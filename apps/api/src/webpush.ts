/**
 * Standard Web Push (RFC 8030) sent straight from the Worker, with message encryption (RFC 8291, "aes128gcm")
 * and VAPID sender identification (RFC 8292). Works with Chrome/Android (and the Play Store app), Edge, Firefox
 * and iPhone home-screen apps. Uses only WebCrypto, so it runs on Cloudflare Workers and in Node tests.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's public key (base64url, 65 bytes uncompressed P-256). */
  p256dh: string;
  /** The browser's 16-byte auth secret (base64url). */
  auth: string;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 public key (also given to browsers as applicationServerKey). */
  publicKey: string;
  /** base64url, 32-byte private scalar "d". Secret. */
  privateKey: string;
  /** Contact for push services, e.g. "mailto:privacy@siwuconnect.com". */
  subject: string;
}

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts one message for one browser (RFC 8291). Returns the request body (header + single record). */
export async function encryptPayload(
  sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  payload: Uint8Array,
  /** Tests only: fixed sender keys and salt, to compare with the example in RFC 8291. */
  fixed?: { keys: CryptoKeyPair; salt: Uint8Array },
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Invalid subscription keys');
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const local = fixed?.keys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the message followed by the last-record delimiter 0x02.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const rs = 4096;
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, 65]), asPublic);
  return concat(header, cipher);
}

const signingKeys = new Map<string, Promise<CryptoKey>>();
function vapidSigningKey(v: VapidKeys): Promise<CryptoKey> {
  let k = signingKeys.get(v.privateKey);
  if (!k) {
    const pub = b64urlDecode(v.publicKey);
    k = crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), d: v.privateKey, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    signingKeys.set(v.privateKey, k);
  }
  return k;
}

/** The VAPID "Authorization" header for a push service (one JWT per push service origin, valid 12 hours). */
export async function vapidAuthorization(endpoint: string, v: VapidKeys, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidSigningKey(v), enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64urlEncode(sig)}, k=${v.publicKey}`;
}

export type SendResult = 'sent' | 'gone' | 'failed';

/**
 * Sends one push. "gone" means the browser unsubscribed (or the app was uninstalled): delete the subscription.
 */
export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
  v: VapidKeys,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string } = {},
): Promise<SendResult> {
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
    const headers: Record<string, string> = {
      authorization: await vapidAuthorization(sub.endpoint, v),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(opts.ttl ?? 86400),
      urgency: opts.urgency ?? 'normal',
    };
    if (opts.topic) headers.topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) {
      console.warn(`Push failed ${res.status} for ${new URL(sub.endpoint).host}: ${(await res.text()).slice(0, 200)}`);
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.warn('Push failed', e);
    return 'failed';
  }
}

/** Makes a new VAPID key pair (used once, by scripts/gen-vapid-keys.mjs, and in tests). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d! };
}
