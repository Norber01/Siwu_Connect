import { describe, expect, it } from 'vitest';
import { matchClock } from './clock';

const ko = new Date('2026-12-05T15:00:00Z');
const m = (extra: Partial<Parameters<typeof matchClock>[0]> = {}) => ({
  status: 'scheduled',
  kickoffAt: ko,
  actualKickoffAt: null,
  secondHalfStartAt: null,
  durationMinutes: 90,
  breakMinutes: 5,
  ...extra,
});
const at = (min: number, sec = 0) => new Date(ko.getTime() + min * 60_000 + sec * 1000);

describe('matchClock', () => {
  it('counts automatically through a 90-minute match with a 5-minute break', () => {
    expect(matchClock(m(), at(-10)).phase).toBe('scheduled');
    expect(matchClock(m(), at(0, 30))).toMatchObject({ phase: 'first', minute: 1, label: "1'", display: '0:30' });
    expect(matchClock(m(), at(31, 45))).toMatchObject({ phase: 'first', minute: 32, display: '31:45' });
    // Half time: paused at 45:00 with a countdown.
    const ht = matchClock(m(), at(47));
    expect(ht).toMatchObject({ phase: 'break', label: 'HT', display: '45:00' });
    expect(ht.breakRemaining).toBe(180);
    // Second half resumes from 45 after the 5-minute break.
    expect(matchClock(m(), at(50, 30))).toMatchObject({ phase: 'second', minute: 46, display: '45:30' });
    expect(matchClock(m(), at(94))).toMatchObject({ phase: 'second', minute: 90 });
    expect(matchClock(m(), at(96))).toMatchObject({ phase: 'ended', label: 'FT' });
  });

  it('follows the reporter when kick-off is late or the break is changed', () => {
    const late = m({ actualKickoffAt: at(10) });
    expect(matchClock(late, at(5)).phase).toBe('scheduled');
    expect(matchClock(late, at(20))).toMatchObject({ phase: 'first', display: '10:00' });
    // Second half started early, at 40 minutes after kick-off.
    const early = m({ secondHalfStartAt: at(40) });
    expect(matchClock(early, at(41))).toMatchObject({ phase: 'second', display: '46:00', minute: 47 });
  });

  it('respects a confirmed result or postponement', () => {
    expect(matchClock(m({ status: 'finished' }), at(30)).label).toBe('FT');
    expect(matchClock(m({ status: 'postponed' }), at(30)).label).toBe('Postponed');
  });

  it('supports shorter games', () => {
    const short = m({ durationMinutes: 60, breakMinutes: 10 });
    expect(matchClock(short, at(31)).phase).toBe('break');
    expect(matchClock(short, at(41))).toMatchObject({ phase: 'second', minute: 32 });
  });
});
