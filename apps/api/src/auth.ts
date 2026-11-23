import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { type Env, isEmulator } from './env';
import { googleAccessToken } from './google-auth';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export interface Caller {
  uid: string;
}

/** Verifies a Firebase Authentication ID token (signature, issuer, audience, expiry). */
export async function verifyIdToken(token: string, env: Env): Promise<Caller> {
  if (isEmulator(env)) {
    // Auth emulator tokens are unsigned; accepted only for demo-* projects.
    const claims = decodeJwt(token);
    if (claims.aud !== env.FIREBASE_PROJECT_ID || typeof claims.sub !== 'string' || !claims.sub) {
      throw new Error('invalid emulator token');
    }
    return { uid: claims.sub };
  }
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    audience: env.FIREBASE_PROJECT_ID,
    algorithms: ['RS256'],
  });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('token has no subject');
  if (typeof payload.auth_time === 'number' && payload.auth_time > Math.floor(Date.now() / 1000) + 300) {
    throw new Error('auth_time in the future');
  }
  return { uid: payload.sub };
}

/** Deletes a Firebase Authentication account (used for account deletion). */
export async function deleteAuthUser(env: Env, uid: string): Promise<void> {
  const base = env.FIREBASE_AUTH_EMULATOR_HOST
    ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com';
  const token = isEmulator(env) ? 'owner' : await googleAccessToken(env);
  const res = await fetch(`${base}/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:delete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  if (res.ok) return;
  const text = await res.text();
  if (res.status === 404 || text.includes('USER_NOT_FOUND')) return; // already gone
  throw new Error(`Failed to delete auth user (${res.status})`);
}
