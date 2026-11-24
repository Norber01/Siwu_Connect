#!/usr/bin/env node
/**
 * Restores a Siwu Connect backup file (downloaded from Admin → Backups) into Firestore.
 *
 *   Local emulator (for checking a backup):
 *     node scripts/restore-backup.mjs <file.json.gz> --emulator
 *   Real project (needs a Google access token with Firestore admin rights, e.g. from
 *   `gcloud auth print-access-token` — never commit or share it):
 *     ACCESS_TOKEN=... node scripts/restore-backup.mjs <file.json.gz> --project <firebase-project-id> [--only users,posts]
 *
 * Documents are written back exactly as saved (same ids and fields). Existing documents with the same
 * ids are overwritten; documents created after the backup are left alone.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !['--project', '--only'].includes(args[i - 1]));
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const emulator = args.includes('--emulator');
if (!file) {
  console.error('Usage: node scripts/restore-backup.mjs <file.json.gz> (--emulator | --project <id>) [--only a,b]');
  process.exit(1);
}

const backup = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
if (backup.format !== 'siwu-connect-backup') throw new Error('This is not a Siwu Connect backup file.');
const project = emulator ? 'demo-siwu' : flag('--project');
if (!project) throw new Error('Pass --project <firebase-project-id> or --emulator.');
const token = emulator ? 'owner' : process.env.ACCESS_TOKEN;
if (!token) throw new Error('Set ACCESS_TOKEN for a real project.');
const base = emulator ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
const only = flag('--only')?.split(',');

console.log(`Backup from ${backup.createdAt} (project ${backup.project})${backup.complete ? '' : ' — PARTIAL: ' + backup.note}`);
const writes = [];
for (const [collection, docs] of Object.entries(backup.collections)) {
  if (only && !only.includes(collection)) continue;
  for (const d of docs) {
    const path = d.name.split('/documents/')[1];
    writes.push({ update: { name: `projects/${project}/databases/(default)/documents/${path}`, fields: d.fields } });
  }
}
for (let i = 0; i < writes.length; i += 400) {
  const res = await fetch(`${base}/v1/projects/${project}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
  });
  if (!res.ok) throw new Error(`Write failed: ${res.status} ${await res.text()}`);
  console.log(`Restored ${Math.min(i + 400, writes.length)} / ${writes.length}`);
}
console.log('Done.');
