#!/usr/bin/env node
/**
 * Publishes apps/web/dist to Cloudflare Pages in a single "create deployment" request
 * (manifest + file contents together). Used when `wrangler pages deploy` cannot run
 * (its separate asset-upload step needs a short-lived upload token).
 *
 *   CLOUDFLARE_ACCOUNT_ID=... node scripts/pages-direct-upload.mjs <project> [dir]
 * The API token is sent as Authorization: Bearer $CLOUDFLARE_API_TOKEN.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import blake3 from 'blake3-wasm';

const [project, dir = 'apps/web/dist'] = process.argv.slice(2);
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN ?? 'proxy-injected';
if (!project || !account) throw new Error('usage: CLOUDFLARE_ACCOUNT_ID=... node scripts/pages-direct-upload.mjs <project> [dir]');

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(dir).filter((f) => !f.endsWith('.map'));

const form = new FormData();
const manifest = {};
for (const f of files) {
  const content = readFileSync(f);
  // Same content hash as wrangler: blake3(base64(content) + extension without dot), first 32 hex chars.
  const hash = blake3.hash(content.toString('base64') + extname(f).slice(1)).toString('hex').slice(0, 32);
  manifest[`/${relative(dir, f).split('\\').join('/')}`] = hash;
  form.append(hash, new Blob([content]), relative(dir, f));
}
form.append('manifest', JSON.stringify(manifest));
form.append('branch', 'main');

const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}/deployments`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: form,
});
const json = await res.json();
if (!json.success) {
  console.error(JSON.stringify(json.errors));
  process.exit(1);
}
console.log(`Deployed ${files.length} files: ${json.result.url}`);
