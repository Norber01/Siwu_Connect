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

/** Serves the Siwu Connect web app. Unknown paths get index.html (client-side routing). */
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
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
