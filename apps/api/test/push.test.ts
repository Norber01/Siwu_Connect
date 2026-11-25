/**
 * Phone notifications end to end against the Firestore emulator: devices register, the app reports what it
 * saved, and real encrypted pushes arrive at a local pretend push service, where a pretend browser decrypts them.
 * Run with `npm run test:emulator`.
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Env, R2BucketLike } from '../src/env';
import { type Data, Firestore } from '../src/firestore';
import { runHourly } from '../src/push';
import { generateVapidKeys } from '../src/webpush';
import { fakeBrowser } from './fake-browser';

const PROJECT = 'demo-siwu-push';
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const noBucket = {} as R2BucketLike;

let keys: { publicKey: string; privateKey: string };
let server: Server;
let base = '';
/** Encrypted bodies received by the pretend push service, per device name. */
const received = new Map<string, Uint8Array[]>();
const browsers = new Map<string, Awaited<ReturnType<typeof fakeBrowser>>>();
let self: Env['SELF'];

const env = (): Env => ({
  FIREBASE_PROJECT_ID: PROJECT,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:8787',
  FIRESTORE_EMULATOR_HOST: FS_HOST,
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
  AVATARS: noBucket,
  VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  SELF: self,
});
const fs = () => new Firestore(env());
const app = createApp();

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}` })}.`;
function call(method: string, path: string, uid?: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (uid) headers.authorization = `Bearer ${token(uid)}`;
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env());
}

const seedUser = (uid: string, hometownId = 'odomi', extra: Data = {}) =>
  fs().commit([{ kind: 'set', path: `users/${uid}`, data: { username: uid, displayName: uid.toUpperCase(), hometownId, status: 'active', photoUrl: null, ...extra } }]);
const set = (path: string, data: Data) => fs().commit([{ kind: 'set', path, data }]);

/** Registers a pretend phone for a member. */
async function device(uid: string, name: string) {
  const b = await fakeBrowser();
  browsers.set(name, b);
  const res = await call('POST', '/push/subscribe', uid, { endpoint: `${base}/push/${name}`, keys: b.keys });
  expect(res.status).toBe(200);
}
/** The notifications a pretend phone got (decrypted), and clears them. */
async function inbox(name: string): Promise<{ title: string; body: string; url: string; tag: string | null }[]> {
  const out = await Promise.all((received.get(name) ?? []).map(async (b) => JSON.parse(await browsers.get(name)!.decrypt(b))));
  received.set(name, []);
  return out;
}
const notify = (uid: string, kind: string, path: string, event?: string) => call('POST', '/push/notify', uid, { kind, path, ...(event ? { event } : {}) });

beforeAll(async () => {
  keys = await generateVapidKeys();
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const name = (req.url ?? '').split('/').pop()!;
      expect(req.headers.authorization).toMatch(/^vapid t=.+, k=/);
      expect(req.headers['content-encoding']).toBe('aes128gcm');
      if (name.startsWith('gone')) {
        res.writeHead(410).end();
        return;
      }
      received.set(name, [...(received.get(name) ?? []), new Uint8Array(Buffer.concat(chunks))]);
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(async () => {
  received.clear();
  self = undefined;
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await seedUser('alice', 'odomi');
  await seedUser('bob', 'odomi');
  await seedUser('carol', 'todzi');
});

describe('devices and choices', () => {
  it('registers a device with the member’s topics, and only real push services', async () => {
    const info = (await (await call('GET', '/push/prefs', 'bob')).json()) as { enabled: boolean; publicKey: string; prefs: { sports: string } };
    expect(info).toMatchObject({ enabled: true, publicKey: keys.publicKey, prefs: { sports: 'town' } });
    await device('bob', 'bobphone');
    const subs = await fs().query<{ uid: string; topics: string[] }>({ collection: 'push_subs' });
    expect(subs).toHaveLength(1);
    expect(subs[0]!.data.uid).toBe('bob');
    expect(subs[0]!.data.topics).toEqual(expect.arrayContaining(['account', 'messages', 'ann:odomi', 'events:odomi', 'sports:odomi']));
    const b = await fakeBrowser();
    expect((await call('POST', '/push/subscribe', 'bob', { endpoint: 'https://evil.example/x', keys: b.keys })).status).toBe(400);
  });

  it('choices update every device; the test notification arrives', async () => {
    await device('bob', 'bobphone');
    const prefs = { messages: true, friends: true, social: true, likes: false, announcements: false, events: true, reminders: true, birthdays: true, staff: true, sports: 'all' };
    expect((await call('POST', '/push/prefs', 'bob', prefs)).status).toBe(200);
    const [sub] = await fs().query<{ topics: string[] }>({ collection: 'push_subs' });
    expect(sub!.data.topics).not.toContain('likes');
    expect(sub!.data.topics).not.toContain('ann:odomi');
    expect(sub!.data.topics).toEqual(expect.arrayContaining(['sports:sokpo', 'sports:other']));
    expect(await (await call('GET', '/push/prefs', 'bob')).json()).toMatchObject({ prefs });
    const r = (await (await call('POST', '/push/test', 'bob', {})).json()) as { sent: number };
    expect(r.sent).toBe(1);
    expect(await inbox('bobphone')).toEqual([expect.objectContaining({ title: 'Notifications are working ✅', url: '/settings' })]);
  });

  it('a device can be switched off only by its owner, and forgotten when the phone is gone', async () => {
    await device('bob', 'bobphone');
    await device('bob', 'gone1');
    await call('POST', '/push/unsubscribe', 'alice', { endpoint: `${base}/push/bobphone` });
    expect(await fs().query({ collection: 'push_subs' })).toHaveLength(2);
    await call('POST', '/push/test', 'bob', {});
    expect(await fs().query({ collection: 'push_subs' })).toHaveLength(1); // the 410 device was removed
    await call('POST', '/push/unsubscribe', 'bob', { endpoint: `${base}/push/bobphone` });
    expect(await fs().query({ collection: 'push_subs' })).toHaveLength(0);
  });
});

describe('what notifies whom', () => {
  it('a private message goes to the other person, once, and never to the sender', async () => {
    await device('alice', 'alicephone');
    await device('bob', 'bobphone');
    await set('chats/alice_bob', { type: 'dm', members: ['alice', 'bob'] });
    await set('chats/alice_bob/messages/m1', { senderId: 'alice', status: 'sent', text: 'Akwaaba Bob!', imageUrl: null, createdAt: new Date() });
    await notify('bob', 'message', 'chats/alice_bob/messages/m1'); // not the sender: ignored
    expect(await inbox('bobphone')).toEqual([]);
    await notify('alice', 'message', 'chats/alice_bob/messages/m1');
    await notify('alice', 'message', 'chats/alice_bob/messages/m1'); // twice: still one notification
    expect(await inbox('bobphone')).toEqual([{ title: 'ALICE', body: 'Akwaaba Bob!', url: '/chat/alice_bob', tag: 'chat-alice_bob' }]);
    expect(await inbox('alicephone')).toEqual([]);
    // Town chat rooms don't notify.
    await set('chats/room_odomi', { type: 'room', townId: 'odomi' });
    await set('chats/room_odomi/messages/m2', { senderId: 'alice', status: 'sent', text: 'Hi all', createdAt: new Date() });
    await notify('alice', 'message', 'chats/room_odomi/messages/m2');
    expect(await inbox('bobphone')).toEqual([]);
  });

  it('comments notify the post’s author, unless they switched that off; likes respect "reactions"', async () => {
    await device('bob', 'bobphone');
    await set('posts/p1', { authorId: 'bob', townId: 'odomi', text: 'Festival photos', status: 'published' });
    await set('posts/p1/comments/c1', { authorId: 'alice', text: 'Beautiful!', status: 'published' });
    await set('users/bob/notifications/comment_c1', { type: 'comment', actorId: 'alice', postId: 'p1', commentId: 'c1', read: false, createdAt: new Date() });
    await notify('alice', 'notification', 'users/bob/notifications/comment_c1');
    expect(await inbox('bobphone')).toEqual([expect.objectContaining({ title: '💬 ALICE commented on your post', body: 'Beautiful!', url: '/p/p1#comments' })]);
    // Someone else cannot trigger it.
    await set('users/bob/notifications/like_p1_alice', { type: 'like', actorId: 'alice', postId: 'p1', commentId: null, read: false, createdAt: new Date() });
    await notify('carol', 'notification', 'users/bob/notifications/like_p1_alice');
    expect(await inbox('bobphone')).toEqual([]);
    await call('POST', '/push/prefs', 'bob', { messages: true, friends: true, social: true, likes: false, announcements: true, events: true, reminders: true, birthdays: true, staff: true, sports: 'town' });
    await notify('alice', 'notification', 'users/bob/notifications/like_p1_alice');
    expect(await inbox('bobphone')).toEqual([]);
  });

  it('friend requests notify straight away', async () => {
    await device('bob', 'bobphone');
    expect((await call('POST', '/friends/bob', 'alice')).status).toBe(200);
    expect(await inbox('bobphone')).toEqual([expect.objectContaining({ title: '👋 ALICE sent you a friend request', url: '/u/alice' })]);
  });

  it('goals go to followers of either team’s town, not to the reporter', async () => {
    await set('admin_roles/alice', { role: 'reporter', townIds: ['odomi'] });
    await seedUser('dave', 'sokpo');
    await device('alice', 'alicephone');
    await device('bob', 'bobphone'); // Odomi
    await device('carol', 'carolphone'); // Todzi
    await device('dave', 'davephone'); // Sokpo: not playing
    await set('matches/mt1', { home: { name: 'Odomi FC', townId: 'odomi' }, away: { name: 'Todzi Stars', townId: 'todzi' }, homeScore: 1, awayScore: 0, status: 'live', competition: 'Akpafu Cup' });
    await set('matches/mt1/updates/u1', { type: 'goal', team: 'home', minute: 23, text: 'Header from a corner', createdBy: 'alice', createdAt: new Date() });
    await notify('alice', 'match', 'matches/mt1/updates/u1', 'goal');
    const goal = { title: '⚽ GOAL! Odomi FC', body: 'Odomi FC 1–0 Todzi Stars · 23′ · Header from a corner', url: '/sports/mt1', tag: 'match-mt1' };
    expect(await inbox('bobphone')).toEqual([goal]);
    expect(await inbox('carolphone')).toEqual([goal]);
    expect(await inbox('davephone')).toEqual([]);
    expect(await inbox('alicephone')).toEqual([]);
    // A member without a reporter role cannot announce a full time.
    await set('matches/mt1', { home: { name: 'Odomi FC', townId: 'odomi' }, away: { name: 'Todzi Stars', townId: 'todzi' }, homeScore: 1, awayScore: 0, status: 'finished' });
    await notify('bob', 'match', 'matches/mt1', 'fulltime');
    expect(await inbox('carolphone')).toEqual([]);
    await notify('alice', 'match', 'matches/mt1', 'fulltime');
    expect(await inbox('carolphone')).toEqual([expect.objectContaining({ title: '🏁 Full time', body: 'Odomi FC 1–0 Todzi Stars' })]);
  });

  it('announcements go to the town (or everyone); reports go to staff', async () => {
    await set('admin_roles/boss', { role: 'super_admin', townIds: [] });
    await set('admin_roles/mod', { role: 'moderator', townIds: [] });
    await seedUser('boss');
    await seedUser('mod', 'sokpo');
    await device('bob', 'bobphone');
    await device('carol', 'carolphone');
    await device('mod', 'modphone');
    expect((await call('POST', '/admin/announcements', 'boss', { townId: 'odomi', title: 'Clean-up day', body: 'Saturday 7am at the park.', pinned: false })).status).toBe(200);
    expect(await inbox('bobphone')).toEqual([expect.objectContaining({ title: '📢 Clean-up day', body: 'Saturday 7am at the park.' })]);
    expect(await inbox('carolphone')).toEqual([]);
    await set('reports/r1', { reporterId: 'bob', targetType: 'post', townId: 'todzi', reason: 'spam', createdAt: new Date() });
    await notify('bob', 'report', 'reports/r1');
    expect(await inbox('modphone')).toEqual([expect.objectContaining({ title: '🚩 New report in Todzi', body: 'Spam or scam (post)', url: '/admin/reports' })]);
    expect(await inbox('carolphone')).toEqual([]);
  });

  it('every hour: reminders for events people are going to, and friends’ birthdays at 7am', async () => {
    await device('bob', 'bobphone');
    const now = new Date();
    now.setUTCHours(7, 7, 0, 0); // today, 07:07 (Ghana time = GMT)
    const today = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    await set('events/e1', { status: 'published', title: 'Homecoming durbar', location: 'Odomi park', startsAt: new Date(now.getTime() + 90 * 60_000) });
    await set('events/e1/rsvps/bob', { status: 'going' });
    await seedUser('erin', 'todzi', { birthdayKey: today });
    await set('friendships/bob_erin', { members: ['bob', 'erin'], status: 'accepted' });
    await runHourly(env(), now);
    const got = await inbox('bobphone');
    expect(got).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: '⏰ Starting soon: Homecoming durbar', body: 'Starts at 08:37 · Odomi park', url: '/events/e1' }),
        expect.objectContaining({ title: '🎂 It’s ERIN’s birthday today', url: '/u/erin' }),
      ]),
    );
    await runHourly(env(), now); // never twice
    expect(await inbox('bobphone')).toEqual([]);
  });

  it('big audiences are sent in batches through the Worker’s own internal calls', async () => {
    self = { fetch: (req: Request) => Promise.resolve(app.fetch(req, env())) };
    for (let i = 0; i < 15; i++) {
      await seedUser(`m${i}`, 'adokor');
      await device(`m${i}`, `phone${i}`);
    }
    await set('admin_roles/boss', { role: 'super_admin', townIds: [] });
    await call('POST', '/admin/announcements', 'boss', { townId: 'adokor', title: 'Water update', body: 'Pipes fixed.', pinned: false });
    for (let i = 0; i < 15; i++) expect(await inbox(`phone${i}`)).toHaveLength(1);
    // The internal address refuses anyone without the key.
    const bad = await app.request('https://push.internal/internal/push/send', { method: 'POST', body: '{}' }, env());
    expect(bad.status).toBe(404);
  });
});
