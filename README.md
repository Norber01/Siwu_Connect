# Siwu Connect

A community platform for the four Siwu-speaking Akpafu towns — Akpafu Odomi, Akpafu Mempeasem,
Akpafu Todzi and Akpafu Adokor — for residents, Ghanaians elsewhere and the diaspora.

**Stage:** Phase 1 (text-first MVP) built and tested locally. Not yet deployed — see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

- Product brief: [`docs/Siwu_Connect_Product_and_Development_Brief.docx`](docs/Siwu_Connect_Product_and_Development_Brief.docx)
- Phase 1 plan & architecture: [`docs/PHASE1_PLAN.md`](docs/PHASE1_PLAN.md)
- Project log, decisions, known issues: [`PROJECT_LOG.md`](PROJECT_LOG.md)

## What's in Phase 1

Registration & login (email/password, Google, password reset) · onboarding with hometown and optional
residence · four town feeds + an Akpafu-wide feed · text posts (create/edit/delete, town-only option) ·
likes (one per person) and comments · profiles with optional photo · search (posts and people, town filter) ·
announcements and pinned posts · report and block · admin area (reports queue, suspensions, announcements,
roles, audit log) · installable mobile-first web app (PWA).

## Repository layout

```
apps/web/          React + TypeScript PWA (Vite, Tailwind, TanStack Query)
apps/api/          Cloudflare Worker: admin actions, photo uploads, account deletion
packages/shared/   towns, limits, validation schemas, role permissions (used by web + API)
firebase/          Firestore security rules and indexes
tests/rules/       security-rules tests (Firestore emulator)
tests/e2e/         Playwright end-to-end tests (mobile + desktop)
scripts/           admin CLI (seed towns, grant Super Admin), icon generator
```

## Run it locally

Requirements: Node.js 22+, Java 21+ (for the Firebase emulators).

```bash
npm install

# Terminal 1 — Firebase Auth + Firestore emulators (no real data, project "demo-siwu")
npm run emulators

# Terminal 2 — add the four town records, then start the API Worker
npm run seed:emulator
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run dev:api            # http://localhost:8787

# Terminal 3 — the web app
npm run dev                # http://127.0.0.1:5173
```

Sign up in the app, then make yourself Super Admin:

```bash
npm run admin -- grant-super-admin <your_username>
```

The emulator UI (view data, users) is at http://127.0.0.1:4000.

To fill the local emulator with clearly fictional sample posts for demos/screenshots:
`node scripts/demo-data.mjs` (sign in as `demo_admin@example.com` / `demo-password-1`). It wipes the emulator first.

## Tests

```bash
npm run lint
npm run typecheck
npm run test:unit       # shared logic + web utilities
npm run test:emulator   # security rules (30) + API (18) against the Firebase emulators
npm run test:e2e        # full user journeys in Chromium, mobile and desktop (starts all servers)
```

All of these run in GitHub Actions on every push (`.github/workflows/ci.yml`).
