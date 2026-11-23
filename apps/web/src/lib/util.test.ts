import { describe, expect, it } from 'vitest';
import { linkify, timeAgo } from './util';

describe('linkify', () => {
  it('extracts http(s) links and leaves everything else as text', () => {
    expect(linkify('See https://example.com/a?b=1. Thanks')).toEqual([
      { text: 'See ' },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: '. Thanks' },
    ]);
  });
  it('does not turn javascript: or plain words into links', () => {
    expect(linkify('javascript:alert(1) <b>hi</b>')).toEqual([{ text: 'javascript:alert(1) <b>hi</b>' }]);
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-11-23T12:00:00Z').getTime();
  it('formats recent times', () => {
    expect(timeAgo(new Date(now - 10_000), now)).toBe('just now');
    expect(timeAgo(new Date(now - 5 * 60_000), now)).toBe('5 minutes ago');
    expect(timeAgo(new Date(now - 3 * 3600_000), now)).toBe('3 hours ago');
    expect(timeAgo(new Date(now - 86400_000), now)).toBe('yesterday');
    expect(timeAgo(null, now)).toBe('just now');
  });
});
