/**
 * Phone and computer notifications: who gets what, with which words, and delivery to every device.
 *
 * Devices live in `push_subs/{hash of endpoint}` ({uid, endpoint, keys, topics}); choices in `push_prefs/{uid}`.
 * Both are written only by this Worker. Delivery to many devices is split into small batches, each handled by
 * a fresh call of this same Worker (the SELF binding), to stay within Cloudflare's free-plan limit of 50
 * outgoing requests and 10 ms of CPU per request.
 */
import {
  type AdminRole,
  type PushNotifyInput,
  type PushPrefs,
  REPORT_REASONS,
  canReportMatch,
  normalizePushPrefs,
  pushTopics,
  sportsTopic,
  staffTopics,
  townShortName,
  townTopics,
} from '@siwu/shared';
import { type Env, isEmulator } from './env';
import { type Doc, FieldValue, Firestore, FirestoreError } from './firestore';
import { type VapidKeys, sendPush } from './webpush';

export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when tapped, e.g. "/chat/abc". */
  url: string;
  /** Notifications with the same tag replace each other on the phone (e.g. one per chat). */
  tag?: string;
  urgency?: 'low' | 'normal' | 'high';
  /** Seconds the push service keeps it for a phone that is offline. */
  ttl?: number;
}

export interface SubDoc {
  uid: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  topics: string[];
}

/** Everyone in `uids` whose devices listen to `topic`, or every device listening to any of `topics`. */
export type Target = { uids: string[]; topic: string } | { topics: string[] };

const INLINE_MAX = 12; // devices sent to directly in the current request
const BATCH = 20; // devices per extra Worker call
const PAGE = 400; // devices read per page of a big audience

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: 'mailto:privacy@siwuconnect.com' };
}

async function sha(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const subPath = async (endpoint: string) => `push_subs/${(await sha(endpoint)).slice(0, 40)}`;
export const internalKey = async (env: Env) => sha(`siwu-push-internal:${env.VAPID_PRIVATE_KEY ?? ''}`);

/** Real push services only (Chrome/Android, Firefox, Safari/iPhone, Edge), so the API cannot be used to call other sites. */
export function allowedEndpoint(env: Env, endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (isEmulator(env) && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;
  if (u.protocol !== 'https:') return false;
  const h = u.hostname;
  return (
    h === 'fcm.googleapis.com' ||
    h === 'android.googleapis.com' ||
    h === 'web.push.apple.com' ||
    h.endsWith('.push.apple.com') ||
    h.endsWith('.push.services.mozilla.com') ||
    h.endsWith('.notify.windows.com')
  );
}

// ---------------- choices and devices ----------------

export async function loadPrefs(fs: Firestore, uid: string): Promise<PushPrefs> {
  const d = await fs.get<{ prefs?: unknown }>(`push_prefs/${uid}`);
  return normalizePushPrefs(d?.data.prefs);
}

export async function topicsFor(fs: Firestore, uid: string, prefs?: PushPrefs): Promise<string[]> {
  const [p, user, role] = await Promise.all([
    prefs ? Promise.resolve(prefs) : loadPrefs(fs, uid),
    fs.get<{ hometownId?: string }>(`users/${uid}`),
    fs.get<AdminRole>(`admin_roles/${uid}`),
  ]);
  return pushTopics(p, user?.data.hometownId ?? '', role ? { role: role.data.role, townIds: role.data.townIds ?? [] } : null);
}

/** After choices, hometown or role change: every device of the member listens to the right topics. */
export async function refreshDevices(fs: Firestore, uid: string, prefs?: PushPrefs): Promise<number> {
  const [topics, subs] = await Promise.all([topicsFor(fs, uid, prefs), fs.query({ collection: 'push_subs', where: [['uid', 'EQUAL', uid]], limit: 50 })]);
  if (subs.length) await fs.commit(subs.map((s) => ({ kind: 'update' as const, path: s.path, data: { topics, updatedAt: FieldValue.serverTimestamp() } })));
  return subs.length;
}

// ---------------- delivery ----------------

async function collect(fs: Firestore, target: Target, exclude?: string, afterPath?: string): Promise<{ subs: Doc<SubDoc>[]; next: string | null }> {
  if ('uids' in target) {
    const uids = [...new Set(target.uids)].filter((u) => u && u !== exclude).slice(0, 300);
    const subs: Doc<SubDoc>[] = [];
    for (let i = 0; i < uids.length; i += 30) {
      subs.push(...(await fs.query<SubDoc>({ collection: 'push_subs', where: [['uid', 'IN', uids.slice(i, i + 30)]], limit: 300 })));
    }
    return { subs: subs.filter((s) => s.data.topics?.includes(target.topic)), next: null };
  }
  if (!target.topics.length) return { subs: [], next: null };
  const rows = await fs.query<SubDoc>({
    collection: 'push_subs',
    where: [['topics', 'ARRAY_CONTAINS_ANY', [...new Set(target.topics)].slice(0, 30)]],
    limit: PAGE,
    afterPath,
  });
  return { subs: rows.filter((s) => s.data.uid !== exclude), next: rows.length === PAGE ? rows[rows.length - 1]!.path : null };
}

/** Sends to these devices now; forgets devices whose owner uninstalled or turned notifications off. */
export async function sendTo(env: Env, fs: Firestore, subs: Pick<Doc<SubDoc>, 'path' | 'data'>[], msg: PushMessage): Promise<number> {
  const v = vapidKeys(env);
  if (!v || !subs.length) return 0;
  const payload = { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag ?? null };
  const results = await Promise.all(subs.map((s) => sendPush(s.data, payload, v, { ttl: msg.ttl ?? 86400, urgency: msg.urgency ?? 'normal' })));
  const gone = subs.filter((_, i) => results[i] === 'gone');
  if (gone.length) await fs.commit(gone.map((s) => ({ kind: 'delete' as const, path: s.path }))).catch((e) => console.warn('Could not forget devices', e));
  return results.filter((r) => r === 'sent').length;
}

async function internal(env: Env, op: 'send' | 'fanout' | 'job', body: unknown): Promise<void> {
  const res = await env.SELF!.fetch(
    new Request(`https://push.internal/internal/push/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-push-key': await internalKey(env) },
      body: JSON.stringify(body),
    }),
  );
  if (!res.ok) console.warn(`Push ${op} call failed: ${res.status}`);
}

/**
 * Notifies the target. Returns how many devices were sent to (or handed to batches).
 * `exclude` is the person who caused it (they never get their own notification).
 */
export async function deliver(env: Env, fs: Firestore, target: Target, msg: PushMessage, opts: { exclude?: string; afterPath?: string } = {}): Promise<number> {
  if (!vapidKeys(env)) return 0;
  const { subs, next } = await collect(fs, target, opts.exclude, opts.afterPath);
  if (!env.SELF) {
    // Local tests: everything in this request.
    let n = await sendTo(env, fs, subs, msg);
    if (next) n += await deliver(env, fs, target, msg, { ...opts, afterPath: next });
    return n;
  }
  if (subs.length <= INLINE_MAX && !next) return sendTo(env, fs, subs, msg);
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < subs.length; i += BATCH) {
    jobs.push(internal(env, 'send', { subs: subs.slice(i, i + BATCH).map((s) => ({ path: s.path, data: s.data })), msg }));
  }
  if (next) jobs.push(internal(env, 'fanout', { target, msg, exclude: opts.exclude, afterPath: next }));
  await Promise.allSettled(jobs);
  return subs.length;
}

/** Runs work in its own Worker call when possible (fresh limits), else right here. */
async function job(env: Env, fs: Firestore, j: Job): Promise<number> {
  if (env.SELF) {
    await internal(env, 'job', j);
    return 0;
  }
  return runJob(env, fs, j);
}

// ---------------- words ----------------

const clip = (s: string | null | undefined, n = 140): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const recent = (d: unknown, minutes = 10): boolean => d instanceof Date && Math.abs(Date.now() - d.getTime()) < minutes * 60_000;
const when = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' }).format(d);
const day = (d: Date) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Accra' }).format(d);
const time = (d: Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' }).format(d);

async function person(fs: Firestore, uid: string): Promise<{ name: string; username: string }> {
  const u = await fs.get<{ displayName?: string; username?: string }>(`users/${uid}`);
  return { name: u?.data.displayName || u?.data.username || 'Someone', username: u?.data.username ?? '' };
}

interface PostLike {
  text?: string;
  media?: { type?: string }[];
  imageUrl?: string | null;
}
function postSnippet(p: PostLike | undefined): string {
  if (!p) return '';
  if (p.text) return clip(p.text);
  const m = p.media?.[0];
  if (m?.type === 'video') return '🎥 Video';
  if (m || p.imageUrl) return '📷 Photo';
  return '';
}

/** Records that something was notified, so it never notifies twice. False if it already was. */
async function once(fs: Firestore, key: string): Promise<boolean> {
  try {
    await fs.commit([{ kind: 'create', path: `push_log/${(await sha(key)).slice(0, 40)}`, data: { key: key.slice(0, 200), createdAt: FieldValue.serverTimestamp() } }]);
    return true;
  } catch (e) {
    if (e instanceof FirestoreError && (e.status === 409 || e.status === 400)) return false;
    throw e;
  }
}

async function friendsOf(fs: Firestore, uid: string): Promise<string[]> {
  const rows = await fs.query<{ members: string[]; status: string }>({ collection: 'friendships', where: [['members', 'ARRAY_CONTAINS', uid]], limit: 500 });
  return rows.filter((r) => r.data.status === 'accepted').map((r) => r.data.members.find((m) => m !== uid)!).filter(Boolean);
}

// ---------------- in-app notifications (the bell) → phone ----------------

export interface NotificationDoc {
  type: string;
  actorId: string;
  postId?: string | null;
  commentId?: string | null;
  targetPath?: string | null;
  title?: string | null;
  note?: string | null;
  createdAt?: unknown;
}

const CATEGORY: Record<string, string> = {
  like: 'likes',
  repost: 'likes',
  comment: 'social',
  mention: 'social',
  friend_request: 'friends',
  friend_accepted: 'friends',
  approved: 'account',
  rejected: 'account',
  verified: 'account',
  tester: 'account',
};

/** Sends the phone version of a notification that was just added to the member's bell. */
export async function pushNotification(env: Env, fs: Firestore, recipient: string, n: NotificationDoc): Promise<number> {
  const topic = CATEGORY[n.type];
  if (!topic || !vapidKeys(env)) return 0;
  const actor = n.type === 'approved' || n.type === 'rejected' || n.type === 'verified' || n.type === 'tester' ? null : await person(fs, n.actorId);
  let msg: PushMessage | null = null;
  const postUrl = `/p/${n.postId}`;
  switch (n.type) {
    case 'like': {
      const post = await fs.get<PostLike>(`posts/${n.postId}`);
      msg = { title: `${actor!.name} reacted to your post`, body: postSnippet(post?.data), url: postUrl, tag: `post-${n.postId}`, urgency: 'low' };
      break;
    }
    case 'repost': {
      const post = await fs.get<PostLike>(`posts/${n.postId}`);
      msg = post?.data.text
        ? { title: `🔁 ${actor!.name} quoted your post`, body: clip(post.data.text), url: postUrl, urgency: 'low' }
        : { title: `🔁 ${actor!.name} reposted your post`, body: '', url: postUrl, urgency: 'low' };
      break;
    }
    case 'comment': {
      const c = await fs.get<{ text?: string }>(`posts/${n.postId}/comments/${n.commentId}`);
      msg = { title: `💬 ${actor!.name} commented on your post`, body: clip(c?.data.text), url: `${postUrl}#comments`, tag: `comments-${n.postId}` };
      break;
    }
    case 'mention': {
      const post = await fs.get<PostLike>(`posts/${n.postId}`);
      msg = { title: `${actor!.name} mentioned you`, body: postSnippet(post?.data), url: postUrl };
      break;
    }
    case 'friend_request':
      msg = { title: `👋 ${actor!.name} sent you a friend request`, body: 'Open their profile to accept.', url: `/u/${actor!.username}`, tag: `friend-${n.actorId}` };
      break;
    case 'friend_accepted':
      msg = { title: `🤝 ${actor!.name} accepted your friend request`, body: 'You can now chat privately and see each other’s stories.', url: `/u/${actor!.username}`, tag: `friend-${n.actorId}` };
      break;
    case 'approved':
    case 'rejected': {
      const [col, id] = (n.targetPath ?? '').split('/');
      const url = col === 'listings' ? `/market/${id}` : col === 'directory' ? `/directory/${id}` : '/notifications';
      msg =
        n.type === 'approved'
          ? { title: `✅ Approved: ${clip(n.title, 60)}`, body: clip(n.note) || 'It is now visible to everyone.', url }
          : { title: `Not approved: ${clip(n.title, 60)}`, body: clip(n.note) || 'Open it to see why, then edit it.', url };
      break;
    }
    case 'verified':
      msg = { title: '☑️ Your account is verified', body: 'A verified badge now shows next to your name.', url: '/me' };
      break;
    case 'tester':
      msg = { title: '🧪 You are a Siwu Connect pilot tester', body: 'Thank you! Open the app to see your checklist.', url: '/' };
      break;
  }
  return msg ? deliver(env, fs, { uids: [recipient], topic }, msg) : 0;
}

export async function pushAnnouncement(env: Env, fs: Firestore, a: { id: string; townId: string; title: string; body: string }, authorId: string): Promise<number> {
  return deliver(
    env,
    fs,
    { topics: townTopics('ann', a.townId) },
    { title: `📢 ${clip(a.title, 80)}`, body: clip(a.body), url: a.townId === 'all' ? '/' : `/towns/${a.townId}`, tag: `ann-${a.id}`, ttl: 3 * 86400 },
    { exclude: authorId },
  );
}

// ---------------- the app says "I just saved this" ----------------

interface MatchDoc {
  home: { name: string; townId: string | null };
  away: { name: string; townId: string | null };
  homeScore: number;
  awayScore: number;
  status: string;
  competition?: string;
  venue?: string;
}

/**
 * Checks what the caller just saved (it must be theirs and new) and notifies the right people, once.
 * Anything that does not check out is silently ignored.
 */
export async function handleNotify(env: Env, fs: Firestore, uid: string, input: PushNotifyInput): Promise<number> {
  if (!vapidKeys(env)) return 0;
  const parts = input.path.split('/');
  switch (input.kind) {
    case 'notification': {
      if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'notifications') return 0;
      const n = await fs.get<NotificationDoc & { createdAt?: Date }>(input.path);
      if (!n || n.data.actorId !== uid || !recent(n.data.createdAt)) return 0;
      if (!['like', 'repost', 'comment', 'mention', 'friend_request', 'friend_accepted'].includes(n.data.type)) return 0;
      // A like is notified once per person and post, even after unlike + like again.
      if (!(await once(fs, n.data.type === 'like' ? input.path : `${input.path}|${(n.data.createdAt as Date).toISOString()}`))) return 0;
      return pushNotification(env, fs, parts[1]!, n.data);
    }

    case 'message': {
      if (parts.length !== 4 || parts[0] !== 'chats' || parts[2] !== 'messages') return 0;
      const chatPath = `chats/${parts[1]}`;
      const [m, chat] = await Promise.all([
        fs.get<{ senderId: string; status: string; text?: string; imageUrl?: string | null; audioUrl?: string; post?: unknown; story?: unknown; createdAt?: Date }>(input.path),
        fs.get<{ type: string; members?: string[]; name?: string }>(chatPath),
      ]);
      if (!m || !chat || m.data.senderId !== uid || m.data.status !== 'sent' || !recent(m.data.createdAt, 5)) return 0;
      if (chat.data.type !== 'dm' && chat.data.type !== 'group') return 0; // town rooms are too busy for notifications
      if (!chat.data.members?.includes(uid)) return 0;
      if (!(await once(fs, input.path))) return 0;
      const sender = await person(fs, uid);
      const d = m.data;
      const preview = d.text ? clip(d.text) : d.audioUrl ? '🎤 Voice note' : d.post ? '📝 Shared a post' : d.imageUrl ? '📷 Photo' : 'New message';
      const msg: PushMessage = d.story
        ? { title: `${sender.name} replied to your story`, body: preview, url: `/chat/${parts[1]}` }
        : chat.data.type === 'group'
          ? { title: chat.data.name || 'Group chat', body: `${sender.name}: ${preview}`, url: `/chat/${parts[1]}` }
          : { title: sender.name, body: preview, url: `/chat/${parts[1]}` };
      return deliver(env, fs, { uids: chat.data.members, topic: 'messages' }, { ...msg, tag: `chat-${parts[1]}`, urgency: 'high', ttl: 2 * 86400 }, { exclude: uid });
    }

    case 'match': {
      if (parts[0] !== 'matches' || !input.event) return 0;
      const matchPath = `matches/${parts[1]}`;
      const [match, role] = await Promise.all([fs.get<MatchDoc>(matchPath), fs.get<AdminRole>(`admin_roles/${uid}`)]);
      if (!match || !role || !canReportMatch({ role: role.data.role, townIds: role.data.townIds ?? [] }, match.data)) return 0;
      const m = match.data;
      const score = `${m.home.name} ${m.homeScore}–${m.awayScore} ${m.away.name}`;
      let msg: PushMessage;
      if (input.event === 'goal') {
        if (parts.length !== 4 || parts[2] !== 'updates') return 0;
        const up = await fs.get<{ type: string; team: string; minute: number | null; text?: string; createdBy: string; createdAt?: Date }>(input.path);
        if (!up || up.data.type !== 'goal' || up.data.createdBy !== uid || !recent(up.data.createdAt, 5)) return 0;
        const team = up.data.team === 'home' ? m.home.name : m.away.name;
        const extra = [up.data.minute !== null ? `${up.data.minute}′` : '', clip(up.data.text, 80)].filter(Boolean).join(' · ');
        msg = { title: `⚽ GOAL! ${team}`, body: extra ? `${score} · ${extra}` : score, url: `/${matchPath.replace('matches', 'sports')}` };
      } else {
        if (parts.length !== 2) return 0;
        const want = { kickoff: 'live', halftime: 'halftime', fulltime: 'finished' }[input.event];
        if (m.status !== want) return 0;
        msg =
          input.event === 'kickoff'
            ? { title: `🟢 Kick-off: ${m.home.name} vs ${m.away.name}`, body: clip([m.competition, m.venue].filter(Boolean).join(' · ')) || 'Follow it live.', url: `/sports/${parts[1]}` }
            : input.event === 'halftime'
              ? { title: '⏸️ Half time', body: score, url: `/sports/${parts[1]}` }
              : { title: '🏁 Full time', body: score, url: `/sports/${parts[1]}` };
      }
      if (!(await once(fs, `${input.path}|${input.event}`))) return 0;
      return deliver(env, fs, { topics: [sportsTopic(m.home.townId), sportsTopic(m.away.townId)] }, { ...msg, tag: `match-${parts[1]}`, urgency: 'high', ttl: 3600 }, { exclude: uid });
    }

    case 'event': {
      if (parts.length !== 2 || parts[0] !== 'events') return 0;
      const e = await fs.get<{ authorId: string; status: string; townId: string; title: string; location?: string; startsAt?: Date; createdAt?: Date }>(input.path);
      if (!e || e.data.authorId !== uid || e.data.status !== 'published' || !recent(e.data.createdAt) || !(e.data.startsAt instanceof Date)) return 0;
      if (e.data.startsAt.getTime() < Date.now()) return 0;
      if (!(await once(fs, input.path))) return 0;
      return deliver(
        env,
        fs,
        { topics: townTopics('events', e.data.townId) },
        {
          title: `📅 New event in ${e.data.townId === 'all' ? 'Akpafu' : townShortName(e.data.townId)}: ${clip(e.data.title, 60)}`,
          body: [when(e.data.startsAt), clip(e.data.location, 60)].filter(Boolean).join(' · '),
          url: `/events/${parts[1]}`,
        },
        { exclude: uid },
      );
    }

    case 'report': {
      if (parts.length !== 2 || parts[0] !== 'reports') return 0;
      const r = await fs.get<{ reporterId: string; townId: string; reason: string; targetType: string; createdAt?: Date }>(input.path);
      if (!r || r.data.reporterId !== uid || !recent(r.data.createdAt)) return 0;
      if (!(await once(fs, input.path))) return 0;
      const reason = REPORT_REASONS.find((x) => x.id === r.data.reason)?.label ?? r.data.reason;
      return deliver(
        env,
        fs,
        { topics: staffTopics(r.data.townId) },
        { title: `🚩 New report in ${townShortName(r.data.townId)}`, body: `${reason} (${r.data.targetType})`, url: '/admin/reports', tag: 'reports' },
        { exclude: uid },
      );
    }

    case 'approval': {
      if (parts.length !== 2 || (parts[0] !== 'listings' && parts[0] !== 'directory')) return 0;
      const owner = parts[0] === 'listings' ? 'sellerId' : 'ownerId';
      const item = await fs.get<Record<string, unknown> & { status: string; townId: string; title: string; updatedAt?: Date }>(input.path);
      if (!item || item.data[owner] !== uid || item.data.status !== 'pending' || !recent(item.data.updatedAt)) return 0;
      if (!(await once(fs, `${input.path}|${(item.data.updatedAt as Date).toISOString()}`))) return 0;
      return deliver(
        env,
        fs,
        { topics: staffTopics(item.data.townId) },
        {
          title: parts[0] === 'listings' ? '🛒 A listing is waiting for approval' : '🏪 A directory entry is waiting for approval',
          body: `${clip(item.data.title, 80)} · ${townShortName(item.data.townId)}`,
          url: '/admin/approvals',
          tag: 'approvals',
        },
        { exclude: uid },
      );
    }

    case 'homevisit': {
      if (parts.length !== 2 || parts[0] !== 'users' || parts[1] !== uid) return 0;
      const u = await fs.get<{ displayName?: string; username?: string; homeVisitTown?: string | null; homeVisitUntil?: Date | null }>(input.path);
      const until = u?.data.homeVisitUntil;
      if (!u || !u.data.homeVisitTown || !(until instanceof Date) || until.getTime() < Date.now()) return 0;
      if (!(await once(fs, `${input.path}|home|${until.toISOString()}`))) return 0;
      const friends = await friendsOf(fs, uid);
      return deliver(env, fs, { uids: friends, topic: 'friends' }, {
        title: `🏡 ${u.data.displayName || u.data.username} is home in ${townShortName(u.data.homeVisitTown)}`,
        body: `Until ${day(until)}. Say hello!`,
        url: `/u/${u.data.username}`,
      });
    }

    case 'story': {
      if (parts.length !== 2 || parts[0] !== 'stories') return 0;
      const s = await fs.get<{ authorId: string; status: string; text?: string; audience?: string[]; createdAt?: Date }>(input.path);
      if (!s || s.data.authorId !== uid || s.data.status !== 'active' || !recent(s.data.createdAt)) return 0;
      const pub = s.data.audience?.find((a) => a.startsWith('public:'));
      if (!pub) return 0; // friends' stories don't notify; admin stories for a town or everyone do
      if (!(await once(fs, input.path))) return 0;
      const author = await person(fs, uid);
      return deliver(
        env,
        fs,
        { topics: townTopics('ann', pub.slice('public:'.length)) },
        { title: `📣 ${author.name} posted a story`, body: clip(s.data.text) || 'Tap to watch it.', url: '/', ttl: 86400 },
        { exclude: uid },
      );
    }
  }
  return 0;
}

// ---------------- every hour: reminders, birthdays, tidy-up ----------------

export type Job = { type: 'reminder'; eventId: string } | { type: 'birthday'; uid: string; dateKey: string };

export async function runJob(env: Env, fs: Firestore, j: Job): Promise<number> {
  if (j.type === 'reminder') {
    const e = await fs.get<{ status: string; title: string; location?: string; startsAt?: Date }>(`events/${j.eventId}`);
    if (!e || e.data.status !== 'published' || !(e.data.startsAt instanceof Date)) return 0;
    if (!(await once(fs, `reminder|${j.eventId}|${e.data.startsAt.toISOString()}`))) return 0;
    const going = await fs.query<{ status: string }>({ collection: 'rsvps', parent: `events/${j.eventId}`, where: [['status', 'EQUAL', 'going']], limit: 300 });
    return deliver(env, fs, { uids: going.map((g) => g.id), topic: 'reminders' }, {
      title: `⏰ Starting soon: ${clip(e.data.title, 70)}`,
      body: [`Starts at ${time(e.data.startsAt)}`, clip(e.data.location, 60)].filter(Boolean).join(' · '),
      url: `/events/${j.eventId}`,
      urgency: 'high',
      ttl: 2 * 3600,
    });
  }
  const who = await fs.get<{ displayName?: string; username?: string; birthdayKey?: string | null; status?: string }>(`users/${j.uid}`);
  if (!who || who.data.birthdayKey !== j.dateKey || who.data.status === 'suspended') return 0;
  if (!(await once(fs, `birthday|${j.uid}|${new Date().getUTCFullYear()}-${j.dateKey}`))) return 0;
  return deliver(env, fs, { uids: await friendsOf(fs, j.uid), topic: 'birthdays' }, {
    title: `🎂 It’s ${who.data.displayName || who.data.username}’s birthday today`,
    body: 'Send them a birthday wish!',
    url: `/u/${who.data.username}`,
    ttl: 12 * 3600,
  });
}

/** Called every hour by the cron trigger. */
export async function runHourly(env: Env, now = new Date()): Promise<string> {
  if (!vapidKeys(env)) return 'Notifications are not configured.';
  const fs = new Firestore(env);
  const out: string[] = [];
  // Events starting in 1–2 hours: remind those going.
  const events = await fs.query<{ status: string }>({
    collection: 'events',
    where: [
      ['startsAt', 'GREATER_THAN_OR_EQUAL', new Date(now.getTime() + 60 * 60_000)],
      ['startsAt', 'LESS_THAN', new Date(now.getTime() + 120 * 60_000)],
    ],
    limit: 30,
  });
  const live = events.filter((e) => e.data.status === 'published');
  for (const e of live) await job(env, fs, { type: 'reminder', eventId: e.id });
  out.push(`${live.length} event reminders`);
  // 07:00 in Ghana (GMT): friends' birthdays.
  if (now.getUTCHours() === 7) {
    const dateKey = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const people = await fs.query({ collection: 'users', where: [['birthdayKey', 'EQUAL', dateKey]], limit: 40 });
    for (const p of people) await job(env, fs, { type: 'birthday', uid: p.id, dateKey });
    out.push(`${people.length} birthdays`);
  }
  // Forget the "already notified" records after a week.
  const old = await fs.query({ collection: 'push_log', where: [['createdAt', 'LESS_THAN', new Date(now.getTime() - 8 * 86400_000)]], limit: 300 });
  if (old.length) await fs.commit(old.map((d) => ({ kind: 'delete' as const, path: d.path })));
  out.push(`${old.length} old records removed`);
  return out.join(', ');
}
