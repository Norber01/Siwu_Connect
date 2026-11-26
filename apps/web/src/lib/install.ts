/**
 * "Install the app": Android/computers get the browser's own install prompt (one tap); iPhones need Safari's
 * Share → Add to Home Screen, which the app explains.
 */
import { useEffect, useState } from 'react';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// Chrome offers installing once it knows the site is an app: keep that offer for our own button.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
/** iPhone browsers other than Safari (Chrome, Firefox, Edge) or apps' built-in browsers. */
export const iosNotSafari = () => /CriOS|FxiOS|EdgiOS|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent);

/** Whether a one-tap install is available right now (Android / computers). */
export function useCanInstall(): boolean {
  const [can, setCan] = useState(!!deferred);
  useEffect(() => {
    const l = () => setCan(!!deferred);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return can;
}

/** Shows the browser's install question. True if the person installed. */
export async function installApp(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  notify();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}
