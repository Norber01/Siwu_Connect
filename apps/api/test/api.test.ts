/**
 * Integration tests for the admin API against the Firestore emulator.
 * Run with `npm run test:emulator`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Env, R2BucketLike } from '../src/env';
import { Firestore } from '../src/firestore';

const PROJECT = 'demo-siwu-api';
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

class MemoryBucket implements R2BucketLike {
  objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  async put(key: string, value: ArrayBuffer | Uint8Array, o?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, { bytes: new Uint8Array(value), type: o?.httpMetadata?.contentType });
  }
  async get(key: string, opts?: { range?: { offset: number; length?: number } }) {
    const o = this.objects.get(key);
    if (!o) return null;
    if (opts?.range) {
      const { offset, length } = opts.range;
      const slice = o.bytes.slice(offset, length !== undefined ? offset + length : undefined);
      return { body: new Response(slice).body!, size: o.bytes.byteLength, httpMetadata: { contentType: o.type }, range: { offset, length: slice.byteLength } };
    }
    return { body: new Response(o.bytes).body!, size: o.bytes.byteLength, httpMetadata: { contentType: o.type } };
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
  async list(o?: { prefix?: string }) {
    return { objects: [...this.objects.keys()].filter((k) => k.startsWith(o?.prefix ?? '')).map((key) => ({ key })) };
  }
}

let bucket: MemoryBucket;
const env = (): Env => ({
  FIREBASE_PROJECT_ID: PROJECT,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:8787',
  FIRESTORE_EMULATOR_HOST: FS_HOST,
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
  AVATARS: bucket,
});
const fs = () => new Firestore(env());
const app = createApp();

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid: string, email?: string) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, ...(email ? { email, email_verified: true } : {}) })}.`;

function call(method: string, path: string, uid?: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (uid) headers.authorization = `Bearer ${token(uid)}`;
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env());
}

async function seedUser(uid: string, hometownId = 'odomi', status = 'active') {
  await fs().commit([
    { kind: 'set', path: `users/${uid}`, data: { username: uid, displayName: uid, hometownId, status, photoUrl: null } },
    { kind: 'set', path: `usernames/${uid}`, data: { uid } },
  ]);
}
const seedRole = (uid: string, role: string, townIds: string[] = []) =>
  fs().commit([{ kind: 'set', path: `admin_roles/${uid}`, data: { role, townIds } }]);
const seedPost = (id: string, authorId: string, townId = 'odomi', extra: Record<string, unknown> = {}) =>
  fs().commit([
    {
      kind: 'set',
      path: `posts/${id}`,
      data: { authorId, townId, text: 'hi', status: 'published', pinned: false, commentCount: 0, reactionCount: 0, ...extra },
    },
  ]);
const auditActions = async () => (await fs().query<{ action: string }>({ collection: 'audit_logs' })).map((d) => d.data.action);

beforeEach(async () => {
  bucket = new MemoryBucket();
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await seedUser('boss');
  await seedRole('boss', 'super_admin');
  await seedUser('mod');
  await seedRole('mod', 'moderator', ['odomi', 'mempeasem', 'todzi', 'adokor', 'sokpo']);
  await seedUser('townadmin');
  await seedRole('townadmin', 'town_admin', ['odomi']);
  await seedUser('alice', 'odomi');
  await seedUser('bob', 'todzi');
});

describe('authentication', () => {
  it('rejects missing or malformed tokens and non-admins', async () => {
    expect((await call('GET', '/health')).status).toBe(200);
    expect((await call('POST', '/admin/posts/p1/remove')).status).toBe(401);
    const bad = await app.request('/admin/posts/p1/remove', { method: 'POST', headers: { authorization: 'Bearer nonsense' } }, env());
    expect(bad.status).toBe(401);
    expect((await call('POST', '/admin/posts/p1/remove', 'alice', {})).status).toBe(403);
  });

  it('never accepts unsigned tokens outside demo projects', async () => {
    const prod = { ...env(), FIREBASE_PROJECT_ID: 'siwu-prod' };
    const res = await app.request(
      '/admin/posts/p1/remove',
      { method: 'POST', headers: { authorization: `Bearer ${token('boss')}` } },
      prod,
    );
    expect(res.status).toBe(401);
  });
});

describe('moderation', () => {
  it('moderator removes and restores a post, with audit log', async () => {
    await seedPost('p1', 'alice');
    expect((await call('POST', '/admin/posts/p1/remove', 'mod', { note: 'spam' })).status).toBe(200);
    expect((await fs().get<{ status: string }>('posts/p1'))!.data.status).toBe('removed');
    expect((await call('POST', '/admin/posts/p1/remove', 'mod', {})).status).toBe(409);
    expect((await call('POST', '/admin/posts/p1/restore', 'mod', {})).status).toBe(200);
    expect((await fs().get<{ status: string }>('posts/p1'))!.data.status).toBe('published');
    expect((await auditActions()).sort()).toEqual(['post.remove', 'post.restore']);
  });

  it('town admin cannot touch another town', async () => {
    await seedPost('p1', 'bob', 'todzi');
    expect((await call('POST', '/admin/posts/p1/remove', 'townadmin', {})).status).toBe(403);
    expect((await call('POST', '/admin/posts/p1/pin', 'townadmin', { pinned: true })).status).toBe(403);
    expect((await call('POST', '/admin/users/bob/suspend', 'townadmin', {})).status).toBe(403);
    expect(await auditActions()).toEqual([]);
    await seedPost('p2', 'alice', 'odomi');
    expect((await call('POST', '/admin/posts/p2/pin', 'townadmin', { pinned: true })).status).toBe(200);
  });

  it('moderators cannot pin or suspend; super admin can', async () => {
    await seedPost('p1', 'alice');
    expect((await call('POST', '/admin/posts/p1/pin', 'mod', { pinned: true })).status).toBe(403);
    expect((await call('POST', '/admin/users/alice/suspend', 'mod', {})).status).toBe(403);
    expect((await call('POST', '/admin/posts/p1/pin', 'boss', { pinned: true })).status).toBe(200);
    expect((await call('POST', '/admin/users/alice/suspend', 'boss', { note: 'abuse' })).status).toBe(200);
    expect((await fs().get<{ status: string }>('users/alice'))!.data.status).toBe('suspended');
    expect((await call('POST', '/admin/users/alice/restore', 'boss', {})).status).toBe(200);
  });

  it('admins cannot be suspended and cannot suspend themselves', async () => {
    expect((await call('POST', '/admin/users/mod/suspend', 'boss', {})).status).toBe(409);
    expect((await call('POST', '/admin/users/boss/suspend', 'boss', {})).status).toBe(400);
  });

  it('removing a comment keeps the post counter right', async () => {
    await seedPost('p1', 'alice', 'odomi', { commentCount: 1 });
    await fs().commit([{ kind: 'set', path: 'posts/p1/comments/c1', data: { authorId: 'bob', townId: 'odomi', text: 'x', status: 'published' } }]);
    expect((await call('POST', '/admin/posts/p1/comments/c1/remove', 'mod', {})).status).toBe(200);
    expect((await fs().get<{ commentCount: number }>('posts/p1'))!.data.commentCount).toBe(0);
    expect((await call('POST', '/admin/posts/p1/comments/c1/restore', 'mod', {})).status).toBe(200);
    expect((await fs().get<{ commentCount: number }>('posts/p1'))!.data.commentCount).toBe(1);
  });
});

describe('reports', () => {
  const report = (id: string, reporter: string, targetPath: string, extra: Record<string, unknown> = {}) =>
    fs().commit([
      {
        kind: 'set',
        path: `reports/${id}`,
        data: { reporterId: reporter, targetType: 'post', targetId: targetPath.split('/')[1]!, targetPath, townId: 'odomi', status: 'open', ...extra },
      },
    ]);

  it('remove_content removes the post and resolves all reports about it', async () => {
    await seedPost('p1', 'bob', 'todzi');
    await report('r1', 'alice', 'posts/p1', { townId: 'todzi' });
    await report('r2', 'boss', 'posts/p1', { townId: 'todzi' });
    const res = await call('POST', '/admin/reports/r1/resolve', 'mod', { action: 'remove_content', note: 'scam' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { resolved: number }).resolved).toBe(2);
    expect((await fs().get<{ status: string }>('posts/p1'))!.data.status).toBe('removed');
    expect((await fs().get<{ status: string }>('reports/r2'))!.data.status).toBe('actioned');
    expect((await call('POST', '/admin/reports/r1/resolve', 'mod', { action: 'dismiss' })).status).toBe(409);
  });

  it('checks permission against the real town, not the town written in the report', async () => {
    await seedPost('p1', 'bob', 'todzi');
    await report('r1', 'alice', 'posts/p1', { townId: 'odomi' }); // misleading town
    expect((await call('POST', '/admin/reports/r1/resolve', 'townadmin', { action: 'dismiss' })).status).toBe(403);
  });

  it('remove_content_and_suspend needs suspend permission', async () => {
    await seedPost('p1', 'alice', 'odomi');
    await report('r1', 'bob', 'posts/p1');
    expect((await call('POST', '/admin/reports/r1/resolve', 'mod', { action: 'remove_content_and_suspend' })).status).toBe(403);
    expect((await call('POST', '/admin/reports/r1/resolve', 'boss', { action: 'remove_content_and_suspend' })).status).toBe(200);
    expect((await fs().get<{ status: string }>('users/alice'))!.data.status).toBe('suspended');
  });
});

describe('announcements', () => {
  it('town admins announce in their own town only; super admin everywhere', async () => {
    const a = { townId: 'odomi', title: 'Clean-up day', body: 'Saturday 7am at the market square.', pinned: true };
    expect((await call('POST', '/admin/announcements', 'townadmin', a)).status).toBe(200);
    expect((await call('POST', '/admin/announcements', 'townadmin', { ...a, townId: 'todzi' })).status).toBe(403);
    expect((await call('POST', '/admin/announcements', 'townadmin', { ...a, townId: 'all' })).status).toBe(403);
    expect((await call('POST', '/admin/announcements', 'mod', a)).status).toBe(403);
    const res = await call('POST', '/admin/announcements', 'boss', { ...a, townId: 'all' });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect((await call('PATCH', `/admin/announcements/${id}`, 'townadmin', { status: 'archived' })).status).toBe(403);
    expect((await call('PATCH', `/admin/announcements/${id}`, 'boss', { status: 'archived' })).status).toBe(200);
  });

  it('validates input', async () => {
    expect((await call('POST', '/admin/announcements', 'boss', { townId: 'accra', title: 'x', body: '' })).status).toBe(400);
  });
});

describe('roles', () => {
  it('only super admins grant and revoke roles', async () => {
    expect((await call('POST', '/admin/roles', 'mod', { username: 'alice', role: 'town_admin', townIds: ['odomi'] })).status).toBe(403);
    expect((await call('POST', '/admin/roles', 'boss', { username: 'alice', role: 'town_admin', townIds: ['odomi'] })).status).toBe(200);
    expect((await fs().get<{ role: string }>('admin_roles/alice'))!.data.role).toBe('town_admin');
    expect((await call('POST', '/admin/roles', 'boss', { username: 'nobody', role: 'town_admin', townIds: ['odomi'] })).status).toBe(404);
    expect((await call('DELETE', '/admin/roles/alice', 'boss')).status).toBe(200);
    expect(await fs().get('admin_roles/alice')).toBeNull();
    expect(await auditActions()).toEqual(expect.arrayContaining(['role.grant', 'role.revoke']));
  });

  it('one Moderator and one Assistant moderator, both for all towns', async () => {
    // 'mod' is already the Moderator.
    const dup = await call('POST', '/admin/roles', 'boss', { username: 'alice', role: 'moderator', townIds: [] });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toMatch(/already a Moderator/);
    expect((await call('POST', '/admin/roles', 'boss', { username: 'alice', role: 'assistant_moderator', townIds: ['odomi'] })).status).toBe(200);
    expect((await fs().get<{ role: string; townIds: string[] }>('admin_roles/alice'))!.data).toMatchObject({ role: 'assistant_moderator', townIds: [] });
    expect((await call('POST', '/admin/roles', 'boss', { username: 'bob', role: 'assistant_moderator', townIds: [] })).status).toBe(409);
    // Re-saving the same person is fine; a town admin still needs towns.
    expect((await call('POST', '/admin/roles', 'boss', { username: 'alice', role: 'assistant_moderator', townIds: [] })).status).toBe(200);
    expect((await call('POST', '/admin/roles', 'boss', { username: 'bob', role: 'town_admin', townIds: [] })).status).toBe(400);
    // The assistant moderates in every town (approvals in Todzi, for example).
    await fs().commit([{ kind: 'set', path: 'listings/la', data: { sellerId: 'bob', townId: 'todzi', title: 'Goat', status: 'pending' } }]);
    expect((await call('POST', '/admin/listings/la/approve', 'alice', {})).status).toBe(200);
  });

  it('the last super admin cannot be removed or demoted', async () => {
    expect((await call('DELETE', '/admin/roles/boss', 'boss')).status).toBe(409);
    expect((await call('POST', '/admin/roles', 'boss', { username: 'boss', role: 'town_admin', townIds: ['odomi'] })).status).toBe(409);
  });
});

describe('avatars', () => {
  const webp = () => {
    const b = new Uint8Array(64);
    b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    return b;
  };
  const upload = (uid: string, bytes: Uint8Array, type = 'image/webp') =>
    app.request('/uploads/avatar', { method: 'POST', headers: { authorization: `Bearer ${token(uid)}`, 'content-type': type }, body: bytes }, env());

  it('stores a valid image and serves it publicly', async () => {
    const res = await upload('alice', webp());
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^http:\/\/localhost:8787\/avatars\/alice\/[A-Za-z0-9]+\.webp$/);
    const get = await app.request(new URL(url).pathname, {}, env());
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/webp');
  });

  it('rejects wrong types, fake content, oversize files and suspended users', async () => {
    expect((await upload('alice', webp(), 'image/svg+xml')).status).toBe(415);
    expect((await upload('alice', new Uint8Array([1, 2, 3]))).status).toBe(415);
    const big = new Uint8Array(300 * 1024);
    big.set(webp());
    expect((await upload('alice', big)).status).toBe(413);
    await seedUser('sam', 'odomi', 'suspended');
    expect((await upload('sam', webp())).status).toBe(403);
  });
});

describe('account deletion', () => {
  it('wipes profile and content and frees the username', async () => {
    await seedPost('p1', 'alice', 'odomi', { commentCount: 1 });
    await seedPost('p2', 'bob', 'todzi', { commentCount: 1 });
    await fs().commit([
      { kind: 'set', path: 'posts/p2/comments/c1', data: { authorId: 'alice', townId: 'todzi', text: 'hey', status: 'published' } },
      { kind: 'set', path: 'chats/alice_bob', data: { type: 'dm', members: ['alice', 'bob'] } },
      { kind: 'set', path: 'chats/alice_bob/messages/m1', data: { senderId: 'alice', text: 'secret plans', imageUrl: null, status: 'sent' } },
      { kind: 'set', path: 'chats/alice_bob/presence/alice', data: { readAt: new Date() } },
      { kind: 'set', path: 'chats/grp_1', data: { type: 'group', name: 'Fam', members: ['alice', 'bob'], admins: ['alice'] } },
      { kind: 'set', path: 'directory/d1', data: { ownerId: 'alice', townId: 'odomi', title: 'Shop', status: 'active' } },
      { kind: 'set', path: 'users/alice/bookmarks/p2', data: { createdAt: new Date() } },
      { kind: 'set', path: 'users/alice/notifications/n1', data: { type: 'like' } },
      { kind: 'set', path: 'events/e1/photos/ph1', data: { authorId: 'alice', url: 'x', status: 'published' } },
    ]);
    // The app repeats the call until the server says it's done.
    let step = 0;
    let calls = 0;
    for (;;) {
      const res = await call('POST', `/me/delete-account?step=${step}`, 'alice');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { done: boolean; next?: number };
      calls++;
      if (body.done) break;
      step = body.next!;
      expect(calls).toBeLessThan(20);
    }
    expect((await fs().get<{ text: string; status: string }>('chats/alice_bob/messages/m1'))!.data).toMatchObject({ text: '', status: 'deleted' });
    expect(await fs().get('chats/alice_bob/presence/alice')).toBeNull();
    expect((await fs().get<{ members: string[]; admins: string[] }>('chats/grp_1'))!.data).toMatchObject({ members: ['bob'], admins: ['bob'] });
    expect(await fs().get('directory/d1')).toBeNull();
    expect(await fs().get('users/alice/bookmarks/p2')).toBeNull();
    expect(await fs().get('users/alice/notifications/n1')).toBeNull();
    expect((await fs().get<{ status: string }>('events/e1/photos/ph1'))!.data.status).toBe('deleted');
    expect(await fs().get('users/alice')).toBeNull();
    expect(await fs().get('usernames/alice')).toBeNull();
    const p1 = await fs().get<{ status: string; text: string }>('posts/p1');
    expect(p1!.data).toMatchObject({ status: 'deleted', text: '' });
    expect((await fs().get<{ text: string }>('posts/p2/comments/c1'))!.data.text).toBe('');
    expect((await fs().get<{ commentCount: number }>('posts/p2'))!.data.commentCount).toBe(0);
  });

  it('the last super admin cannot delete their account', async () => {
    expect((await call('POST', '/me/delete-account', 'boss')).status).toBe(409);
  });
});

describe('events and marketplace moderation', () => {
  it('moderator removes and restores a listing; report on an event resolves', async () => {
    await fs().commit([
      { kind: 'set', path: 'listings/l1', data: { sellerId: 'alice', townId: 'odomi', title: 'Phone', status: 'available' } },
      { kind: 'set', path: 'events/e1', data: { authorId: 'bob', townId: 'todzi', title: 'Party', status: 'published' } },
      { kind: 'set', path: 'reports/r1', data: { reporterId: 'alice', targetType: 'event', targetId: 'e1', targetPath: 'events/e1', townId: 'todzi', status: 'open' } },
    ]);
    expect((await call('POST', '/admin/listings/l1/remove', 'mod', { note: 'scam' })).status).toBe(200);
    expect((await fs().get<{ status: string }>('listings/l1'))!.data.status).toBe('removed');
    expect((await call('POST', '/admin/listings/l1/restore', 'mod', {})).status).toBe(200);
    expect((await fs().get<{ status: string }>('listings/l1'))!.data.status).toBe('available');
    expect((await call('POST', '/admin/listings/l1/remove', 'townadmin', {})).status).toBe(200); // odomi
    expect((await call('POST', '/admin/events/e1/remove', 'townadmin', {})).status).toBe(403); // todzi
    expect((await call('POST', '/admin/reports/r1/resolve', 'mod', { action: 'remove_content' })).status).toBe(200);
    expect((await fs().get<{ status: string }>('events/e1'))!.data.status).toBe('removed');
  });

  it('reporters have no admin powers', async () => {
    await seedUser('rep');
    await seedRole('rep', 'reporter', []);
    await seedPost('p1', 'alice');
    expect((await call('POST', '/admin/posts/p1/remove', 'rep', {})).status).toBe(403);
  });
});

describe('photo uploads', () => {
  const jpeg = () => {
    const b = new Uint8Array(64);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    return b;
  };
  const upload = (uid: string, bytes: Uint8Array) =>
    app.request('/uploads/image', { method: 'POST', headers: { authorization: `Bearer ${token(uid)}`, 'content-type': 'image/jpeg' }, body: bytes }, env());

  it('members upload event/listing photos that are served publicly', async () => {
    const res = await upload('alice', jpeg());
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/\/images\/alice\/[A-Za-z0-9]+\.jpg$/);
    expect((await app.request(new URL(url).pathname, {}, env())).status).toBe(200);
  });

  it('requires a profile and an active account', async () => {
    expect((await upload('nobody', jpeg())).status).toBe(403);
    await seedUser('sam', 'odomi', 'suspended');
    expect((await upload('sam', jpeg())).status).toBe(403);
  });
});

describe('one-time setup', () => {
  const run = (uid: string, email: string | undefined, e: Env) =>
    app.request('/setup/run', { method: 'POST', headers: { authorization: `Bearer ${token(uid, email)}` } }, e);

  it('only the verified founder can run it while no Super Admin exists', async () => {
    await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    const e = { ...env(), FOUNDER_EMAIL: 'Founder@Example.com' };
    expect((await run('stranger', 'someone@example.com', e)).status).toBe(403);
    expect((await run('nomail', undefined, e)).status).toBe(403);
    expect((await run('founder', 'founder@example.com', { ...env() })).status).toBe(403); // no founder configured
    const res = await run('founder', 'founder@example.com', e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; steps: { id: string; ok: boolean }[] };
    expect(body.ok).toBe(true);
    expect(body.steps.map((s) => s.id)).toEqual(['credentials', 'rules', 'indexes', 'towns', 'search', 'domains', 'superAdmin']);
    expect((await fs().get<{ type: string }>('chats/room_sokpo'))!.data.type).toBe('room');
    expect((await fs().get<{ role: string }>('admin_roles/founder'))!.data.role).toBe('super_admin');
    expect((await fs().query({ collection: 'towns' })).length).toBe(5);
    const status = await app.request('/setup/status', { headers: { authorization: `Bearer ${token('founder', 'founder@example.com')}` } }, e);
    expect(((await status.json()) as { setupNeeded: boolean }).setupNeeded).toBe(false);
    await fs().commit([{ kind: 'set', path: 'settings/setup', data: { version: 'old' } }]);
    const stale = await app.request('/setup/status', { headers: { authorization: `Bearer ${token('founder', 'founder@example.com')}` } }, e);
    expect(((await stale.json()) as { setupNeeded: boolean }).setupNeeded).toBe(true);
    // Afterwards nobody else can take over; the Super Admin may re-run it.
    expect((await run('stranger', 'founder@example.com', e)).status).toBe(403);
    expect((await run('founder', 'founder@example.com', e)).status).toBe(200);
  });

  it('reports whether the key is configured', async () => {
    const res = await app.request('/setup/status', { headers: { authorization: `Bearer ${token('x', 'x@example.com')}` } }, env());
    expect(((await res.json()) as { keyConfigured: boolean }).keyConfigured).toBe(true);
  });
});

describe('friend requests', () => {
  it('sends, accepts the other side, and explains refusals', async () => {
    const f = (who: string, uid: string) => call('POST', `/friends/${uid}`, who, {});
    expect((await f('alice', 'alice')).status).toBe(400);
    expect(await (await f('alice', 'bob')).json()).toEqual({ result: 'sent' });
    expect((await fs().get<{ status: string }>('friendships/alice_bob'))!.data.status).toBe('pending');
    expect(await (await f('alice', 'bob')).json()).toEqual({ result: 'already' });
    expect(await (await f('bob', 'alice')).json()).toEqual({ result: 'accepted' });
    expect((await fs().get<{ status: string }>('friendships/alice_bob'))!.data.status).toBe('accepted');
    expect((await fs().get<{ type: string }>('users/bob/notifications/friend_alice'))!.data.type).toBe('friend_request');
    expect((await fs().get<{ type: string }>('users/alice/notifications/friendok_bob'))!.data.type).toBe('friend_accepted');
    expect(await (await f('bob', 'alice')).json()).toEqual({ result: 'friends' });
    await fs().commit([{ kind: 'set', path: 'users/mod/blocks/alice', data: { createdAt: new Date() } }]);
    const blocked = await f('alice', 'mod');
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/cannot send a request/);
  });
});

describe('backups', () => {
  it('Super Admin backs up every collection to private storage; others cannot', async () => {
    await seedPost('pb1', 'alice');
    expect((await call('POST', '/admin/backups', 'mod', {})).status).toBe(403);
    const res = await call('POST', '/admin/backups', 'boss', {});
    expect(res.status).toBe(200);
    const r = (await res.json()) as { key: string; documents: number; complete: boolean };
    expect(r.complete).toBe(true);
    expect(r.documents).toBeGreaterThan(5);
    const list = (await (await call('GET', '/admin/backups', 'boss')).json()) as { items: { file: string }[] };
    expect(list.items).toHaveLength(1);
    const dl = await call('GET', `/admin/backups/${list.items[0]!.file}`, 'boss');
    expect(dl.status).toBe(200);
    const { gunzipSync } = await import('node:zlib');
    const data = JSON.parse(gunzipSync(Buffer.from((await dl.arrayBuffer()) as ArrayBuffer)).toString('utf8')) as { collections: Record<string, { name: string }[]> };
    expect(data.collections.posts!.map((d) => d.name.split('/').pop())).toContain('pb1');
    expect(data.collections.admin_roles!.length).toBeGreaterThan(0);
    // Not reachable through the public photo routes.
    expect((await app.request(`/images/backups/${list.items[0]!.file}`, {}, env())).status).toBe(404);
  });
});

describe('group chats', () => {
  it('members make groups with their friends only; add, rename, leave', async () => {
    await seedUser('carl', 'odomi');
    await fs().commit([
      { kind: 'set', path: 'friendships/alice_bob', data: { members: ['alice', 'bob'], requesterId: 'alice', status: 'accepted' } },
      { kind: 'set', path: 'friendships/alice_carl', data: { members: ['alice', 'carl'], requesterId: 'alice', status: 'pending' } },
    ]);
    expect((await call('POST', '/chats/groups', 'alice', { name: 'Family', members: ['carl'] })).status).toBe(403); // not friends yet
    expect((await call('POST', '/chats/groups', 'alice', { name: 'F', members: ['bob'] })).status).toBe(400); // name too short
    const res = await call('POST', '/chats/groups', 'alice', { name: 'Odomi family', members: ['bob'] });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const g = await fs().get<{ type: string; members: string[]; admins: string[]; name: string }>(`chats/${id}`);
    expect(g!.data).toMatchObject({ type: 'group', members: ['alice', 'bob'], admins: ['alice'], name: 'Odomi family' });
    expect((await call('POST', `/chats/${id}/members`, 'alice', { add: ['carl'] })).status).toBe(403);
    await fs().commit([{ kind: 'set', path: 'friendships/alice_carl', data: { members: ['alice', 'carl'], requesterId: 'alice', status: 'accepted' } }]);
    expect((await call('POST', `/chats/${id}/members`, 'alice', { add: ['carl'] })).status).toBe(200);
    expect((await call('POST', `/chats/${id}/rename`, 'bob', { name: 'Bob rules' })).status).toBe(403); // not admin
    expect((await call('POST', `/chats/${id}/rename`, 'alice', { name: 'Akpafu family' })).status).toBe(200);
    expect((await call('POST', `/chats/${id}/leave`, 'alice', {})).status).toBe(200);
    const after = await fs().get<{ members: string[]; admins: string[]; name: string }>(`chats/${id}`);
    expect(after!.data).toMatchObject({ members: ['bob', 'carl'], admins: ['bob'], name: 'Akpafu family' });
    expect((await call('POST', `/chats/${id}/leave`, 'alice', {})).status).toBe(404); // no longer a member
    expect((await call('POST', `/chats/${id}/members`, 'mod', { add: ['mod'] })).status).toBe(404); // outsiders
  });
});

describe('pilot testers and reporters', () => {
  it('admins choose pilot testers from their towns; the member is told', async () => {
    const t = (who: string, uid: string, route: string) => call('POST', `/admin/users/${uid}/${route}`, who, {});
    expect((await t('townadmin', 'bob', 'tester')).status).toBe(403); // bob is from Todzi
    expect((await t('boss', 'bob', 'tester')).status).toBe(200);
    expect((await fs().get<{ tester: boolean }>('users/bob'))!.data.tester).toBe(true);
    const n = await fs().query<{ type: string }>({ collection: 'notifications', parent: 'users/bob' });
    expect(n.map((x) => x.data.type)).toContain('tester');
    expect((await t('alice', 'bob', 'untester')).status).toBe(403); // not an admin
    expect((await t('boss', 'bob', 'untester')).status).toBe(200);
  });

  it('anyone signed in can see who reports for each town', async () => {
    await seedRole('alice', 'reporter', ['odomi']);
    const res = await call('GET', '/sports/reporters', 'bob');
    expect(((await res.json()) as { reporters: { uid: string; townIds: string[] }[] }).reporters).toEqual([{ uid: 'alice', townIds: ['odomi'] }]);
  });
});

describe('verified badge', () => {
  it('admins verify members of their towns; members cannot verify themselves', async () => {
    const v = (who: string, uid: string, route: string) => call('POST', `/admin/users/${uid}/${route}`, who, {});
    expect((await v('bob', 'bob', 'verify')).status).toBe(403);
    expect((await v('townadmin', 'bob', 'verify')).status).toBe(403); // bob is from Todzi
    expect((await v('townadmin', 'alice', 'verify')).status).toBe(200);
    expect((await v('boss', 'bob', 'verify')).status).toBe(200);
    expect((await v('boss', 'bob', 'verify')).status).toBe(409);
    expect((await fs().get<{ verified: boolean }>('users/bob'))!.data.verified).toBe(true);
    const n = await fs().query<{ type: string }>({ collection: 'notifications', parent: 'users/bob' });
    expect(n.map((x) => x.data.type)).toContain('verified');
    expect((await v('boss', 'bob', 'unverify')).status).toBe(200);
    expect((await fs().get<{ verified: boolean }>('users/bob'))!.data.verified).toBe(false);
    expect(await auditActions()).toEqual(expect.arrayContaining(['user.verify', 'user.unverify']));
  });
});

describe('video uploads', () => {
  const mp4 = (n = 2000) => {
    const b = new Uint8Array(n);
    b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    for (let i = 12; i < n; i++) b[i] = i % 256;
    return b;
  };
  const upload = (uid: string, bytes: Uint8Array, type = 'video/mp4') =>
    app.request('/uploads/video', { method: 'POST', headers: { authorization: `Bearer ${token(uid)}`, 'content-type': type }, body: bytes }, env());

  it('stores a video and serves byte ranges for phone playback', async () => {
    const res = await upload('alice', mp4());
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/\/videos\/alice\/[A-Za-z0-9]+\.mp4$/);
    const path = new URL(url).pathname;
    const full = await app.request(path, {}, env());
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    const part = await app.request(path, { headers: { range: 'bytes=100-199' } }, env());
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 100-199/2000');
    expect(new Uint8Array((await part.arrayBuffer()) as ArrayBuffer)[0]).toBe(100);
  });

  it('rejects fake or non-video files and non-members', async () => {
    expect((await upload('alice', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).status).toBe(415);
    expect((await upload('alice', mp4(), 'application/pdf')).status).toBe(415);
    expect((await upload('nobody', mp4())).status).toBe(403);
  });

  it('stores voice notes and streams them', async () => {
    const webm = new Uint8Array(500);
    webm.set([0x1a, 0x45, 0xdf, 0xa3]);
    const send = (body: Uint8Array, type: string) =>
      app.request('/uploads/audio', { method: 'POST', headers: { authorization: `Bearer ${token('alice')}`, 'content-type': type }, body }, env());
    const res = await send(webm, 'audio/webm;codecs=opus');
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/\/audio\/alice\/[A-Za-z0-9]+\.webm$/);
    const part = await app.request(new URL(url).pathname, { headers: { range: 'bytes=0-3' } }, env());
    expect(part.status).toBe(206);
    expect((await send(new Uint8Array(500), 'audio/webm')).status).toBe(415); // not really WebM
    expect((await send(webm, 'audio/wav')).status).toBe(415);
  });
});

describe('approvals', () => {
  it('moderators approve or reject members\' listings; owner is notified', async () => {
    await fs().commit([
      { kind: 'set', path: 'listings/l9', data: { sellerId: 'alice', townId: 'odomi', title: 'Kente', status: 'pending' } },
      { kind: 'set', path: 'directory/d9', data: { ownerId: 'bob', townId: 'todzi', title: 'Shop', status: 'pending' } },
    ]);
    expect((await call('POST', '/admin/listings/l9/approve', 'alice', {})).status).toBe(403);
    expect((await call('POST', '/admin/listings/l9/approve', 'mod', {})).status).toBe(200);
    expect((await fs().get<{ status: string }>('listings/l9'))!.data.status).toBe('available');
    expect((await call('POST', '/admin/listings/l9/approve', 'mod', {})).status).toBe(409);
    expect((await call('POST', '/admin/directory/d9/reject', 'townadmin', { note: 'x' })).status).toBe(403); // todzi
    expect((await call('POST', '/admin/directory/d9/reject', 'mod', { note: 'Please add a phone number' })).status).toBe(200);
    expect((await fs().get<{ status: string }>('directory/d9'))!.data.status).toBe('rejected');
    const notes = await fs().query<{ type: string }>({ parent: 'users/bob', collection: 'notifications' });
    expect(notes.map((n) => n.data.type)).toEqual(['rejected']);
  });
});
