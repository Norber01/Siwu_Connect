import { describe, expect, it } from 'vitest';
import { type KVLike, kvBucket } from '../src/kv-bucket';

function memoryKV(): KVLike {
  const store = new Map<string, { value: Uint8Array; metadata: Record<string, string> }>();
  return {
    async put(key, value, options) {
      store.set(key, { value: value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer), metadata: options?.metadata ?? {} });
    },
    async getWithMetadata<M>(key: string) {
      const v = store.get(key);
      return v ? { value: new Response(v.value).body!, metadata: v.metadata as M } : { value: null, metadata: null };
    },
    async delete(key) {
      store.delete(key);
    },
    async list(options) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(options?.prefix ?? '')).map((name) => ({ name })) };
    },
  };
}

describe('kvBucket', () => {
  it('stores, serves, lists and deletes photos like R2', async () => {
    const b = kvBucket(memoryKV());
    await b.put('images/u1/a.webp', new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: 'image/webp' } });
    await b.put('images/u1/b.webp', new Uint8Array([4]), { httpMetadata: { contentType: 'image/webp' } });
    await b.put('avatars/u1/c.jpg', new Uint8Array([5]), { httpMetadata: { contentType: 'image/jpeg' } });
    const got = await b.get('images/u1/a.webp');
    expect(got?.httpMetadata?.contentType).toBe('image/webp');
    expect(new Uint8Array((await new Response(got!.body).arrayBuffer()) as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect((await b.list({ prefix: 'images/u1/' })).objects.map((o) => o.key).sort()).toEqual(['images/u1/a.webp', 'images/u1/b.webp']);
    await b.delete(['images/u1/a.webp', 'images/u1/b.webp']);
    expect(await b.get('images/u1/a.webp')).toBeNull();
    expect((await b.list({ prefix: 'avatars/' })).objects).toHaveLength(1);
  });
});
