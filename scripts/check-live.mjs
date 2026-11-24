#!/usr/bin/env node
/**
 * Quick check of the LIVE site and API after a deploy (read-only; changes nothing):
 *   node scripts/check-live.mjs [siteUrl] [apiUrl]
 * (Behind an HTTPS proxy, run it with NODE_USE_ENV_PROXY=1 so Node uses the proxy.)
 * Exits with an error if anything is wrong, listing what failed.
 */
const SITE = (process.argv[2] ?? 'https://siwu-connect.fnorxx.workers.dev').replace(/\/$/, '');
const API = (process.argv[3] ?? 'https://siwu-connect-api.fnorxx.workers.dev').replace(/\/$/, '');
const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail: detail ?? '' });
  } catch (e) {
    results.push({ ok: false, name, detail: e instanceof Error ? e.message : String(e) });
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await check('Website loads', async () => {
  const r = await fetch(`${SITE}/`);
  expect(r.ok, `status ${r.status}`);
  expect((await r.text()).includes('<div id="root">'), 'page does not contain the app');
  return `status ${r.status}`;
});
await check('Microphone and camera allowed for the site', async () => {
  const p = (await fetch(`${SITE}/chat`)).headers.get('permissions-policy') ?? '';
  expect(p.includes('microphone=(self)') && p.includes('camera=(self)'), `permissions-policy is "${p}"`);
  return p;
});
await check('Cannot be framed; no type sniffing', async () => {
  const h = (await fetch(`${SITE}/`)).headers;
  expect(h.get('x-frame-options') === 'DENY', `x-frame-options is ${h.get('x-frame-options')}`);
  expect(h.get('x-content-type-options') === 'nosniff', `x-content-type-options is ${h.get('x-content-type-options')}`);
});
await check('Pages are loaded fresh (not from the offline cache)', async () => {
  const sw = await (await fetch(`${SITE}/sw.js`)).text();
  expect(sw.includes('NetworkFirst'), 'service worker does not load pages network-first');
  expect(!/["']index\.html["']/.test(sw), 'service worker pre-caches index.html');
  const cc = (await fetch(`${SITE}/`)).headers.get('cache-control');
  expect(cc === 'no-cache', `index cache-control is ${cc}`);
});
await check('API is healthy', async () => {
  const r = await fetch(`${API}/health`);
  expect(r.ok, `status ${r.status}`);
  expect((await r.json()).ok === true, 'health is not ok');
});
await check('API accepts requests from the website', async () => {
  const r = await fetch(`${API}/setup/status`, {
    method: 'OPTIONS',
    headers: { origin: SITE, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
  });
  expect(r.headers.get('access-control-allow-origin') === SITE, `CORS allow-origin is ${r.headers.get('access-control-allow-origin')}`);
});
await check('API refuses requests without sign-in', async () => {
  const r = await fetch(`${API}/admin/approvals`);
  expect(r.status === 401, `status ${r.status}`);
});

for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
if (results.some((r) => !r.ok)) process.exit(1);
