import { describe, expect, it } from 'vitest';
import { computeStandings } from './standings';
import type { Match } from './types';

const m = (home: string, away: string, hs: number, as: number, status: Match['status'] = 'finished'): Match => ({
  id: `${home}-${away}`,
  competition: 'Cup',
  home: { name: home, townId: null },
  away: { name: away, townId: null },
  venue: '',
  kickoffAt: new Date(),
  status,
  homeScore: hs,
  awayScore: as,
  minute: 90,
  votesHome: 0,
  votesDraw: 0,
  votesAway: 0,
});

describe('computeStandings', () => {
  it('awards 3 for a win, 1 for a draw, and sorts by points then goal difference', () => {
    const table = computeStandings([m('Odomi', 'Todzi', 2, 2), m('Mempeasem', 'Adokor', 3, 1), m('Adokor', 'Odomi', 0, 1), m('Todzi', 'Adokor', 5, 0, 'live')]);
    expect(table.map((r) => [r.team, r.pts])).toEqual([
      ['Odomi', 4],
      ['Mempeasem', 3],
      ['Todzi', 1],
      ['Adokor', 0],
    ]);
    const adokor = table.find((r) => r.team === 'Adokor')!;
    expect([adokor.p, adokor.l, adokor.gf, adokor.ga]).toEqual([2, 2, 1, 4]); // live match ignored
  });
});
