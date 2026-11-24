import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { townShortName } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { useProfileById } from '../lib/hooks';
import { savePrediction } from '../lib/ops';
import { fetchMyPrediction, fetchPredictionLeague, predictionPoints } from '../lib/queries';
import type { Match } from '../lib/types';
import { friendlyError, isPermissionDenied } from '../lib/util';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { Avatar, Button, EmptyState, ErrorState, PageSpinner } from './ui';
import { VerifiedBadge } from './VerifiedBadge';

function ScoreInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="max-w-[7rem] truncate text-sm font-semibold text-gray-800">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} className="h-9 w-9 rounded-full bg-sand-100 text-lg font-bold" aria-label={`${label} one less`}>
          −
        </button>
        <span className="w-8 text-center text-2xl font-black tabular-nums" aria-label={`${label} goals`}>
          {value}
        </span>
        <button type="button" onClick={() => onChange(Math.min(20, value + 1))} className="h-9 w-9 rounded-full bg-sand-100 text-lg font-bold" aria-label={`${label} one more`}>
          +
        </button>
      </div>
    </div>
  );
}

/** On fixture cards: "Predict the score", or your prediction once made. */
export function PredictChip({ match: m }: { match: Match }) {
  const { user } = useMe();
  const mine = useQuery({ queryKey: ['prediction', m.id, user.uid], queryFn: () => fetchMyPrediction(m.id, user.uid), staleTime: 60_000 });
  if (mine.isPending) return <div className="mt-3 h-9" />;
  return (
    <div className="mt-3 flex justify-center">
      {mine.data ? (
        <span className="rounded-full bg-gold-100 px-3 py-1.5 text-xs font-bold text-gold-800">
          🔮 Your prediction: {mine.data.homeScore} – {mine.data.awayScore} · tap to change
        </span>
      ) : (
        <span className="rounded-full bg-gradient-to-b from-gold-400 to-gold-600 px-4 py-1.5 text-sm font-bold text-white shadow-sm">
          🔮 Predict the score
        </span>
      )}
    </div>
  );
}

/** Predict the final score before kick-off; after the match, shows the points earned. */
export function PredictionCard({ match: m }: { match: Match }) {
  const { user, profile } = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['prediction', m.id, user.uid], queryFn: () => fetchMyPrediction(m.id, user.uid) });
  const [home, setHome] = useState<number | null>(null);
  const [away, setAway] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const open = m.status === 'scheduled' && Date.now() < m.kickoffAt.getTime();
  const h = home ?? mine.data?.homeScore ?? 0;
  const a = away ?? mine.data?.awayScore ?? 0;

  const save = async () => {
    setBusy(true);
    try {
      await savePrediction(db, user.uid, m.id, profile.hometownId, h, a, !!mine.data);
      toast(`Prediction saved: ${m.home.name} ${h} – ${a} ${m.away.name} 🔮`);
      void qc.invalidateQueries({ queryKey: ['prediction', m.id, user.uid] });
    } catch (e) {
      toast(isPermissionDenied(e) ? 'Predictions close at kick-off.' : friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (mine.isPending) return null;
  const p = mine.data;
  return (
    <section className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm" aria-label="Predict the score">
      <h2 className="mb-1 flex items-center gap-2 font-bold text-gray-900">🔮 Predict the score</h2>
      <p className="mb-3 text-xs text-gray-600">
        3 points for the exact score, 1 for the right result. <Link to="/sports?tab=predictions" className="font-semibold text-brand-700 underline">See the league</Link>
      </p>
      {open && profile.status === 'active' ? (
        <>
          <div className="flex items-center justify-around">
            <ScoreInput label={m.home.name} value={h} onChange={setHome} />
            <span className="text-xl font-black text-gray-400">–</span>
            <ScoreInput label={m.away.name} value={a} onChange={setAway} />
          </div>
          <Button className="mt-3 w-full" busy={busy} onClick={save}>
            {p ? 'Update prediction' : 'Save prediction'}
          </Button>
          <p className="mt-2 text-center text-xs text-gray-600">You can change it until kick-off.</p>
        </>
      ) : p ? (
        <p className="text-sm text-gray-800">
          Your prediction: <strong>{m.home.name} {p.homeScore} – {p.awayScore} {m.away.name}</strong>
          {m.status === 'finished' && (
            <span className="ml-1 rounded-full bg-gold-100 px-2 py-0.5 text-xs font-bold text-gold-800">
              +{predictionPoints(p, m)} {predictionPoints(p, m) === 1 ? 'point' : 'points'}
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-gray-600">Predictions closed at kick-off.</p>
      )}
    </section>
  );
}

function MemberRow({ rank, uid, points, exact, me }: { rank: number; uid: string; points: number; exact: number; me: boolean }) {
  const { data: p } = useProfileById(uid);
  return (
    <li className={`flex items-center gap-3 px-3 py-2 ${me ? 'bg-brand-50' : ''}`}>
      <span className="w-6 text-center font-black tabular-nums text-gray-500">{rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}</span>
      <Avatar url={p?.photoUrl} name={p?.displayName ?? '…'} size={32} />
      <Link to={p ? `/u/${p.username}` : '#'} className="min-w-0 flex-1 truncate font-semibold text-gray-900">
        {p?.displayName ?? '…'} {p?.verified && <VerifiedBadge className="h-3.5 w-3.5" />}
        <span className="block text-xs font-normal text-gray-600">{exact} exact {exact === 1 ? 'score' : 'scores'}</span>
      </Link>
      <span className="font-black tabular-nums text-brand-700">{points}</span>
    </li>
  );
}

/** Weekly predictions league: members and towns. */
export function PredictionLeague() {
  const { user } = useMe();
  const q = useQuery({ queryKey: ['predictionLeague'], queryFn: () => fetchPredictionLeague(7), staleTime: 2 * 60_000 });
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  const { members, towns } = q.data;
  const myRank = members.findIndex((r) => r.uid === user.uid);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white">
        <p className="text-[11px] font-black uppercase tracking-widest text-gold-400">🔮 Predictions league · last 7 days</p>
        <p className="mt-1 text-sm text-white/90">
          Open a fixture and predict the score before kick-off. Exact score = 3 points, right result = 1 point.
        </p>
        {myRank >= 0 && (
          <p className="mt-2 font-bold">
            You: #{myRank + 1} with {members[myRank]!.points} {members[myRank]!.points === 1 ? 'point' : 'points'}
          </p>
        )}
      </div>
      {members.length === 0 ? (
        <EmptyState title="No points yet this week" icon="trophy">
          Predict the score of an upcoming match — points are added when it finishes.
        </EmptyState>
      ) : (
        <>
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-900">
              <Icon name="towns" className="h-4 w-4" /> Towns
            </h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {towns.map((t, i) => (
                <li key={t.townId} className="rounded-2xl bg-white p-3 ring-1 ring-sand-200">
                  <span className="text-xs font-bold text-gray-500">#{i + 1}</span>
                  <span className="block font-bold text-gray-900">{townShortName(t.townId)}</span>
                  <span className="text-sm text-gray-600">
                    <strong className="text-brand-700">{t.points}</strong> pts · {t.players} {t.players === 1 ? 'player' : 'players'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-bold text-gray-900">Top predictors</h2>
            <ul className="divide-y divide-sand-200 overflow-hidden rounded-2xl bg-white ring-1 ring-sand-200">
              {members.slice(0, 20).map((r, i) => (
                <MemberRow key={r.uid} rank={i + 1} uid={r.uid} points={r.points} exact={r.exact} me={r.uid === user.uid} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
