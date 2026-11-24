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
const towns = [['odomi', 'Akpafu Odomi', 'Odomi', 1], ['mempeasem', 'Akpafu Mempeasem', 'Mempeasem', 2], ['todzi', 'Akpafu Todzi', 'Todzi', 3], ['adokor', 'Akpafu Adokor', 'Adokor', 4], ['sokpo', 'Akpafu Sokpo', 'Sokpo', 5]];
await commit(towns.map(([id, name, shortName, order]) => set(`towns/${id}`, { id, name, shortName, order, active: true })));
await commit([['all', 'All Akpafu'], ...towns.map(([id, name]) => [id, name])].map(([id, name]) =>
  set(`chats/room_${id}`, { type: 'room', townId: id, name, lastMessage: null, createdAt: ago(9000), updatedAt: ago(9000) })));
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
writes.push(set('announcements/a1', { townId: 'all', title: 'Akpafu Cultural Festival', body: 'The festival takes place on Saturday 24 May at Akpafu Odomi. All five towns are invited — come and celebrate together!', pinned: true, status: 'published', authorId: uids.demo_admin, createdAt: ago(60), updatedAt: ago(60), expiresAt: null }));
writes.push(set(`posts/p1/reactions/${uids.demo_admin}`, { type: 'like', userId: uids.demo_admin, postId: 'p1', createdAt: ago(30) }));
const days = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d; };
const ev = [
  ['e1', 'demo_admin', 'odomi', 'Akpafu Cultural Festival', 'festival', 'Odomi Durbar Grounds', 4, 9, 'Drumming, dancing and food from all five towns. Bring the family!', 48, 30],
  ['e2', 'kofi_mensah', 'todzi', 'Youth football tournament draw', 'sports', 'Todzi Community Centre', 2, 16, 'Team captains please attend.', 12, 5],
  ['e3', 'efua_adokor', 'adokor', 'Harvest Thanksgiving Service', 'church', 'E.P. Church, Adokor', 7, 9, 'Everyone is welcome.', 20, 14],
];
for (const [id, who, town, title, cat, loc, inDays, hour, desc, going, interested] of ev)
  writes.push(set(`events/${id}`, { authorId: uids[who], townId: town, title, description: desc, category: cat, location: loc, startsAt: days(inDays, hour), endsAt: null, imageUrl: null, status: 'published', goingCount: going, interestedCount: interested, createdAt: ago(200), updatedAt: ago(200) }));
const ls = [
  ['l1', 'efua_adokor', 'adokor', 'Fresh tomatoes', 'food', 20, 'basket', 'Picked this morning from my farm.', '+233241234567'],
  ['l2', 'ama_serwaa', 'mempeasem', 'Kente cloth (6 yards)', 'clothing', 850, '', 'Handwoven, never used.', '+233201112222'],
  ['l3', 'kofi_mensah', 'todzi', 'Phone repairs', 'services', null, '', 'Screens, batteries and charging ports. Quick service.', '+233551234567'],
  ['l4', 'akpafu_today', 'odomi', 'Palm oil', 'food', 45, 'gallon', 'Pure, locally made.', null],
];
for (const [id, who, town, title, cat, price, unit, desc, phone] of ls)
  writes.push(set(`listings/${id}`, { sellerId: uids[who], townId: town, title, description: desc, category: cat, price, priceUnit: unit, imageUrl: null, contactPhone: phone, contactWhatsApp: !!phone, status: 'available', searchTokens: tokens(title + ' ' + desc), createdAt: ago(90 + ls.length), updatedAt: ago(90) }));
const team = (t) => ({ name: t[0].toUpperCase() + t.slice(1), townId: t });
const mt = [
  ['m1', 'odomi', 'mempeasem', 'live', 1, 0, 32, ago(32), 62, 10, 28],
  ['m2', 'todzi', 'adokor', 'scheduled', 0, 0, null, days(3, 15), 4, 2, 6],
  ['m3', 'odomi', 'todzi', 'finished', 2, 2, 90, days(-7, 15), 0, 0, 0],
  ['m4', 'mempeasem', 'adokor', 'finished', 3, 1, 90, days(-6, 15), 0, 0, 0],
  ['m5', 'adokor', 'odomi', 'finished', 0, 1, 90, days(-3, 15), 0, 0, 0],
  ['m6', 'sokpo', 'todzi', 'live', 0, 0, null, ago(47), 3, 1, 2],
];
for (const [id, h, a, status, hs, as, min, ko, vh, vd, va] of mt)
  writes.push(set(`matches/${id}`, { competition: 'Akpafu Community Cup', home: team(h), away: team(a), venue: `${team(h).name} Park`, kickoffAt: ko, durationMinutes: 90, breakMinutes: 5, actualKickoffAt: null, secondHalfStartAt: null, status, homeScore: hs, awayScore: as, minute: min, votesHome: vh, votesDraw: vd, votesAway: va, createdBy: uids.demo_admin, createdAt: ago(5000), updatedAt: ago(1) }));
writes.push(set('matches/m1/updates/u1', { type: 'chance', team: 'home', minute: 15, text: 'Great chance for Odomi!', createdBy: uids.demo_admin, createdAt: ago(17) }));
writes.push(set('matches/m1/updates/u2', { type: 'yellow', team: 'away', minute: 28, text: '', createdBy: uids.demo_admin, createdAt: ago(4) }));
writes.push(set('matches/m1/updates/u3', { type: 'goal', team: 'home', minute: 32, text: 'Odomi takes the lead!', createdBy: uids.demo_admin, createdAt: ago(1) }));
writes.push(set(`users/${uids.demo_admin}/notifications/like_p1_x`, { type: 'like', actorId: uids.ama_serwaa, postId: 'p1', commentId: null, read: false, createdAt: ago(20) }));
writes.push(set(`users/${uids.demo_admin}/notifications/comment_c9`, { type: 'comment', actorId: uids.kofi_mensah, postId: 'p1', commentId: 'c0', read: false, createdAt: ago(8) }));
await commit(writes);
console.log('Sample data written to the emulator. Sign in as demo_admin@example.com / demo-password-1');
