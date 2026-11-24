/**
 * Tests the production path of the one-time setup against a simulated Google API
 * (the real Google services cannot be reached from tests).
 */
import { exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { FIRESTORE_INDEXES } from '../src/generated/firebase-assets';
import { runSetup } from '../src/setup';

async function prodEnv(): Promise<Env> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  return {
    FIREBASE_PROJECT_ID: 'siwu-test',
    ALLOWED_ORIGINS: 'https://siwu-connect.pages.dev',
    PUBLIC_API_URL: 'https://api.example.com',
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa@siwu-test.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey) }),
    FOUNDER_EMAIL: 'founder@example.com',
    AVATARS: {} as Env['AVATARS'],
  };
}

const caller = { uid: 'founder', email: 'founder@example.com', emailVerified: true };

function fakeGoogle(opts: { indexStatus?: number; rulesFail?: boolean } = {}) {
  const calls: string[] = [];
  let configPatch: unknown = null;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.replace(/\?.*/, '')}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('firebaserules') && url.endsWith('/rulesets'))
      return opts.rulesFail ? json({ error: { message: 'Permission denied' } }, 403) : json({ name: 'projects/siwu-test/rulesets/abc' });
    if (url.includes('firebaserules') && method === 'PATCH') return json({}, 404);
    if (url.includes('firebaserules') && url.endsWith('/releases')) return json({ name: 'ok' });
    if (url.includes('/collectionGroups/')) return json({}, opts.indexStatus ?? 200);
    if (url.includes('identitytoolkit') && method === 'GET') return json({ authorizedDomains: ['localhost', 'siwu-test.firebaseapp.com'] });
    if (url.includes('identitytoolkit') && method === 'PATCH') {
      configPatch = JSON.parse(String(init?.body));
      return json({});
    }
    if (url.endsWith(':runQuery')) return json([]);
    if (url.endsWith(':commit')) return json({});
    if (url.includes('/documents/chats/')) return json({ error: { message: 'not found' } }, 404);
    return json({ error: { message: `unexpected ${url}` } }, 500);
  });
  return { calls, configPatch: () => configPatch };
}

afterEach(() => vi.unstubAllGlobals());

describe('setup against Google APIs', () => {
  it('installs rules, indexes, towns, domain and Super Admin', async () => {
    const g = fakeGoogle();
    const result = await runSetup(await prodEnv(), caller);
    expect(result.steps.map((s) => [s.id, s.ok])).toEqual([
      ['credentials', true],
      ['rules', true],
      ['indexes', true],
      ['towns', true],
      ['search', true],
      ['domains', true],
      ['superAdmin', true],
    ]);
    expect(g.calls.filter((c) => c.includes('/collectionGroups/'))).toHaveLength(FIRESTORE_INDEXES.length);
    expect(g.calls).toContain('POST https://firebaserules.googleapis.com/v1/projects/siwu-test/releases'); // created after 404
    expect(g.configPatch()).toEqual({ authorizedDomains: ['localhost', 'siwu-test.firebaseapp.com', 'siwu-connect.pages.dev'] });
  });

  it('treats existing indexes as fine and reports failures clearly', async () => {
    fakeGoogle({ indexStatus: 409 });
    let result = await runSetup(await prodEnv(), caller);
    expect(result.steps.find((s) => s.id === 'indexes')).toMatchObject({ ok: true, detail: expect.stringContaining('already existed') });

    vi.unstubAllGlobals();
    fakeGoogle({ rulesFail: true });
    result = await runSetup(await prodEnv(), caller);
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.id === 'rules')).toMatchObject({ ok: false, detail: expect.stringContaining('Permission denied') });
  });

  it('runs in parts small enough for Cloudflare', async () => {
    const g = fakeGoogle();
    const core = await runSetup(await prodEnv(), caller, 'core');
    expect(core.steps.map((s) => s.id)).toEqual(['credentials', 'rules', 'towns', 'search', 'domains', 'superAdmin']);
    expect(g.calls.filter((c) => c.includes('/collectionGroups/'))).toHaveLength(0);
    let from: number | null | undefined = 0;
    let calls = 0;
    while (from !== null && from !== undefined) {
      const before = g.calls.length;
      const part = await runSetup(await prodEnv(), caller, 'indexes', from);
      expect(part.steps.map((s) => s.id)).toEqual(['credentials', 'indexes']);
      expect(g.calls.length - before).toBeLessThan(45);
      from = part.next;
      calls++;
    }
    expect(calls).toBe(Math.ceil(FIRESTORE_INDEXES.length / 20));
    expect(g.calls.filter((c) => c.includes('/collectionGroups/'))).toHaveLength(FIRESTORE_INDEXES.length);
  });

  it('stops early with a helpful message when the key is missing', async () => {
    fakeGoogle();
    const env = { ...(await prodEnv()), GOOGLE_SERVICE_ACCOUNT_JSON: undefined };
    const result = await runSetup(env, caller);
    expect(result.steps).toEqual([{ id: 'credentials', label: 'Firebase key', ok: false, detail: 'The Firebase key has not been added in Cloudflare yet.' }]);
  });
});
