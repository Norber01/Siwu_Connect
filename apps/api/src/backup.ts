/**
 * Daily database backup (free plan friendly): every collection is read through the Firestore REST API and
 * saved as one gzipped JSON file in the R2 bucket under backups/ (private: never served to the public).
 * The newest 14 are kept. Restore with scripts/restore-backup.mjs.
 */
import type { Env } from './env';
import { Firestore } from './firestore';

/** Every collection (and sub-collection) name used by the app. */
export const BACKUP_COLLECTIONS = [
  'admin_roles',
  'announcements',
  'audit_logs',
  'blocks',
  'chatState',
  'chats',
  'comments',
  'directory',
  'events',
  'feedback',
  'friendships',
  'listings',
  'matches',
  'messages',
  'notifications',
  'pollVotes',
  'posts',
  'predictions',
  'rate_limits',
  'reactions',
  'reports',
  'rsvps',
  'settings',
  'stories',
  'towns',
  'updates',
  'usernames',
  'users',
  'users_private',
  'views',
  'votes',
  'words',
];

const KEEP = 14;
const PAGE = 2000;

export interface BackupResult {
  key: string;
  documents: number;
  bytes: number;
  complete: boolean;
  note?: string;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array((await new Response(stream as ReadableStream).arrayBuffer()) as ArrayBuffer);
}

export async function runBackup(env: Env, now = new Date()): Promise<BackupResult> {
  const fs = new Firestore(env);
  const collections: Record<string, { name: string; fields: unknown }[]> = {};
  let documents = 0;
  let complete = true;
  let note: string | undefined;
  try {
    for (const id of BACKUP_COLLECTIONS) {
      const docs: { name: string; fields: unknown }[] = [];
      let after: string | undefined;
      for (;;) {
        const page = await fs.exportGroup(id, PAGE, after);
        docs.push(...page);
        if (page.length < PAGE) break;
        after = page[page.length - 1]!.name;
      }
      collections[id] = docs;
      documents += docs.length;
    }
  } catch (e) {
    // Cloudflare's free plan limits outgoing calls per run; keep what was read and say so.
    complete = false;
    note = `Partial backup: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
  }
  const body = await gzip(
    JSON.stringify({
      format: 'siwu-connect-backup',
      version: 1,
      project: env.FIREBASE_PROJECT_ID,
      createdAt: now.toISOString(),
      complete,
      note,
      collections,
    }),
  );
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const key = `backups/${stamp}.json.gz`;
  await env.AVATARS.put(key, body, { httpMetadata: { contentType: 'application/gzip' } });

  // Keep the newest 14.
  const existing = (await env.AVATARS.list({ prefix: 'backups/', limit: 1000 })).objects.map((o) => o.key).sort();
  const old = existing.slice(0, Math.max(0, existing.length - KEEP));
  if (old.length) await env.AVATARS.delete(old);
  return { key, documents, bytes: body.byteLength, complete, note };
}
