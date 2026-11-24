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
