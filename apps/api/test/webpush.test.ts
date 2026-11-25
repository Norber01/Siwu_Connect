/**
 * Web Push encryption and VAPID: decrypts what the sender produces exactly as a browser would (RFC 8291),
 * and checks the VAPID signature (RFC 8292).
 */
import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, vapidAuthorization } from '../src/webpush';
import { fakeBrowser } from './fake-browser';

const enc = new TextEncoder();

describe('web push', () => {
  it('encrypts so that only the browser can read the message', async () => {
    const browser = await fakeBrowser();
    const body = await encryptPayload(browser.keys, enc.encode('{"title":"Akwaaba 👋"}'));
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(await browser.decrypt(body)).toBe('{"title":"Akwaaba 👋"}');
    // Every message uses fresh keys and salt.
    const again = await encryptPayload(browser.keys, enc.encode('{"title":"Akwaaba 👋"}'));
    expect(b64urlEncode(again.slice(0, 16))).not.toBe(b64urlEncode(body.slice(0, 16)));
  });

  it('matches the worked example in RFC 8291 (Appendix A)', async () => {
    const asPublic = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
    const pub = b64urlDecode(asPublic);
    const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)), ext: true };
    const keys = {
      privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' }, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    } as CryptoKeyPair;
    const body = await encryptPayload(
      { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      enc.encode('When I grow up, I want to be a watermelon'),
      { keys, salt: b64urlDecode('DGv6ra1nlYgDCS1FRnbzlw') },
    );
    expect(b64urlEncode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('signs a VAPID token for the push service', async () => {
    const keys = await generateVapidKeys();
    expect(b64urlDecode(keys.publicKey)).toHaveLength(65);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'mailto:privacy@siwuconnect.com' }, 1_700_000_000_000);
    const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]!)));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:privacy@siwuconnect.com' });
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(m[3]!), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});
