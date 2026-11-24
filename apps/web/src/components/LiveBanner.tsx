import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { matchClock } from '@siwu/shared';
import { activeMatchesQuery } from '../lib/queries';
import { type Match, toMatch } from '../lib/types';

/** Matches that are being played right now (by the live clock or the reporter's status). */
function useLiveMatches(): Match[] {
  const [all, setAll] = useState<Match[]>([]);
  const [now, setNow] = useState(() => new Date());
  useEffect(
    () =>
      onSnapshot(
        activeMatchesQuery(),
        (s) => setAll(s.docs.map(toMatch)),
        () => setAll([]),
      ),
    [],
  );
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return all.filter((m) => ['first', 'break', 'second'].includes(matchClock(m, now).phase));
}

/** Hidden while scrolling down, shown again when scrolling up or at the top. */
function useShowOnScrollUp(): boolean {
  const [show, setShow] = useState(true);
  const last = useRef(0);
  useEffect(() => {
    last.current = window.scrollY;
    const on = () => {
      const y = window.scrollY;
      if (y < 60) setShow(true);
      else if (y > last.current + 8) setShow(false);
      else if (y < last.current - 8) setShow(true);
      last.current = y;
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return show;
}

/** Small "LIVE" strip at the top of the app while a game is on. Tap it to follow the match. */
export function LiveBanner() {
  const live = useLiveMatches();
  const show = useShowOnScrollUp();
  const location = useLocation();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const m = live[0];
  if (!m || location.pathname.startsWith('/sports') || dismissed === live.map((x) => x.id).join(',')) return null;
  const clock = matchClock(m, new Date());
  return (
    <div
      className={`sticky top-14 z-20 transition-all duration-300 sm:top-0 ${show ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0'}`}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 border-b border-sand-200 bg-brand-900 px-3 py-1.5 text-white">
        <Link to={`/sports/${m.id}`} className="flex min-w-0 flex-1 items-center gap-2 text-sm" aria-label={`Live: ${m.home.name} ${m.homeScore}, ${m.away.name} ${m.awayScore}. Open match`}>
          <span className="flex shrink-0 items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
          </span>
          <span className="min-w-0 truncate font-semibold">{m.home.name}</span>
          <span className="shrink-0 rounded bg-white/15 px-1.5 font-black tabular-nums">
            {m.homeScore} – {m.awayScore}
          </span>
          <span className="min-w-0 truncate font-semibold">{m.away.name}</span>
          <span className="shrink-0 text-xs font-bold text-gold-400">{clock.phase === 'break' ? 'HT' : clock.label}</span>
          {live.length > 1 && <span className="shrink-0 text-xs text-white/70">+{live.length - 1}</span>}
        </Link>
        <button
          onClick={() => setDismissed(live.map((x) => x.id).join(','))}
          className="shrink-0 rounded-full px-1.5 text-lg leading-none text-white/70 hover:text-white"
          aria-label="Hide live score"
        >
          ×
        </button>
      </div>
    </div>
  );
}
