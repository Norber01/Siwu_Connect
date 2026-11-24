/** All Firestore reads used by the app. */
import {
  type DocumentSnapshot,
  type QueryConstraint,
  collection,
  collectionGroup,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  getDocsFromCache,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import { LIMITS, normalize, searchTokens } from '@siwu/shared';
import { db } from './firebase';
import { mixPosts } from './mix';
import {
  toEvent,
  toFeedback,
  toListing,
  toMatch,
  toNotification,
  type AppNotification,
  type CommunityEvent,
  type Feedback,
  type Listing,
  type Match,
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

/** Town and All-Akpafu feeds read this many recent posts at a time and mix them. */
const MIX_PAGE = 20;

export async function fetchFeedPage(feed: Feed, cursor: DocumentSnapshot | null, fromCache = false): Promise<Page<Post>> {
  const mixed = feed.kind !== 'author'; // a member's profile stays newest first
  const size = mixed ? MIX_PAGE : LIMITS.feedPageSize;
  const constraints = [...feedConstraints(feed), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(size)];
  if (cursor) constraints.push(startAfter(cursor));
  const q = query(collection(db, 'posts'), ...constraints);
  const snap = fromCache ? await getDocsFromCache(q) : await getDocs(q);
  const items = snap.docs.map(toPost);
  return {
    items: mixed ? mixPosts(items) : items,
    // The next page continues after the oldest post read, whatever order they are shown in.
    cursor: snap.docs.length === size ? snap.docs[snap.docs.length - 1]! : null,
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
/** The caller's reaction (emoji type) per post, for a page of posts. */
export async function fetchMyLikes(uid: string, postIds: string[], fromCache = false): Promise<Map<string, string>> {
  const liked = new Map<string, string>();
  for (let i = 0; i < postIds.length; i += 30) {
    const chunk = postIds.slice(i, i + 30);
    if (!chunk.length) continue;
    const q = query(collectionGroup(db, 'reactions'), where('userId', '==', uid), where('postId', 'in', chunk));
    const snap = fromCache ? await getDocsFromCache(q) : await getDocs(q);
    snap.docs.forEach((d) => liked.set(d.data().postId as string, d.data().type as string));
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

/**
 * Finds members by any part of their name or username, as you type: "ser" finds Ama Serwaa,
 * "kofi m" finds Kofi Mensah. Best matches first.
 */
export async function searchPeople(text: string, opts: { includeSuspended?: boolean } = {}): Promise<Profile[]> {
  const words = normalize(text.trim().replace(/^@/, '')).split(/[^a-z0-9]+/).filter(Boolean);
  const term = words.join(' ');
  if (term.replace(/ /g, '').length < 2) return [];
  const longest = [...words].sort((a, b) => b.length - a.length)[0]!.slice(0, 20);
  const end = '\uf8ff';
  const [byToken, byUsername, byName] = await Promise.all([
    longest.length >= 2
      ? getDocs(query(collection(db, 'users'), where('nameTokens', 'array-contains', longest), limit(30)))
      : Promise.resolve(null),
    getDocs(query(collection(db, 'users'), where('username', '>=', words.join('_')), where('username', '<=', `${words.join('_')}${end}`), limit(10))),
    getDocs(query(collection(db, 'users'), where('displayNameLower', '>=', term), where('displayNameLower', '<=', `${term}${end}`), limit(10))),
  ]);
  const seen = new Map<string, Profile>();
  for (const d of [...byUsername.docs, ...byName.docs, ...(byToken?.docs ?? [])]) seen.set(d.id, toProfile(d));
  // Every typed word must start one of the words of the name or username.
  const parts = (p: Profile) => [...normalize(p.displayName).split(/[^a-z0-9]+/), ...normalize(p.username).split(/[^a-z0-9]+/), normalize(p.username)];
  const matches = (p: Profile) => words.every((w) => parts(p).some((x) => x.startsWith(w)));
  const score = (p: Profile) =>
    (normalize(p.username).startsWith(words.join('_')) ? 0 : normalize(p.displayName).startsWith(term) ? 1 : 2) - (p.verified ? 0.5 : 0);
  return [...seen.values()].filter((p) => (opts.includeSuspended || p.status === 'active') && matches(p)).sort((a, b) => score(a) - score(b) || a.displayName.localeCompare(b.displayName));
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
  if (path.startsWith('chats/')) {
    const d = snap.data();
    return { kind: 'message' as const, message: { senderId: d.senderId as string, text: (d.text as string) ?? '', status: d.status as string, chatId: path.split('/')[1]! } };
  }
  if (path.startsWith('events/')) return { kind: 'event' as const, event: toEvent(snap) };
  if (path.startsWith('listings/')) return { kind: 'listing' as const, listing: toListing(snap) };
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

// ---------------- events ----------------

export async function fetchUpcomingEvents(townId: string | null): Promise<CommunityEvent[]> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const constraints: QueryConstraint[] = [where('status', '==', 'published'), where('startsAt', '>=', startOfToday)];
  if (townId) constraints.unshift(where('townId', '==', townId));
  const snap = await getDocs(query(collection(db, 'events'), ...constraints, orderBy('startsAt', 'asc'), limit(50)));
  return snap.docs.map(toEvent);
}

export async function fetchEvent(id: string): Promise<CommunityEvent | null> {
  const snap = await getDoc(doc(db, 'events', id));
  return snap.exists() ? toEvent(snap) : null;
}

export async function fetchMyRsvp(uid: string, eventId: string): Promise<'going' | 'interested' | null> {
  const snap = await getDoc(doc(db, 'events', eventId, 'rsvps', uid));
  return snap.exists() ? (snap.data().status as 'going' | 'interested') : null;
}

// ---------------- marketplace ----------------

export async function fetchListings(townId: string | null): Promise<Listing[]> {
  const constraints: QueryConstraint[] = [where('status', '==', 'available')];
  if (townId) constraints.unshift(where('townId', '==', townId));
  const snap = await getDocs(query(collection(db, 'listings'), ...constraints, orderBy('createdAt', 'desc'), limit(60)));
  return snap.docs.map(toListing);
}

export async function fetchListing(id: string): Promise<Listing | null> {
  const snap = await getDoc(doc(db, 'listings', id));
  return snap.exists() ? toListing(snap) : null;
}

export async function fetchSellerListings(uid: string, mine = false): Promise<Listing[]> {
  const statuses = mine ? ['available', 'sold', 'pending', 'rejected'] : ['available', 'sold'];
  const snap = await getDocs(query(collection(db, 'listings'), where('sellerId', '==', uid), where('status', 'in', statuses), limit(50)));
  return snap.docs.map(toListing).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

// ---------------- sports ----------------

export function matchesQuery(tab: 'live' | 'fixtures' | 'results') {
  const c = collection(db, 'matches');
  if (tab === 'live') return query(c, where('status', 'in', ['live', 'halftime']), orderBy('kickoffAt', 'asc'), limit(20));
  if (tab === 'fixtures') return query(c, where('status', 'in', ['scheduled', 'postponed']), orderBy('kickoffAt', 'asc'), limit(50));
  return query(c, where('status', '==', 'finished'), orderBy('kickoffAt', 'desc'), limit(200));
}

/** Every match that is not finished/cancelled — split into Live and Fixtures by the clock. */
export function activeMatchesQuery() {
  return query(
    collection(db, 'matches'),
    where('status', 'in', ['scheduled', 'live', 'halftime', 'postponed']),
    orderBy('kickoffAt', 'asc'),
    limit(100),
  );
}

export async function fetchMatches(tab: 'live' | 'fixtures' | 'results'): Promise<Match[]> {
  return (await getDocs(matchesQuery(tab))).docs.map(toMatch);
}

export async function fetchMyVote(uid: string, matchId: string): Promise<'home' | 'draw' | 'away' | null> {
  const snap = await getDoc(doc(db, 'matches', matchId, 'votes', uid));
  return snap.exists() ? (snap.data().pick as 'home' | 'draw' | 'away') : null;
}

// ---------------- notifications, members, feedback ----------------

export async function fetchNotifications(uid: string): Promise<AppNotification[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(40)));
  return snap.docs.map(toNotification);
}

export async function fetchNewMembers(): Promise<Profile[]> {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(12)));
  return snap.docs.map(toProfile).filter((p) => p.status === 'active');
}

export async function fetchFeedback(): Promise<Feedback[]> {
  const snap = await getDocs(query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(100)));
  return snap.docs.map(toFeedback);
}

// ---------------- admin: all members ----------------

export async function fetchUsersPage(
  filter: { townId: string | null; status: 'active' | 'suspended' | null },
  cursor: DocumentSnapshot | null,
): Promise<Page<Profile>> {
  const c: QueryConstraint[] = [];
  if (filter.townId) c.push(where('hometownId', '==', filter.townId));
  if (filter.status) c.push(where('status', '==', filter.status));
  c.push(orderBy('createdAt', 'desc'), limit(30));
  if (cursor) c.push(startAfter(cursor));
  const snap = await getDocs(query(collection(db, 'users'), ...c));
  return { items: snap.docs.map(toProfile), cursor: snap.docs.length === 30 ? snap.docs[29]! : null };
}

export async function countUsers(): Promise<number> {
  return (await getCountFromServer(collection(db, 'users'))).data().count;
}

export async function fetchMyPollVote(uid: string, postId: string): Promise<number | null> {
  const snap = await getDoc(doc(db, 'posts', postId, 'pollVotes', uid));
  return snap.exists() ? (snap.data().option as number) : null;
}

export async function fetchTagPosts(tag: string): Promise<Post[]> {
  const snap = await getDocs(
    query(collection(db, 'posts'), where('tags', 'array-contains', tag), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(50)),
  );
  return snap.docs.map(toPost);
}

/** Trending hashtags from the 80 most recent Akpafu-wide posts. */
export async function fetchTrendingTags(): Promise<Array<{ tag: string; count: number }>> {
  const snap = await getDocs(
    query(collection(db, 'posts'), where('visibility', '==', 'akpafu'), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(80)),
  );
  const counts = new Map<string, number>();
  for (const d of snap.docs) for (const t of (d.data().tags ?? []) as string[]) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 12);
}

/** Posts per town in the last 7 days (for the town leaderboard). */
export async function fetchTownActivity(): Promise<Array<{ townId: string; posts: number; members: number }>> {
  const since = new Date(Date.now() - 7 * 86400_000);
  const { TOWNS } = await import('@siwu/shared');
  return Promise.all(
    TOWNS.map(async (t) => {
      const [posts, members] = await Promise.all([
        getCountFromServer(query(collection(db, 'posts'), where('townId', '==', t.id), where('status', '==', 'published'), where('createdAt', '>=', since))),
        getCountFromServer(query(collection(db, 'users'), where('hometownId', '==', t.id))),
      ]);
      return { townId: t.id as string, posts: posts.data().count, members: members.data().count };
    }),
  );
}

/** Turns @usernames into member ids (unknown names are ignored). */
export async function resolveMentions(usernames: string[]): Promise<string[]> {
  const found = await Promise.all(usernames.map((u) => getDoc(doc(db, 'usernames', u)).then((d) => (d.exists() ? (d.data().uid as string) : null)).catch(() => null)));
  return found.filter((x): x is string => !!x);
}

// ---------------- Siwu words ----------------

export interface SiwuWord {
  id: string;
  word: string;
  meaning: string;
  example: string;
  audioUrl: string | null;
  createdAt: Date | null;
}

export async function fetchWords(): Promise<SiwuWord[]> {
  const snap = await getDocs(query(collection(db, 'words'), orderBy('createdAt', 'asc'), limit(1000)));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      word: x.word,
      meaning: x.meaning,
      example: x.example ?? '',
      audioUrl: x.audioUrl ?? null,
      createdAt: x.createdAt?.toDate?.() ?? null,
    };
  });
}

/** The same word for everyone all day; moves on at midnight (Ghana time = UTC). */
export function wordOfTheDay(words: SiwuWord[], now = new Date()): SiwuWord | null {
  if (!words.length) return null;
  const day = Math.floor(now.getTime() / 86_400_000);
  return words[day % words.length]!;
}

// ---------------- predictions league ----------------

export interface Prediction {
  uid: string;
  homeScore: number;
  awayScore: number;
  townId: string;
}

export async function fetchMyPrediction(matchId: string, uid: string): Promise<Prediction | null> {
  const s = await getDoc(doc(db, 'matches', matchId, 'predictions', uid));
  return s.exists() ? { uid, ...(s.data() as Omit<Prediction, 'uid'>) } : null;
}

/** 3 points for the exact score, 1 for the right result (win/draw/loss). */
export function predictionPoints(p: { homeScore: number; awayScore: number }, m: { homeScore: number; awayScore: number }): number {
  if (p.homeScore === m.homeScore && p.awayScore === m.awayScore) return 3;
  return Math.sign(p.homeScore - p.awayScore) === Math.sign(m.homeScore - m.awayScore) ? 1 : 0;
}

export interface LeagueTable {
  members: { uid: string; townId: string; points: number; exact: number; played: number }[];
  towns: { townId: string; points: number; players: number }[];
  matches: number;
}

/** Points from matches finished in the last 7 days. */
export async function fetchPredictionLeague(days = 7): Promise<LeagueTable> {
  const since = Date.now() - days * 86_400_000;
  const finished = (await getDocs(query(collection(db, 'matches'), where('status', '==', 'finished'), orderBy('kickoffAt', 'desc'), limit(40)))).docs
    .map(toMatch)
    .filter((m) => m.kickoffAt.getTime() >= since);
  const members = new Map<string, { uid: string; townId: string; points: number; exact: number; played: number }>();
  for (const m of finished) {
    const preds = await getDocs(query(collection(db, 'matches', m.id, 'predictions'), limit(2000)));
    for (const d of preds.docs) {
      const p = d.data() as Omit<Prediction, 'uid'>;
      const pts = predictionPoints(p, m);
      const row = members.get(d.id) ?? { uid: d.id, townId: p.townId, points: 0, exact: 0, played: 0 };
      row.points += pts;
      row.exact += pts === 3 ? 1 : 0;
      row.played += 1;
      members.set(d.id, row);
    }
  }
  const list = [...members.values()].sort((a, b) => b.points - a.points || b.exact - a.exact);
  const towns = new Map<string, { townId: string; points: number; players: number }>();
  for (const r of list) {
    const t = towns.get(r.townId) ?? { townId: r.townId, points: 0, players: 0 };
    t.points += r.points;
    t.players += 1;
    towns.set(r.townId, t);
  }
  return { members: list, towns: [...towns.values()].sort((a, b) => b.points - a.points), matches: finished.length };
}

// ---------------- bookmarks, event photos, birthdays, visits ----------------

export async function fetchSavedPosts(uid: string): Promise<Post[]> {
  const marks = await getDocs(query(collection(db, 'users', uid, 'bookmarks'), orderBy('createdAt', 'desc'), limit(50)));
  const posts = await Promise.all(marks.docs.map((d) => fetchPost(d.id).catch(() => null)));
  return posts.filter((p): p is Post => !!p && p.status === 'published');
}

export interface EventPhoto {
  id: string;
  authorId: string;
  url: string;
  thumbUrl: string | null;
  createdAt: Date | null;
}

export async function fetchEventPhotos(eventId: string): Promise<EventPhoto[]> {
  const snap = await getDocs(query(collection(db, 'events', eventId, 'photos'), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(200)));
  return snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, authorId: x.authorId, url: x.url, thumbUrl: x.thumbUrl ?? null, createdAt: x.createdAt?.toDate?.() ?? null };
  });
}

/** Today as "MM-DD" in Ghana time (UTC). */
export function todayKey(now = new Date()): string {
  return `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

export async function fetchBirthdaysToday(): Promise<Profile[]> {
  const snap = await getDocs(query(collection(db, 'users'), where('birthdayKey', '==', todayKey()), limit(30)));
  return snap.docs.map(toProfile).filter((p) => p.status === 'active');
}

export async function fetchVisitingHome(): Promise<Profile[]> {
  const snap = await getDocs(query(collection(db, 'users'), where('homeVisitUntil', '>', new Date()), orderBy('homeVisitUntil', 'asc'), limit(30)));
  return snap.docs.map(toProfile).filter((p) => p.status === 'active');
}
