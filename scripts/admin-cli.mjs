#!/usr/bin/env node
/**
 * Siwu Connect admin CLI — one-off setup tasks that need admin credentials.
 *
 *   node scripts/admin-cli.mjs seed-towns
 *   node scripts/admin-cli.mjs grant-super-admin <username>
 *
 * Local emulators (default):   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-siwu
 * Production:                  FIREBASE_PROJECT_ID=<id> GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json
 *
 * The towns written here are the real, founder-confirmed town records (not test data).
 */
import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

const TOWNS = [
  { id: 'odomi', name: 'Akpafu Odomi', shortName: 'Odomi', order: 1 },
  { id: 'mempeasem', name: 'Akpafu Mempeasem', shortName: 'Mempeasem', order: 2 },
  { id: 'todzi', name: 'Akpafu Todzi', shortName: 'Todzi', order: 3 },
  { id: 'adokor', name: 'Akpafu Adokor', shortName: 'Adokor', order: 4 },
  { id: 'sokpo', name: 'Akpafu Sokpo', shortName: 'Sokpo', order: 5 },
];

const project = process.env.FIREBASE_PROJECT_ID ?? 'demo-siwu';
const emulator = process.env.FIRESTORE_EMULATOR_HOST ?? (project.startsWith('demo-') ? '127.0.0.1:8080' : null);
const base = emulator ? `http://${emulator}` : 'https://firestore.googleapis.com';
const docs = `projects/${project}/databases/(default)/documents`;

async function token() {
  if (emulator) return 'owner';
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file.');
  const sa = JSON.parse(readFileSync(file, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(await importPKCS8(sa.private_key, 'RS256'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  return (await res.json()).access_token;
}

const enc = (v) =>
  v === null ? { nullValue: null }
  : typeof v === 'number' ? { integerValue: String(v) }
  : typeof v === 'boolean' ? { booleanValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
  : { stringValue: String(v) };

async function call(path, init = {}) {
  const res = await fetch(`${base}/v1/${docs}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
  });
  if (!res.ok && res.status !== 404) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 404 ? null : res.json();
}

async function commit(writes) {
  return call(':commit', { method: 'POST', body: JSON.stringify({ writes }) });
}

const set = (path, data, serverTime = []) => ({
  update: { name: `${docs}/${path}`, fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) },
  ...(serverTime.length ? { updateTransforms: serverTime.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })) } : {}),
});

const [cmd, arg] = process.argv.slice(2);
console.log(`Project: ${project}${emulator ? ` (emulator ${emulator})` : ''}`);

if (cmd === 'seed-towns') {
  await commit(TOWNS.map((t) => set(`towns/${t.id}`, { ...t, active: true })));
  console.log(`Wrote ${TOWNS.length} town records.`);
} else if (cmd === 'grant-super-admin' && arg) {
  const username = arg.replace(/^@/, '').toLowerCase();
  const name = await call(`/usernames/${username}`);
  if (!name) throw new Error(`No user with username @${username}. They must sign up and finish onboarding first.`);
  const uid = name.fields.uid.stringValue;
  const id = crypto.randomUUID().replace(/-/g, '');
  await commit([
    set(`admin_roles/${uid}`, { role: 'super_admin', townIds: [], username, grantedBy: 'admin-cli' }, ['grantedAt']),
    set(`audit_logs/${id}`, { actorId: 'admin-cli', action: 'role.grant', targetPath: `admin_roles/${uid}`, townId: 'all', details: { role: 'super_admin', username } }, ['at']),
  ]);
  console.log(`@${username} is now a Super Admin.`);
} else {
  console.log('Usage:\n  node scripts/admin-cli.mjs seed-towns\n  node scripts/admin-cli.mjs grant-super-admin <username>');
  process.exit(1);
}
