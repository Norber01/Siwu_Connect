import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import {
  type AdminRole,
  LIMITS,
  announcementSchema,
  announcementUpdateSchema,
  canAnnounce,
  canModerate,
  canSuspend,
  grantRoleSchema,
  isSuperAdmin,
  moderationNoteSchema,
  pinSchema,
  resolveReportSchema,
} from '@siwu/shared';
import { deleteAuthUser, verifyIdToken } from './auth';
import type { Env } from './env';
import { type Data, FieldValue, Firestore, type Write } from './firestore';

type Vars = { uid: string; fs: Firestore };
type Ctx = { Bindings: Env; Variables: Vars };

interface PostDoc {
  authorId: string;
  townId: string;
  status: string;
  pinned: boolean;
  commentCount: number;
}
interface CommentDoc {
  authorId: string;
  townId: string;
  status: string;
}
interface UserDoc {
  username: string;
  hometownId: string;
  status: string;
  photoUrl: string | null;
}
interface ReportDoc {
  targetType: 'post' | 'comment' | 'user';
  targetId: string;
  targetPath: string;
  townId: string;
  status: string;
}

const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 415, message: string): never => {
  throw new HTTPException(status, { message });
};

async function body<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let json: unknown = {};
  try {
    const text = await req.text();
    json = text ? JSON.parse(text) : {};
  } catch {
    fail(400, 'Invalid JSON body');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) fail(400, parsed.error.issues.map((i) => i.message).join('; '));
  return parsed.data;
}

async function roleOf(fs: Firestore, uid: string): Promise<AdminRole | null> {
  const doc = await fs.get<AdminRole>(`admin_roles/${uid}`);
  return doc ? { role: doc.data.role, townIds: doc.data.townIds ?? [] } : null;
}

function audit(fs: Firestore, actorId: string, action: string, targetPath: string, townId: string, details: Data = {}): Write {
  return {
    kind: 'create',
    path: `audit_logs/${fs.newId()}`,
    data: { actorId, action, targetPath, townId, details: details as Data[string], at: FieldValue.serverTimestamp() },
  };
}

function moderation(uid: string, action: string, note: string): Data {
  return { moderation: { by: uid, action, note, at: new Date() }, updatedAt: FieldValue.serverTimestamp() };
}

/** Builds the writes to remove or restore a post/comment. */
async function contentStatusWrites(
  fs: Firestore,
  uid: string,
  targetPath: string,
  newStatus: 'removed' | 'published',
  note: string,
): Promise<{ writes: Write[]; townId: string; authorId: string }> {
  const parts = targetPath.split('/');
  const isComment = parts.length === 4 && parts[2] === 'comments';
  if (!isComment && !(parts.length === 2 && parts[0] === 'posts')) fail(400, 'Unsupported target');
  const target = await fs.get<PostDoc | CommentDoc>(targetPath);
  if (!target) fail(404, 'Content not found');
  const from = newStatus === 'removed' ? 'published' : 'removed';
  if (target!.data.status !== from) fail(409, `Content is ${target!.data.status}, not ${from}`);
  const action = newStatus === 'removed' ? 'remove' : 'restore';
  const writes: Write[] = [
    { kind: 'update', path: targetPath, data: { status: newStatus, ...moderation(uid, action, note) } },
  ];
  if (isComment) {
    const postPath = `posts/${parts[1]}`;
    const post = await fs.get<PostDoc>(postPath);
    if (post?.data.status === 'published') {
      writes.push({
        kind: 'update',
        path: postPath,
        data: { commentCount: FieldValue.increment(newStatus === 'removed' ? -1 : 1) },
      });
    }
  }
  return { writes, townId: target!.data.townId, authorId: target!.data.authorId };
}

export function createApp() {
  const app = new Hono<Ctx>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Something went wrong. Please try again.' }, 500);
  });

  app.use('*', async (c, next) => {
    const origins = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    return cors({
      origin: (o) => (origins.includes(o) ? o : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['authorization', 'content-type'],
      maxAge: 86400,
    })(c, next);
  });

  app.get('/health', (c) => c.json({ ok: true }));

  // Public: serve profile photos from R2.
  app.get('/avatars/:uid/:file', async (c) => {
    const { uid, file } = c.req.param();
    if (!/^[A-Za-z0-9_-]+\.(webp|jpg)$/.test(file) || !/^[A-Za-z0-9]+$/.test(uid)) fail(404, 'Not found');
    const obj = await c.env.AVATARS.get(`avatars/${uid}/${file}`);
    if (!obj) fail(404, 'Not found');
    return new Response(obj!.body, {
      headers: {
        'content-type': obj!.httpMetadata?.contentType ?? 'image/webp',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  });

  // Everything below requires a verified Firebase user.
  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) fail(401, 'Sign in required');
    try {
      const { uid } = await verifyIdToken(token, c.env);
      c.set('uid', uid);
    } catch {
      fail(401, 'Your session has expired. Please sign in again.');
    }
    c.set('fs', new Firestore(c.env));
    await next();
  });

  // ---------- profile photo upload ----------
  app.post('/uploads/avatar', async (c) => {
    const uid = c.get('uid');
    const fs = c.get('fs');
    const user = await fs.get<UserDoc>(`users/${uid}`);
    if (user && user.data.status !== 'active') fail(403, 'Your account is suspended');
    const type = c.req.header('content-type') ?? '';
    if (type !== 'image/webp' && type !== 'image/jpeg') fail(415, 'Upload a WebP or JPEG image');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) fail(400, 'Empty upload');
    if (bytes.byteLength > LIMITS.avatarMaxBytes) fail(413, 'Image is too large');
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (type === 'image/webp' ? !isWebp : !isJpeg) fail(415, 'File content does not match its type');

    const ext = type === 'image/webp' ? 'webp' : 'jpg';
    const key = `avatars/${uid}/${fs.newId()}.${ext}`;
    await c.env.AVATARS.put(key, bytes, { httpMetadata: { contentType: type } });

    // Keep only the new photo and the one currently on the profile.
    const current = user?.data.photoUrl?.split('/avatars/')[1];
    const existing = await c.env.AVATARS.list({ prefix: `avatars/${uid}/`, limit: 100 });
    const stale = existing.objects.map((o) => o.key).filter((k) => k !== key && k !== `avatars/${current}`);
    if (stale.length) await c.env.AVATARS.delete(stale);

    return c.json({ url: `${c.env.PUBLIC_API_URL.replace(/\/$/, '')}/${key}` });
  });

  // ---------- account deletion ----------
  app.post('/me/delete-account', async (c) => {
    const uid = c.get('uid');
    const fs = c.get('fs');
    const role = await roleOf(fs, uid);
    if (isSuperAdmin(role)) {
      const supers = await fs.query({ collection: 'admin_roles', where: [['role', 'EQUAL', 'super_admin']], limit: 2 });
      if (supers.length < 2) fail(409, 'The last Super Admin account cannot be deleted');
    }
    const user = await fs.get<UserDoc>(`users/${uid}`);

    // Wipe the user's posts (soft delete, text removed).
    for (;;) {
      const posts = await fs.query<PostDoc>({
        collection: 'posts',
        where: [['authorId', 'EQUAL', uid], ['status', 'IN', ['published', 'removed']]],
        limit: 200,
      });
      if (!posts.length) break;
      await fs.commit(
        posts.map((p) => ({
          kind: 'update' as const,
          path: p.path,
          data: { status: 'deleted', text: '', searchTokens: [], updatedAt: FieldValue.serverTimestamp() },
        })),
      );
    }
    // Wipe the user's comments, keeping counters right.
    for (;;) {
      const comments = await fs.query<CommentDoc>({
        collection: 'comments',
        allDescendants: true,
        where: [['authorId', 'EQUAL', uid], ['status', 'IN', ['published', 'removed']]],
        limit: 100,
      });
      if (!comments.length) break;
      const writes: Write[] = [];
      for (const cm of comments) {
        writes.push({ kind: 'update', path: cm.path, data: { status: 'deleted', text: '' } });
        if (cm.data.status === 'published') {
          const postPath = cm.path.split('/comments/')[0]!;
          const post = await fs.get<PostDoc>(postPath);
          if (post?.data.status === 'published') {
            writes.push({ kind: 'update', path: postPath, data: { commentCount: FieldValue.increment(-1) } });
          }
        }
      }
      await fs.commit(writes);
    }

    const writes: Write[] = [
      { kind: 'delete', path: `users/${uid}` },
      { kind: 'delete', path: `users_private/${uid}` },
      { kind: 'delete', path: `rate_limits/${uid}` },
      { kind: 'delete', path: `admin_roles/${uid}` },
      audit(fs, uid, 'account.delete', `users/${uid}`, user?.data.hometownId ?? ''),
    ];
    if (user) writes.push({ kind: 'delete', path: `usernames/${user.data.username}` });
    await fs.commit(writes);

    const avatars = await c.env.AVATARS.list({ prefix: `avatars/${uid}/`, limit: 100 });
    if (avatars.objects.length) await c.env.AVATARS.delete(avatars.objects.map((o) => o.key));
    await deleteAuthUser(c.env, uid);
    return c.json({ ok: true });
  });

  // ---------- admin: everything below needs an admin role ----------
  const admin = new Hono<Ctx & { Variables: Vars & { role: AdminRole } }>();
  admin.use('*', async (c, next) => {
    const role = await roleOf(c.get('fs'), c.get('uid'));
    if (!role) fail(403, 'Admin access required');
    c.set('role', role!);
    await next();
  });

  // Remove / restore a post.
  for (const [route, status] of [
    ['remove', 'removed'],
    ['restore', 'published'],
  ] as const) {
    admin.post(`/posts/:postId/${route}`, async (c) => {
      const { note } = await body(c.req.raw, moderationNoteSchema);
      const fs = c.get('fs');
      const path = `posts/${c.req.param('postId')}`;
      const { writes, townId } = await contentStatusWrites(fs, c.get('uid'), path, status, note);
      if (!canModerate(c.get('role'), townId)) fail(403, 'You cannot moderate this town');
      writes.push(audit(fs, c.get('uid'), `post.${route}`, path, townId, { note }));
      await fs.commit(writes);
      return c.json({ ok: true });
    });

    admin.post(`/posts/:postId/comments/:commentId/${route}`, async (c) => {
      const { note } = await body(c.req.raw, moderationNoteSchema);
      const fs = c.get('fs');
      const path = `posts/${c.req.param('postId')}/comments/${c.req.param('commentId')}`;
      const { writes, townId } = await contentStatusWrites(fs, c.get('uid'), path, status, note);
      if (!canModerate(c.get('role'), townId)) fail(403, 'You cannot moderate this town');
      writes.push(audit(fs, c.get('uid'), `comment.${route}`, path, townId, { note }));
      await fs.commit(writes);
      return c.json({ ok: true });
    });
  }

  admin.post('/posts/:postId/pin', async (c) => {
    const { pinned } = await body(c.req.raw, pinSchema);
    const fs = c.get('fs');
    const path = `posts/${c.req.param('postId')}`;
    const post = await fs.get<PostDoc>(path);
    if (!post) fail(404, 'Post not found');
    if (!canAnnounce(c.get('role'), post!.data.townId)) fail(403, 'You cannot pin posts in this town');
    if (pinned && post!.data.status !== 'published') fail(409, 'Only published posts can be pinned');
    await fs.commit([
      { kind: 'update', path, data: { pinned } },
      audit(fs, c.get('uid'), pinned ? 'post.pin' : 'post.unpin', path, post!.data.townId),
    ]);
    return c.json({ ok: true });
  });

  // ---------- reports ----------
  admin.post('/reports/:reportId/resolve', async (c) => {
    const input = await body(c.req.raw, resolveReportSchema);
    const fs = c.get('fs');
    const uid = c.get('uid');
    const role = c.get('role');
    const reportPath = `reports/${c.req.param('reportId')}`;
    const report = await fs.get<ReportDoc>(reportPath);
    if (!report) fail(404, 'Report not found');
    if (report!.data.status !== 'open') fail(409, 'This report has already been resolved');
    const r = report!.data;

    const writes: Write[] = [];
    let townId = r.townId;
    let authorId: string | null = null;

    if (r.targetType === 'user') {
      const target = await fs.get<UserDoc>(r.targetPath);
      townId = target?.data.hometownId ?? r.townId;
      authorId = target ? r.targetId : null;
      if (input.action === 'remove_content') fail(400, 'Use "suspend" for reports about a user');
    } else {
      const target = await fs.get<PostDoc | CommentDoc>(r.targetPath);
      if (target) {
        townId = target.data.townId;
        authorId = target.data.authorId;
        if (input.action !== 'dismiss' && target.data.status === 'published') {
          const removal = await contentStatusWrites(fs, uid, r.targetPath, 'removed', input.note);
          writes.push(...removal.writes);
        }
      }
    }
    // Permission is checked against the target's real town, not the reporter's claim.
    if (!canModerate(role, townId)) fail(403, 'You cannot moderate this town');

    if (input.action === 'remove_content_and_suspend' && authorId) {
      const author = await fs.get<UserDoc>(`users/${authorId}`);
      if (author) {
        if (!canSuspend(role, author.data.hometownId)) fail(403, 'You cannot suspend this user');
        if (await roleOf(fs, authorId)) fail(409, 'Admins cannot be suspended. Remove their role first.');
        if (author.data.status === 'active') {
          writes.push({ kind: 'update', path: `users/${authorId}`, data: { status: 'suspended', ...moderation(uid, 'suspend', input.note) } });
          writes.push(audit(fs, uid, 'user.suspend', `users/${authorId}`, author.data.hometownId, { note: input.note }));
        }
      }
    }

    // Resolve every open report about the same target together.
    const related = await fs.query<ReportDoc>({
      collection: 'reports',
      where: [['targetPath', 'EQUAL', r.targetPath], ['status', 'EQUAL', 'open']],
      limit: 200,
    });
    const status = input.action === 'dismiss' ? 'dismissed' : 'actioned';
    for (const rep of related) {
      writes.push({
        kind: 'update',
        path: rep.path,
        data: { status, resolvedBy: uid, resolvedAt: FieldValue.serverTimestamp(), resolution: { action: input.action, note: input.note } },
      });
    }
    writes.push(audit(fs, uid, `report.${input.action}`, reportPath, townId, { note: input.note, targetPath: r.targetPath }));
    await fs.commit(writes);
    return c.json({ ok: true, resolved: related.length });
  });

  // ---------- users ----------
  for (const [route, from, to] of [
    ['suspend', 'active', 'suspended'],
    ['restore', 'suspended', 'active'],
  ] as const) {
    admin.post(`/users/:uid/${route}`, async (c) => {
      const { note } = await body(c.req.raw, moderationNoteSchema);
      const fs = c.get('fs');
      const targetUid = c.req.param('uid');
      if (targetUid === c.get('uid')) fail(400, 'You cannot change your own account status');
      const path = `users/${targetUid}`;
      const user = await fs.get<UserDoc>(path);
      if (!user) fail(404, 'User not found');
      if (!canSuspend(c.get('role'), user!.data.hometownId)) fail(403, 'You cannot manage this user');
      if (route === 'suspend' && (await roleOf(fs, targetUid))) fail(409, 'Admins cannot be suspended. Remove their role first.');
      if (user!.data.status !== from) fail(409, `User is already ${user!.data.status}`);
      await fs.commit([
        { kind: 'update', path, data: { status: to, ...moderation(c.get('uid'), route, note) } },
        audit(fs, c.get('uid'), `user.${route}`, path, user!.data.hometownId, { note }),
      ]);
      return c.json({ ok: true });
    });
  }

  // ---------- announcements ----------
  admin.post('/announcements', async (c) => {
    const input = await body(c.req.raw, announcementSchema);
    if (!canAnnounce(c.get('role'), input.townId)) fail(403, 'You cannot publish announcements here');
    const fs = c.get('fs');
    const path = `announcements/${fs.newId()}`;
    await fs.commit([
      {
        kind: 'create',
        path,
        data: {
          townId: input.townId,
          title: input.title,
          body: input.body,
          pinned: input.pinned,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          status: 'published',
          authorId: c.get('uid'),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      audit(fs, c.get('uid'), 'announcement.create', path, input.townId, { title: input.title }),
    ]);
    return c.json({ ok: true, id: path.split('/')[1] });
  });

  admin.patch('/announcements/:id', async (c) => {
    const input = await body(c.req.raw, announcementUpdateSchema);
    const fs = c.get('fs');
    const path = `announcements/${c.req.param('id')}`;
    const existing = await fs.get<{ townId: string }>(path);
    if (!existing) fail(404, 'Announcement not found');
    const role = c.get('role');
    if (!canAnnounce(role, existing!.data.townId)) fail(403, 'You cannot edit this announcement');
    if (input.townId && !canAnnounce(role, input.townId)) fail(403, 'You cannot move it to that town');
    const data: Data = { updatedAt: FieldValue.serverTimestamp() };
    if (input.townId !== undefined) data.townId = input.townId;
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body;
    if (input.pinned !== undefined) data.pinned = input.pinned;
    if (input.status !== undefined) data.status = input.status;
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    await fs.commit([
      { kind: 'update', path, data },
      audit(fs, c.get('uid'), 'announcement.update', path, input.townId ?? existing!.data.townId, {
        fields: Object.keys(data).filter((k) => k !== 'updatedAt'),
      }),
    ]);
    return c.json({ ok: true });
  });

  // ---------- roles (Super Admin only) ----------
  admin.post('/roles', async (c) => {
    if (!isSuperAdmin(c.get('role'))) fail(403, 'Only a Super Admin can manage roles');
    const input = await body(c.req.raw, grantRoleSchema);
    const fs = c.get('fs');
    const name = await fs.get<{ uid: string }>(`usernames/${input.username}`);
    if (!name) fail(404, `No user with username @${input.username}`);
    const targetUid = name!.data.uid;
    const current = await roleOf(fs, targetUid);
    if (isSuperAdmin(current) && input.role !== 'super_admin') await assertNotLastSuper(fs);
    const townIds = input.role === 'super_admin' ? [] : input.townIds;
    const path = `admin_roles/${targetUid}`;
    await fs.commit([
      { kind: 'set', path, data: { role: input.role, townIds, username: input.username, grantedBy: c.get('uid'), grantedAt: FieldValue.serverTimestamp() } },
      audit(fs, c.get('uid'), 'role.grant', path, townIds.join(',') || 'all', { role: input.role, townIds, username: input.username }),
    ]);
    return c.json({ ok: true, uid: targetUid });
  });

  admin.delete('/roles/:uid', async (c) => {
    if (!isSuperAdmin(c.get('role'))) fail(403, 'Only a Super Admin can manage roles');
    const fs = c.get('fs');
    const targetUid = c.req.param('uid');
    const current = await roleOf(fs, targetUid);
    if (!current) fail(404, 'This user has no role');
    if (isSuperAdmin(current)) await assertNotLastSuper(fs);
    const path = `admin_roles/${targetUid}`;
    await fs.commit([
      { kind: 'delete', path },
      audit(fs, c.get('uid'), 'role.revoke', path, current!.townIds.join(',') || 'all', { role: current!.role }),
    ]);
    return c.json({ ok: true });
  });

  app.route('/admin', admin);
  return app;
}

async function assertNotLastSuper(fs: Firestore) {
  const supers = await fs.query({ collection: 'admin_roles', where: [['role', 'EQUAL', 'super_admin']], limit: 2 });
  if (supers.length < 2) fail(409, 'There must always be at least one Super Admin');
}
