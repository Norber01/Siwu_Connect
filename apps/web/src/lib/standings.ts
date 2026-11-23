import type { Match } from './types';

interface Row {
  team: string;
  townId: string | null;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
}

/** League table from finished matches: 3 points a win, 1 a draw; sorted by points, goal difference, goals scored. */
export function computeStandings(matches: Match[]): Row[] {
  const rows = new Map<string, Row>();
  const row = (t: Match['home']) => {
    const key = t.name.toLowerCase();
    if (!rows.has(key)) rows.set(key, { team: t.name, townId: t.townId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    return rows.get(key)!;
  };
  for (const m of matches.filter((x) => x.status === 'finished')) {
    const h = row(m.home);
    const a = row(m.away);
    h.p++;
    a.p++;
    h.gf += m.homeScore;
    h.ga += m.awayScore;
    a.gf += m.awayScore;
    a.ga += m.homeScore;
    if (m.homeScore > m.awayScore) {
      h.w++;
      a.l++;
      h.pts += 3;
    } else if (m.homeScore < m.awayScore) {
      a.w++;
      h.l++;
      a.pts += 3;
    } else {
      h.d++;
      a.d++;
      h.pts++;
      a.pts++;
    }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || x.team.localeCompare(y.team));
}

