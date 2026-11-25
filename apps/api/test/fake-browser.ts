/** A pretend browser for notification tests: its keys, and decryption exactly as RFC 8291 describes. */
import { expect } from 'vitest';
import { b64urlEncode } from '../src/webpush';

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** A fake browser: its key pair and auth secret, plus the receiving side of RFC 8291. */
export async function fakeBrowser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) },
    async decrypt(body: Uint8Array): Promise<string> {
      const salt = body.slice(0, 16);
      const idlen = body[20]!;
      const asPublic = body.slice(21, 21 + idlen);
      const cipher = body.slice(21 + idlen);
      const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, pair.privateKey, 256));
      const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...pub, ...asPublic]);
      const ikm = await hkdf(auth, shared, info, 32);
      const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
      const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
      expect(plain[plain.length - 1]).toBe(2); // last-record delimiter
      return new TextDecoder().decode(plain.slice(0, -1));
    },
  };
}

