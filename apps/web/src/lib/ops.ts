/**
 * All client-side writes. Every function here is exercised by the security-rules
 * tests in tests/rules, so what the app does is exactly what the rules allow.
 */
import {
  type Firestore,
  collection,
  deleteDoc,
  getDoc,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  type EventInput,
  type ListingInput,
  type MatchInput,
  type MatchStatus,
  type MatchUpdateInput,
  type PostInput,
  type ProfileInput,
  type ReportTargetType,
  nameTokens,
  searchTokens,
} from '@siwu/shared';

export interface NewProfile extends ProfileInput {
  username: string;
  photoUrl: string | null;
}

/** Creates the public profile, claims the username and records consent — atomically. */
export async function createProfile(db: Firestore, uid: string, p: NewProfile): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', p.username), { uid });
  batch.set(doc(db, 'users', uid), {
    displayName: p.displayName,
    displayNameLower: p.displayName.toLowerCase(),
    nameTokens: nameTokens(p.displayName, p.username),
    username: p.username,
    photoUrl: p.photoUrl,
    hometownId: p.hometownId,
    residence: p.residence,
    countryCode: p.countryCode,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users_private', uid), {
    rulesAcceptedAt: serverTimestamp(),
    ageConfirmedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function updateProfile(
  db: Firestore,
  uid: string,
  p: ProfileInput & { photoUrl: string | null; username: string },
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    displayName: p.displayName,
    displayNameLower: p.displayName.toLowerCase(),
    nameTokens: nameTokens(p.displayName, p.username),
    photoUrl: p.photoUrl,
    hometownId: p.hometownId,
    residence: p.residence,
    countryCode: p.countryCode,
    updatedAt: serverTimestamp(),
  });
}

export interface MediaItem {
  type: 'image' | 'video';
  url: string;
  posterUrl: string | null;
  /** Pixel size, so the feed can reserve the right space before it loads. */
  width?: number;
  height?: number;
  /** Light 360p copy of a video for slow connections. */
  lowUrl?: string;
  /** Small preview of a photo for the feed (full size opens on tap). */
  thumbUrl?: string;
}

export interface PostExtras {
  poll?: string[] | null;
  /** uids of mentioned members (resolved from @usernames). */
  mentions?: string[];
  /** Repost or quote of another post. */
  quoteOf?: { id: string; authorId: string } | null;
}

/** #hashtags in a text, lowercase, without "#". */
export function extractTags(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_]{2,30})/gu)].map((m) => m[1]!.toLowerCase()))].slice(0, 10);
}

/** @usernames in a text. */
export function extractMentions(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|\s)@([a-z0-9_]{3,20})/gi)].map((m) => m[1]!.toLowerCase()))].slice(0, 10);
}

export async function createPost(
  db: Firestore,
  uid: string,
  input: PostInput,
  media: MediaItem[] = [],
  extras: PostExtras = {},
): Promise<string> {
  const ref = doc(collection(db, 'posts'));
  const batch = writeBatch(db);
  const mentions = (extras.mentions ?? []).filter((m) => m !== uid).slice(0, 10);
  const quoteOf = extras.quoteOf ?? null;
  const poll = extras.poll && extras.poll.length >= 2 ? { options: extras.poll.slice(0, 4), counts: extras.poll.slice(0, 4).map(() => 0) } : null;
  batch.set(ref, {
    poll,
    tags: extractTags(input.text),
    mentions,
    reactions: {},
    ...(quoteOf ? { quoteOf: quoteOf.id } : {}),
    authorId: uid,
    townId: input.townId,
    text: input.text,
    imageUrl: null,
    media,
    visibility: input.visibility,
    status: 'published',
    pinned: false,
    reactionCount: 0,
    commentCount: 0,
    lastCommentOp: null,
    searchTokens: searchTokens(input.text),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    editedAt: null,
  });
  batch.set(doc(db, 'rate_limits', uid), { lastPostAt: serverTimestamp() }, { merge: true });
  if (quoteOf && quoteOf.authorId !== uid) {
    batch.set(doc(db, 'users', quoteOf.authorId, 'notifications', `repost_${ref.id}`), {
      type: 'repost',
      actorId: uid,
      postId: ref.id,
      commentId: null,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  for (const m of mentions) {
    batch.set(doc(db, 'users', m, 'notifications', `mention_${ref.id}`), {
      type: 'mention',
      actorId: uid,
      postId: ref.id,
      commentId: null,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return ref.id;
}

export async function votePoll(db: Firestore, uid: string, post: { id: string; poll: { counts: number[] } }, option: number): Promise<void> {
  const b = writeBatch(db);
  b.set(doc(db, 'posts', post.id, 'pollVotes', uid), { option, createdAt: serverTimestamp() });
  const counts = [...post.poll.counts];
  counts[option] = (counts[option] ?? 0) + 1;
  // Firestore cannot increment inside an array, so the new counts are written; the rules check
  // that exactly the chosen option went up by one compared with what is stored.
  b.update(doc(db, 'posts', post.id), { 'poll.counts': counts });
  await b.commit();
}

export async function editPost(
  db: Firestore,
  postId: string,
  input: Pick<PostInput, 'text' | 'visibility'>,
  media: MediaItem[] = [],
): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), {
    text: input.text,
    imageUrl: null,
    media,
    tags: extractTags(input.text),
    visibility: input.visibility,
    searchTokens: searchTokens(input.text),
    updatedAt: serverTimestamp(),
    editedAt: serverTimestamp(),
  });
}

/** Soft delete: the post disappears everywhere and its text is wiped. */
export async function deletePost(db: Firestore, postId: string): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), {
    status: 'deleted',
    text: '',
    imageUrl: null,
    media: [],
    searchTokens: [],
    updatedAt: serverTimestamp(),
  });
}

export const REACTIONS = [
  { id: 'like', emoji: '👍' },
  { id: 'love', emoji: '❤️' },
  { id: 'haha', emoji: '😂' },
  { id: 'fire', emoji: '🔥' },
  { id: 'wow', emoji: '😮' },
  { id: 'sad', emoji: '😢' },
] as const;
export type Reaction = (typeof REACTIONS)[number]['id'];

/**
 * Sets, changes or removes the caller's reaction. Each step moves the total and the
 * per-emoji count by exactly one (switching emoji = remove, then add).
 */
export async function setReaction(
  db: Firestore,
  uid: string,
  post: { id: string; authorId: string },
  current: Reaction | null,
  next: Reaction | null,
): Promise<void> {
  if (current === next) return;
  const reaction = doc(db, 'posts', post.id, 'reactions', uid);
  if (current) {
    const b = writeBatch(db);
    b.delete(reaction);
    b.update(doc(db, 'posts', post.id), { reactionCount: increment(-1), [`reactions.${current}`]: increment(-1) });
    await b.commit();
  }
  if (next) {
    const b = writeBatch(db);
    b.set(reaction, { type: next, userId: uid, postId: post.id, createdAt: serverTimestamp() });
    b.update(doc(db, 'posts', post.id), { reactionCount: increment(1), [`reactions.${next}`]: increment(1) });
    if (post.authorId !== uid) {
      b.set(doc(db, 'users', post.authorId, 'notifications', `like_${post.id}_${uid}`), {
        type: 'like',
        actorId: uid,
        postId: post.id,
        commentId: null,
        read: false,
        createdAt: serverTimestamp(),
      });
    }
    await b.commit();
  }
}

/** Simple like/unlike (👍). */
export async function setLike(db: Firestore, uid: string, post: { id: string; authorId: string }, like: boolean): Promise<void> {
  await setReaction(db, uid, post, like ? null : 'like', like ? 'like' : null);
}

export async function addComment(
  db: Firestore,
  uid: string,
  post: { id: string; townId: string; authorId: string },
  text: string,
): Promise<string> {
  const ref = doc(collection(db, 'posts', post.id, 'comments'));
  const batch = writeBatch(db);
  batch.set(ref, {
    authorId: uid,
    townId: post.townId,
    text,
    status: 'published',
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, 'posts', post.id), {
    commentCount: increment(1),
    lastCommentOp: { id: ref.id, op: 'add' },
  });
  batch.set(doc(db, 'rate_limits', uid), { lastCommentAt: serverTimestamp() }, { merge: true });
  if (post.authorId !== uid) {
    batch.set(doc(db, 'users', post.authorId, 'notifications', `comment_${ref.id}`), {
      type: 'comment',
      actorId: uid,
      postId: post.id,
      commentId: ref.id,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return ref.id;
}

export async function deleteComment(
  db: Firestore,
  postId: string,
  commentId: string,
  postIsPublished: boolean,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'posts', postId, 'comments', commentId), { status: 'deleted', text: '' });
  if (postIsPublished) {
    batch.update(doc(db, 'posts', postId), {
      commentCount: increment(-1),
      lastCommentOp: { id: commentId, op: 'remove' },
    });
  }
  await batch.commit();
}

export interface ReportTarget {
  targetType: ReportTargetType;
  targetId: string;
  targetPath: string;
  townId: string;
}

export function reportId(uid: string, t: Pick<ReportTarget, 'targetType' | 'targetId'>): string {
  return `${uid}_${t.targetType}_${t.targetId}`;
}

export async function submitReport(
  db: Firestore,
  uid: string,
  target: ReportTarget,
  reason: string,
  details: string,
): Promise<void> {
  await setDoc(doc(db, 'reports', reportId(uid, target)), {
    reporterId: uid,
    targetType: target.targetType,
    targetId: target.targetId,
    targetPath: target.targetPath,
    townId: target.townId,
    reason,
    details,
    status: 'open',
    createdAt: serverTimestamp(),
    resolvedBy: null,
    resolvedAt: null,
    resolution: null,
  });
}

export async function blockUser(db: Firestore, uid: string, otherUid: string): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'blocks', otherUid), { createdAt: serverTimestamp() });
}

export async function unblockUser(db: Firestore, uid: string, otherUid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'blocks', otherUid));
}

// ---------------- notifications ----------------

export async function markNotificationsRead(db: Firestore, uid: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const batch = writeBatch(db);
  for (const id of ids) batch.update(doc(db, 'users', uid, 'notifications', id), { read: true });
  await batch.commit();
}

// ---------------- feedback ----------------

export async function sendFeedback(db: Firestore, uid: string, text: string, page: string): Promise<void> {
  await setDoc(doc(collection(db, 'feedback')), { userId: uid, text, page: page.slice(0, 200), createdAt: serverTimestamp() });
}

// ---------------- events ----------------

export async function createEvent(db: Firestore, uid: string, e: EventInput, imageUrl: string | null): Promise<string> {
  const ref = doc(collection(db, 'events'));
  const batch = writeBatch(db);
  batch.set(ref, {
    authorId: uid,
    townId: e.townId,
    title: e.title,
    description: e.description,
    category: e.category,
    location: e.location,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    imageUrl,
    status: 'published',
    goingCount: 0,
    interestedCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'rate_limits', uid), { lastEventAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return ref.id;
}

export async function updateEvent(db: Firestore, id: string, e: EventInput, imageUrl: string | null): Promise<void> {
  await updateDoc(doc(db, 'events', id), {
    townId: e.townId,
    title: e.title,
    description: e.description,
    category: e.category,
    location: e.location,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    imageUrl,
    updatedAt: serverTimestamp(),
  });
}

export async function setEventStatus(db: Firestore, id: string, status: 'cancelled' | 'deleted'): Promise<void> {
  await updateDoc(doc(db, 'events', id), { status, updatedAt: serverTimestamp() });
}

export type RsvpStatus = 'going' | 'interested';

/** Sets, changes or removes (null) the user's RSVP, keeping the event counters exact. */
export async function setRsvp(
  db: Firestore,
  uid: string,
  eventId: string,
  current: RsvpStatus | null,
  next: RsvpStatus | null,
): Promise<void> {
  if (current === next) return;
  const batch = writeBatch(db);
  const ref = doc(db, 'events', eventId, 'rsvps', uid);
  if (next) batch.set(ref, { status: next, userId: uid, eventId, createdAt: serverTimestamp() });
  else batch.delete(ref);
  const counters: Record<string, ReturnType<typeof increment>> = {};
  const add = (s: RsvpStatus | null, n: number) => {
    if (s) counters[s === 'going' ? 'goingCount' : 'interestedCount'] = increment(n);
  };
  add(current, -1);
  add(next, 1);
  batch.update(doc(db, 'events', eventId), counters);
  await batch.commit();
}

// ---------------- marketplace ----------------

function listingFields(l: ListingInput, imageUrl: string | null) {
  return {
    townId: l.townId,
    title: l.title,
    description: l.description,
    category: l.category,
    price: l.price,
    priceUnit: l.priceUnit,
    imageUrl,
    contactPhone: l.contactPhone,
    contactWhatsApp: l.contactPhone ? l.contactWhatsApp : false,
    searchTokens: searchTokens(l.title, l.description),
  };
}

/** `staff`: admins' listings go live at once; members' wait for moderator approval. */
export async function createListing(db: Firestore, uid: string, l: ListingInput, imageUrl: string | null, staff = false): Promise<string> {
  const ref = doc(collection(db, 'listings'));
  const batch = writeBatch(db);
  batch.set(ref, {
    sellerId: uid,
    ...listingFields(l, imageUrl),
    status: staff ? 'available' : 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'rate_limits', uid), { lastListingAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return ref.id;
}

export async function updateListing(
  db: Firestore,
  id: string,
  l: ListingInput,
  imageUrl: string | null,
  status: 'available' | 'sold' | 'pending',
): Promise<void> {
  await updateDoc(doc(db, 'listings', id), { ...listingFields(l, imageUrl), status, updatedAt: serverTimestamp() });
}

export async function setListingStatus(db: Firestore, id: string, status: 'available' | 'sold' | 'deleted'): Promise<void> {
  await updateDoc(doc(db, 'listings', id), { status, updatedAt: serverTimestamp() });
}

// ---------------- sports centre ----------------

export async function createMatch(db: Firestore, uid: string, m: MatchInput): Promise<string> {
  const ref = doc(collection(db, 'matches'));
  await setDoc(ref, {
    competition: m.competition,
    home: m.home,
    away: m.away,
    venue: m.venue,
    kickoffAt: m.kickoffAt,
    durationMinutes: m.durationMinutes,
    breakMinutes: m.breakMinutes,
    actualKickoffAt: null,
    secondHalfStartAt: null,
    status: 'scheduled',
    homeScore: 0,
    awayScore: 0,
    minute: null,
    votesHome: 0,
    votesDraw: 0,
    votesAway: 0,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateMatchState(
  db: Firestore,
  id: string,
  state: { status: MatchStatus; homeScore: number; awayScore: number; minute: number | null },
): Promise<void> {
  await updateDoc(doc(db, 'matches', id), { ...state, updatedAt: serverTimestamp() });
}

/**
 * Posts a live update. A goal also increases the score in the same write.
 */
export async function addMatchUpdate(
  db: Firestore,
  uid: string,
  match: { id: string; homeScore: number; awayScore: number; status: MatchStatus },
  u: MatchUpdateInput,
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'matches', match.id, 'updates')), {
    type: u.type,
    team: u.team,
    minute: u.minute,
    text: u.text,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  const patch: { [k: string]: number | string | ReturnType<typeof serverTimestamp> } = { updatedAt: serverTimestamp() };
  if (u.minute !== null) patch.minute = u.minute;
  if (u.type === 'goal' && u.team === 'home') patch.homeScore = match.homeScore + 1;
  if (u.type === 'goal' && u.team === 'away') patch.awayScore = match.awayScore + 1;
  if (match.status === 'scheduled') patch.status = 'live';
  batch.update(doc(db, 'matches', match.id), patch);
  await batch.commit();
}

export async function deleteMatchUpdate(db: Firestore, matchId: string, updateId: string): Promise<void> {
  await deleteDoc(doc(db, 'matches', matchId, 'updates', updateId));
}

export async function deleteMatch(db: Firestore, matchId: string): Promise<void> {
  await deleteDoc(doc(db, 'matches', matchId));
}

export type MatchPick = 'home' | 'draw' | 'away';

export async function voteOnMatch(db: Firestore, uid: string, matchId: string, pick: MatchPick): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'matches', matchId, 'votes', uid), { pick, userId: uid, matchId, createdAt: serverTimestamp() });
  batch.update(doc(db, 'matches', matchId), {
    [pick === 'home' ? 'votesHome' : pick === 'draw' ? 'votesDraw' : 'votesAway']: increment(1),
  });
  await batch.commit();
}

/** Reporter clock controls. The clock itself runs automatically from these times. */
export async function startMatchNow(db: Firestore, id: string): Promise<void> {
  await updateDoc(doc(db, 'matches', id), { actualKickoffAt: serverTimestamp(), secondHalfStartAt: null, status: 'live', updatedAt: serverTimestamp() });
}

export async function startSecondHalfNow(db: Firestore, id: string): Promise<void> {
  await updateDoc(doc(db, 'matches', id), { secondHalfStartAt: serverTimestamp(), status: 'live', updatedAt: serverTimestamp() });
}

export async function setMatchStatus(db: Firestore, id: string, status: MatchStatus): Promise<void> {
  await updateDoc(doc(db, 'matches', id), { status, updatedAt: serverTimestamp() });
}

export async function setMatchScore(db: Firestore, id: string, homeScore: number, awayScore: number): Promise<void> {
  await updateDoc(doc(db, 'matches', id), { homeScore, awayScore, updatedAt: serverTimestamp() });
}

// ---------------- chat ----------------

/** Direct-message chat id: the two user ids, sorted, joined with "_". */
export function dmId(a: string, b: string): string {
  return [a, b].sort().join('_');
}

/** Opens (creating if needed) the private chat between the caller and another member. */
export async function openDm(db: Firestore, uid: string, otherUid: string): Promise<string> {
  const id = dmId(uid, otherUid);
  const ref = doc(db, 'chats', id);
  if (!(await getDoc(ref)).exists()) {
    await setDoc(ref, {
      type: 'dm',
      members: [uid, otherUid].sort(),
      lastMessage: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  return id;
}

export async function sendMessage(
  db: Firestore,
  uid: string,
  chatId: string,
  text: string,
  imageUrl: string | null,
  audio?: { url: string; seconds: number },
): Promise<void> {
  const ref = doc(collection(db, 'chats', chatId, 'messages'));
  const batch = writeBatch(db);
  batch.set(ref, {
    senderId: uid,
    text,
    imageUrl,
    status: 'sent',
    createdAt: serverTimestamp(),
    ...(audio ? { audioUrl: audio.url, audioSeconds: Math.round(audio.seconds) } : {}),
  });
  const preview = text ? text.slice(0, 120) : audio ? '🎤 Voice note' : '📷 Photo';
  batch.update(doc(db, 'chats', chatId), {
    lastMessage: { id: ref.id, senderId: uid, text: preview, at: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'rate_limits', uid), { lastMessageAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

export async function deleteMessage(db: Firestore, chatId: string, messageId: string, hadAudio = false): Promise<void> {
  await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
    status: 'deleted',
    text: '',
    imageUrl: null,
    ...(hadAudio ? { audioUrl: null } : {}),
  });
}

export async function markChatRead(db: Firestore, uid: string, chatId: string): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'chatState', chatId), { lastReadAt: serverTimestamp() });
}

// ---------------- friends ----------------
// friendships/{dmId}: someone sends a request, the other person accepts. Friends can chat
// privately and see each other's stories.

/**
 * Sends a friend request — or, if the other person already sent one, accepts it.
 * Returns what happened so the screen can say so.
 */
export async function sendFriendRequest(db: Firestore, uid: string, otherUid: string): Promise<'sent' | 'accepted' | 'already'> {
  const id = dmId(uid, otherUid);
  const existing = await getDoc(doc(db, 'friendships', id));
  if (existing.exists()) {
    const d = existing.data() as { status: string; requesterId: string };
    if (d.status === 'pending' && d.requesterId === otherUid) {
      await acceptFriendRequest(db, uid, otherUid);
      return 'accepted';
    }
    return 'already';
  }
  const b = writeBatch(db);
  b.set(doc(db, 'friendships', id), {
    members: [uid, otherUid].sort(),
    requesterId: uid,
    status: 'pending',
    createdAt: serverTimestamp(),
    acceptedAt: null,
  });
  b.set(doc(db, 'users', otherUid, 'notifications', `friend_${uid}`), {
    type: 'friend_request',
    actorId: uid,
    postId: null,
    commentId: null,
    read: false,
    createdAt: serverTimestamp(),
  });
  b.set(doc(db, 'rate_limits', uid), { lastFriendAt: serverTimestamp() }, { merge: true });
  await b.commit();
  return 'sent';
}

export async function acceptFriendRequest(db: Firestore, uid: string, otherUid: string): Promise<void> {
  const b = writeBatch(db);
  b.update(doc(db, 'friendships', dmId(uid, otherUid)), { status: 'accepted', acceptedAt: serverTimestamp() });
  b.set(doc(db, 'users', otherUid, 'notifications', `friendok_${uid}`), {
    type: 'friend_accepted',
    actorId: uid,
    postId: null,
    commentId: null,
    read: false,
    createdAt: serverTimestamp(),
  });
  await b.commit();
}

/** Cancel a sent request, decline a received one, or unfriend. */
export async function removeFriendship(db: Firestore, uid: string, otherUid: string): Promise<void> {
  await deleteDoc(doc(db, 'friendships', dmId(uid, otherUid)));
}

// ---------------- profile extras ----------------

export async function updateBio(db: Firestore, uid: string, bio: string, vibe: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { bio: bio.trim().slice(0, 160), vibe: vibe.trim().slice(0, 16), updatedAt: serverTimestamp() });
}

// ---------------- stories ----------------

export type StoryBg = 'green' | 'gold' | 'night' | 'sunset' | 'ocean';

export async function createStory(
  db: Firestore,
  uid: string,
  townId: string,
  story: { type: 'image' | 'video' | 'text'; url: string | null; posterUrl: string | null; text: string; bg: StoryBg },
  friendIds: string[],
): Promise<void> {
  const b = writeBatch(db);
  const now = Timestamp.now();
  b.set(doc(collection(db, 'stories')), {
    authorId: uid,
    townId,
    ...story,
    status: 'active',
    createdAt: serverTimestamp(),
    // The server checks this is about 24 hours from now.
    expiresAt: Timestamp.fromMillis(now.toMillis() + 24 * 3600_000),
    // Only you and your friends can see it.
    audience: [uid, ...friendIds.filter((f) => f !== uid)].slice(0, 2000),
  });
  b.set(doc(db, 'rate_limits', uid), { lastStoryAt: serverTimestamp() }, { merge: true });
  await b.commit();
}

/** Lets the author see who viewed their story. */
export async function recordStoryView(db: Firestore, uid: string, storyId: string): Promise<void> {
  const ref = doc(db, 'stories', storyId, 'views', uid);
  try {
    if ((await getDoc(ref)).exists()) return;
  } catch {
    // Not viewed yet (reading a missing view is allowed, so errors mean offline): try to write.
  }
  await setDoc(ref, { viewedAt: serverTimestamp() });
}

export async function deleteStory(db: Firestore, id: string): Promise<void> {
  await updateDoc(doc(db, 'stories', id), { status: 'deleted' });
}

// ---------------- directory: businesses & opportunities ----------------

export type EntryKind = 'business' | 'job' | 'scholarship' | 'training';
export interface EntryInput {
  kind: EntryKind;
  townId: string;
  title: string;
  description: string;
  category: string;
  contactPhone: string | null;
  link: string | null;
  deadline: Date | null;
}

export async function saveEntry(db: Firestore, uid: string, e: EntryInput, imageUrl: string | null, id?: string, staff = false): Promise<string> {
  if (id) {
    const { kind: _kind, ...rest } = e;
    void _kind;
    // A member's edit goes back to the moderators for approval.
    await updateDoc(doc(db, 'directory', id), { ...rest, imageUrl, ...(staff ? {} : { status: 'pending' }), updatedAt: serverTimestamp() });
    return id;
  }
  const ref = doc(collection(db, 'directory'));
  const b = writeBatch(db);
  b.set(ref, { ...e, ownerId: uid, imageUrl, status: staff ? 'active' : 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(doc(db, 'rate_limits', uid), { lastListingAt: serverTimestamp() }, { merge: true });
  await b.commit();
  return ref.id;
}

export async function setEntryStatus(db: Firestore, id: string, status: 'active' | 'closed' | 'deleted'): Promise<void> {
  await updateDoc(doc(db, 'directory', id), { status, updatedAt: serverTimestamp() });
}

// ---------------- Siwu word of the day ----------------

export interface WordInput {
  word: string;
  meaning: string;
  example: string;
  audioUrl: string | null;
}

export async function addWord(db: Firestore, uid: string, w: WordInput): Promise<void> {
  await setDoc(doc(collection(db, 'words')), {
    word: w.word.trim().slice(0, 60),
    meaning: w.meaning.trim().slice(0, 300),
    example: w.example.trim().slice(0, 300),
    audioUrl: w.audioUrl,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
}

export async function deleteWord(db: Firestore, id: string): Promise<void> {
  await deleteDoc(doc(db, 'words', id));
}

// ---------------- predictions league ----------------

export async function savePrediction(
  db: Firestore,
  uid: string,
  matchId: string,
  townId: string,
  homeScore: number,
  awayScore: number,
  existing: boolean,
): Promise<void> {
  const ref = doc(db, 'matches', matchId, 'predictions', uid);
  if (existing) await updateDoc(ref, { homeScore, awayScore, updatedAt: serverTimestamp() });
  else await setDoc(ref, { homeScore, awayScore, townId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}
