import type { R2BucketLike } from './env';

/** The subset of a Workers KV namespace we use. */
export interface KVLike {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { metadata?: Record<string, string> }): Promise<void>;
  getWithMetadata<M = Record<string, string>>(
    key: string,
    type: 'stream',
  ): Promise<{ value: ReadableStream | null; metadata: M | null }>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

/**
 * Stores photos in Workers KV (free plan, no payment card needed) behind the same
 * interface as R2. Used until an R2 bucket is enabled; then bind AVATARS to R2 instead.
 * KV values can be up to 25 MB; our photos are at most 400 KB.
 */
export function kvBucket(kv: KVLike): R2BucketLike {
  return {
    async put(key, value, options) {
      await kv.put(key, value, { metadata: { contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream' } });
    },
    async get(key) {
      const { value, metadata } = await kv.getWithMetadata<{ contentType?: string }>(key, 'stream');
      return value ? { body: value, httpMetadata: { contentType: metadata?.contentType } } : null;
    },
    async delete(keys) {
      await Promise.all((Array.isArray(keys) ? keys : [keys]).map((k) => kv.delete(k)));
    },
    async list(options) {
      const res = await kv.list({ prefix: options?.prefix, limit: Math.min(options?.limit ?? 1000, 1000) });
      return { objects: res.keys.map((k) => ({ key: k.name })) };
    },
  };
}
