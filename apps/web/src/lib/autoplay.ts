import { useEffect, useState } from 'react';

/** Feed videos play by themselves (muted) unless the member switched it off in Settings → Videos and data. Per device. */
const KEY = 'siwu.autoplay';
const EVENT = 'siwu:autoplay';

export function autoplayOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoplay(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // private mode: only for this visit
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useAutoplay(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(autoplayOn);
  useEffect(() => {
    const sync = () => setOn(autoplayOn());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [on, setAutoplay];
}
