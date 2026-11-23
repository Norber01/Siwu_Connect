/**
 * All client-side writes. Every function here is exercised by the security-rules
 * tests in tests/rules, so what the app does is exactly what the rules allow.
 */
import {
  type Firestore,
  collection,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  setDoc,
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
  p: ProfileInput & { photoUrl: string | null },
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    displayName: p.displayName,
    displayNameLower: p.displayName.toLowerCase(),
    photoUrl: p.photoUrl,
    hometownId: p.hometownId,
    residence: p.residence,
    countryCode: p.countryCode,
    updatedAt: serverTimestamp(),
  });
}

export async function createPost(db: Firestore, uid: string, input: PostInput): Promise<string> {
  const ref = doc(collection(db, 'posts'));
  const batch = writeBatch(db);
  batch.set(ref, {
    authorId: uid,
    townId: input.townId,
    text: input.text,
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
  await batch.commit();
  return ref.id;
}

export async function editPost(
  db: Firestore,
  postId: string,
  input: Pick<PostInput, 'text' | 'visibility'>,
): Promise<void> {
  await updateDoc(doc(db, 'posts', postId), {
    text: input.text,
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
    searchTokens: [],
    updatedAt: serverTimestamp(),
  });
}

export async function setLike(
  db: Firestore,
  uid: string,
  post: { id: string; authorId: string },
  like: boolean,
): Promise<void> {
  const batch = writeBatch(db);
  const reaction = doc(db, 'posts', post.id, 'reactions', uid);
  if (like) batch.set(reaction, { type: 'like', userId: uid, postId: post.id, createdAt: serverTimestamp() });
  else batch.delete(reaction);
  batch.update(doc(db, 'posts', post.id), { reactionCount: increment(like ? 1 : -1) });
  if (like && post.authorId !== uid) {
    batch.set(doc(db, 'users', post.authorId, 'notifications', `like_${post.id}_${uid}`), {
      type: 'like',
      actorId: uid,
      postId: post.id,
      commentId: null,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
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

export async function createListing(db: Firestore, uid: string, l: ListingInput, imageUrl: string | null): Promise<string> {
  const ref = doc(collection(db, 'listings'));
  const batch = writeBatch(db);
  batch.set(ref, {
    sellerId: uid,
    ...listingFields(l, imageUrl),
    status: 'available',
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
  status: 'available' | 'sold',
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
