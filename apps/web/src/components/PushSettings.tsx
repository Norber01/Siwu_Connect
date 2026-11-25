import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PUSH_CATEGORIES, type PushPrefs, SPORTS_FOLLOW } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { friendlyError } from '../lib/util';
import {
  currentSubscription,
  disablePush,
  enablePush,
  getPushInfo,
  isInstalled,
  isIos,
  permission,
  pushSupported,
  savePushPrefs,
  explainPushError,
  sendTestPush,
} from '../lib/push';
import { useToast } from './Toast';
import { Alert, Button, Card } from './ui';

const usePushInfo = () => useQuery({ queryKey: ['push', 'info'], queryFn: getPushInfo, staleTime: 5 * 60_000 });

/** Whether this device is getting notifications right now. */
function useDeviceOn(): [boolean | null, (on: boolean) => void] {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void currentSubscription().then((s) => live && setOn(!!s && permission() === 'granted'));
    return () => {
      live = false;
    };
  }, []);
  return [on, setOn];
}

function explainResult(r: Awaited<ReturnType<typeof enablePush>>): string | null {
  if (r === 'denied') return 'Notifications are blocked. Allow them for Siwu Connect in your browser or phone settings, then try again.';
  if (r === 'unsupported') return 'This browser cannot show notifications. Try Chrome.';
  if (r === 'unavailable') return 'Notifications are not available in this window. Open siwuconnect.com in Chrome (or the app) and try again.';
  return null;
}

/** Help for devices that cannot turn notifications on yet. */
function DeviceHelp() {
  if (isIos() && !isInstalled()) {
    return (
      <Alert kind="info">
        On iPhone and iPad, first add Siwu Connect to your Home Screen: tap <strong>Share</strong> →{' '}
        <strong>Add to Home Screen</strong>. Then open it from your Home Screen and turn notifications on here.
      </Alert>
    );
  }
  if (!pushSupported()) return <Alert kind="info">This browser cannot show notifications. Open Siwu Connect in Chrome, or install the app.</Alert>;
  if (permission() === 'denied') {
    return (
      <Alert kind="warning">
        Notifications are blocked for Siwu Connect on this device. To allow them: tap the <strong>lock</strong> (or ⓘ) next to the
        address → <strong>Notifications</strong> → <strong>Allow</strong>. In the app: phone <strong>Settings → Apps → Siwu Connect →
        Notifications</strong>. Then come back here.
      </Alert>
    );
  }
  return null;
}

/** Settings → Notifications: this device on/off, and which kinds to get (for all devices). */
export function PushSettingsCard() {
  const { user } = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const info = usePushInfo();
  const [deviceOn, setDeviceOn] = useDeviceOn();
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (info.data) setPrefs(info.data.prefs);
  }, [info.data]);

  const turnOn = async () => {
    if (!info.data?.publicKey) return;
    setBusy('on');
    setProblem(null);
    try {
      const r = await enablePush(user.uid, info.data.publicKey);
      if (r === 'on') {
        setDeviceOn(true);
        toast('Notifications are on for this device 🔔');
      } else setProblem(explainResult(r));
    } catch (e) {
      setProblem(explainPushError(e));
    } finally {
      setBusy(null);
    }
  };
  const turnOff = async () => {
    setBusy('off');
    await disablePush().catch(() => {});
    setDeviceOn(false);
    setBusy(null);
    toast('Notifications are off for this device.');
  };
  const test = async () => {
    setBusy('test');
    try {
      const r = await sendTestPush();
      toast(r.sent ? 'Sent! It should appear in a few seconds.' : 'No device is set up yet. Turn notifications on first.', r.sent ? 'success' : 'error');
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const change = async (next: PushPrefs) => {
    const before = prefs;
    setPrefs(next);
    try {
      await savePushPrefs(next);
      qc.setQueryData(['push', 'info'], (d: typeof info.data) => (d ? { ...d, prefs: next } : d));
    } catch (e) {
      setPrefs(before);
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-base font-bold text-gray-900">Phone notifications</h2>
      {info.isPending ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : info.isError ? (
        <Alert>{friendlyError(info.error)}</Alert>
      ) : !info.data.enabled ? (
        <Alert kind="info">Phone notifications are being set up. Check back soon.</Alert>
      ) : (
        <>
          <div className="space-y-2">
            <DeviceHelp />
            {problem && <Alert kind="warning">{problem}</Alert>}
            {deviceOn ? (
              <>
                <p className="text-sm font-semibold text-green-800">🔔 On for this device</p>
                <div className="flex flex-wrap gap-2">
                  <Button small variant="secondary" busy={busy === 'test'} onClick={test}>
                    Send a test notification
                  </Button>
                  <Button small variant="ghost" busy={busy === 'off'} onClick={turnOff}>
                    Turn off on this device
                  </Button>
                </div>
              </>
            ) : (
              pushSupported() &&
              permission() !== 'denied' &&
              !(isIos() && !isInstalled()) && (
                <>
                  <p className="text-sm text-gray-600">Get a notification on this phone or computer when something happens, even when Siwu Connect is closed.</p>
                  <Button small icon="bell" busy={busy === 'on'} onClick={turnOn}>
                    Turn on notifications
                  </Button>
                </>
              )
            )}
          </div>

          {prefs && (
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-bold text-gray-800">Notify me about</legend>
              {PUSH_CATEGORIES.filter((c) => c.id !== 'staff' || info.data.staff).map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={prefs[c.id]}
                    onChange={(e) => void change({ ...prefs, [c.id]: e.target.checked })}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand-800"
                  />
                  <span className="text-sm">
                    <span className="font-semibold text-gray-900">{c.label}</span>
                    <span className="block text-gray-500">{c.help}</span>
                  </span>
                </label>
              ))}
              <div>
                <p id="sports-follow" className="text-sm font-semibold text-gray-900">
                  Live matches
                </p>
                <p className="text-sm text-gray-500">Kick-off, goals and full time.</p>
                <div role="radiogroup" aria-labelledby="sports-follow" className="mt-2 flex flex-wrap gap-2">
                  {SPORTS_FOLLOW.map((o) => (
                    <label
                      key={o.id}
                      className={`cursor-pointer rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${
                        prefs.sports === o.id ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white text-gray-700 ring-sand-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="sports-follow"
                        className="sr-only"
                        checked={prefs.sports === o.id}
                        onChange={() => void change({ ...prefs, sports: o.id })}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Your choices apply to all your devices. Approvals and account news are always sent. Town chat rooms don’t send
                notifications.
              </p>
            </fieldset>
          )}
        </>
      )}
    </Card>
  );
}

const PROMPT_KEY = 'siwu.push.prompt';

/** A friendly "turn on notifications" card (home and notifications page) until the member decides. */
export function PushPrompt() {
  const { user } = useMe();
  const toast = useToast();
  const info = usePushInfo();
  const [deviceOn, setDeviceOn] = useDeviceOn();
  const [hidden, setHidden] = useState(() => {
    try {
      const t = Number(localStorage.getItem(PROMPT_KEY) ?? 0);
      return Date.now() - t < 14 * 86400_000; // "Not now" hides it for two weeks
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const iosHint = isIos() && !isInstalled();
  if (hidden || deviceOn !== false || !info.data?.enabled || !info.data.publicKey) return null;
  if (!iosHint && (!pushSupported() || permission() === 'denied')) return null;

  const later = () => {
    try {
      localStorage.setItem(PROMPT_KEY, String(Date.now()));
    } catch {
      // fine
    }
    setHidden(true);
  };
  const turnOn = async () => {
    setBusy(true);
    try {
      const r = await enablePush(user.uid, info.data.publicKey!);
      if (r === 'on') {
        setDeviceOn(true);
        toast('Notifications are on 🔔 Choose what you get in Settings.');
      } else {
        toast(explainResult(r)!, 'error');
        later();
      }
    } catch (e) {
      toast(explainPushError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-l-4 border-gold-400 p-4">
      <p className="font-bold text-gray-900">🔔 Don’t miss messages and goals</p>
      {iosHint ? (
        <p className="mt-1 text-sm text-gray-600">
          To get notifications on iPhone, tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open Siwu Connect from
          your Home Screen.
        </p>
      ) : (
        <p className="mt-1 text-sm text-gray-600">
          Turn on notifications to hear about new messages, friend requests, comments, announcements and your town’s matches.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {!iosHint && (
          <Button small icon="bell" busy={busy} onClick={turnOn}>
            Turn on
          </Button>
        )}
        <Button small variant="ghost" onClick={later}>
          {iosHint ? 'OK' : 'Not now'}
        </Button>
      </div>
    </Card>
  );
}

/** When a notification is tapped while the app is open, go to its page without reloading. */
export function usePushNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== 'siwu:navigate' || !d.url) return;
      const u = new URL(d.url, location.origin);
      if (u.origin === location.origin) navigate(u.pathname + u.search + u.hash);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
}
