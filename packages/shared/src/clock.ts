/**
 * Automatic match clock. Computed on every device from the stored times, so it keeps
 * counting without anyone pressing anything:
 *  - before kick-off: "scheduled"
 *  - first half: counts up from kick-off for half of the match length
 *  - half time: paused for the break, with a countdown to the second half
 *  - second half: counts on from half time to the full match length
 *  - then "ended" until a reporter confirms full time (status "finished")
 * Reporters can correct the clock with "Start now" (actualKickoffAt) and
 * "Start 2nd half now" (secondHalfStartAt).
 */
export interface ClockFields {
  status: string;
  kickoffAt: Date;
  actualKickoffAt: Date | null;
  secondHalfStartAt: Date | null;
  durationMinutes: number;
  breakMinutes: number;
}

export type ClockPhase = 'scheduled' | 'first' | 'break' | 'second' | 'ended' | 'finished' | 'postponed' | 'cancelled';

export interface Clock {
  phase: ClockPhase;
  /** Seconds played so far (excluding the break). */
  playedSeconds: number;
  /** Football-style minute, e.g. 32 for "32'". */
  minute: number | null;
  /** Seconds until the second half starts (only during the break). */
  breakRemaining: number | null;
  /** Short label: "32'", "HT", "FT", "Postponed"... */
  label: string;
  /** "31:45" style running clock while the match is being played. */
  display: string | null;
}

export const DEFAULT_MATCH_MINUTES = 90;
export const DEFAULT_BREAK_MINUTES = 15;

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function matchClock(m: ClockFields, now: Date = new Date()): Clock {
  const base = { playedSeconds: 0, minute: null, breakRemaining: null, display: null };
  if (m.status === 'finished') return { ...base, phase: 'finished', label: 'FT', playedSeconds: m.durationMinutes * 60 };
  if (m.status === 'postponed') return { ...base, phase: 'postponed', label: 'Postponed' };
  if (m.status === 'cancelled') return { ...base, phase: 'cancelled', label: 'Cancelled' };

  const halfSec = (m.durationMinutes * 60) / 2;
  const t = now.getTime();
  const start = (m.actualKickoffAt ?? m.kickoffAt).getTime();
  if (t < start) return { ...base, phase: 'scheduled', label: 'Upcoming' };

  const firstEnd = Math.min(start + halfSec * 1000, m.secondHalfStartAt ? m.secondHalfStartAt.getTime() : Infinity);
  const secondStart = m.secondHalfStartAt ? m.secondHalfStartAt.getTime() : firstEnd + m.breakMinutes * 60_000;
  const minuteOf = (played: number, cap: number) => Math.min(cap, Math.floor(played / 60) + 1);

  if (t < firstEnd) {
    const played = (t - start) / 1000;
    const minute = minuteOf(played, Math.ceil(halfSec / 60));
    return { phase: 'first', playedSeconds: played, minute, breakRemaining: null, label: `${minute}'`, display: mmss(played) };
  }
  if (t < secondStart) {
    return {
      phase: 'break',
      playedSeconds: halfSec,
      minute: null,
      breakRemaining: (secondStart - t) / 1000,
      label: 'HT',
      display: mmss(halfSec),
    };
  }
  const played = halfSec + (t - secondStart) / 1000;
  if (played < halfSec * 2) {
    const minute = minuteOf(played, m.durationMinutes);
    return { phase: 'second', playedSeconds: played, minute, breakRemaining: null, label: `${minute}'`, display: mmss(played) };
  }
  return { ...base, phase: 'ended', playedSeconds: halfSec * 2, label: 'FT', display: mmss(halfSec * 2) };
}

export const isPlaying = (c: Clock) => c.phase === 'first' || c.phase === 'break' || c.phase === 'second';
