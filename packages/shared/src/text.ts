import { LIMITS } from './constants';

/**
 * Builds lowercase search tokens for basic keyword search in Firestore
 * (`array-contains`). Accents are stripped so "Akpafú" matches "akpafu".
 */
export function searchTokens(...texts: string[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    for (const word of normalize(text).split(/[^a-z0-9]+/)) {
      if (word.length >= 2 && word.length <= 30) seen.add(word);
      if (seen.size >= LIMITS.searchTokensMax) return [...seen];
    }
  }
  return [...seen];
}

/**
 * Search keys for a member: every beginning (2+ letters) of every word of their name and of their
 * username, so typing part of any name ("ser" → Ama Serwaa) finds them.
 */
export function nameTokens(displayName: string, username: string): string[] {
  const seen = new Set<string>();
  const words = [...normalize(displayName).split(/[^a-z0-9]+/), ...normalize(username).split(/[^a-z0-9]+/), normalize(username)];
  for (const w of words) {
    for (let i = 2; i <= Math.min(w.length, 20); i++) {
      seen.add(w.slice(0, i));
      if (seen.size >= 100) return [...seen];
    }
  }
  return [...seen];
}

export function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Collapses runs of blank lines and trims; keeps single line breaks. */
export function cleanMultiline(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function cleanSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
