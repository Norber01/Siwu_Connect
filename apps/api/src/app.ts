import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import {
  type AdminRole,
  EXTRA_LIMITS,
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
import { type Caller, deleteAuthUser, verifyIdToken } from './auth';
import { runSetup, setupStatus } from './setup';
import type { Env } from './env';
import { type Data, FieldValue, Firestore, type Write } from './firestore';

type Vars = { uid: string; fs: Firestore; caller: Caller };
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
  targetType: 'post' | 'comment' | 'user' | 'event' | 'listing';
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

interface ContentDoc {
  authorId?: string;
  sellerId?: string;
  townId: string;
  status: string;
}

/** Which statuses count as "visible" for each kind of content, and what a restore returns to. */
function contentKind(path: string): { kind: 'post' | 'comment' | 'event' | 'listing'; visible: string[]; restoreTo: string } {
  const p = path.split('/');
  if (p.length === 2 && p[0] === 'posts') return { kind: 'post', visible: ['published'], restoreTo: 'published' };
  if (p.length === 4 && p[0] === 'posts' && p[2] === 'comments') return { kind: 'comment', visible: ['published'], restoreTo: 'published' };
  if (p.length === 2 && p[0] === 'events') return { kind: 'event', visible: ['published', 'cancelled'], restoreTo: 'published' };
  if (p.length === 2 && p[0] === 'listings') return { kind: 'listing', visible: ['available', 'sold'], restoreTo: 'available' };
  return fail(400, 'Unsupported target');
}

/** Builds the writes to remove or restore a post, comment, event or listing. */
async function contentStatusWrites(
  fs: Firestore,
  uid: string,
  targetPath: string,
  action: 'remove' | 'restore',
  note: string,
): Promise<{ writes: Write[]; townId: string; authorId: string }> {
  const { kind, visible, restoreTo } = contentKind(targetPath);
  const target = await fs.get<ContentDoc>(targetPath);
  if (!target) fail(404, 'Content not found');
  const status = target!.data.status;
  if (action === 'remove' && !visible.includes(status)) fail(409, `Content is ${status}, it cannot be removed`);
  if (action === 'restore' && status !== 'removed') fail(409, `Content is ${status}, not removed`);
  const newStatus = action === 'remove' ? 'removed' : restoreTo;
  const writes: Write[] = [{ kind: 'update', path: targetPath, data: { status: newStatus, ...moderation(uid, action, note) } }];
  if (kind === 'comment') {
    const postPath = targetPath.split('/comments/')[0]!;
    const post = await fs.get<PostDoc>(postPath);
    if (post?.data.status === 'published') {
      writes.push({ kind: 'update', path: postPath, data: { commentCount: FieldValue.increment(action === 'remove' ? -1 : 1) } });
    }
  }
  return { writes, townId: target!.data.townId, authorId: (target!.data.authorId ?? target!.data.sellerId)! };
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

  /** Videos are served with HTTP Range support, which phones need for playback and seeking. */
  app.get('/videos/:uid/:file', async (c) => {
    const { uid, file } = c.req.param();
    if (!/^[A-Za-z0-9_-]+\.(mp4|mov|webm)$/.test(file) || !/^[A-Za-z0-9]+$/.test(uid)) fail(404, 'Not found');
    const key = `videos/${uid}/${file}`;
    const rangeHeader = c.req.header('range');
    const m = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/);
    const offset = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : null;
    const obj = await c.env.AVATARS.get(key, m ? { range: { offset, length: end !== null ? end - offset + 1 : undefined } } : undefined);
    if (!obj) fail(404, 'Not found');
    const headers: Record<string, string> = {
      'content-type': obj!.httpMetadata?.contentType ?? 'video/mp4',
      'cache-control': 'public, max-age=31536000, immutable',
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
    };
    if (m && obj!.size !== undefined && obj!.range) {
      const len = obj!.range.length ?? obj!.size - offset;
      headers['content-range'] = `bytes ${offset}-${offset + len - 1}/${obj!.size}`;
      headers['content-length'] = String(len);
      return new Response(obj!.body, { status: 206, headers });
    }
    if (obj!.size !== undefined) headers['content-length'] = String(obj!.size);
    return new Response(obj!.body, { headers });
  });

  app.get('/images/:uid/:file', async (c) => {
    const { uid, file } = c.req.param();
    if (!/^[A-Za-z0-9_-]+\.(webp|jpg)$/.test(file) || !/^[A-Za-z0-9]+$/.test(uid)) fail(404, 'Not found');
    const obj = await c.env.AVATARS.get(`images/${uid}/${file}`);
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
      const caller = await verifyIdToken(token, c.env);
      c.set('uid', caller.uid);
      c.set('caller', caller);
    } catch {
      fail(401, 'Your session has expired. Please sign in again.');
    }
    c.set('fs', new Firestore(c.env));
    await next();
  });

  // ---------- one-time setup (from the founder's phone) ----------
  app.get('/setup/status', async (c) => c.json(await setupStatus(c.env, c.get('caller'))));

  app.post('/setup/run', async (c) => {
    const status = await setupStatus(c.env, c.get('caller'));
    if (status.superAdminExists) {
      if (!status.callerIsSuperAdmin) fail(403, 'Setup has already been completed.');
    } else {
      if (!status.founderEmailConfigured) fail(403, 'The founder email has not been configured for this site.');
      if (!status.isFounder) fail(403, 'Only the founder account (with a verified email) can run the setup.');
    }
    return c.json(await runSetup(c.env, c.get('caller')));
  });

  // ---------- photo uploads ----------
  async function readImage(c: { req: { header: (n: string) => string | undefined; arrayBuffer: () => Promise<ArrayBuffer> } }, maxBytes: number) {
    const type = c.req.header('content-type') ?? '';
    if (type !== 'image/webp' && type !== 'image/jpeg') fail(415, 'Upload a WebP or JPEG image');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) fail(400, 'Empty upload');
    if (bytes.byteLength > maxBytes) fail(413, 'Image is too large');
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (type === 'image/webp' ? !isWebp : !isJpeg) fail(415, 'File content does not match its type');
    return { bytes, type, ext: type === 'image/webp' ? 'webp' : 'jpg' };
  }

  /** Short videos for posts: MP4, MOV or WebM, up to 50 MB; 30 videos per member. */
  app.post('/uploads/video', async (c) => {
    const uid = c.get('uid');
    const fs = c.get('fs');
    const user = await fs.get<UserDoc>(`users/${uid}`);
    if (!user) fail(403, 'Finish setting up your profile first');
    if (user!.data.status !== 'active') fail(403, 'Your account is suspended');
    const type = c.req.header('content-type') ?? '';
    const ext = ({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' } as Record<string, string>)[type];
    if (!ext) fail(415, 'Upload an MP4, MOV or WebM video');
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > EXTRA_LIMITS.videoMaxBytes) fail(413, 'This video is too large (maximum 50 MB). Try a shorter clip.');
    const existing = await c.env.AVATARS.list({ prefix: `videos/${uid}/`, limit: 31 });
    if (existing.objects.length >= EXTRA_LIMITS.videosPerMember)
      fail(409, `You can have at most ${EXTRA_LIMITS.videosPerMember} videos. Delete an old post with a video first.`);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) fail(400, 'Empty upload');
    if (bytes.byteLength > EXTRA_LIMITS.videoMaxBytes) fail(413, 'This video is too large (maximum 50 MB). Try a shorter clip.');
    const isMp4 = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // "ftyp"
    const isWebm = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    if (ext === 'webm' ? !isWebm : !isMp4) fail(415, 'File content does not match its type');
    const key = `videos/${uid}/${fs.newId()}.${ext}`;
    await c.env.AVATARS.put(key, bytes, { httpMetadata: { contentType: type } });
    return c.json({ url: `${c.env.PUBLIC_API_URL.replace(/\/$/, '')}/${key}` });
  });

  app.post('/uploads/avatar', async (c) => {
    const uid = c.get('uid');
    const fs = c.get('fs');
    const user = await fs.get<UserDoc>(`users/${uid}`);
    if (user && user.data.status !== 'active') fail(403, 'Your account is suspended');
    const { bytes, type, ext } = await readImage(c, LIMITS.avatarMaxBytes);
    const key = `avatars/${uid}/${fs.newId()}.${ext}`;
    await c.env.AVATARS.put(key, bytes, { httpMetadata: { contentType: type } });

    // Keep only the new photo and the one currently on the profile.
    const current = user?.data.photoUrl?.split('/avatars/')[1];
    const existing = await c.env.AVATARS.list({ prefix: `avatars/${uid}/`, limit: 100 });
    const stale = existing.objects.map((o) => o.key).filter((k) => k !== key && k !== `avatars/${current}`);
    if (stale.length) await c.env.AVATARS.delete(stale);

    return c.json({ url: `${c.env.PUBLIC_API_URL.replace(/\/$/, '')}/${key}` });
  });

  /** Photos for events and marketplace listings. Members only; max 200 photos per member. */
  app.post('/uploads/image', async (c) => {
    const uid = c.get('uid');
    const fs = c.get('fs');
    const user = await fs.get<UserDoc>(`users/${uid}`);
    if (!user) fail(403, 'Finish setting up your profile first');
    if (user!.data.status !== 'active') fail(403, 'Your account is suspended');
    const existing = await c.env.AVATARS.list({ prefix: `images/${uid}/`, limit: 201 });
    if (existing.objects.length >= 200) fail(409, 'You have reached the photo limit. Delete old listings or events first.');
    const { bytes, type, ext } = await readImage(c, EXTRA_LIMITS.imageMaxBytes);
    const key = `images/${uid}/${fs.newId()}.${ext}`;
    await c.env.AVATARS.put(key, bytes, { httpMetadata: { contentType: type } });
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
          data: { status: 'deleted', text: '', imageUrl: null, media: [], searchTokens: [], updatedAt: FieldValue.serverTimestamp() },
        })),
      );
    }
    // Wipe the user's events and listings.
    for (const [collection, field, live] of [
      ['events', 'authorId', ['published', 'cancelled', 'removed']],
      ['listings', 'sellerId', ['available', 'sold', 'removed']],
    ] as const) {
      for (;;) {
        const docs = await fs.query({ collection, where: [[field, 'EQUAL', uid], ['status', 'IN', [...live]]], limit: 200 });
        if (!docs.length) break;
        await fs.commit(
          docs.map((d) => ({
            kind: 'update' as const,
            path: d.path,
            data: { status: 'deleted', description: '', imageUrl: null, updatedAt: FieldValue.serverTimestamp() },
          })),
        );
      }
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

    for (const prefix of [`avatars/${uid}/`, `images/${uid}/`, `videos/${uid}/`]) {
      const objects = await c.env.AVATARS.list({ prefix, limit: 1000 });
      if (objects.objects.length) await c.env.AVATARS.delete(objects.objects.map((o) => o.key));
    }
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
  for (const route of ['remove', 'restore'] as const) {
    for (const collection of ['events', 'listings'] as const) {
      admin.post(`/${collection}/:id/${route}`, async (c) => {
        const { note } = await body(c.req.raw, moderationNoteSchema);
        const fs = c.get('fs');
        const path = `${collection}/${c.req.param('id')}`;
        const { writes, townId } = await contentStatusWrites(fs, c.get('uid'), path, route, note);
        if (!canModerate(c.get('role'), townId)) fail(403, 'You cannot moderate this town');
        writes.push(audit(fs, c.get('uid'), `${collection.slice(0, -1)}.${route}`, path, townId, { note }));
        await fs.commit(writes);
        return c.json({ ok: true });
      });
    }

    admin.post(`/posts/:postId/${route}`, async (c) => {
      const { note } = await body(c.req.raw, moderationNoteSchema);
      const fs = c.get('fs');
      const path = `posts/${c.req.param('postId')}`;
      const { writes, townId } = await contentStatusWrites(fs, c.get('uid'), path, route, note);
      if (!canModerate(c.get('role'), townId)) fail(403, 'You cannot moderate this town');
      writes.push(audit(fs, c.get('uid'), `post.${route}`, path, townId, { note }));
      await fs.commit(writes);
      return c.json({ ok: true });
    });

    admin.post(`/posts/:postId/comments/:commentId/${route}`, async (c) => {
      const { note } = await body(c.req.raw, moderationNoteSchema);
      const fs = c.get('fs');
      const path = `posts/${c.req.param('postId')}/comments/${c.req.param('commentId')}`;
      const { writes, townId } = await contentStatusWrites(fs, c.get('uid'), path, route, note);
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
      const target = await fs.get<ContentDoc>(r.targetPath);
      if (target) {
        townId = target.data.townId;
        authorId = (target.data.authorId ?? target.data.sellerId) ?? null;
        if (input.action !== 'dismiss' && contentKind(r.targetPath).visible.includes(target.data.status)) {
          const removal = await contentStatusWrites(fs, uid, r.targetPath, 'remove', input.note);
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
