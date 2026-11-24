/**
 * One-time "Set up Siwu Connect" (run from a phone, no computer needed).
 *
 * Installs the Firestore security rules and indexes, adds the five towns, authorises the
 * website's domain for sign-in, and makes the founder's account Super Admin. Safe to run
 * again: every step is idempotent. Only the founder's verified account may run it while no
 * Super Admin exists; afterwards only a Super Admin may re-run it (e.g. after an update).
 */
import { TOWNS } from '@siwu/shared';
import type { Caller } from './auth';
import { type Env, isEmulator } from './env';
import { FieldValue, Firestore } from './firestore';
import { FIRESTORE_INDEXES, FIRESTORE_RULES } from './generated/firebase-assets';
import { googleAccessToken } from './google-auth';

export interface SetupStep {
  id: 'credentials' | 'rules' | 'indexes' | 'towns' | 'domains' | 'superAdmin';
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

async function deployIndexes(env: Env): Promise<string> {
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/collectionGroups`;
  let created = 0;
  let existing = 0;
  const failed: string[] = [];
  for (const idx of FIRESTORE_INDEXES) {
    const res = await google(env, `${base}/${idx.collectionGroup}/indexes`, {
      method: 'POST',
      body: JSON.stringify({ queryScope: idx.queryScope, fields: idx.fields }),
    });
    if (res.ok) created++;
    else if (res.status === 409) existing++;
    else failed.push(`${idx.collectionGroup}: ${await errorText(res)}`);
  }
  if (failed.length) throw new Error(`${failed.length} of ${FIRESTORE_INDEXES.length} indexes failed. First error — ${failed[0]}`);
  return `${created} indexes started building, ${existing} already existed. Building can take a few minutes.`;
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

export async function runSetup(env: Env, caller: Caller): Promise<{ ok: boolean; steps: SetupStep[] }> {
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

  await run('rules', 'Security rules', () => (emulator ? Promise.resolve('Skipped in local test mode.') : deployRules(env)));
  await run('indexes', 'Database indexes', () => (emulator ? Promise.resolve('Skipped in local test mode.') : deployIndexes(env)));
  await run('towns', 'Five towns', () => seedTowns(fs));
  await run('domains', 'Website sign-in', () => (emulator ? Promise.resolve('Skipped in local test mode.') : authorizeDomains(env)));
  await run('superAdmin', 'Super Admin', () => grantFounder(fs, caller));
  return { ok: steps.every((s) => s.ok), steps };
}
