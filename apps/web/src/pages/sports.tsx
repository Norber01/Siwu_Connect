import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  EXTRA_LIMITS,
  MATCH_UPDATE_TYPES,
  TOWNS,
  type Clock,
  canReportSports,
  matchClock,
  matchSchema,
  matchUpdateSchema,
  townName,
} from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import {
  type MatchPick,
  addMatchUpdate,
  createMatch,
  deleteMatch,
  deleteMatchUpdate,
  setMatchScore,
  setMatchStatus,
  startMatchNow,
  startSecondHalfNow,
  voteOnMatch,
} from '../lib/ops';
import { activeMatchesQuery, fetchMatches, fetchMyVote } from '../lib/queries';
import { type Match, type MatchUpdate, toMatch, toMatchUpdate } from '../lib/types';
import { friendlyError, fromLocalInput } from '../lib/util';
import { TeamCrest } from '../components/extras';
import { computeStandings } from '../lib/standings';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { PredictChip, PredictionCard, PredictionLeague } from '../components/Predictions';
import { Alert, Button, EmptyState, ErrorState, Modal, PageHeader, PageSpinner, SelectField, TextField } from '../components/ui';

type Tab = 'live' | 'fixtures' | 'results' | 'standings' | 'predictions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'results', label: 'Results' },
  { id: 'standings', label: 'Standings' },
  { id: 'predictions', label: '🔮 League' },
];

/** Re-renders every `ms` so the match clock ticks. */
function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const clockOf = (m: Match, now: Date) => matchClock(m, now);

/** Real-time list of every match that is not finished (fixtures and live games). */
function useActiveMatches(enabled: boolean) {
  const [state, setState] = useState<{ data: Match[] | null; error: unknown }>({ data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      activeMatchesQuery(),
      (snap) => setState({ data: snap.docs.map(toMatch), error: null }),
      (error) => setState({ data: null, error }),
    );
  }, [enabled]);
  return state;
}

export function SportsPage() {
  const { role } = useMe();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'live') as Tab;
  const now = useNow(1000);
  const active = useActiveMatches(tab === 'live' || tab === 'fixtures');
  const results = useQuery({
    queryKey: ['matches', 'results'],
    queryFn: () => fetchMatches('results'),
    enabled: tab === 'results' || tab === 'standings',
    staleTime: 30_000,
  });
  // Live = being played now (or waiting for a reporter to confirm full time); Fixtures = not started yet.
  const liveMatches = (active.data ?? []).filter((m) => ['first', 'break', 'second', 'ended'].includes(clockOf(m, now).phase));
  const fixtureMatches = (active.data ?? []).filter((m) => ['scheduled', 'postponed'].includes(clockOf(m, now).phase));
  const list = tab === 'results' || tab === 'standings' ? results : null;

  return (
    <div className="space-y-3">
      <div className="-mx-4 -mt-3 bg-brand-600 px-4 pb-4 pt-4 text-white">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Icon name="trophy" /> Sports Centre
          </h1>
          {canReportSports(role) && (
            <Link to="/sports/new" className="inline-flex min-h-[40px] items-center gap-1 rounded-full bg-white px-3 text-sm font-bold text-brand-700">
              <Icon name="plus" className="h-4 w-4" /> Match
            </Link>
          )}
        </div>
        <div role="tablist" className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParams(t.id === 'live' ? {} : { tab: t.id }, { replace: true })}
              className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-bold ${tab === t.id ? 'bg-white text-brand-700' : 'bg-brand-700/60 text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'predictions' ? (
        <PredictionLeague />
      ) : tab === 'live' || tab === 'fixtures' ? (
        active.error ? (
          <ErrorState message={friendlyError(active.error)} />
        ) : !active.data ? (
          <PageSpinner />
        ) : tab === 'live' ? (
          liveMatches.length === 0 ? (
            <EmptyState title="No matches live right now" icon="ball">
              Check the <button className="font-semibold text-brand-700 underline" onClick={() => setParams({ tab: 'fixtures' })}>fixtures</button> for the next kick-off.
            </EmptyState>
          ) : (
            <MatchList matches={liveMatches} now={now} />
          )
        ) : fixtureMatches.length === 0 ? (
          <EmptyState title="No upcoming fixtures" icon="ball">
            {canReportSports(role) ? 'Add a match with the “Match” button.' : 'Match reporters will add fixtures here.'}
          </EmptyState>
        ) : (
          <MatchList matches={fixtureMatches} now={now} />
        )
      ) : list!.isPending ? (
        <PageSpinner />
      ) : list!.isError ? (
        <ErrorState message={friendlyError(list!.error)} onRetry={() => list!.refetch()} />
      ) : tab === 'standings' ? (
        <Standings matches={list!.data!} />
      ) : list!.data!.length === 0 ? (
        <EmptyState title="No results yet" icon="ball">
          Finished matches will appear here.
        </EmptyState>
      ) : (
        <MatchList matches={list!.data!} now={now} />
      )}
    </div>
  );
}

function MatchList({ matches, now }: { matches: Match[]; now: Date }) {
  return (
    <ul className="space-y-3">
      {matches.map((m) => (
        <li key={m.id}>
          <MatchCard match={m} now={now} />
        </li>
      ))}
    </ul>
  );
}

function MatchCard({ match: m, now }: { match: Match; now: Date }) {
  const clock = clockOf(m, now);
  const started = !['scheduled', 'postponed', 'cancelled'].includes(clock.phase);
  return (
    <Link to={`/sports/${m.id}`} className="block rounded-2xl border border-sand-200 bg-white p-4 shadow-sm hover:border-brand-300">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <Icon name="ball" className="h-4 w-4 text-brand-700" /> {m.competition}
        </span>
        <StatusBadge clock={clock} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
        <TeamBlock team={m.home} />
        <div>
          {started ? (
            <p className="text-3xl font-black tabular-nums text-gray-900">
              {m.homeScore} - {m.awayScore}
            </p>
          ) : (
            <p className="text-lg font-black text-gray-900">{m.kickoffAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
          )}
          <p className="text-xs font-semibold tabular-nums text-gray-600">
            <ClockText clock={clock} fallback={m.kickoffAt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} />
          </p>
        </div>
        <TeamBlock team={m.away} />
      </div>
      {m.status === 'scheduled' && !started && <PredictChip match={m} />}
    </Link>
  );
}

function TeamBlock({ team, large }: { team: Match['home']; large?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <TeamCrest name={team.name} townId={team.townId} size={large ? 64 : 48} />
      <span className={`font-bold text-gray-900 ${large ? 'text-base' : 'text-sm'}`}>{team.name}</span>
    </div>
  );
}

function StatusBadge({ clock }: { clock: Clock }) {
  if (clock.phase === 'first' || clock.phase === 'second' || clock.phase === 'break')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-black text-white">
        <span className={`h-1.5 w-1.5 rounded-full bg-white ${clock.phase === 'break' ? '' : 'animate-pulse'}`} />
        {clock.phase === 'break' ? 'HT' : 'LIVE'}
      </span>
    );
  if (clock.phase === 'finished' || clock.phase === 'ended')
    return <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">FT</span>;
  if (clock.phase === 'postponed' || clock.phase === 'cancelled')
    return <span className="rounded-full bg-gold-100 px-2 py-0.5 text-xs font-bold text-gold-800">{clock.label}</span>;
  return <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-800">Upcoming</span>;
}

/** "32:15", "HT · 2nd half in 3:12", "FT"... */
function ClockText({ clock, fallback }: { clock: Clock; fallback: string }) {
  if (clock.phase === 'first' || clock.phase === 'second') return <>⏱ {clock.display}</>;
  if (clock.phase === 'break') {
    const r = Math.ceil(clock.breakRemaining ?? 0);
    return <>Half time · 2nd half in {Math.floor(r / 60)}:{String(r % 60).padStart(2, '0')}</>;
  }
  if (clock.phase === 'ended') return <>Full time</>;
  if (clock.phase === 'finished') return <>Full time</>;
  return <>{fallback}</>;
}

// ---------------- standings ----------------

function Standings({ matches }: { matches: Match[] }) {
  const competitions = useMemo(() => [...new Set(matches.map((m) => m.competition))], [matches]);
  const [competition, setCompetition] = useState('');
  const selected = competition || competitions[0] || '';
  const table = computeStandings(matches.filter((m) => m.competition === selected));
  if (!competitions.length) return <EmptyState title="No finished matches yet" icon="trophy">The table appears after the first result.</EmptyState>;
  return (
    <div className="space-y-3">
      {competitions.length > 1 && (
        <SelectField label="Competition" value={selected} onChange={(e) => setCompetition(e.target.value)}>
          {competitions.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
      )}
      <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm">
        <h2 className="bg-brand-800 px-4 py-2 text-sm font-bold text-white">{selected}</h2>
        <table className="w-full text-sm">
          <thead className="bg-sand-100 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="py-2 text-left">Team</th>
              <th className="px-1">P</th>
              <th className="px-1">W</th>
              <th className="px-1">D</th>
              <th className="px-1">L</th>
              <th className="px-1">GD</th>
              <th className="px-3">Pts</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => (
              <tr key={r.team} className="border-t border-sand-100 text-center tabular-nums">
                <td className="px-3 py-2 text-left font-bold text-gray-600">{i + 1}</td>
                <td className="py-2 text-left">
                  <span className="flex items-center gap-2 font-semibold text-gray-900">
                    <TeamCrest name={r.team} townId={r.townId} size={24} /> {r.team}
                  </span>
                </td>
                <td className="px-1">{r.p}</td>
                <td className="px-1">{r.w}</td>
                <td className="px-1">{r.d}</td>
                <td className="px-1">{r.l}</td>
                <td className="px-1">{r.gf - r.ga > 0 ? `+${r.gf - r.ga}` : r.gf - r.ga}</td>
                <td className="px-3 font-black text-brand-700">{r.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- match detail ----------------

export function MatchDetailPage() {
  const { matchId = '' } = useParams();
  const { user, role, profile } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [updates, setUpdates] = useState<MatchUpdate[]>([]);
  const [error, setError] = useState<unknown>(null);
  const myVote = useQuery({ queryKey: ['vote', matchId], queryFn: () => fetchMyVote(user.uid, matchId) });
  const [voting, setVoting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    const unsubMatch = onSnapshot(
      doc(db, 'matches', matchId),
      (s) => setMatch(s.exists() ? toMatch(s) : null),
      setError,
    );
    const unsubUpdates = onSnapshot(
      query(collection(db, 'matches', matchId, 'updates'), orderBy('createdAt', 'desc'), limit(100)),
      (s) => setUpdates(s.docs.map(toMatchUpdate)),
      () => {},
    );
    return () => {
      unsubMatch();
      unsubUpdates();
    };
  }, [matchId]);

  if (error) return <ErrorState message={friendlyError(error)} />;
  if (match === undefined) return <PageSpinner />;
  if (match === null) return <EmptyState title="Match not found" icon="ball" />;
  const m = match;
  const reporter = canReportSports(role);
  const totalVotes = m.votesHome + m.votesDraw + m.votesAway;
  const clock = clockOf(m, now);
  const votingOpen = m.status === 'scheduled' || m.status === 'live' || m.status === 'halftime';
  const pct = (n: number) => (totalVotes ? Math.round((n / totalVotes) * 100) : 0);

  const vote = async (pick: MatchPick) => {
    setVoting(true);
    try {
      await voteOnMatch(db, user.uid, m.id, pick);
      await myVote.refetch();
      toast('Your vote is in!');
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setVoting(false);
    }
  };

  const typeInfo = (t: string) => MATCH_UPDATE_TYPES.find((x) => x.id === t);

  return (
    <div className="space-y-4">
      <PageHeader title="Sports Centre" back />
      <section className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm">
        <div className="flex items-center justify-between bg-brand-600 px-4 py-2 text-white">
          <span className="text-sm font-bold">{m.competition}</span>
          <StatusBadge clock={clock} />
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-5 text-center">
          <TeamBlock team={m.home} large />
          <div>
            <p className="text-4xl font-black tabular-nums text-gray-900" aria-live="polite">
              {m.homeScore} - {m.awayScore}
            </p>
            <p className="mt-1 text-sm font-bold tabular-nums text-gray-700" aria-live="off">
              <ClockText clock={clock} fallback={m.kickoffAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
            </p>
          </div>
          <TeamBlock team={m.away} large />
        </div>
        <p className="border-t border-sand-100 px-4 py-2 text-center text-xs text-gray-600">
          {m.kickoffAt.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
          {m.venue && ` · ${m.venue}`} · {m.durationMinutes} min, {m.breakMinutes}-min break
        </p>
      </section>

      {reporter && <ReporterPanel match={m} clock={clock} />}

      <PredictionCard match={m} />

      <section className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900">
          <Icon name="check" className="h-5 w-5 text-brand-700" /> Who will win?
        </h2>
        {myVote.data || !votingOpen ? (
          <div className="space-y-2">
            {(
              [
                ['home', m.home.name, m.votesHome],
                ['draw', 'Draw', m.votesDraw],
                ['away', m.away.name, m.votesAway],
              ] as const
            ).map(([id, label, n]) => (
              <div key={id} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-sm">
                <span className={`truncate font-semibold ${myVote.data === id ? 'text-brand-700' : 'text-gray-800'}`}>
                  {label} {myVote.data === id && '✓'}
                </span>
                <span className="h-3 overflow-hidden rounded-full bg-sand-200">
                  <span className="block h-full rounded-full bg-brand-600" style={{ width: `${pct(n)}%` }} />
                </span>
                <span className="text-right font-bold tabular-nums">{pct(n)}%</span>
              </div>
            ))}
            <p className="pt-1 text-xs text-gray-600">
              {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'} · just for fun, no money involved{!votingOpen && ' · voting closed'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(['home', 'draw', 'away'] as const).map((p) => (
              <Button key={p} variant="secondary" busy={voting} disabled={profile.status !== 'active'} onClick={() => vote(p)}>
                {p === 'home' ? m.home.name : p === 'away' ? m.away.name : 'Draw'}
              </Button>
            ))}
            <p className="col-span-3 text-xs text-gray-600">One vote per member. Just for fun — no money involved.</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-bold text-gray-900">Live updates</h2>
        {updates.length === 0 ? (
          <p className="py-2 text-sm text-gray-600">No updates yet.</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {updates.map((u) => (
              <li key={u.id} className="flex items-start gap-3 py-2.5 text-sm">
                <span className="w-9 shrink-0 font-bold tabular-nums text-gray-600">{u.minute !== null ? `${u.minute}'` : ''}</span>
                <span aria-hidden="true">{typeInfo(u.type)?.emoji}</span>
                <span className="flex-1 text-gray-900">
                  <span className="font-semibold">{typeInfo(u.type)?.label}</span>
                  {u.team && ` · ${u.team === 'home' ? m.home.name : m.away.name}`}
                  {u.text && <span className="block text-gray-700">{u.text}</span>}
                </span>
                {reporter && (
                  <button
                    onClick={() => deleteMatchUpdate(db, m.id, u.id).catch((e) => toast(friendlyError(e), 'error'))}
                    className="rounded p-1 text-gray-400 hover:text-red-700"
                    aria-label="Delete this update"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {reporter && (
        <Button variant="ghost" className="text-red-700" icon="trash" onClick={() => setConfirmDelete(true)}>
          Delete this match
        </Button>
      )}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this match?">
        <p className="text-sm text-gray-700">The match, its score and votes will be removed from the Sports Centre.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await deleteMatch(db, m.id);
                navigate('/sports');
              } catch (e) {
                toast(friendlyError(e), 'error');
              }
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ReporterPanel({ match: m, clock }: { match: Match; clock: Clock }) {
  const { user } = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const [minute, setMinute] = useState('');
  // Start as a plain "Update" with no team, so a goal is only ever counted on purpose.
  const [type, setType] = useState('note');
  const [team, setTeam] = useState<'home' | 'away' | ''>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const act = async (name: string, fn: () => Promise<void>, done?: string) => {
    setBusy(name);
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: ['matches'] });
      if (done) toast(done);
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = matchUpdateSchema.safeParse({
      type,
      team: team || null,
      // Defaults to the live clock's minute; the reporter can type a different one.
      minute: minute !== '' ? Number(minute) : clock.minute,
      text,
    });
    if (!parsed.success) {
      toast(parsed.error.issues[0]!.message, 'error');
      return;
    }
    if (parsed.data.type === 'goal' && !parsed.data.team) {
      toast('Choose which team scored.', 'error');
      return;
    }
    await act(
      'update',
      async () => {
        await addMatchUpdate(db, user.uid, m, parsed.data);
        setText('');
        setMinute('');
        setType('note');
        setTeam('');
      },
      parsed.data.type === 'goal' ? `⚽ Goal for ${parsed.data.team === 'home' ? m.home.name : m.away.name}!` : 'Update posted.',
    );
  };

  const score = (side: 'home' | 'away', d: number) => {
    const home = m.homeScore + (side === 'home' ? d : 0);
    const away = m.awayScore + (side === 'away' ? d : 0);
    if (home < 0 || away < 0) return;
    void act('score', () => setMatchScore(db, m.id, home, away));
  };

  const finished = clock.phase === 'finished';

  return (
    <section className="space-y-4 rounded-2xl border-2 border-gold-400 bg-gold-100/40 p-4">
      <h2 className="flex items-center gap-2 font-bold text-gray-900">
        <Icon name="megaphone" className="h-5 w-5" /> Match reporter controls
      </h2>

      <div className="rounded-xl bg-white p-3 text-sm ring-1 ring-sand-200">
        <p className="font-semibold text-gray-900">⏱️ The clock runs by itself</p>
        <p className="mt-0.5 text-gray-600">
          {m.durationMinutes} minutes ({m.durationMinutes / 2} each half) with a {m.breakMinutes}-minute break. It starts at kick-off, pauses at
          half time and resumes for the second half. Use the buttons only if the real game is early or late.
        </p>
        {!finished && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(clock.phase === 'scheduled' || clock.phase === 'postponed') && (
              <Button small busy={busy === 'start'} onClick={() => act('start', () => startMatchNow(db, m.id), 'Kick-off! The clock is running.')}>
                ▶ Start match now
              </Button>
            )}
            {(clock.phase === 'first' || clock.phase === 'break') && (
              <Button small busy={busy === 'second'} onClick={() => act('second', () => startSecondHalfNow(db, m.id), 'Second half started.')}>
                ▶ Start 2nd half now
              </Button>
            )}
            {clock.phase !== 'scheduled' && clock.phase !== 'postponed' && (
              <Button small variant={clock.phase === 'ended' ? 'primary' : 'secondary'} onClick={() => setConfirmEnd(true)}>
                ■ {clock.phase === 'ended' ? 'Confirm full time' : 'End match'}
              </Button>
            )}
            {clock.phase === 'scheduled' && (
              <Button small variant="ghost" busy={busy === 'postpone'} onClick={() => act('postpone', () => setMatchStatus(db, m.id, 'postponed'), 'Match postponed.')}>
                Postpone
              </Button>
            )}
          </div>
        )}
        {finished && (
          <Button small variant="ghost" className="mt-2" busy={busy === 'reopen'} onClick={() => act('reopen', () => setMatchStatus(db, m.id, 'live'), 'Match reopened.')}>
            Reopen match (correct a mistake)
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-center">
        {(['home', 'away'] as const).map((side) => (
          <div key={side} className="rounded-xl bg-white p-2 ring-1 ring-sand-200">
            <p className="truncate text-xs font-semibold text-gray-600">{side === 'home' ? m.home.name : m.away.name}</p>
            <div className="mt-1 flex items-center justify-center gap-3">
              <Button small variant="secondary" aria-label={`Remove a goal from ${side === 'home' ? m.home.name : m.away.name}`} onClick={() => score(side, -1)}>
                −
              </Button>
              <span className="text-2xl font-black tabular-nums">{side === 'home' ? m.homeScore : m.awayScore}</span>
              <Button small variant="secondary" aria-label={`Add a goal to ${side === 'home' ? m.home.name : m.away.name}`} onClick={() => score(side, 1)}>
                +
              </Button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={post} className="space-y-3 border-t border-gold-400/50 pt-3">
        <p className="text-sm font-semibold text-gray-800">Post a live update</p>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="What happened?" value={type} onChange={(e) => setType(e.target.value)}>
            {MATCH_UPDATE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji} {t.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Team" value={team} onChange={(e) => setTeam(e.target.value as 'home' | 'away' | '')}>
            <option value="">— None —</option>
            <option value="home">{m.home.name}</option>
            <option value="away">{m.away.name}</option>
          </SelectField>
        </div>
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <TextField
            label="Minute"
            inputMode="numeric"
            value={minute}
            placeholder={clock.minute !== null ? String(clock.minute) : ''}
            onChange={(e) => setMinute(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          />
          <TextField label="Comment (optional)" maxLength={EXTRA_LIMITS.matchUpdateMax} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Header from the corner!" />
        </div>
        <p className="text-xs text-gray-600">
          The minute is filled in from the clock. Only a <strong>Goal</strong> update changes the score (+1 for the team you choose).
        </p>
        <Button type="submit" busy={busy === 'update'}>
          {type === 'goal' ? (team ? `Post goal for ${team === 'home' ? m.home.name : m.away.name}` : 'Choose the team that scored') : 'Post update'}
        </Button>
      </form>

      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End the match?">
        <p className="text-sm text-gray-700">
          Final score {m.home.name} {m.homeScore} – {m.awayScore} {m.away.name}. The result goes into the table and voting closes.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
            Not yet
          </Button>
          <Button
            onClick={() => {
              setConfirmEnd(false);
              void act('end', () => setMatchStatus(db, m.id, 'finished'), 'Full time. Result saved.');
            }}
          >
            Confirm full time
          </Button>
        </div>
      </Modal>
    </section>
  );
}

// ---------------- new match ----------------

export function MatchFormPage() {
  const { user, role } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [competition, setCompetition] = useState('Akpafu Community Cup');
  const [homeTown, setHomeTown] = useState<string>('odomi');
  const [homeName, setHomeName] = useState('Odomi');
  const [awayTown, setAwayTown] = useState<string>('mempeasem');
  const [awayName, setAwayName] = useState('Mempeasem');
  const [venue, setVenue] = useState('');
  const [kickoff, setKickoff] = useState('');
  const [duration, setDuration] = useState('90');
  const [breakMins, setBreakMins] = useState('15');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canReportSports(role)) return <EmptyState title="Only match reporters can add matches" icon="ban">Ask a Super Admin to give you the Sports reporter role.</EmptyState>;

  const townSelect = (label: string, value: string, set: (v: string) => void, setName: (v: string) => void) => (
    <SelectField
      label={label}
      value={value}
      onChange={(e) => {
        set(e.target.value);
        const t = TOWNS.find((x) => x.id === e.target.value);
        if (t) setName(t.shortName);
      }}
    >
      {TOWNS.map((t) => (
        <option key={t.id} value={t.id}>
          {townName(t.id)}
        </option>
      ))}
      <option value="">Other / not a town team</option>
    </SelectField>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = matchSchema.safeParse({
      competition,
      home: { name: homeName, townId: homeTown || null },
      away: { name: awayName, townId: awayTown || null },
      venue,
      kickoffAt: fromLocalInput(kickoff),
      durationMinutes: duration === '' ? NaN : Number(duration),
      breakMinutes: breakMins === '' ? NaN : Number(breakMins),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await createMatch(db, user.uid, parsed.data);
      void qc.invalidateQueries({ queryKey: ['matches'] });
      toast('Match added to the Sports Centre.');
      navigate(`/sports/${id}`, { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Add a match" back />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <TextField label="Competition" maxLength={EXTRA_LIMITS.competitionMax} value={competition} onChange={(e) => setCompetition(e.target.value)} />
        <div className="grid gap-3 rounded-2xl border border-sand-200 bg-white p-4 sm:grid-cols-2">
          <div className="space-y-3">
            {townSelect('Home team town', homeTown, setHomeTown, setHomeName)}
            <TextField label="Home team name" maxLength={EXTRA_LIMITS.teamNameMax} value={homeName} onChange={(e) => setHomeName(e.target.value)} />
          </div>
          <div className="space-y-3">
            {townSelect('Away team town', awayTown, setAwayTown, setAwayName)}
            <TextField label="Away team name" maxLength={EXTRA_LIMITS.teamNameMax} value={awayName} onChange={(e) => setAwayName(e.target.value)} />
          </div>
        </div>
        <TextField label="Kick-off (date and time)" type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Match length (minutes)"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            hint={Number(duration) ? `${Number(duration) / 2} minutes each half` : 'e.g. 90'}
          />
          <TextField
            label="Half-time break (minutes)"
            inputMode="numeric"
            value={breakMins}
            onChange={(e) => setBreakMins(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
            hint="e.g. 5, 10 or 15"
          />
        </div>
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-900">
          ⏱️ The clock starts by itself at kick-off, pauses at half time for the break, then carries on for the second half.
        </p>
        <TextField label="Venue (optional)" maxLength={EXTRA_LIMITS.eventLocationMax} value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Odomi Park" />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Add match
          </Button>
        </div>
      </form>
    </div>
  );
}
