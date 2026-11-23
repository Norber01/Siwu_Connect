#!/usr/bin/env node
/**
 * SAMPLE DATA FOR LOCAL DEMOS AND SCREENSHOTS ONLY.
 * Writes fictional users and posts into the local Firebase EMULATOR (project demo-siwu).
 * It only ever talks to the local emulator ports (127.0.0.1). Never use as production data.
 */
const PROJECT = 'demo-siwu';
const FS = 'http://127.0.0.1:8080';
const AUTH = 'http://127.0.0.1:9099';
const docs = `projects/${PROJECT}/databases/(default)/documents`;

const enc = (v) =>
  v === null ? { nullValue: null }
  : v instanceof Date ? { timestampValue: v.toISOString() }
  : typeof v === 'number' ? { integerValue: String(v) }
  : typeof v === 'boolean' ? { booleanValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
  : { stringValue: String(v) };
const set = (path, data) => ({ update: { name: `${docs}/${path}`, fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) } });
async function commit(writes) {
  const r = await fetch(`${FS}/v1/${docs}:commit`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ writes }) });
  if (!r.ok) throw new Error(await r.text());
}
const ago = (min) => new Date(Date.now() - min * 60_000);
const tokens = (t) => [...new Set(t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 2))].slice(0, 50);

await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });

const people = [
  ['akpafu_today', 'Akpafu Today', 'odomi', null],
  ['ama_serwaa', 'Ama Serwaa', 'mempeasem', 'abroad'],
  ['kofi_mensah', 'Kofi Mensah', 'todzi', 'ghana'],
  ['efua_adokor', 'Efua Agbeko', 'adokor', 'hometown'],
  ['demo_admin', 'Siwu Admin', 'odomi', 'hometown'],
];
const uids = {};
for (const [username, name, town, residence] of people) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${username}@example.com`, password: 'demo-password-1', returnSecureToken: true }),
  });
  const uid = (await r.json()).localId;
  uids[username] = uid;
  await commit([
    set(`users/${uid}`, { displayName: name, displayNameLower: name.toLowerCase(), username, photoUrl: null, hometownId: town, residence, countryCode: residence === 'abroad' ? 'GB' : residence ? 'GH' : null, status: 'active', createdAt: ago(5000), updatedAt: ago(5000) }),
    set(`usernames/${username}`, { uid }),
  ]);
}
const towns = [['odomi', 'Akpafu Odomi', 'Odomi', 1], ['mempeasem', 'Akpafu Mempeasem', 'Mempeasem', 2], ['todzi', 'Akpafu Todzi', 'Todzi', 3], ['adokor', 'Akpafu Adokor', 'Adokor', 4]];
await commit(towns.map(([id, name, shortName, order]) => set(`towns/${id}`, { id, name, shortName, order, active: true })));
await commit([set('admin_roles/' + uids.demo_admin, { role: 'super_admin', townIds: [], username: 'demo_admin' })]);

const posts = [
  ['p1', 'akpafu_today', 'odomi', 'Welcome to the new Siwu Connect! 🎉 Let\'s keep our community strong 💚 Share news from your town, ask questions and stay in touch with home.', 120, 12, 3],
  ['p2', 'ama_serwaa', 'mempeasem', 'Beautiful day in Akpafu! ☀️ Greetings to everyone from London. Missing home a lot this season.', 180, 5, 1],
  ['p3', 'kofi_mensah', 'todzi', 'The Todzi youth group is organising a clean-up of the stream path this Saturday at 7am. Bring a cutlass or broom if you can. Water will be provided.', 300, 8, 2],
  ['p4', 'efua_adokor', 'adokor', 'Does anyone know the new opening hours for the Adokor clinic? My mother needs to go on Monday.', 420, 2, 2],
];
const writes = [];
for (const [id, who, town, text, min, likes, comments] of posts) {
  writes.push(set(`posts/${id}`, { authorId: uids[who], townId: town, text, visibility: 'akpafu', status: 'published', pinned: id === 'p1', reactionCount: likes, commentCount: comments, lastCommentOp: null, searchTokens: tokens(text), createdAt: ago(min), updatedAt: ago(min), editedAt: null }));
  for (let c = 0; c < comments; c++) {
    const author = people[(c + 1) % 4][0];
    writes.push(set(`posts/${id}/comments/c${c}`, { authorId: uids[author], townId: town, text: ['Thank you for this!', 'We will be there 💪', 'Great news for the community.'][c % 3], status: 'published', createdAt: ago(min - 10 - c) }));
  }
}
writes.push(set('announcements/a1', { townId: 'all', title: 'Akpafu Cultural Festival', body: 'The festival takes place on Saturday 24 May at Akpafu Odomi. All four towns are invited — come and celebrate together!', pinned: true, status: 'published', authorId: uids.demo_admin, createdAt: ago(60), updatedAt: ago(60), expiresAt: null }));
writes.push(set(`posts/p1/reactions/${uids.demo_admin}`, { type: 'like', userId: uids.demo_admin, postId: 'p1', createdAt: ago(30) }));
await commit(writes);
console.log('Sample data written to the emulator. Sign in as demo_admin@example.com / demo-password-1');
