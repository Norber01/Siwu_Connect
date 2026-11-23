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
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return { body: new Response(o.bytes).body!, httpMetadata: { contentType: o.type } };
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
const token = (uid: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}` })}.`;

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
    expect((await call('POST', '/admin/roles', 'mod', { username: 'alice', role: 'moderator', townIds: ['odomi'] })).status).toBe(403);
    expect((await call('POST', '/admin/roles', 'boss', { username: 'alice', role: 'moderator', townIds: ['odomi'] })).status).toBe(200);
    expect((await fs().get<{ role: string }>('admin_roles/alice'))!.data.role).toBe('moderator');
    expect((await call('POST', '/admin/roles', 'boss', { username: 'nobody', role: 'moderator', townIds: ['odomi'] })).status).toBe(404);
    expect((await call('DELETE', '/admin/roles/alice', 'boss')).status).toBe(200);
    expect(await fs().get('admin_roles/alice')).toBeNull();
    expect(await auditActions()).toEqual(expect.arrayContaining(['role.grant', 'role.revoke']));
  });

  it('the last super admin cannot be removed or demoted', async () => {
    expect((await call('DELETE', '/admin/roles/boss', 'boss')).status).toBe(409);
    expect((await call('POST', '/admin/roles', 'boss', { username: 'boss', role: 'moderator', townIds: ['odomi'] })).status).toBe(409);
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
    await fs().commit([{ kind: 'set', path: 'posts/p2/comments/c1', data: { authorId: 'alice', townId: 'todzi', text: 'hey', status: 'published' } }]);
    expect((await call('POST', '/me/delete-account', 'alice')).status).toBe(200);
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
