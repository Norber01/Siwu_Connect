import { useEffect, useState } from 'react';
import { db } from './firebase';
import { setActive } from './ops';

const KEY = 'siwu.showActive';

/** Members choose whether others can see when they are active (like WhatsApp: if you hide yours, you don't see others'). */
export function getShowActivity(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function useShowActivity(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState(getShowActivity);
  return [
    show,
    (v: boolean) => {
      try {
        localStorage.setItem(KEY, v ? 'on' : 'off');
      } catch {
        /* storage unavailable: applies for this visit */
      }
      setShow(v);
      window.dispatchEvent(new Event('siwu-activity-pref'));
    },
  ];
}

let lastBeat = 0;

/** Refreshes "Active now" every few minutes while the app is open and visible. */
export function useActivityHeartbeat(uid: string | null | undefined, active: boolean) {
  useEffect(() => {
    if (!uid || !active) return;
    const beat = (force = false) => {
      if (document.visibilityState !== 'visible') return;
      const show = getShowActivity();
      if (!force && show && Date.now() - lastBeat < 2.5 * 60_000) return;
      lastBeat = Date.now();
      void setActive(db, uid, show).catch(() => {});
    };
    beat();
    const t = setInterval(() => beat(), 60_000);
    const onVis = () => beat();
    const onPref = () => beat(true);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('siwu-activity-pref', onPref);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('siwu-activity-pref', onPref);
    };
  }, [uid, active]);
}

/** "Active now", "Active 12 min ago", "Active 3 h ago" — or null if longer, hidden, or you hide yours. */
export function activeLabel(at: Date | null | undefined, now = Date.now()): string | null {
  if (!at || !getShowActivity()) return null;
  const min = (now - at.getTime()) / 60_000;
  if (min < 5) return 'Active now';
  if (min < 60) return `Active ${Math.round(min)} min ago`;
  if (min < 24 * 60) return `Active ${Math.round(min / 60)} h ago`;
  return null;
}

export const isOnline = (at: Date | null | undefined) => activeLabel(at) === 'Active now';
