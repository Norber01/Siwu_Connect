/**
 * Security-rules tests. Run with `npm run test:emulator` (starts the Firestore
 * emulator automatically). They use the real client write functions from
 * apps/web/src/lib/ops.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  type Firestore,
  Timestamp,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  increment,
  setLogLevel,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as ops from '../../apps/web/src/lib/ops';

let env: RulesTestEnvironment;
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');

const db = (uid?: string): Firestore =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;

const profile = (username: string, hometownId = 'odomi') => ({
  username,
  displayName: `User ${username}`,
  hometownId: hometownId as 'odomi',
  residence: null,
  countryCode: null,
  photoUrl: null,
});

/** Admin-side seeding with rules disabled. */
async function seed(fn: (db: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as Firestore));
}

async function seedUser(uid: string, hometownId = 'odomi', status = 'active') {
  await seed(async (a) => {
    await setDoc(doc(a, 'users', uid), {
      displayName: uid,
      displayNameLower: uid,
      username: uid,
      photoUrl: null,
      hometownId,
      residence: null,
      countryCode: null,
      status,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(a, 'usernames', uid), { uid });
  });
}

async function seedRole(uid: string, role: string, townIds: string[] = []) {
  await seed((a) => setDoc(doc(a, 'admin_roles', uid), { role, townIds }));
}

async function seedPost(id: string, authorId: string, townId = 'odomi', extra: Record<string, unknown> = {}) {
  await seed((a) =>
    setDoc(doc(a, 'posts', id), {
      authorId,
      townId,
      text: 'hello',
      visibility: 'akpafu',
      status: 'published',
      pinned: false,
      reactionCount: 0,
      commentCount: 0,
      lastCommentOp: null,
      searchTokens: ['hello'],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      editedAt: null,
      ...extra,
    }),
  );
}

beforeAll(async () => {
  setLogLevel('silent');
  env = await initializeTestEnvironment({
    projectId: 'demo-siwu-rules',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firebase/firestore.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

describe('reading', () => {
  it('requires sign-in for posts and profiles but towns are public', async () => {
    await seedUser('alice');
    await seedPost('p1', 'alice');
    await assertFails(getDoc(doc(db(), 'posts', 'p1')));
    await assertFails(getDoc(doc(db(), 'users', 'alice')));
    await assertSucceeds(getDoc(doc(db(), 'towns', 'odomi')));
    await assertSucceeds(getDoc(doc(db('bob'), 'posts', 'p1')));
  });

  it('hides removed and deleted posts from ordinary users', async () => {
    await seedUser('alice');
    await seedPost('p1', 'alice', 'odomi', { status: 'removed' });
    await assertFails(getDoc(doc(db('bob'), 'posts', 'p1')));
    await assertSucceeds(getDoc(doc(db('alice'), 'posts', 'p1'))); // author still sees it
  });

  it('feed queries must filter on published status', async () => {
    await seedPost('p1', 'alice');
    const posts = collection(db('bob'), 'posts');
    await assertSucceeds(
      getDocs(query(posts, where('townId', '==', 'odomi'), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(20))),
    );
    await assertFails(getDocs(query(posts, where('townId', '==', 'odomi'), limit(20))));
  });
});

describe('registration', () => {
  it('creates profile and claims a unique username', async () => {
    await assertSucceeds(ops.createProfile(db('alice'), 'alice', profile('alice_a')));
    // Someone else cannot take the same username.
    await assertFails(ops.createProfile(db('bob'), 'bob', profile('alice_a')));
    await assertSucceeds(ops.createProfile(db('bob'), 'bob', profile('bob_b', 'adokor')));
  });

  it('rejects invalid towns, usernames, reserved names and a second profile', async () => {
    await assertFails(ops.createProfile(db('alice'), 'alice', { ...profile('alice'), hometownId: 'accra' as 'odomi' }));
    await assertFails(ops.createProfile(db('alice'), 'alice', profile('Alice')));
    await assertFails(ops.createProfile(db('alice'), 'alice', profile('admin')));
    await assertSucceeds(ops.createProfile(db('alice'), 'alice', profile('alice')));
    await assertFails(ops.createProfile(db('alice'), 'alice', profile('alice2')));
  });

  it('cannot create a profile for someone else or self-assign status', async () => {
    await assertFails(ops.createProfile(db('bob'), 'alice', profile('alice')));
    const a = db('alice');
    const b = writeBatch(a);
    b.set(doc(a, 'usernames', 'alice'), { uid: 'alice' });
    b.set(doc(a, 'users', 'alice'), {
      displayName: 'Alice', displayNameLower: 'alice', username: 'alice', photoUrl: null, hometownId: 'odomi',
      residence: null, countryCode: null, status: 'suspended', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await assertFails(b.commit());
  });

  it('profile photo URL must point at the user\'s own avatar folder', async () => {
    await assertSucceeds(
      ops.createProfile(db('alice'), 'alice', { ...profile('alice'), photoUrl: 'https://api.example.com/avatars/alice/abc123.webp' }),
    );
    await assertFails(
      ops.createProfile(db('bob'), 'bob', { ...profile('bob'), photoUrl: 'https://api.example.com/avatars/alice/abc123.webp' }),
    );
    await assertFails(ops.createProfile(db('bob'), 'bob', { ...profile('bob'), photoUrl: 'javascript:alert(1)' }));
  });
});

describe('profiles', () => {
  it('users can edit their own profile but not status, username or others', async () => {
    await seedUser('alice');
    await seedUser('bob');
    const edit = { displayName: 'Alice A', hometownId: 'todzi' as const, residence: 'abroad' as const, countryCode: 'GB', photoUrl: null };
    await assertSucceeds(ops.updateProfile(db('alice'), 'alice', edit));
    await assertFails(ops.updateProfile(db('bob'), 'alice', edit));
    await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { status: 'active' , username: 'new' }));
    await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { username: 'newname' }));
  });

  it('private fields are only visible to the owner', async () => {
    await assertSucceeds(ops.createProfile(db('alice'), 'alice', profile('alice')));
    await assertSucceeds(getDoc(doc(db('alice'), 'users_private', 'alice')));
    await assertFails(getDoc(doc(db('bob'), 'users_private', 'alice')));
  });
});

describe('posts', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob', 'todzi');
  });

  it('active users can post in a valid town', async () => {
    await assertSucceeds(ops.createPost(db('alice'), 'alice', { townId: 'adokor', text: 'Hello Adokor', visibility: 'akpafu' }));
    await assertSucceeds(ops.createProfile(db('sokpo1'), 'sokpo1', profile('sokpo_one', 'sokpo')));
    await assertSucceeds(ops.createPost(db('sokpo1'), 'sokpo1', { townId: 'sokpo', text: 'Hello from Sokpo', visibility: 'akpafu' }));
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'accra' as 'adokor', text: 'x', visibility: 'akpafu' }));
  });

  it('enforces text length and a posting cooldown', async () => {
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: 'x'.repeat(2001), visibility: 'akpafu' }));
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: '', visibility: 'akpafu' }));
    await assertSucceeds(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: 'first', visibility: 'akpafu' }));
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: 'second too fast', visibility: 'akpafu' }));
  });

  it('cannot post as someone else, pre-pin, or fake counters', async () => {
    const base = {
      townId: 'odomi', text: 'x', visibility: 'akpafu', status: 'published', pinned: false, reactionCount: 0,
      commentCount: 0, lastCommentOp: null, searchTokens: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), editedAt: null,
    };
    const write = (data: object) => {
      const a = db('alice');
      const b = writeBatch(a);
      b.set(doc(collection(a, 'posts')), data);
      b.set(doc(a, 'rate_limits', 'alice'), { lastPostAt: serverTimestamp() }, { merge: true });
      return b.commit();
    };
    await assertFails(write({ ...base, authorId: 'bob' }));
    await assertFails(write({ ...base, authorId: 'alice', pinned: true }));
    await assertFails(write({ ...base, authorId: 'alice', reactionCount: 100 }));
    await assertSucceeds(write({ ...base, authorId: 'alice' }));
  });

  it('suspended users cannot post', async () => {
    await seedUser('sam', 'odomi', 'suspended');
    await assertFails(ops.createPost(db('sam'), 'sam', { townId: 'odomi', text: 'hi', visibility: 'akpafu' }));
  });

  it('only the author can edit or delete, and not after removal by a moderator', async () => {
    await seedPost('p1', 'alice');
    await assertFails(ops.editPost(db('bob'), 'p1', { text: 'hacked', visibility: 'akpafu' }));
    await assertSucceeds(ops.editPost(db('alice'), 'p1', { text: 'edited', visibility: 'town' }));
    await assertFails(updateDoc(doc(db('alice'), 'posts', 'p1'), { townId: 'todzi' }));
    await assertFails(updateDoc(doc(db('alice'), 'posts', 'p1'), { pinned: true }));
    await assertFails(updateDoc(doc(db('alice'), 'posts', 'p1'), { status: 'published', text: 'x' }));
    await assertFails(ops.deletePost(db('bob'), 'p1'));
    await assertSucceeds(ops.deletePost(db('alice'), 'p1'));

    await seedPost('p2', 'alice', 'odomi', { status: 'removed' });
    await assertFails(ops.editPost(db('alice'), 'p2', { text: 'restore myself', visibility: 'akpafu' }));
    await assertSucceeds(ops.deletePost(db('alice'), 'p2'));
  });
});

describe('reactions', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedPost('p1', 'alice');
  });

  it('like and unlike keep the counter exact', async () => {
    await assertSucceeds(ops.setLike(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, true));
    await assertSucceeds(ops.setLike(db('alice'), 'alice', { id: 'p1', authorId: 'alice' }, true));
    let snap = await getDoc(doc(db('bob'), 'posts', 'p1'));
    expect(snap.data()?.reactionCount).toBe(2);
    await assertSucceeds(ops.setLike(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, false));
    snap = await getDoc(doc(db('bob'), 'posts', 'p1'));
    expect(snap.data()?.reactionCount).toBe(1);
  });

  it('prevents duplicate reactions and counter tampering', async () => {
    await assertSucceeds(ops.setLike(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, true));
    await assertFails(ops.setLike(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, true)); // second like
    await assertFails(updateDoc(doc(db('bob'), 'posts', 'p1'), { reactionCount: increment(1) })); // counter only
    await assertFails(updateDoc(doc(db('bob'), 'posts', 'p1'), { reactionCount: 50 }));
    const bob = db('bob');
    const b = writeBatch(bob);
    b.set(doc(bob, 'posts', 'p1', 'reactions', 'alice'), { type: 'like', userId: 'alice', postId: 'p1', createdAt: serverTimestamp() });
    b.update(doc(bob, 'posts', 'p1'), { reactionCount: increment(1) });
    await assertFails(b.commit()); // reacting on behalf of someone else
  });

  it('users can query only their own reactions across posts', async () => {
    await seedPost('p2', 'alice');
    await ops.setLike(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, true);
    await ops.setLike(db('bob'), 'bob', { id: 'p2', authorId: 'alice' }, true);
    const mine = await getDocs(
      query(collectionGroup(db('bob'), 'reactions'), where('userId', '==', 'bob'), where('postId', 'in', ['p1', 'p2'])),
    );
    expect(mine.size).toBe(2);
    await assertFails(getDocs(query(collectionGroup(db('alice'), 'reactions'), where('userId', '==', 'bob'))));
  });
});

describe('comments', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedPost('p1', 'alice', 'todzi');
  });

  it('add and delete comments with an exact counter', async () => {
    const cid = await ops.addComment(db('bob'), 'bob', { id: 'p1', townId: 'todzi', authorId: 'alice' }, 'Nice');
    expect((await getDoc(doc(db('bob'), 'posts', 'p1'))).data()?.commentCount).toBe(1);
    await assertFails(ops.deleteComment(db('alice'), 'p1', cid, true)); // not the comment author
    await assertSucceeds(ops.deleteComment(db('bob'), 'p1', cid, true));
    expect((await getDoc(doc(db('bob'), 'posts', 'p1'))).data()?.commentCount).toBe(0);
  });

  it('rejects wrong town, fake counters and comment flooding', async () => {
    await assertFails(ops.addComment(db('bob'), 'bob', { id: 'p1', townId: 'odomi', authorId: 'alice' }, 'wrong town'));
    await assertFails(
      updateDoc(doc(db('bob'), 'posts', 'p1'), { commentCount: increment(1), lastCommentOp: { id: 'nope', op: 'add' } }),
    );
    await assertSucceeds(ops.addComment(db('bob'), 'bob', { id: 'p1', townId: 'todzi', authorId: 'alice' }, 'one'));
    await assertFails(ops.addComment(db('bob'), 'bob', { id: 'p1', townId: 'todzi', authorId: 'alice' }, 'two too fast'));
  });

  it('blocked users cannot comment on the blocker\'s posts', async () => {
    await assertSucceeds(ops.blockUser(db('alice'), 'alice', 'bob'));
    await assertFails(ops.addComment(db('bob'), 'bob', { id: 'p1', townId: 'todzi', authorId: 'alice' }, 'hi'));
    await assertFails(getDoc(doc(db('bob'), 'users', 'alice', 'blocks', 'bob'))); // block list is private
  });

  it('cannot comment on removed posts', async () => {
    await seedPost('p2', 'alice', 'todzi', { status: 'removed' });
    await assertFails(ops.addComment(db('bob'), 'bob', { id: 'p2', townId: 'todzi', authorId: 'alice' }, 'hi'));
  });
});

describe('reports', () => {
  const target = { targetType: 'post' as const, targetId: 'p1', targetPath: 'posts/p1', townId: 'odomi' };
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedUser('mod');
    await seedUser('modtodzi');
    await seedUser('boss');
    await seedRole('mod', 'moderator', ['odomi']);
    await seedRole('modtodzi', 'moderator', ['todzi']);
    await seedRole('boss', 'super_admin');
    await seedPost('p1', 'alice');
  });

  it('users can report once; only scoped moderators can read reports', async () => {
    await assertSucceeds(ops.submitReport(db('bob'), 'bob', target, 'spam', ''));
    await assertFails(ops.submitReport(db('bob'), 'bob', target, 'spam', 'again'));
    const id = ops.reportId('bob', target);
    await assertFails(getDoc(doc(db('alice'), 'reports', id)));
    await assertFails(getDoc(doc(db('modtodzi'), 'reports', id)));
    await assertSucceeds(getDoc(doc(db('mod'), 'reports', id)));
    await assertSucceeds(getDoc(doc(db('boss'), 'reports', id)));
  });

  it('moderators can list open reports for their towns', async () => {
    await ops.submitReport(db('bob'), 'bob', target, 'spam', '');
    const reports = collection(db('mod'), 'reports');
    await assertSucceeds(
      getDocs(query(reports, where('status', '==', 'open'), where('townId', 'in', ['odomi']), orderBy('createdAt', 'desc'))),
    );
    await assertFails(getDocs(query(collection(db('modtodzi'), 'reports'), where('status', '==', 'open'), where('townId', 'in', ['odomi']))));
    await assertSucceeds(getDocs(query(collection(db('boss'), 'reports'), where('status', '==', 'open'), orderBy('createdAt', 'desc'))));
  });

  it('reports cannot be resolved by clients, even moderators', async () => {
    await ops.submitReport(db('bob'), 'bob', target, 'spam', '');
    const id = ops.reportId('bob', target);
    await assertFails(updateDoc(doc(db('mod'), 'reports', id), { status: 'dismissed' }));
    await assertFails(updateDoc(doc(db('boss'), 'reports', id), { status: 'dismissed' }));
  });

  it('rejects malformed reports', async () => {
    await assertFails(ops.submitReport(db('bob'), 'bob', target, 'because', ''));
    await assertFails(ops.submitReport(db('bob'), 'bob', { ...target, targetPath: 'users/alice' }, 'spam', ''));
    await assertFails(
      ops.submitReport(db('bob'), 'bob', { targetType: 'user', targetId: 'bob', targetPath: 'users/bob', townId: 'odomi' }, 'spam', ''),
    );
  });

  it('moderators can read removed posts in their towns only', async () => {
    await seedPost('p9', 'alice', 'odomi', { status: 'removed' });
    await assertSucceeds(getDoc(doc(db('mod'), 'posts', 'p9')));
    await assertFails(getDoc(doc(db('modtodzi'), 'posts', 'p9')));
    await assertSucceeds(getDoc(doc(db('boss'), 'posts', 'p9')));
  });
});

describe('privileged collections', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('boss');
    await seedUser('townadmin');
    await seedRole('boss', 'super_admin');
    await seedRole('townadmin', 'town_admin', ['odomi']);
    await seedPost('p1', 'alice', 'todzi');
  });

  it('nobody can grant roles from the client — not even a super admin', async () => {
    await assertFails(setDoc(doc(db('alice'), 'admin_roles', 'alice'), { role: 'super_admin', townIds: [] }));
    await assertFails(setDoc(doc(db('boss'), 'admin_roles', 'alice'), { role: 'moderator', townIds: ['odomi'] }));
    await assertSucceeds(getDoc(doc(db('alice'), 'admin_roles', 'alice')));
    await assertFails(getDoc(doc(db('alice'), 'admin_roles', 'boss')));
    await assertSucceeds(getDoc(doc(db('boss'), 'admin_roles', 'townadmin')));
  });

  it('a town admin cannot modify another town\'s records (or any records directly)', async () => {
    await assertFails(updateDoc(doc(db('townadmin'), 'posts', 'p1'), { status: 'removed' }));
    await assertFails(updateDoc(doc(db('townadmin'), 'posts', 'p1'), { pinned: true }));
    await assertFails(setDoc(doc(db('townadmin'), 'announcements', 'a1'), { townId: 'todzi' }));
    await assertFails(updateDoc(doc(db('townadmin'), 'users', 'alice'), { status: 'suspended' }));
  });

  it('audit log is readable only by super admins and writable by nobody', async () => {
    await seed((a) => setDoc(doc(a, 'audit_logs', 'l1'), { action: 'x' }));
    await assertSucceeds(getDoc(doc(db('boss'), 'audit_logs', 'l1')));
    await assertFails(getDoc(doc(db('townadmin'), 'audit_logs', 'l1')));
    await assertFails(setDoc(doc(db('boss'), 'audit_logs', 'l2'), { action: 'fake' }));
  });

  it('announcements: published ones are readable, nobody writes directly', async () => {
    await seed((a) => setDoc(doc(a, 'announcements', 'a1'), { status: 'published', townId: 'odomi' }));
    await seed((a) => setDoc(doc(a, 'announcements', 'a2'), { status: 'archived', townId: 'odomi' }));
    await assertSucceeds(getDoc(doc(db('alice'), 'announcements', 'a1')));
    await assertFails(getDoc(doc(db('alice'), 'announcements', 'a2')));
    await assertSucceeds(getDoc(doc(db('townadmin'), 'announcements', 'a2')));
    await assertFails(updateDoc(doc(db('boss'), 'announcements', 'a1'), { status: 'archived' }));
  });
});


describe('notifications', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedPost('p1', 'alice');
  });

  it('likes and comments notify the post author, who alone can read them', async () => {
    await assertSucceeds(ops.setLike(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, true));
    await ops.addComment(db('bob'), 'bob', { id: 'p1', townId: 'odomi', authorId: 'alice' }, 'hi');
    const list = await getDocs(collection(db('alice'), 'users', 'alice', 'notifications'));
    expect(list.size).toBe(2);
    await assertFails(getDocs(collection(db('bob'), 'users', 'alice', 'notifications')));
    await assertSucceeds(ops.markNotificationsRead(db('alice'), 'alice', list.docs.map((d) => d.id)));
    // Unlike + like again re-sends the like notification without error.
    await ops.setLike(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, false);
    await assertSucceeds(ops.setLike(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, true));
  });

  it('cannot forge notifications', async () => {
    const forge = (data: object, id: string) => setDoc(doc(db('bob'), 'users', 'alice', 'notifications', id), data);
    const base = { actorId: 'bob', postId: 'p1', read: false, createdAt: serverTimestamp() };
    await assertFails(forge({ ...base, type: 'like', commentId: null }, 'like_p1_bob')); // no actual like
    await assertFails(forge({ ...base, type: 'comment', commentId: 'zzz' }, 'comment_zzz')); // no actual comment
    await assertFails(forge({ ...base, actorId: 'carol', type: 'like', commentId: null }, 'like_p1_carol'));
  });
});

describe('events', () => {
  const input = () => ({
    townId: 'todzi' as const,
    title: 'Todzi Harvest Thanksgiving',
    description: 'Service at the Presby church followed by lunch.',
    category: 'church' as const,
    location: 'Presby Church, Todzi',
    startsAt: new Date(Date.now() + 86400_000),
    endsAt: null,
  });
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
  });

  it('members create events; RSVP counters stay exact', async () => {
    const id = await ops.createEvent(db('alice'), 'alice', input(), null);
    await assertSucceeds(ops.setRsvp(db('bob'), 'bob', id, null, 'going'));
    await assertSucceeds(ops.setRsvp(db('bob'), 'bob', id, 'going', 'interested'));
    let e = (await getDoc(doc(db('bob'), 'events', id))).data()!;
    expect([e.goingCount, e.interestedCount]).toEqual([0, 1]);
    await assertSucceeds(ops.setRsvp(db('bob'), 'bob', id, 'interested', null));
    e = (await getDoc(doc(db('bob'), 'events', id))).data()!;
    expect([e.goingCount, e.interestedCount]).toEqual([0, 0]);
  });

  it('blocks fake RSVP counts, foreign image URLs and editing others\' events', async () => {
    const id = await ops.createEvent(db('alice'), 'alice', input(), null);
    await assertFails(updateDoc(doc(db('bob'), 'events', id), { goingCount: 100 }));
    await assertFails(ops.setRsvp(db('bob'), 'bob', id, 'going', 'interested')); // lying about current state
    await assertFails(ops.updateEvent(db('bob'), id, input(), null));
    await assertFails(ops.setEventStatus(db('bob'), id, 'cancelled'));
    await assertSucceeds(ops.setEventStatus(db('alice'), id, 'cancelled'));
    await seedUser('carol');
    await assertFails(ops.createEvent(db('carol'), 'carol', input(), 'https://x.example/images/alice/a.webp'));
    await assertSucceeds(ops.createEvent(db('bob'), 'bob', input(), 'https://x.example/images/bob/a.webp'));
  });

  it('rate-limits event creation', async () => {
    await assertSucceeds(ops.createEvent(db('alice'), 'alice', input(), null));
    await assertFails(ops.createEvent(db('alice'), 'alice', input(), null));
  });
});

describe('marketplace', () => {
  const input = () => ({
    townId: 'adokor' as const,
    title: 'Fresh tomatoes',
    description: 'From my farm, picked this morning.',
    category: 'food' as const,
    price: 20,
    priceUnit: 'per basket',
    contactPhone: '+233241234567',
    contactWhatsApp: true,
  });
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
  });

  it('sellers list, mark sold and delete; others cannot', async () => {
    const id = await ops.createListing(db('alice'), 'alice', input(), null);
    await assertFails(ops.setListingStatus(db('bob'), id, 'sold'));
    await assertSucceeds(ops.setListingStatus(db('alice'), id, 'sold'));
    await assertSucceeds(getDoc(doc(db('bob'), 'listings', id))); // sold items stay visible
    await assertSucceeds(ops.setListingStatus(db('alice'), id, 'deleted'));
    await assertFails(getDoc(doc(db('bob'), 'listings', id)));
  });

  it('validates price and phone', async () => {
    await assertFails(ops.createListing(db('alice'), 'alice', { ...input(), price: -5 }, null));
    await assertFails(ops.createListing(db('bob'), 'bob', { ...input(), contactPhone: 'call me' }, null));
    await assertSucceeds(ops.createListing(db('bob'), 'bob', { ...input(), price: null, contactPhone: null }, null));
  });
});

describe('sports centre', () => {
  const match = () => ({
    competition: 'Akpafu Community Cup',
    home: { name: 'Odomi', townId: 'odomi' as const },
    away: { name: 'Mempeasem', townId: 'mempeasem' as const },
    venue: 'Odomi Park',
    kickoffAt: new Date(Date.now() + 3600_000),
  });
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedUser('rep');
    await seedRole('rep', 'reporter', []);
  });

  it('only reporters/admins create matches and post live updates', async () => {
    await assertFails(ops.createMatch(db('alice'), 'alice', match()));
    const id = await ops.createMatch(db('rep'), 'rep', match());
    const m = { id, homeScore: 0, awayScore: 0, status: 'scheduled' as const };
    await assertFails(ops.addMatchUpdate(db('alice'), 'alice', m, { type: 'goal', team: 'home', minute: 10, text: '' }));
    await assertSucceeds(ops.addMatchUpdate(db('rep'), 'rep', m, { type: 'goal', team: 'home', minute: 32, text: 'Odomi takes the lead!' }));
    const data = (await getDoc(doc(db('alice'), 'matches', id))).data()!;
    expect([data.homeScore, data.status, data.minute]).toEqual([1, 'live', 32]);
    await assertFails(updateDoc(doc(db('alice'), 'matches', id), { homeScore: 5 }));
  });

  it('one vote per member, only while voting is open', async () => {
    const id = await ops.createMatch(db('rep'), 'rep', match());
    await assertSucceeds(ops.voteOnMatch(db('alice'), 'alice', id, 'home'));
    await assertFails(ops.voteOnMatch(db('alice'), 'alice', id, 'away'));
    await assertFails(updateDoc(doc(db('bob'), 'matches', id), { votesAway: increment(1) }));
    await ops.updateMatchState(db('rep'), id, { status: 'finished', homeScore: 1, awayScore: 0, minute: 90 });
    await assertFails(ops.voteOnMatch(db('bob'), 'bob', id, 'draw'));
    expect((await getDoc(doc(db('bob'), 'matches', id))).data()?.votesHome).toBe(1);
  });

  it('reporters cannot moderate', async () => {
    await seedPost('p1', 'alice', 'odomi', { status: 'removed' });
    await assertFails(getDoc(doc(db('rep'), 'posts', 'p1')));
  });
});

describe('feedback', () => {
  it('any member can send feedback; only super admins read it', async () => {
    await seedUser('alice');
    await seedUser('boss');
    await seedRole('boss', 'super_admin');
    await assertSucceeds(ops.sendFeedback(db('alice'), 'alice', 'The like button is great!', '/'));
    await assertFails(ops.sendFeedback(db('alice'), 'bob', 'Pretending to be Bob', '/'));
    await assertFails(getDocs(collection(db('alice'), 'feedback')));
    await assertSucceeds(getDocs(collection(db('boss'), 'feedback')));
  });
});
