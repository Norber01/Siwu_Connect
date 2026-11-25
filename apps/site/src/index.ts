import { FILES } from './files.gen';

const decoded = new Map<string, Uint8Array>();
function body(path: string): Uint8Array {
  let b = decoded.get(path);
  if (!b) {
    const bin = atob(FILES[path]!.b64);
    b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    decoded.set(path, b);
  }
  return b;
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  // Microphone: voice notes and word pronunciations. Camera: photos are picked through the phone's own camera app.
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=()',
};

/** Android app (Google Play) that opens this website full-screen. Its package name never changes once published. */
export const ANDROID_PACKAGE = 'com.siwuconnect.app';

/**
 * Digital Asset Links: proves to Android that the Play Store app and this website belong together, so the app
 * opens the site full-screen without a browser bar. The SHA-256 fingerprints come from Play Console
 * (Setup → App integrity → App signing) and are set in wrangler.toml as ANDROID_CERT_SHA256 (comma separated).
 */
export function assetLinks(fingerprints: string | undefined): unknown[] {
  const certs = (fingerprints ?? '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (!certs.length) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: certs },
    },
  ];
}

/**
 * Google sign-in helper pages (/__/auth/…, /__/firebase/…) are passed through from Firebase, so sign-in happens on
 * siwuconnect.com instead of showing the Firebase address (Firebase's recommended setup for a custom domain).
 * Their own headers are kept: the sign-in helper must be allowed to load inside the app's page.
 */
export function proxyFirebaseAuth(request: Request, authHost: string): Promise<Response> {
  const url = new URL(request.url);
  return fetch(new Request(`https://${authHost}${url.pathname}${url.search}`, request));
}

interface SiteEnv {
  ANDROID_CERT_SHA256?: string;
  /** e.g. "siwu-connect-cadd9.firebaseapp.com" */
  FIREBASE_AUTH_HOST?: string;
}

/** Serves the Siwu Connect web app. Unknown paths get index.html (client-side routing). */
export default {
  fetch(request: Request, env: SiteEnv = {}): Response | Promise<Response> {
    const url = new URL(request.url);
    if (env.FIREBASE_AUTH_HOST && (url.pathname.startsWith('/__/auth/') || url.pathname.startsWith('/__/firebase/'))) {
      return proxyFirebaseAuth(request, env.FIREBASE_AUTH_HOST);
    }
    if (url.hostname === 'www.siwuconnect.com') {
      url.hostname = 'siwuconnect.com';
      return new Response(null, { status: 301, headers: { location: url.toString(), ...SECURITY_HEADERS } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    // The old workers.dev address keeps working, but only siwuconnect.com should appear in Google.
    if (url.pathname === '/robots.txt' && url.hostname.endsWith('.workers.dev')) {
      return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS } });
    }
    if (url.pathname === '/.well-known/assetlinks.json') {
      return new Response(JSON.stringify(assetLinks(env.ANDROID_CERT_SHA256)), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', ...SECURITY_HEADERS },
      });
    }
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!FILES[path]) path = '/index.html';
    const file = FILES[path]!;
    const immutable = path.startsWith('/assets/');
    const noCache = path === '/index.html' || path === '/sw.js' || path.startsWith('/workbox-') || path.endsWith('.webmanifest');
    return new Response(request.method === 'HEAD' ? null : body(path), {
      headers: {
        'content-type': file.type,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : noCache ? 'no-cache' : 'public, max-age=3600',
        ...SECURITY_HEADERS,
      },
    });
  },
};
