/**
 * One-time "Set up Siwu Connect" (run from a phone, no computer needed).
 *
 * Installs the Firestore security rules and indexes, adds the five towns, authorises the
 * website's domain for sign-in, and makes the founder's account Super Admin. Safe to run
 * again: every step is idempotent. Only the founder's verified account may run it while no
 * Super Admin exists; afterwards only a Super Admin may re-run it (e.g. after an update).
 */
import { TOWNS, nameTokens } from '@siwu/shared';
import type { Caller } from './auth';
import { type Env, isEmulator } from './env';
import { FieldValue, Firestore } from './firestore';
import { FIRESTORE_INDEXES, FIRESTORE_RULES } from './generated/firebase-assets';
import { googleAccessToken } from './google-auth';

export interface SetupStep {
  id: 'credentials' | 'rules' | 'indexes' | 'towns' | 'search' | 'domains' | 'superAdmin';
  label: string;
  ok: boolean;
  detail: string;
}

export interface SetupStatus {
  founderEmailConfigured: boolean;
  isFounder: boolean;
  keyConfigured: boolean;
  superAdminExists: boolean;
  callerIsSuperAdmin: boolean;
}

async function superAdminExists(fs: Firestore): Promise<boolean> {
  const rows = await fs.query({ collection: 'admin_roles', where: [['role', 'EQUAL', 'super_admin']], limit: 1 });
  return rows.length > 0;
}

export async function setupStatus(env: Env, caller: Caller): Promise<SetupStatus> {
  const founder = (env.FOUNDER_EMAIL ?? '').trim().toLowerCase();
  const keyConfigured = isEmulator(env) || !!env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let exists = false;
  let callerIsSuperAdmin = false;
  if (keyConfigured) {
    const fs = new Firestore(env);
    exists = await superAdminExists(fs);
    const role = await fs.get<{ role: string }>(`admin_roles/${caller.uid}`);
    callerIsSuperAdmin = role?.data.role === 'super_admin';
  }
  return {
    founderEmailConfigured: !!founder,
    isFounder: !!founder && caller.email === founder && caller.emailVerified,
    keyConfigured,
    superAdminExists: exists,
    callerIsSuperAdmin,
  };
}

async function google(env: Env, url: string, init: RequestInit = {}) {
  const token = await googleAccessToken(env);
  return fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
}

async function errorText(res: Response): Promise<string> {
  const body = await res.text();
  try {
    return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

async function deployRules(env: Env): Promise<string> {
  const p = env.FIREBASE_PROJECT_ID;
  const created = await google(env, `https://firebaserules.googleapis.com/v1/projects/${p}/rulesets`, {
    method: 'POST',
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: FIRESTORE_RULES }] } }),
  });
  if (!created.ok) throw new Error(`Could not upload the security rules: ${await errorText(created)}`);
  const { name: rulesetName } = (await created.json()) as { name: string };
  const releaseName = `projects/${p}/releases/cloud.firestore`;
  let res = await google(env, `https://firebaserules.googleapis.com/v1/${releaseName}`, {
    method: 'PATCH',
    body: JSON.stringify({ release: { name: releaseName, rulesetName } }),
  });
  if (res.status === 404) {
    res = await google(env, `https://firebaserules.googleapis.com/v1/projects/${p}/releases`, {
      method: 'POST',
      body: JSON.stringify({ name: releaseName, rulesetName }),
    });
  }
  if (!res.ok) throw new Error(`Could not activate the security rules: ${await errorText(res)}`);
  return 'Security rules are active.';
}

/** Indexes are created a batch at a time: Cloudflare allows ~50 outgoing requests per call. */
export const INDEX_BATCH = 20;

async function deployIndexes(env: Env, from: number): Promise<{ detail: string; created: number; existing: number; next: number | null }> {
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/collectionGroups`;
  let created = 0;
  let existing = 0;
  const failed: string[] = [];
  const batch = FIRESTORE_INDEXES.slice(from, from + INDEX_BATCH);
  for (const idx of batch) {
    const res = await google(env, `${base}/${idx.collectionGroup}/indexes`, {
      method: 'POST',
      body: JSON.stringify({ queryScope: idx.queryScope, fields: idx.fields }),
    });
    if (res.ok) created++;
    else if (res.status === 409) existing++;
    else failed.push(`${idx.collectionGroup}: ${await errorText(res)}`);
  }
  if (failed.length) throw new Error(`${failed.length} of ${FIRESTORE_INDEXES.length} indexes failed. First error — ${failed[0]}`);
  const end = from + batch.length;
  return {
    detail: `${created} indexes started building, ${existing} already existed. Building can take a few minutes.`,
    created,
    existing,
    next: end < FIRESTORE_INDEXES.length ? end : null,
  };
}

async function authorizeDomains(env: Env): Promise<string> {
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${env.FIREBASE_PROJECT_ID}/config`;
  const current = await google(env, url);
  if (!current.ok) throw new Error(`Could not read sign-in settings: ${await errorText(current)}`);
  const domains = ((await current.json()) as { authorizedDomains?: string[] }).authorizedDomains ?? [];
  const wanted = env.ALLOWED_ORIGINS.split(',')
    .map((o) => {
      try {
        return new URL(o.trim()).hostname;
      } catch {
        return '';
      }
    })
    .filter((h) => h && h !== 'localhost' && h !== '127.0.0.1');
  const missing = wanted.filter((h) => !domains.includes(h));
  if (!missing.length) return 'Website address already allowed for sign-in.';
  const res = await google(env, `${url}?updateMask=authorizedDomains`, {
    method: 'PATCH',
    body: JSON.stringify({ authorizedDomains: [...domains, ...missing] }),
  });
  if (!res.ok) throw new Error(`Could not allow the website for sign-in: ${await errorText(res)}`);
  return `Allowed for sign-in: ${missing.join(', ')}.`;
}

async function seedTowns(fs: Firestore): Promise<string> {
  await fs.commit(TOWNS.map((t) => ({ kind: 'set' as const, path: `towns/${t.id}`, data: { ...t, active: true } })));
  // One group chat per town plus an Akpafu-wide room. Existing rooms keep their last message.
  const rooms = [{ id: 'all', name: 'All Akpafu' }, ...TOWNS.map((t) => ({ id: t.id as string, name: t.name as string }))];
  const writes = [];
  for (const r of rooms) {
    if (await fs.get(`chats/room_${r.id}`)) continue;
    writes.push({
      kind: 'create' as const,
      path: `chats/room_${r.id}`,
      data: { type: 'room', townId: r.id, name: r.name, lastMessage: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
    });
  }
  if (writes.length) await fs.commit(writes);
  return `${TOWNS.length} towns ready: ${TOWNS.map((t) => t.shortName).join(', ')}. Town chat rooms ready.`;
}

/** Adds the "any part of the name" search keys to members who joined before people search had them. */
async function backfillNameTokens(fs: Firestore): Promise<string> {
  const users = await fs.query<{ displayName?: string; username?: string; nameTokens?: string[] }>({ collection: 'users', limit: 2000 });
  const writes = users
    .filter((u) => !Array.isArray(u.data.nameTokens) && u.data.displayName && u.data.username)
    .map((u) => ({ kind: 'update' as const, path: u.path, data: { nameTokens: nameTokens(u.data.displayName!, u.data.username!) } }));
  for (let i = 0; i < writes.length; i += 400) await fs.commit(writes.slice(i, i + 400));
  return writes.length ? `Search updated for ${writes.length} members.` : 'People search is up to date.';
}

async function grantFounder(fs: Firestore, caller: Caller): Promise<string> {
  if (await superAdminExists(fs)) return 'A Super Admin already exists — no change.';
  const path = `admin_roles/${caller.uid}`;
  await fs.commit([
    { kind: 'set', path, data: { role: 'super_admin', townIds: [], grantedBy: 'setup', grantedAt: FieldValue.serverTimestamp() } },
    {
      kind: 'create',
      path: `audit_logs/${fs.newId()}`,
      data: { actorId: caller.uid, action: 'setup.super_admin', targetPath: path, townId: 'all', details: {}, at: FieldValue.serverTimestamp() },
    },
  ]);
  return 'Your account is now Super Admin.';
}

export interface SetupResult {
  ok: boolean;
  steps: SetupStep[];
  /** For the "indexes" part: where the next batch starts, or null when all are done. */
  next?: number | null;
  created?: number;
  existing?: number;
  total?: number;
}

/**
 * Runs one part of the setup. The page calls "core" first, then "indexes" in batches
 * (each call stays under Cloudflare's per-request limit on outgoing calls).
 * Calling without a part runs everything (used by tests and the local emulators).
 */
export async function runSetup(env: Env, caller: Caller, part: 'core' | 'indexes' | 'all' = 'all', from = 0): Promise<SetupResult> {
  const steps: SetupStep[] = [];
  const run = async (id: SetupStep['id'], label: string, fn: () => Promise<string>) => {
    try {
      steps.push({ id, label, ok: true, detail: await fn() });
    } catch (e) {
      steps.push({ id, label, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  const emulator = isEmulator(env);
  const fs = new Firestore(env);

  await run('credentials', 'Firebase key', async () => {
    if (emulator) return 'Local test mode.';
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('The Firebase key has not been added in Cloudflare yet.');
    await googleAccessToken(env);
    return 'Key accepted by Google.';
  });
  if (!steps[0]!.ok) return { ok: false, steps };

  let indexInfo: Pick<SetupResult, 'next' | 'created' | 'existing' | 'total'> = {};
  const indexes = async () => {
    if (emulator) {
      indexInfo = { next: null, created: 0, existing: 0, total: FIRESTORE_INDEXES.length };
      return 'Skipped in local test mode.';
    }
    if (part === 'all') {
      let created = 0;
      let existing = 0;
      let next: number | null = 0;
      while (next !== null) {
        const r = await deployIndexes(env, next);
        created += r.created;
        existing += r.existing;
        next = r.next;
      }
      return `${created} indexes started building, ${existing} already existed. Building can take a few minutes.`;
    }
    const r = await deployIndexes(env, from);
    indexInfo = { next: r.next, created: r.created, existing: r.existing, total: FIRESTORE_INDEXES.length };
    return r.detail;
  };

  if (part !== 'indexes') await run('rules', 'Security rules', () => (emulator ? Promise.resolve('Skipped in local test mode.') : deployRules(env)));
  if (part !== 'core') await run('indexes', 'Database indexes', indexes);
  if (part !== 'indexes') {
    await run('towns', 'Five towns', () => seedTowns(fs));
    await run('search', 'People search', () => backfillNameTokens(fs));
    await run('domains', 'Website sign-in', () => (emulator ? Promise.resolve('Skipped in local test mode.') : authorizeDomains(env)));
    await run('superAdmin', 'Super Admin', () => grantFounder(fs, caller));
  }
  return { ok: steps.every((s) => s.ok), steps, ...indexInfo };
}
