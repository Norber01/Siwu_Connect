import { FirebaseError } from 'firebase/app';
import { ApiError } from './errors';

/** Turns any error into a short message a user can act on. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case 'permission-denied':
        return "You don't have permission to do that.";
      case 'unavailable':
      case 'auth/network-request-failed':
        return 'You seem to be offline. Check your connection and try again.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-login-credentials':
        return 'Email or password is incorrect.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists. Try signing in instead.';
      case 'auth/weak-password':
        return 'Choose a stronger password (at least 8 characters).';
      case 'auth/invalid-email':
        return 'That email address does not look right.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a few minutes and try again.';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return 'Sign-in was cancelled.';
      case 'auth/account-exists-with-different-credential':
        return 'This email is already registered with a different sign-in method.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

export function isPermissionDenied(e: unknown): boolean {
  return e instanceof FirebaseError && e.code === 'permission-denied';
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(date: Date | null, now = Date.now()): string {
  if (!date) return 'just now';
  const s = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}

export function fullDate(date: Date | null): string {
  return date ? date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/** Splits text into plain strings and safe links (rendered by React, never as HTML). */
export function linkify(text: string): Array<{ text: string; href?: string }> {
  const parts: Array<{ text: string; href?: string }> = [];
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], href: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * Resizes and crops an image to a square WebP (falls back to JPEG) under the
 * size limit, entirely on the device — saves the user's mobile data.
 */
export async function prepareAvatar(file: File, size: number, maxBytes: number): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This image could not be read. Try a JPEG or PNG.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  for (const [type, quality] of [
    ['image/webp', 0.85],
    ['image/webp', 0.7],
    ['image/jpeg', 0.8],
    ['image/jpeg', 0.6],
  ] as const) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
    if (blob && blob.type === type && blob.size <= maxBytes) return blob;
  }
  throw new Error('This image is too large. Try a different photo.');
}
