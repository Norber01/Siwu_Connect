/** All Firestore reads used by the app. */
import {
  type DocumentSnapshot,
  type QueryConstraint,
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import { LIMITS, normalize, searchTokens } from '@siwu/shared';
import { db } from './firebase';
import {
  toAnnouncement,
  toAudit,
  toComment,
  toPost,
  toProfile,
  toReport,
  type Announcement,
  type Post,
  type Profile,
  type RoleAssignment,
} from './types';

export type Feed = { kind: 'town'; townId: string } | { kind: 'akpafu' } | { kind: 'author'; uid: string };

export interface Page<T> {
  items: T[];
  cursor: DocumentSnapshot | null;
}

function feedConstraints(feed: Feed): QueryConstraint[] {
  if (feed.kind === 'town') return [where('townId', '==', feed.townId)];
  if (feed.kind === 'akpafu') return [where('visibility', '==', 'akpafu')];
  return [where('authorId', '==', feed.uid)];
}

export async function fetchFeedPage(feed: Feed, cursor: DocumentSnapshot | null): Promise<Page<Post>> {
  const constraints = [
    ...feedConstraints(feed),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc'),
    limit(LIMITS.feedPageSize),
  ];
  if (cursor) constraints.push(startAfter(cursor));
  const snap = await getDocs(query(collection(db, 'posts'), ...constraints));
  return {
    items: snap.docs.map(toPost),
    cursor: snap.docs.length === LIMITS.feedPageSize ? snap.docs[snap.docs.length - 1]! : null,
  };
}

export async function fetchPinned(feed: Feed): Promise<Post[]> {
  if (feed.kind === 'author') return [];
  const snap = await getDocs(
    query(
      collection(db, 'posts'),
      ...feedConstraints(feed),
      where('status', '==', 'published'),
      where('pinned', '==', true),
      orderBy('createdAt', 'desc'),
      limit(3),
    ),
  );
  return snap.docs.map(toPost);
}

export async function fetchAnnouncements(townId: string | null): Promise<Announcement[]> {
  const towns = townId ? [townId, 'all'] : ['all'];
  const snap = await getDocs(
    query(
      collection(db, 'announcements'),
      where('status', '==', 'published'),
      where('townId', 'in', towns),
      orderBy('createdAt', 'desc'),
      limit(10),
    ),
  );
  const now = Date.now();
  return snap.docs
    .map(toAnnouncement)
    .filter((a) => !a.expiresAt || a.expiresAt.getTime() > now)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .slice(0, 5);
}

export async function fetchAllAnnouncements(): Promise<Announcement[]> {
  const snap = await getDocs(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(50)));
  return snap.docs.map(toAnnouncement);
}

export async function fetchPost(id: string): Promise<Post | null> {
  const snap = await getDoc(doc(db, 'posts', id));
  return snap.exists() ? toPost(snap) : null;
}

export async function fetchComments(postId: string, max: number) {
  const snap = await getDocs(
    query(collection(db, 'posts', postId, 'comments'), where('status', '==', 'published'), orderBy('createdAt', 'asc'), limit(max)),
  );
  return snap.docs.map(toComment);
}

export async function fetchProfile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? toProfile(snap) : null;
}

export async function fetchProfileByUsername(username: string): Promise<Profile | null> {
  const name = await getDoc(doc(db, 'usernames', username.toLowerCase()));
  if (!name.exists()) return null;
  return fetchProfile(name.data().uid as string);
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  return (await getDoc(doc(db, 'usernames', username))).exists();
}

/** Which of these posts has the user liked? One query instead of one read per post. */
export async function fetchMyLikes(uid: string, postIds: string[]): Promise<Set<string>> {
  const liked = new Set<string>();
  for (let i = 0; i < postIds.length; i += 30) {
    const chunk = postIds.slice(i, i + 30);
    if (!chunk.length) continue;
    const snap = await getDocs(
      query(collectionGroup(db, 'reactions'), where('userId', '==', uid), where('postId', 'in', chunk)),
    );
    snap.docs.forEach((d) => liked.add(d.data().postId as string));
  }
  return liked;
}

export async function fetchBlocked(uid: string): Promise<Set<string>> {
  const snap = await getDocs(collection(db, 'users', uid, 'blocks'));
  return new Set(snap.docs.map((d) => d.id));
}

export async function fetchLastPostAt(uid: string): Promise<Date | null> {
  const snap = await getDoc(doc(db, 'rate_limits', uid));
  return snap.exists() ? (snap.data().lastPostAt?.toDate?.() ?? null) : null;
}

// ---------- search ----------

export async function searchPosts(text: string, townId: string | null): Promise<Post[]> {
  const tokens = searchTokens(text);
  if (!tokens.length) return [];
  // Firestore allows one array-contains per query: query on the longest word, filter the rest here.
  const [first, ...rest] = [...tokens].sort((a, b) => b.length - a.length);
  const snap = await getDocs(
    query(
      collection(db, 'posts'),
      where('searchTokens', 'array-contains', first),
      where('status', '==', 'published'),
      orderBy('createdAt', 'desc'),
      limit(50),
    ),
  );
  return snap.docs
    .map(toPost)
    .filter((p) => rest.every((t) => normalize(p.text).includes(t)))
    .filter((p) => !townId || p.townId === townId);
}

export async function searchPeople(text: string): Promise<Profile[]> {
  const term = text.trim().replace(/^@/, '').toLowerCase();
  if (term.length < 2) return [];
  const prefix = (field: string) =>
    getDocs(query(collection(db, 'users'), where(field, '>=', term), where(field, '<=', `${term}`), limit(20)));
  const [byUsername, byName] = await Promise.all([prefix('username'), prefix('displayNameLower')]);
  const seen = new Map<string, Profile>();
  for (const d of [...byUsername.docs, ...byName.docs]) seen.set(d.id, toProfile(d));
  return [...seen.values()];
}

// ---------- admin ----------

export async function fetchOpenReports(townIds: string[] | 'all') {
  const constraints: QueryConstraint[] = [where('status', '==', 'open')];
  if (townIds !== 'all') constraints.push(where('townId', 'in', townIds));
  const snap = await getDocs(query(collection(db, 'reports'), ...constraints, orderBy('createdAt', 'desc'), limit(50)));
  return snap.docs.map(toReport);
}

export async function fetchTargetDoc(path: string) {
  const snap = await getDoc(doc(db, path));
  if (!snap.exists()) return null;
  if (path.startsWith('users/')) return { kind: 'user' as const, profile: toProfile(snap) };
  if (path.includes('/comments/')) return { kind: 'comment' as const, comment: toComment(snap) };
  return { kind: 'post' as const, post: toPost(snap) };
}

export async function fetchSuspendedUsers(): Promise<Profile[]> {
  const snap = await getDocs(
    query(collection(db, 'users'), where('status', '==', 'suspended'), orderBy('updatedAt', 'desc'), limit(50)),
  );
  return snap.docs.map(toProfile);
}

export async function fetchRoles(): Promise<RoleAssignment[]> {
  const snap = await getDocs(query(collection(db, 'admin_roles'), orderBy(documentId()), limit(100)));
  return snap.docs.map((d) => ({
    uid: d.id,
    role: d.data().role,
    townIds: d.data().townIds ?? [],
    username: d.data().username,
  }));
}

export async function fetchAuditLog() {
  const snap = await getDocs(query(collection(db, 'audit_logs'), orderBy('at', 'desc'), limit(100)));
  return snap.docs.map(toAudit);
}
