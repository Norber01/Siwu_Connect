export interface Env {
  /** Firebase project id, e.g. "siwu-connect-prod". */
  FIREBASE_PROJECT_ID: string;
  /** Comma-separated list of web origins allowed to call the API. */
  ALLOWED_ORIGINS: string;
  /** Public base URL of this Worker, used to build avatar URLs. */
  PUBLIC_API_URL: string;
  /** Secret: full JSON of a Google service account with Firestore + Firebase Auth admin access. */
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  /** Local development only — never set in production. */
  FIRESTORE_EMULATOR_HOST?: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  /** R2 bucket for profile photos. */
  AVATARS: R2BucketLike;
}

/** The subset of the R2 binding we use (lets tests provide an in-memory fake). */
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string }[] }>;
}

/**
 * Emulator mode is allowed only for Firebase "demo-" projects, which can never
 * reach real Firebase resources. This makes it impossible to accidentally accept
 * unsigned emulator tokens in production.
 */
export function isEmulator(env: Env): boolean {
  return !!env.FIREBASE_AUTH_EMULATOR_HOST && env.FIREBASE_PROJECT_ID.startsWith('demo-');
}
