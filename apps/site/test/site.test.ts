/**
 * Checks the security headers the live website sends. Guards against mistakes like switching off the
 * microphone for the whole site (which silently broke voice notes once).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/files.gen', () => ({
  FILES: {
    '/index.html': { type: 'text/html; charset=utf-8', b64: btoa('<!doctype html><title>Siwu</title>') },
    '/sw.js': { type: 'text/javascript', b64: btoa('self') },
    '/assets/app-abc.js': { type: 'text/javascript', b64: btoa('1') },
  },
}));

const site = (await import('../src/index')).default;
const get = (path: string, method = 'GET') => site.fetch(new Request(`https://siwu.example${path}`, { method }));

describe('domain', () => {
  it('www.siwuconnect.com sends visitors to siwuconnect.com, keeping the page', () => {
    const r = site.fetch(new Request('https://www.siwuconnect.com/p/abc?x=1'));
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('https://siwuconnect.com/p/abc?x=1');
    expect(site.fetch(new Request('https://siwuconnect.com/')).status).toBe(200);
  });
});

describe('website security headers', () => {
  it('allow the microphone and camera for the site itself and nothing else', () => {
    const policy = get('/').headers.get('permissions-policy') ?? '';
    expect(policy).toContain('microphone=(self)');
    expect(policy).toContain('camera=(self)');
    expect(policy).not.toMatch(/microphone=\(\)/);
    expect(policy).toContain('geolocation=()');
  });

  it('cannot be framed by other sites and do not let browsers guess file types', () => {
    const h = get('/chat').headers;
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('pages and the service worker are never cached for long; built files are', () => {
    expect(get('/').headers.get('cache-control')).toBe('no-cache');
    expect(get('/sw.js').headers.get('cache-control')).toBe('no-cache');
    expect(get('/assets/app-abc.js').headers.get('cache-control')).toContain('immutable');
  });

  it('serves the app for any page address and refuses writes', async () => {
    const res = get('/u/someone');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Siwu');
    expect(get('/', 'POST').status).toBe(405);
  });
});

describe('Android app link (Google Play)', () => {
  const fp = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
  it('lists the app only when a valid fingerprint is set', async () => {
    const empty = await site.fetch(new Request('https://siwu.example/.well-known/assetlinks.json'), {});
    expect(await empty.json()).toEqual([]);
    const res = await site.fetch(new Request('https://siwu.example/.well-known/assetlinks.json'), { ANDROID_CERT_SHA256: `${fp}, not-a-fingerprint` });
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = (await res.json()) as { target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
    expect(body[0]!.target).toEqual({ namespace: 'android_app', package_name: 'com.siwuconnect.app', sha256_cert_fingerprints: [fp] });
  });
});
