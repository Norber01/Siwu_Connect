#!/usr/bin/env node
/* global btoa */
/**
 * Makes a new key pair for phone notifications (Web Push "VAPID" keys). Run once per environment:
 *   node scripts/gen-vapid-keys.mjs
 * Put the PUBLIC key in apps/api/wrangler.toml (VAPID_PUBLIC_KEY) and store the PRIVATE key as a Worker secret:
 *   npx wrangler secret put VAPID_PRIVATE_KEY --env production   (paste it when asked; never commit it)
 * Changing the keys later means every device has to turn notifications on again.
 */
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const pub = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
