import { describe, expect, it } from 'vitest';
import { mixPosts } from './mix';

const now = Date.parse('2026-11-24T12:00:00Z');
const post = (id: string, hoursAgo: number, reactionCount = 0, commentCount = 0) => ({
  id,
  createdAt: new Date(now - hoursAgo * 3_600_000),
  reactionCount,
  commentCount,
});

describe('feed mixing', () => {
  const posts = Array.from({ length: 12 }, (_, i) => post(`p${i}`, i * 2, i % 3, i % 2));

  it('is stable for one visit and different between visits', () => {
    expect(mixPosts(posts, 1, now).map((p) => p.id)).toEqual(mixPosts(posts, 1, now).map((p) => p.id));
    const orders = new Set([1, 2, 3, 4, 5].map((seed) => mixPosts(posts, seed, now).map((p) => p.id).join(',')));
    expect(orders.size).toBeGreaterThan(1);
    expect(mixPosts(posts, 7, now).map((p) => p.id).sort()).toEqual(posts.map((p) => p.id).sort());
  });

  it('favours new, lively posts over old quiet ones', () => {
    const fresh = post('fresh', 0.5, 20, 10);
    const old = post('old', 24 * 6);
    let freshFirst = 0;
    for (let seed = 0; seed < 50; seed++) {
      const ids = mixPosts([old, fresh], seed, now).map((p) => p.id);
      if (ids[0] === 'fresh') freshFirst++;
    }
    expect(freshFirst).toBe(50);
  });
});
