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
