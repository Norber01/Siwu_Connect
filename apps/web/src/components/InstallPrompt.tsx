import { useEffect, useState } from 'react';
import { installApp, iosNotSafari, isInstalled, isIos, useCanInstall } from '../lib/install';
import { LogoMark } from './Brand';
import { Button } from './ui';

const KEY = 'siwu.install.later';
const snoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < 14 * 86_400_000;
  } catch {
    return false;
  }
};

/** Safari's Share symbol (a square with an arrow up). */
function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="inline h-5 w-5 align-[-4px] text-[#007aff]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="Share">
      <path d="M12 15V3m0 0L8 7m4-4l4 4" />
      <path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

/** The install steps for iPhone (also used in Settings). */
export function IosInstallSteps() {
  if (iosNotSafari())
    return (
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
        <li>
          Open <strong>siwuconnect.com</strong> in <strong>Safari</strong> (the blue compass app). In Chrome: tap <ShareGlyph /> in the
          address bar, then continue below.
        </li>
        <li>
          Tap <ShareGlyph /> <strong>Share</strong>, then <strong>Add to Home Screen</strong> <span aria-hidden>➕</span>.
        </li>
        <li>
          Tap <strong>Add</strong>, then open Siwu Connect from your Home Screen.
        </li>
      </ol>
    );
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
      <li>
        Tap <ShareGlyph /> <strong>Share</strong> at the bottom of Safari (on iPad: at the top).
      </li>
      <li>
        Scroll down and tap <strong>Add to Home Screen</strong> <span aria-hidden>➕</span>.
      </li>
      <li>
        Tap <strong>Add</strong>. Open Siwu Connect from your Home Screen — it works like an app and can send notifications.
      </li>
    </ol>
  );
}

/**
 * A pop-up from the bottom, a few seconds after opening Siwu Connect in a browser: install the app.
 * Not shown once installed, or for two weeks after "Not now".
 */
export function InstallPrompt() {
  const canInstall = useCanInstall();
  const ios = isIos();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isInstalled() || snoozed()) return;
    if (!ios && !canInstall) return; // nothing we can offer (yet) on this browser
    const t = setTimeout(() => setOpen(true), 4000);
    return () => clearTimeout(t);
  }, [ios, canInstall]);

  if (!open) return null;
  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // fine
    }
    setOpen(false);
  };
  const install = async () => {
    setBusy(true);
    const ok = await installApp().catch(() => false);
    setBusy(false);
    if (ok) setOpen(false);
    else later();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 pb-[calc(8px+env(safe-area-inset-bottom))] sm:bottom-4">
      <section
        role="dialog"
        aria-label="Install Siwu Connect"
        className="animate-msg-in-left w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl ring-1 ring-sand-200"
      >
        <div className="flex items-center gap-3">
          <LogoMark size={44} />
          <div className="min-w-0 flex-1">
            <p className="font-black text-gray-900">Install Siwu Connect</p>
            <p className="text-sm text-gray-600">{ios ? 'Add it to your Home Screen — free, no App Store needed.' : 'Get the app on your phone — free and quick.'}</p>
          </div>
          <button type="button" onClick={later} className="-mr-2 -mt-6 rounded-full p-2 text-gray-500 hover:bg-sand-100" aria-label="Close">
            ✕
          </button>
        </div>
        {ios ? (
          <div className="mt-4">
            <IosInstallSteps />
            <div className="mt-4 flex justify-end">
              <Button small variant="secondary" onClick={later}>
                Got it
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex justify-end gap-2">
            <Button small variant="ghost" onClick={later}>
              Not now
            </Button>
            <Button small busy={busy} onClick={() => void install()}>
              Install
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
