/**
 * Phone and computer notifications (Web Push).
 *
 * - When the app saves something that may notify others (a message, a comment, a goal…) it tells the server,
 *   which checks it and notifies the right people (see apps/api/src/push.ts).
 * - Each device turns notifications on once (the browser asks for permission), and is kept up to date
 *   when the app opens. Signing out stops that device getting the member's notifications.
 */
import type { PushPrefs } from '@siwu/shared';
import { api } from './api';
import { ApiError } from './errors';
import { setPushPing } from './ops';

setPushPing((kind, path, event) => {
  void api('/push/notify', { json: { kind, path, ...(event ? { event } : {}) } }).catch(() => {
    // Best effort: the message or comment itself is already saved.
  });
});

export interface PushInfo {
  /** False until the server has notification keys. */
  enabled: boolean;
  publicKey: string | null;
  prefs: PushPrefs;
  /** Admins and moderators can choose "Reports and approvals". */
  staff: boolean;
}

export const getPushInfo = () => api<PushInfo>('/push/prefs', { method: 'GET' });
export const savePushPrefs = (prefs: PushPrefs) => api('/push/prefs', { json: prefs });
export const sendTestPush = () => api<{ sent: number }>('/push/test', { json: {} });

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function permission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) return reg;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await registration();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

function keyBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const SYNC_KEY = 'siwu.push.synced';
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // private mode: fine
    }
  },
};

async function register(sub: PushSubscription, uid: string): Promise<void> {
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/push/subscribe', { json: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } } });
  store.set(SYNC_KEY, `${uid}|${new Date().toDateString()}`);
}

export type EnableResult = 'on' | 'denied' | 'unsupported' | 'unavailable';

/** Asks the browser for permission (must be called from a tap) and registers this device. */
export async function enablePush(uid: string, publicKey: string): Promise<EnableResult> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await registration();
  if (!reg) return 'unavailable';
  let sub = await reg.pushManager.getSubscription();
  const key = keyBytes(publicKey);
  const sameKey = (s: PushSubscription) => {
    const k = s.options?.applicationServerKey;
    if (!k) return true;
    const a = new Uint8Array(k);
    return a.length === key.length && a.every((b, i) => b === key[i]);
  };
  if (sub && !sameKey(sub)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await register(sub, uid);
  return 'on';
}

/** A clear explanation (with the technical reason in brackets, to help fix it) when turning on fails. */
export function explainPushError(e: unknown): string {
  const name = e instanceof Error || e instanceof DOMException ? e.name : '';
  const msg = e instanceof Error || e instanceof DOMException ? e.message : String(e);
  const detail = ` (${[name, msg].filter(Boolean).join(': ').slice(0, 160)})`;
  if (e instanceof ApiError) return msg;
  if (name === 'NotAllowedError') return `Notifications are blocked for Siwu Connect on this phone. Allow them in the phone or browser settings, then try again.${detail}`;
  if (name === 'AbortError' || /push service/i.test(msg)) {
    return `This phone could not reach its notification service. This happens on phones without Google services (some Huawei phones) and in browsers such as Brave or Opera with notifications switched off. Try Chrome, and check you are online.${detail}`;
  }
  if (name === 'InvalidStateError') return `Please close Siwu Connect completely, open it again and try once more.${detail}`;
  return `Could not turn on notifications.${detail}`;
}

/** Stops notifications on this device. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { json: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => false);
  store.set(SYNC_KEY, null);
}

/** On app start: keeps this device registered (once a day, after a hometown change, or for a new account). */
export async function syncPush(uid: string, force = false): Promise<void> {
  if (permission() !== 'granted') return;
  const sub = await currentSubscription();
  if (!sub) return;
  if (!force && store.get(SYNC_KEY) === `${uid}|${new Date().toDateString()}`) return;
  await register(sub, uid).catch(() => {});
}

/** Before signing out: this device stops getting the member's notifications. */
export async function forgetDevice(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await Promise.race([api('/push/unsubscribe', { json: { endpoint: sub.endpoint } }), new Promise((r) => setTimeout(r, 3000))]);
    await sub.unsubscribe();
  } catch {
    // best effort
  }
  store.set(SYNC_KEY, null);
}
