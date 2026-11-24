/** Feed mixing: pure functions, no database access (unit-tested in mix.test.ts). */

/** A new mix each time the app is opened (kept while it stays open, so the feed doesn't jump around). */
export function feedSeed(): number {
  const g = globalThis as { __siwuFeedSeed?: number };
  if (g.__siwuFeedSeed === undefined) g.__siwuFeedSeed = Math.floor(Math.random() * 2 ** 31);
  return g.__siwuFeedSeed;
}

/** Stable random number in [0, 1) for a post within this visit. */
function jitter(id: string, seed: number): number {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (Math.imul(h, 0xc2b2ae35) >>> 0) / 2 ** 32;
}

/**
 * Mixes a batch of recent posts: newer and livelier posts (reactions, comments) tend to come first,
 * with a random shuffle so the feed is different each visit.
 */
export function mixPosts<T extends { id: string; createdAt: Date | null; reactionCount: number; commentCount: number }>(
  posts: T[],
  seed = feedSeed(),
  now = Date.now(),
): T[] {
  const score = (p: T) => {
    const hours = Math.max(0, (now - (p.createdAt?.getTime() ?? now)) / 3_600_000);
    const fresh = 1 / (1 + hours / 24);
    const lively = Math.log1p(p.reactionCount + 2 * p.commentCount) / 4;
    return fresh + lively + jitter(p.id, seed) * 0.9;
  };
  return posts
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

