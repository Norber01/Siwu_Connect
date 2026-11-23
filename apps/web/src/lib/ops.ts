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

export async function setLike(db: Firestore, uid: string, postId: string, like: boolean): Promise<void> {
  const batch = writeBatch(db);
  const reaction = doc(db, 'posts', postId, 'reactions', uid);
  if (like) batch.set(reaction, { type: 'like', userId: uid, postId, createdAt: serverTimestamp() });
  else batch.delete(reaction);
  batch.update(doc(db, 'posts', postId), { reactionCount: increment(like ? 1 : -1) });
  await batch.commit();
}

export async function addComment(
  db: Firestore,
  uid: string,
  post: { id: string; townId: string },
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
