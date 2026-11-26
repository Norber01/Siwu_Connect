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
    const edit = { displayName: 'Alice A', hometownId: 'todzi' as const, residence: 'abroad' as const, countryCode: 'GB', photoUrl: null, username: 'alice' };
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
    // Members post in their hometown only (shown in the All Akpafu feed too if they choose).
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'adokor', text: 'Hello Adokor', visibility: 'akpafu' }));
    await assertSucceeds(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: 'Hello Odomi', visibility: 'akpafu' }));
    await assertSucceeds(ops.createProfile(db('sokpo1'), 'sokpo1', profile('sokpo_one', 'sokpo')));
    await assertSucceeds(ops.createPost(db('sokpo1'), 'sokpo1', { townId: 'sokpo', text: 'Hello from Sokpo', visibility: 'akpafu' }));
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'accra' as 'adokor', text: 'x', visibility: 'akpafu' }));
  });

  it('town admins post in their towns; Super Admins anywhere', async () => {
    await seedUser('ta', 'odomi');
    await seedRole('ta', 'town_admin', ['todzi']);
    await seedUser('boss2', 'odomi');
    await seedRole('boss2', 'super_admin');
    await assertSucceeds(ops.createPost(db('ta'), 'ta', { townId: 'todzi', text: 'Todzi news', visibility: 'town' }));
    await assertFails(ops.createPost(db('ta'), 'ta', { townId: 'sokpo', text: 'Sokpo news', visibility: 'town' }));
    await assertSucceeds(ops.createPost(db('boss2'), 'boss2', { townId: 'sokpo', text: 'Sokpo news', visibility: 'town' }));
  });

  it('enforces text length and a posting cooldown', async () => {
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: 'x'.repeat(2001), visibility: 'akpafu' }));
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: '', visibility: 'akpafu' }));
    await assertSucceeds(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: 'first', visibility: 'akpafu' }));
    await assertFails(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: 'second too fast', visibility: 'akpafu' }));
  });

  it('cannot post as someone else, pre-pin, or fake counters', async () => {
    const base = {
      townId: 'odomi', text: 'x', imageUrl: null, media: [], visibility: 'akpafu', status: 'published', pinned: false, reactionCount: 0,
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

  it('photo and video posts: up to 4 items, all uploaded by the author', async () => {
    const img = (u: string, n = 1) => ({ type: 'image' as const, url: `https://api.example.com/images/${u}/p${n}.webp`, posterUrl: null });
    const vid = (u: string) => ({ type: 'video' as const, url: `https://api.example.com/videos/${u}/v1.mp4`, posterUrl: `https://api.example.com/images/${u}/poster.webp` });
    await assertSucceeds(ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: '', visibility: 'akpafu' }, [img('alice'), vid('alice')]));
    await assertFails(ops.createPost(db('bob'), 'bob', { townId: 'todzi', text: 'hi', visibility: 'akpafu' }, [vid('alice')]));
    await assertFails(ops.createPost(db('bob'), 'bob', { townId: 'todzi', text: '', visibility: 'akpafu' }, [])); // empty post
    await assertFails(
      ops.createPost(db('bob'), 'bob', { townId: 'todzi', text: 'too many', visibility: 'akpafu' }, [1, 2, 3, 4, 5].map((n) => img('bob', n))),
    );
    await assertFails(
      ops.createPost(db('bob'), 'bob', { townId: 'todzi', text: 'x', visibility: 'akpafu' }, [{ type: 'image', url: 'javascript:alert(1)', posterUrl: null }]),
    );
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

  it('likes on comments: each member adds or removes only their own like', async () => {
    await seedUser('carol');
    const post = { id: 'p1', townId: 'todzi', authorId: 'alice' };
    const cid = await ops.addComment(db('bob'), 'bob', post, 'Nice');
    await assertSucceeds(ops.setCommentLike(db('carol'), 'carol', 'p1', cid, true));
    await assertSucceeds(ops.setCommentLike(db('alice'), 'alice', 'p1', cid, true));
    expect((await getDoc(doc(db('bob'), 'posts', 'p1', 'comments', cid))).data()?.likedBy).toEqual(['carol', 'alice']);
    // Nobody can add or remove someone else's like.
    await assertFails(updateDoc(doc(db('carol'), 'posts', 'p1', 'comments', cid), { likedBy: ['carol', 'alice', 'bob'] }));
    await assertFails(updateDoc(doc(db('carol'), 'posts', 'p1', 'comments', cid), { likedBy: ['carol'] }));
    await assertFails(updateDoc(doc(db('carol'), 'posts', 'p1', 'comments', cid), { likedBy: ['alice'], text: 'changed' }));
    await assertSucceeds(ops.setCommentLike(db('carol'), 'carol', 'p1', cid, false));
    expect((await getDoc(doc(db('bob'), 'posts', 'p1', 'comments', cid))).data()?.likedBy).toEqual(['alice']);
  });

  it('replies go under a top-level comment and notify the person answered', async () => {
    await seedUser('carol');
    const post = { id: 'p1', townId: 'todzi', authorId: 'alice' };
    const top = await ops.addComment(db('bob'), 'bob', post, 'Who is coming?');
    await new Promise((r) => setTimeout(r, 5100)); // comment cooldown
    const reply = await ops.addComment(db('carol'), 'carol', post, 'Me!', { to: top, uid: 'bob' });
    const r = (await getDoc(doc(db('carol'), 'posts', 'p1', 'comments', reply))).data();
    expect(r).toMatchObject({ replyTo: top, replyToUid: 'bob' });
    expect((await getDoc(doc(db('bob'), 'users', 'bob', 'notifications', `reply_${reply}`))).data()).toMatchObject({ type: 'reply', actorId: 'carol' });
    // The post's author still hears about it.
    expect((await getDoc(doc(db('alice'), 'users', 'alice', 'notifications', `comment_${reply}`))).exists()).toBe(true);
    // No replies to replies (one level), and no replies to comments that don't exist.
    await new Promise((r) => setTimeout(r, 5100));
    await assertFails(ops.addComment(db('carol'), 'carol', post, 'nested', { to: reply, uid: 'carol' }));
    await assertFails(ops.addComment(db('carol'), 'carol', post, 'ghost', { to: 'nope', uid: 'bob' }));
    expect((await getDoc(doc(db('bob'), 'posts', 'p1'))).data()?.commentCount).toBe(2);
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
    await seedRole('mod', 'town_admin', ['odomi']);
    await seedRole('modtodzi', 'town_admin', ['todzi']);
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

describe('moderator roles', () => {
  it('the Moderator and Assistant moderator review reports in every town', async () => {
    await seedUser('amod');
    await seedRole('amod', 'assistant_moderator', []);
    await seedUser('xmod');
    await seedRole('xmod', 'moderator', []);
    await seed((a) => setDoc(doc(a, 'reports', 'r1'), { reporterId: 'x', targetType: 'post', targetId: 'p1', targetPath: 'posts/p1', townId: 'sokpo', reason: 'spam', details: '', status: 'open', createdAt: Timestamp.now() }));
    await assertSucceeds(getDoc(doc(db('amod'), 'reports', 'r1')));
    await assertSucceeds(getDoc(doc(db('xmod'), 'reports', 'r1')));
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

  it('notification devices, choices and records are only handled by the server', async () => {
    for (const path of ['push_subs/abc', 'push_prefs/alice', 'push_log/abc']) {
      await assertFails(getDoc(doc(db('alice'), path)));
      await assertFails(getDoc(doc(db('boss'), path)));
      await assertFails(setDoc(doc(db('alice'), path), { uid: 'alice', topics: ['staff:all'] }));
    }
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
  beforeEach(async () => {
    await seedRole('alice', 'moderator', ['odomi', 'mempeasem', 'todzi', 'adokor', 'sokpo']);
    await seedRole('bob', 'moderator', ['todzi']);
  });
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

  it('only admins create events; RSVP counters stay exact', async () => {
    await seedUser('dan');
    await assertFails(ops.createEvent(db('dan'), 'dan', input(), null)); // ordinary member
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
    await seedRole('carol', 'moderator', ['todzi']);
    await assertFails(ops.createEvent(db('carol'), 'carol', input(), 'https://x.example/images/alice/a.webp'));
    await assertSucceeds(ops.createEvent(db('bob'), 'bob', input(), 'https://x.example/images/bob/a.webp'));
  });

  it('rate-limits event creation', async () => {
    await assertSucceeds(ops.createEvent(db('alice'), 'alice', input(), null));
    await assertFails(ops.createEvent(db('alice'), 'alice', input(), null));
  });

  it('event photo albums: anyone adds own photos; author deletes; town moderator removes', async () => {
    await seedUser('dan');
    const id = await ops.createEvent(db('alice'), 'alice', input(), null);
    await assertSucceeds(ops.addEventPhoto(db('dan'), 'dan', id, 'https://x.example/images/dan/a.webp', 'https://x.example/images/dan/a-s.webp'));
    await assertFails(ops.addEventPhoto(db('dan'), 'dan', id, 'https://x.example/images/dan/b.webp', null)); // too fast
    await assertFails(ops.addEventPhoto(db('bob'), 'bob', id, 'https://x.example/images/dan/a.webp', null)); // someone else's photo
    const photos = await getDocs(query(collection(db('bob'), 'events', id, 'photos'), where('status', '==', 'published')));
    expect(photos.size).toBe(1);
    const pid = photos.docs[0]!.id;
    await seedUser('eve');
    await assertFails(ops.takeDownEventPhoto(db('eve'), id, pid, 'removed')); // not a moderator
    await assertSucceeds(ops.takeDownEventPhoto(db('bob'), id, pid, 'removed')); // moderator of Todzi
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

  it('members\' listings wait for approval (hidden until approved); admins\' go live', async () => {
    await assertFails(ops.createListing(db('alice'), 'alice', input(), null, true)); // member cannot skip approval
    const pending = await ops.createListing(db('alice'), 'alice', input(), null);
    await assertFails(getDoc(doc(db('bob'), 'listings', pending)));
    await assertSucceeds(getDoc(doc(db('alice'), 'listings', pending)));
    await assertFails(ops.setListingStatus(db('alice'), pending, 'available')); // cannot self-approve
  });

  it('sellers mark sold and delete; others cannot', async () => {
    await seedRole('alice', 'moderator', ['adokor']);
    const id = await ops.createListing(db('alice'), 'alice', input(), null, true);
    await assertFails(ops.setListingStatus(db('bob'), id, 'sold'));
    await assertSucceeds(ops.setListingStatus(db('alice'), id, 'sold'));
    await assertSucceeds(getDoc(doc(db('bob'), 'listings', id))); // sold items stay visible
    await assertSucceeds(ops.setListingStatus(db('alice'), id, 'deleted'));
    await assertFails(getDoc(doc(db('bob'), 'listings', id)));
  });

  it('validates price and phone', async () => {
    await assertFails(ops.createListing(db('alice'), 'alice', { ...input(), price: -5 }, null));
    await assertFails(ops.createListing(db('bob'), 'bob', { ...input(), contactPhone: 'call me' }, null));
    await assertSucceeds(ops.createListing(db('bob'), 'bob', { ...input(), price: null, contactPhone: null }, null)); // pending
  });
});

describe('sports centre', () => {
  const match = () => ({
    competition: 'Akpafu Community Cup',
    home: { name: 'Odomi', townId: 'odomi' as const },
    away: { name: 'Mempeasem', townId: 'mempeasem' as const },
    venue: 'Odomi Park',
    kickoffAt: new Date(Date.now() + 3600_000),
    durationMinutes: 90,
    breakMinutes: 5,
  });
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedUser('rep');
    await seedRole('rep', 'reporter', []);
  });

  it('predictions: own, before kick-off only, with your hometown', async () => {
    const id = await ops.createMatch(db('rep'), 'rep', match());
    await assertSucceeds(ops.savePrediction(db('alice'), 'alice', id, 'odomi', 2, 1, false));
    await assertSucceeds(ops.savePrediction(db('alice'), 'alice', id, 'odomi', 3, 1, true));
    await assertFails(ops.savePrediction(db('bob'), 'bob', id, 'todzi', 1, 1, false)); // not bob's hometown
    await assertFails(setDoc(doc(db('bob'), 'matches', id, 'predictions', 'alice'), { homeScore: 0, awayScore: 0, townId: 'odomi', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(ops.savePrediction(db('bob'), 'bob', id, 'odomi', 99, 1, false));
    expect((await getDocs(collection(db('bob'), 'matches', id, 'predictions'))).size).toBe(1);
    // After kick-off predictions are closed.
    const past = await ops.createMatch(db('rep'), 'rep', { ...match(), kickoffAt: new Date(Date.now() - 60_000) });
    await assertFails(ops.savePrediction(db('bob'), 'bob', past, 'odomi', 1, 0, false));
  });

  it('town reporters manage only matches involving their towns; all-towns reporters any', async () => {
    await seedUser('trep');
    await seedRole('trep', 'reporter', ['sokpo']);
    await assertFails(ops.createMatch(db('trep'), 'trep', match())); // Odomi v Mempeasem
    const own = await ops.createMatch(db('trep'), 'trep', { ...match(), away: { name: 'Sokpo', townId: 'sokpo' as const } });
    await assertSucceeds(ops.addMatchUpdate(db('trep'), 'trep', { id: own, homeScore: 0, awayScore: 0, status: 'scheduled' as const }, { type: 'note', team: null, minute: null, text: 'Kick-off soon' }));
    const other = await ops.createMatch(db('rep'), 'rep', match()); // 'rep' covers all towns
    await assertFails(ops.addMatchUpdate(db('trep'), 'trep', { id: other, homeScore: 0, awayScore: 0, status: 'scheduled' as const }, { type: 'goal', team: 'home', minute: 3, text: '' }));
    await assertFails(updateDoc(doc(db('trep'), 'matches', other), { homeScore: 3, updatedAt: serverTimestamp() }));
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
    await assertSucceeds(ops.startSecondHalfNow(db('rep'), id));
    await assertFails(ops.startMatchNow(db('alice'), id));
    await assertFails(updateDoc(doc(db('rep'), 'matches', id), { breakMinutes: 500 }));
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

describe('chat', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedUser('carol');
    await seedUser('mod');
    await seedRole('mod', 'moderator', ['odomi', 'mempeasem', 'todzi', 'adokor', 'sokpo']);
    await seed((a) => setDoc(doc(a, 'chats', 'room_odomi'), { type: 'room', townId: 'odomi', name: 'Akpafu Odomi', lastMessage: null }));
  });

  it('town chat rooms: members use their hometown and All Akpafu; only Super Admins every town', async () => {
    await seedUser('tod', 'todzi');
    await seedUser('chief', 'sokpo');
    await seedRole('chief', 'super_admin');
    await seed((a) => setDoc(doc(a, 'chats', 'room_all'), { type: 'room', townId: 'all', name: 'All Akpafu', lastMessage: null }));
    await seed((a) => setDoc(doc(a, 'chats', 'room_odomi', 'messages', 'm1'), { senderId: 'alice', text: 'hi', imageUrl: null, status: 'sent', createdAt: Timestamp.now() }));
    // Someone from Todzi: not the Odomi room, but All Akpafu yes.
    await assertFails(getDoc(doc(db('tod'), 'chats', 'room_odomi')));
    await assertFails(getDocs(collection(db('tod'), 'chats', 'room_odomi', 'messages')));
    await assertFails(ops.sendMessage(db('tod'), 'tod', 'room_odomi', 'Hello?', null));
    await assertSucceeds(getDoc(doc(db('tod'), 'chats', 'room_all')));
    await assertSucceeds(ops.sendMessage(db('tod'), 'tod', 'room_all', 'Hello everyone', null));
    // The Super Admin sees every room.
    await assertSucceeds(getDocs(collection(db('chief'), 'chats', 'room_odomi', 'messages')));
    // A moderator from another town can open a single reported message, not the whole room.
    await seedUser('mod2', 'sokpo');
    await seedRole('mod2', 'moderator');
    await assertSucceeds(getDoc(doc(db('mod2'), 'chats', 'room_odomi', 'messages', 'm1')));
    await assertFails(getDocs(collection(db('mod2'), 'chats', 'room_odomi', 'messages')));
  });

  const befriend = async (a: string, b: string) => {
    await ops.sendFriendRequest(db(a), a, b);
    await ops.acceptFriendRequest(db(b), b, a);
  };

  it('friend requests: send, accept by the other person only, notify, unfriend', async () => {
    await assertSucceeds(ops.sendFriendRequest(db('alice'), 'alice', 'bob'));
    expect((await getDoc(doc(db('bob'), 'users', 'bob', 'notifications', 'friend_alice'))).data()?.type).toBe('friend_request');
    await assertFails(ops.acceptFriendRequest(db('alice'), 'alice', 'bob')); // cannot accept your own request
    await assertFails(getDoc(doc(db('carol'), 'friendships', 'alice_bob')));
    await assertFails(ops.openDm(db('alice'), 'alice', 'bob')); // not friends yet
    await assertSucceeds(ops.acceptFriendRequest(db('bob'), 'bob', 'alice'));
    expect((await getDoc(doc(db('alice'), 'users', 'alice', 'notifications', 'friendok_bob'))).data()?.type).toBe('friend_accepted');
    // Cannot fake a friendship for others, or as already accepted.
    await assertFails(
      setDoc(doc(db('carol'), 'friendships', 'alice_carol'), { members: ['alice', 'carol'], requesterId: 'carol', status: 'accepted', createdAt: serverTimestamp(), acceptedAt: null }),
    );
    await assertFails(
      setDoc(doc(db('carol'), 'friendships', 'alice_bob'), { members: ['alice', 'bob'], requesterId: 'carol', status: 'pending', createdAt: serverTimestamp(), acceptedAt: null }),
    );
    const id = await ops.openDm(db('alice'), 'alice', 'bob');
    await assertSucceeds(ops.sendMessage(db('alice'), 'alice', id, 'Hi friend', null));
    await assertSucceeds(ops.removeFriendship(db('bob'), 'bob', 'alice'));
    await new Promise((r) => setTimeout(r, 1100));
    await assertFails(ops.sendMessage(db('alice'), 'alice', id, 'still there?', null)); // unfriended
    // Blocked people cannot send requests.
    await ops.blockUser(db('bob'), 'bob', 'carol');
    await assertFails(ops.sendFriendRequest(db('carol'), 'carol', 'bob'));
  });

  it('direct messages are private to the two members — even from admins', async () => {
    await befriend('alice', 'bob');
    const id = await ops.openDm(db('alice'), 'alice', 'bob');
    expect(id).toBe('alice_bob');
    await assertSucceeds(ops.sendMessage(db('alice'), 'alice', id, 'Hi Bob!', null));
    await assertSucceeds(getDocs(collection(db('bob'), 'chats', id, 'messages')));
    await assertFails(getDocs(collection(db('carol'), 'chats', id, 'messages')));
    await assertFails(getDocs(collection(db('mod'), 'chats', id, 'messages')));
    await assertFails(ops.sendMessage(db('carol'), 'carol', id, 'sneaky', null));
    const mine = await getDocs(query(collection(db('bob'), 'chats'), where('members', 'array-contains', 'bob')));
    expect(mine.size).toBe(1);
  });

  it('cannot fake a chat for others or message someone who blocked you', async () => {
    await assertFails(
      setDoc(doc(db('carol'), 'chats', 'alice_bob'), { type: 'dm', members: ['alice', 'bob'], lastMessage: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    );
    await befriend('carol', 'bob');
    await ops.blockUser(db('bob'), 'bob', 'carol');
    await assertFails(ops.openDm(db('carol'), 'carol', 'bob'));
  });

  it('town rooms are open to members; senders delete their own messages; rate limited', async () => {
    await assertSucceeds(ops.sendMessage(db('alice'), 'alice', 'room_odomi', 'Hello Odomi!', null));
    await assertFails(ops.sendMessage(db('alice'), 'alice', 'room_odomi', 'too fast', null));
    const msgs = await getDocs(collection(db('carol'), 'chats', 'room_odomi', 'messages'));
    expect(msgs.size).toBe(1);
    const mid = msgs.docs[0]!.id;
    await assertFails(ops.deleteMessage(db('carol'), 'room_odomi', mid));
    await assertSucceeds(ops.deleteMessage(db('alice'), 'room_odomi', mid));
    await assertFails(ops.sendMessage(db('bob'), 'bob', 'room_odomi', 'pic', 'https://x.example/images/alice/a.webp'));
  });

  it('voice notes: own recordings only', async () => {
    await assertSucceeds(ops.sendMessage(db('alice'), 'alice', 'room_odomi', '', null, { url: 'https://x.example/audio/alice/v1.webm', seconds: 4 }));
    await new Promise((r) => setTimeout(r, 1100));
    await assertFails(ops.sendMessage(db('bob'), 'bob', 'room_odomi', '', null, { url: 'https://x.example/audio/alice/v1.webm', seconds: 4 }));
    const msgs = await getDocs(collection(db('alice'), 'chats', 'room_odomi', 'messages'));
    await assertSucceeds(ops.deleteMessage(db('alice'), 'room_odomi', msgs.docs[0]!.id, true));
  });

  it('typing, seen, replies and reactions', async () => {
    await befriend('alice', 'bob');
    const id = await ops.openDm(db('alice'), 'alice', 'bob');
    await assertSucceeds(ops.setTyping(db('alice'), 'alice', id, true));
    await assertSucceeds(ops.markChatRead(db('bob'), 'bob', id));
    const pres = await getDocs(collection(db('bob'), 'chats', id, 'presence'));
    expect(pres.docs.map((d) => d.id).sort()).toEqual(['alice', 'bob']);
    await assertFails(getDocs(collection(db('carol'), 'chats', id, 'presence'))); // not in the chat
    await assertFails(setDoc(doc(db('alice'), 'chats', id, 'presence', 'bob'), { typingAt: serverTimestamp() })); // someone else's
    await assertFails(ops.setTyping(db('alice'), 'alice', 'room_odomi', true).then(() => setDoc(doc(db('alice'), 'chats', 'room_odomi', 'presence', 'alice'), { typingAt: serverTimestamp() })));

    await assertSucceeds(ops.sendMessage(db('alice'), 'alice', id, 'Are you coming?', null));
    const first = (await getDocs(collection(db('bob'), 'chats', id, 'messages'))).docs[0]!;
    await assertSucceeds(ops.sendMessage(db('bob'), 'bob', id, 'Yes!', null, null, { replyTo: { id: first.id, senderId: 'alice', text: 'Are you coming?' } }));
    await assertSucceeds(ops.reactToMessage(db('bob'), 'bob', id, first.id, '❤️'));
    await assertFails(ops.reactToMessage(db('bob'), 'bob', id, first.id, '💩')); // not an allowed emoji
    await assertFails(updateDoc(doc(db('bob'), 'chats', id, 'messages', first.id), { 'reactions.alice': '😂' })); // someone else's reaction
    await assertFails(ops.reactToMessage(db('carol'), 'carol', id, first.id, '❤️')); // not in the chat
    await assertSucceeds(ops.reactToMessage(db('bob'), 'bob', id, first.id, null));
    expect((await getDoc(doc(db('alice'), 'chats', id, 'messages', first.id))).data()?.reactions).toEqual({});
  });

  it('"active" time: only your own, now or cleared', async () => {
    await assertSucceeds(ops.setActive(db('alice'), 'alice', true));
    await assertSucceeds(ops.setActive(db('alice'), 'alice', false));
    await assertFails(ops.setActive(db('bob'), 'alice', true));
    await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { lastActiveAt: new Date(Date.now() + 86400_000) }));
  });

  it('group chats: members talk, outsiders cannot read; clients cannot create groups', async () => {
    await seed((a) =>
      setDoc(doc(a, 'chats', 'grp_1'), { type: 'group', name: 'Family', members: ['alice', 'bob'], admins: ['alice'], lastMessage: null }),
    );
    await assertSucceeds(ops.sendMessage(db('bob'), 'bob', 'grp_1', 'Hello family', null));
    await assertSucceeds(getDocs(collection(db('alice'), 'chats', 'grp_1', 'messages')));
    await assertFails(getDocs(collection(db('carol'), 'chats', 'grp_1', 'messages')));
    await assertFails(ops.sendMessage(db('carol'), 'carol', 'grp_1', 'sneaky', null));
    await assertFails(
      setDoc(doc(db('carol'), 'chats', 'grp_2'), { type: 'group', name: 'Mine', members: ['carol', 'alice'], admins: ['carol'], lastMessage: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    );
    const mine = await getDocs(query(collection(db('alice'), 'chats'), where('members', 'array-contains', 'alice')));
    expect(mine.docs.map((d) => d.id)).toContain('grp_1');
  });

  it('posts can be shared into a chat as a preview', async () => {
    await befriend('alice', 'bob');
    const id = await ops.openDm(db('alice'), 'alice', 'bob');
    await assertSucceeds(ops.sendMessage(db('alice'), 'alice', id, '', null, null, { post: { id: 'p1', authorId: 'carol', text: 'Look at this', imageUrl: null } }));
    const m = (await getDocs(collection(db('bob'), 'chats', id, 'messages'))).docs[0]!.data();
    expect(m.post.id).toBe('p1');
  });

  it('read markers are private', async () => {
    await assertSucceeds(ops.markChatRead(db('alice'), 'alice', 'room_odomi'));
    await assertFails(getDoc(doc(db('bob'), 'users', 'alice', 'chatState', 'room_odomi')));
  });
});

describe('Gen Z features', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedUser('carol');
    await seedPost('p1', 'alice');
  });

  it('emoji reactions keep total and per-emoji counts exact; switching works', async () => {
    await assertSucceeds(ops.setReaction(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, null, 'fire'));
    await assertSucceeds(ops.setReaction(db('carol'), 'carol', { id: 'p1', authorId: 'alice' }, null, 'fire'));
    await assertSucceeds(ops.setReaction(db('bob'), 'bob', { id: 'p1', authorId: 'alice' }, 'fire', 'haha'));
    const d = (await getDoc(doc(db('bob'), 'posts', 'p1'))).data()!;
    expect(d.reactionCount).toBe(2);
    expect(d.reactions).toEqual({ fire: 1, haha: 1 });
    await assertFails(updateDoc(doc(db('bob'), 'posts', 'p1'), { 'reactions.love': increment(5) }));
  });

  it('polls: one vote per member, only +1 on the chosen option', async () => {
    const id = await ops.createPost(db('alice'), 'alice', { townId: 'odomi', text: 'Best festival food?', visibility: 'akpafu' }, [], { poll: ['Fufu', 'Banku', 'Akple'] });
    const post = async () => (await getDoc(doc(db('bob'), 'posts', id))).data()!;
    await assertSucceeds(ops.votePoll(db('bob'), 'bob', { id, poll: (await post()).poll }, 2));
    expect((await post()).poll.counts).toEqual([0, 0, 1]);
    await assertFails(ops.votePoll(db('bob'), 'bob', { id, poll: (await post()).poll }, 1)); // second vote
    await assertFails(updateDoc(doc(db('carol'), 'posts', id), { 'poll.counts': [9, 0, 1] })); // no vote doc
  });

  it('@mentions notify the mentioned member; cannot fake mentions', async () => {
    await new Promise((r) => setTimeout(r, 0));
    const id = await ops.createPost(db('bob'), 'bob', { townId: 'odomi', text: 'Thanks @carol!', visibility: 'akpafu' }, [], { mentions: ['carol'] });
    const n = await getDoc(doc(db('carol'), 'users', 'carol', 'notifications', `mention_${id}`));
    expect(n.data()?.type).toBe('mention');
    await assertFails(
      setDoc(doc(db('bob'), 'users', 'alice', 'notifications', 'mention_p1'), { type: 'mention', actorId: 'bob', postId: 'p1', commentId: null, read: false, createdAt: serverTimestamp() }),
    );
  });

  it('stories: friends only, own media only, author sees viewers, author deletes', async () => {
    await assertSucceeds(
      ops.createStory(db('bob'), 'bob', 'odomi', { type: 'text', url: null, posterUrl: null, text: 'Good morning Akpafu ☀️', bg: 'sunset' }, ['alice']),
    );
    await assertFails(
      ops.createStory(db('carol'), 'carol', 'odomi', { type: 'image', url: 'https://x.example/images/bob/a.webp', posterUrl: null, text: '', bg: 'green' }, []),
    );
    const visible = (uid: string) =>
      getDocs(query(collection(db(uid), 'stories'), where('audience', 'array-contains', uid), where('status', '==', 'active')));
    const s = await visible('alice');
    expect(s.size).toBe(1);
    const id = s.docs[0]!.id;
    await assertFails(getDocs(collection(db('carol'), 'stories'))); // not a friend: cannot list
    await assertFails(getDoc(doc(db('carol'), 'stories', id)));
    expect((await visible('carol')).size).toBe(0);
    // Views: friends record a view; only the author lists them.
    await assertSucceeds(ops.recordStoryView(db('alice'), 'alice', id));
    await assertSucceeds(ops.recordStoryView(db('alice'), 'alice', id)); // already viewed: no-op
    await assertFails(setDoc(doc(db('carol'), 'stories', id, 'views', 'carol'), { viewedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db('alice'), 'stories', id, 'views', 'carol'), { viewedAt: serverTimestamp() }));
    const views = await getDocs(collection(db('bob'), 'stories', id, 'views'));
    expect(views.docs.map((d) => d.id)).toEqual(['alice']);
    await assertFails(getDocs(collection(db('alice'), 'stories', id, 'views')));
    await assertFails(ops.deleteStory(db('alice'), id));
    await assertSucceeds(ops.deleteStory(db('bob'), id));
  });

  it('reposts and quotes: original must be published; the author is notified', async () => {
    const id = await ops.createPost(db('bob'), 'bob', { townId: 'odomi', text: '', visibility: 'akpafu' }, [], { quoteOf: { id: 'p1', authorId: 'alice' } });
    const d = (await getDoc(doc(db('alice'), 'posts', id))).data()!;
    expect(d.quoteOf).toBe('p1');
    expect((await getDoc(doc(db('alice'), 'users', 'alice', 'notifications', `repost_${id}`))).data()?.type).toBe('repost');
    await new Promise((r) => setTimeout(r, 0));
    await assertFails(ops.createPost(db('carol'), 'carol', { townId: 'odomi', text: '', visibility: 'akpafu' }, [], { quoteOf: { id: 'nope', authorId: 'alice' } }));
    await assertFails(ops.createPost(db('carol'), 'carol', { townId: 'odomi', text: '', visibility: 'akpafu' }, [])); // empty post
  });

  it('admin stories can go to everyone, or everyone from one town; members cannot do this', async () => {
    await seedUser('boss', 'odomi');
    await seedRole('boss', 'super_admin');
    await seedUser('tadmin', 'todzi');
    await seedRole('tadmin', 'town_admin', ['todzi']);
    await seedUser('tina', 'todzi');
    const story = { type: 'text' as const, url: null, posterUrl: null, text: 'Festival on Saturday 🎉', bg: 'gold' as const };
    await assertFails(ops.createStory(db('bob'), 'bob', 'odomi', story, [], 'all')); // member
    await assertFails(ops.createStory(db('tadmin'), 'tadmin', 'todzi', story, [], 'all')); // town admin: not all towns
    await assertFails(ops.createStory(db('tadmin'), 'tadmin', 'todzi', story, [], 'odomi')); // not their town
    await assertSucceeds(ops.createStory(db('tadmin'), 'tadmin', 'todzi', story, [], 'todzi'));
    await assertSucceeds(ops.createStory(db('boss'), 'boss', 'odomi', story, [], 'all'));
    const mine = (uid: string, town: string) =>
      getDocs(query(collection(db(uid), 'stories'), where('audience', 'array-contains-any', [uid, 'public:all', `public:${town}`]), where('status', '==', 'active')));
    expect((await mine('carol', 'odomi')).size).toBe(1); // only the all-towns one
    expect((await mine('tina', 'todzi')).size).toBe(2); // all towns + Todzi
    // Faking a hometown in the query is refused.
    await assertFails(getDocs(query(collection(db('carol'), 'stories'), where('audience', 'array-contains-any', ['carol', 'public:all', 'public:todzi']))));
    // Anyone it was shown to can record a view.
    const all = (await mine('carol', 'odomi')).docs[0]!.id;
    await assertSucceeds(ops.recordStoryView(db('carol'), 'carol', all));
  });

  it('photo previews: own uploads only', async () => {
    const own = { type: 'image' as const, url: 'https://x.example/images/bob/a.webp', posterUrl: null, thumbUrl: 'https://x.example/images/bob/a-small.webp' };
    await assertSucceeds(ops.createPost(db('bob'), 'bob', { townId: 'odomi', text: 'Photo', visibility: 'akpafu' }, [own]));
    await new Promise((r) => setTimeout(r, 0));
    await assertFails(
      ops.createPost(db('carol'), 'carol', { townId: 'odomi', text: 'Photo', visibility: 'akpafu' }, [
        { type: 'image', url: 'https://x.example/images/carol/a.webp', posterUrl: null, thumbUrl: 'https://x.example/images/bob/a-small.webp' },
      ]),
    );
  });

  it('Siwu words: admins add and delete; members only read', async () => {
    await seedRole('carol', 'moderator', ['odomi']);
    const w = { word: 'Test word', meaning: 'A test meaning', example: '', audioUrl: null };
    await assertFails(ops.addWord(db('bob'), 'bob', w));
    await assertSucceeds(ops.addWord(db('carol'), 'carol', w));
    await assertFails(ops.addWord(db('carol'), 'carol', { ...w, audioUrl: 'https://x.example/audio/bob/a.webm' })); // someone else's recording
    const list = await getDocs(collection(db('bob'), 'words'));
    expect(list.size).toBe(1);
    await assertFails(ops.deleteWord(db('bob'), list.docs[0]!.id));
    await assertSucceeds(ops.deleteWord(db('carol'), list.docs[0]!.id));
  });

  it('people search keys: members keep their own up to date and anyone can search them', async () => {
    await assertSucceeds(updateDoc(doc(db('bob'), 'users', 'bob'), { nameTokens: ['bo', 'bob'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('bob'), 'users', 'bob'), { nameTokens: Array.from({ length: 101 }, (_, i) => `t${i}`), updatedAt: serverTimestamp() }));
    const found = await getDocs(query(collection(db('carol'), 'users'), where('nameTokens', 'array-contains', 'bo')));
    expect(found.docs.map((d) => d.id)).toEqual(['bob']);
  });

  it('bookmarks are private; birthdays and home visits are checked', async () => {
    await assertSucceeds(ops.setBookmark(db('bob'), 'bob', 'p1', true));
    await assertFails(getDoc(doc(db('carol'), 'users', 'bob', 'bookmarks', 'p1')));
    await assertFails(ops.setBookmark(db('carol'), 'bob', 'p1', true));
    await assertSucceeds(ops.setBookmark(db('bob'), 'bob', 'p1', false));
    await assertSucceeds(ops.setBirthday(db('bob'), 'bob', '11-24'));
    await assertFails(ops.setBirthday(db('bob'), 'bob', '13-40'));
    await assertSucceeds(ops.setBirthday(db('bob'), 'bob', null));
    await assertSucceeds(ops.setHomeVisit(db('bob'), 'bob', { townId: 'todzi', until: new Date(Date.now() + 10 * 86400_000) }));
    await assertFails(ops.setHomeVisit(db('bob'), 'bob', { townId: 'todzi', until: new Date(Date.now() + 200 * 86400_000) })); // too far ahead
    await assertFails(ops.setHomeVisit(db('bob'), 'bob', { townId: 'accra', until: new Date(Date.now() + 86400_000) }));
    await assertFails(ops.setHomeVisit(db('carol'), 'bob', null));
  });

  it('profile bio and vibe', async () => {
    await assertSucceeds(ops.updateBio(db('bob'), 'bob', 'Footballer from Todzi ⚽', '🔥'));
    await assertFails(updateDoc(doc(db('bob'), 'users', 'bob'), { bio: 'x'.repeat(200), updatedAt: serverTimestamp() }));
  });

  it('directory entries: owners manage their own', async () => {
    const e = { kind: 'job' as const, townId: 'todzi', title: 'Teaching assistant', description: 'Primary school, Todzi.', category: 'Education', contactPhone: '+233241234567', link: null, deadline: new Date(Date.now() + 7 * 86400_000) };
    const id = await ops.saveEntry(db('bob'), 'bob', e, null);
    await assertFails(ops.setEntryStatus(db('bob'), id, 'active')); // pending: cannot self-approve
    await seed((a) => updateDoc(doc(a, 'directory', id), { status: 'active' })); // moderator approved
    await assertFails(ops.setEntryStatus(db('carol'), id, 'closed'));
    await assertSucceeds(ops.setEntryStatus(db('bob'), id, 'closed'));
    await assertFails(ops.saveEntry(db('carol'), 'carol', { ...e, link: 'http://insecure.example' }, null));
  });
});
