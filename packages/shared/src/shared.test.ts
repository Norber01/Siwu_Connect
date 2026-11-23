import { describe, expect, it } from 'vitest';
import {
  canAnnounce,
  canModerate,
  canSuspend,
  grantRoleSchema,
  isTownId,
  postSchema,
  searchTokens,
  usernameSchema,
} from './index';

describe('towns', () => {
  it('accepts only the four stable town ids', () => {
    expect(isTownId('odomi')).toBe(true);
    expect(isTownId('adokor')).toBe(true);
    expect(isTownId('Akpafu Odomi')).toBe(false);
    expect(isTownId('')).toBe(false);
  });
});

describe('searchTokens', () => {
  it('lowercases, strips accents and punctuation, dedupes', () => {
    expect(searchTokens('Funeral at Akpafú Todzi! Funeral...')).toEqual(['funeral', 'at', 'akpafu', 'todzi']);
  });
  it('drops 1-letter words and caps the count', () => {
    expect(searchTokens('a b cd')).toEqual(['cd']);
    const many = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    expect(searchTokens(many)).toHaveLength(50);
  });
});

describe('schemas', () => {
  it('normalises usernames and rejects invalid ones', () => {
    expect(usernameSchema.parse('  Kofi_A ')).toBe('kofi_a');
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('kofi-a').success).toBe(false);
  });
  it('validates posts', () => {
    expect(postSchema.safeParse({ townId: 'todzi', text: '  hello \n\n\n\n world ', visibility: 'akpafu' }).data?.text).toBe(
      'hello \n\n world',
    );
    expect(postSchema.safeParse({ townId: 'todzi', text: '   ', visibility: 'akpafu' }).success).toBe(false);
    expect(postSchema.safeParse({ townId: 'accra', text: 'x', visibility: 'akpafu' }).success).toBe(false);
    expect(postSchema.safeParse({ townId: 'todzi', text: 'x'.repeat(2001), visibility: 'town' }).success).toBe(false);
  });
  it('requires towns for scoped roles', () => {
    expect(grantRoleSchema.safeParse({ username: 'ama', role: 'moderator', townIds: [] }).success).toBe(false);
    expect(grantRoleSchema.safeParse({ username: 'ama', role: 'super_admin' }).success).toBe(true);
  });
});

describe('permissions', () => {
  const superAdmin = { role: 'super_admin' as const, townIds: [] };
  const townAdmin = { role: 'town_admin' as const, townIds: ['odomi'] };
  const mod = { role: 'moderator' as const, townIds: ['odomi', 'todzi'] };

  it('super admin can do everything everywhere', () => {
    for (const t of ['odomi', 'mempeasem', 'todzi', 'adokor']) {
      expect(canModerate(superAdmin, t)).toBe(true);
      expect(canAnnounce(superAdmin, t)).toBe(true);
      expect(canSuspend(superAdmin, t)).toBe(true);
    }
    expect(canAnnounce(superAdmin, 'all')).toBe(true);
  });
  it('town admin is limited to their town', () => {
    expect(canModerate(townAdmin, 'odomi')).toBe(true);
    expect(canModerate(townAdmin, 'todzi')).toBe(false);
    expect(canAnnounce(townAdmin, 'all')).toBe(false);
    expect(canSuspend(townAdmin, 'adokor')).toBe(false);
  });
  it('moderator moderates assigned towns but cannot announce or suspend', () => {
    expect(canModerate(mod, 'todzi')).toBe(true);
    expect(canModerate(mod, 'adokor')).toBe(false);
    expect(canAnnounce(mod, 'odomi')).toBe(false);
    expect(canSuspend(mod, 'odomi')).toBe(false);
  });
  it('no role means no access', () => {
    expect(canModerate(null, 'odomi')).toBe(false);
  });
});
