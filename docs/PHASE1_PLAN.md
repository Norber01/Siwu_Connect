# Siwu Connect — Phase 1 Plan

Status: **Approved and implemented (2026-11-23).** See PROJECT_LOG.md for decisions and progress.
Source: `docs/Siwu_Connect_Product_and_Development_Brief.docx` (sections 4, 8–15).

Phase 1 = a text-first community platform for the five Akpafu towns (Akpafu Sokpo added 2026-11-23): registration,
profiles, five town feeds, an Akpafu-wide feed, text posts, reactions, comments,
announcements, reporting/blocking and a small admin/moderation area.
Explicitly **out**: video, livestreaming, private chat, stories, marketplace,
sports centre, payments, monetisation.

---

## 1. Architecture

```
 ┌─────────────────────────────┐        ┌──────────────────────────────┐
 │  Web app (PWA)              │        │  Firebase (Spark/free plan)   │
 │  React + TypeScript + Vite  │──────▶ │  • Authentication            │
 │  hosted on Cloudflare Pages │  SDK   │  • Cloud Firestore + rules   │
 └──────────────┬──────────────┘        └──────────────▲───────────────┘
                │ HTTPS + Firebase ID token             │ Admin access
                ▼                                       │ (service account)
 ┌─────────────────────────────┐                        │
 │  API — Cloudflare Worker    │────────────────────────┘
 │  (privileged actions only)  │──────▶ Cloudflare R2 (profile photos)
 └─────────────────────────────┘
```

**Two paths for writes:**

| Path | Used for | Enforced by |
|---|---|---|
| Direct Firestore SDK | Own profile, own posts/comments, reactions, reports, blocks, reading feeds | Firestore Security Rules (server-side) |
| Cloudflare Worker API | Role assignment, suspensions, removing others' content, resolving reports, publishing/pinning announcements, photo upload URLs | Worker checks verified ID token + `admin_roles`, writes an `audit_logs` entry in the same batch |

Why this split: ordinary actions stay fast and free (no server hop); every privileged
action goes through one small audited server endpoint. Using a Worker instead of
Cloud Functions keeps Firebase on the free Spark plan (Functions require the
pay-as-you-go Blaze plan) and matches the founder's Cloudflare preference.

### Stack

- **Frontend:** React 18 + TypeScript, Vite, React Router, TanStack Query,
  Tailwind CSS with a small in-house component set, `vite-plugin-pwa`.
- **Shared package:** TypeScript types, town constants, `zod` validation schemas
  used by both web and Worker (one definition of "a valid post").
- **API:** Cloudflare Worker (Hono), `jose` for Firebase ID-token verification,
  Firestore REST API with a service-account credential stored as a Worker secret.
- **Images:** client-side resize to ≤ 256 px WebP before upload → R2 via a short-lived
  signed URL issued by the Worker. Hard size limit (e.g. 200 KB).
- **Anti-spam:** posting/commenting cooldowns enforced in security rules; Firebase's built-in sign-up protection. (Turnstile deferred — see PROJECT_LOG.)
- **Testing:** Vitest (unit), `@firebase/rules-unit-testing` against the Firestore
  emulator (security rules), Playwright (end-to-end, mobile + desktop viewports).
- **CI:** GitHub Actions — lint, typecheck, unit tests, rules tests on every push.

### Repository layout (npm workspaces)

```
apps/web/          React PWA
apps/api/          Cloudflare Worker
packages/shared/   types, towns, zod schemas
firebase/          firestore.rules, firestore.indexes.json, emulator config
tests/rules/       security-rules tests
tests/e2e/         Playwright tests
docs/              brief, this plan, community rules, privacy notice drafts
PROJECT_LOG.md     running log (tasks, decisions, bugs, next steps)
```

---

## 2. Screen map

| Route | Screen | Auth |
|---|---|---|
| `/welcome` | Landing: what Siwu Connect is, sign in / join | public |
| `/register`, `/login`, `/forgot-password` | Auth flows | public |
| `/onboarding` | Display name, username, hometown, optional residence/country, optional photo, accept community rules | signed-in |
| `/` | **Home**: pinned announcements + feed with toggle *My town / All Akpafu* | signed-in |
| `/towns` | The five towns | signed-in |
| `/towns/:townId` | One town's feed + its announcements | signed-in |
| `/new` | **Create post** (choose town, text, visibility) | signed-in |
| `/p/:postId` | Post detail, comments, react, report | signed-in |
| `/u/:username` | **Profile**: name, username, hometown, photo, public posts; block/report | signed-in |
| `/search` | Search users & posts, town filter | signed-in |
| `/settings` | Edit profile, blocked users, sign out, delete account | signed-in |
| `/rules`, `/privacy` | Community rules, privacy notice | public |
| `/admin` | Reports queue, users (suspend/restore), announcements, pins | moderator / town admin |
| `/admin/roles`, `/admin/audit` | Role assignment, audit log | super admin |

Bottom navigation (mobile): **Home · Towns · Create · Profile** (Notifications added when it exists — no dead tab).
Every screen implements loading, empty, error and permission-denied states.

---

## 3. Data model (Cloud Firestore)

Stable town IDs: `odomi`, `mempeasem`, `todzi`, `adokor`, `sokpo`. Display names live in `towns/*`.

```
towns/{townId}
  name, shortName, order, active

users/{uid}                       — PUBLIC profile
  displayName, username, usernameLower, photoUrl|null,
  hometownId, residence: 'hometown'|'ghana'|'abroad'|null, countryCode|null,
  status: 'active'|'suspended', createdAt, updatedAt
users/{uid}/blocks/{blockedUid}   — createdAt   (private to owner)

users_private/{uid}               — PRIVATE (owner + super admin only)
  rulesAcceptedAt, privacyAcceptedAt, createdAt
  (email stays in Firebase Auth; not duplicated)

usernames/{usernameLower}         — { uid }  guarantees unique usernames

posts/{postId}
  authorId, author: {displayName, username, photoUrl}   (denormalised snapshot)
  townId, text (1–2000 chars), visibility: 'akpafu'|'town',
  status: 'published'|'removed', pinned: bool,
  reactionCount, commentCount, searchTokens[],
  createdAt, updatedAt, editedAt|null
posts/{postId}/comments/{commentId}
  authorId, author{...}, text (1–1000), status, createdAt, updatedAt
posts/{postId}/reactions/{uid}    — { type, createdAt }  doc id = uid ⇒ no duplicates

announcements/{id}
  townId | 'all', authorId, title, body, pinned, status,
  publishAt, expiresAt|null, createdAt

reports/{reportId}
  reporterId, targetType: 'post'|'comment'|'user', targetId, targetPath,
  townId, reason, details, status: 'open'|'actioned'|'dismissed',
  createdAt, resolvedBy|null, resolvedAt|null, resolution|null

admin_roles/{uid}                 — written only by the Worker
  role: 'super_admin'|'town_admin'|'moderator', townIds[], grantedBy, grantedAt

audit_logs/{id}                   — written only by the Worker, never edited
  actorId, action, targetPath, townId, details, at
```

Key indexes: `posts (townId, status, createdAt desc)`,
`posts (visibility, status, createdAt desc)`, `posts (authorId, status, createdAt desc)`,
`posts (searchTokens array-contains, createdAt desc)`, `reports (status, townId, createdAt)`.

Counters (`reactionCount`, `commentCount`) are updated in the same batched write as the
reaction/comment, and the rules verify the counter moved by exactly ±1 (`existsAfter`/`getAfter`).

---

## 4. Security approach

**Firestore rules (summary):**
- Reads require sign-in (see decision D3). Removed posts/comments are hidden from non-moderators.
- Users may create/update only their own `users/{uid}` doc; cannot change `status`.
  Username claim must atomically create `usernames/{name}` pointing to them.
- Suspended users cannot create posts, comments, reactions or reports.
- Posts: author-only create/edit/delete; `authorId` must equal the caller; `townId` must
  be one of the five valid IDs; text length validated; `status`, `pinned` and counters are
  not client-writable except the ±1 counter rule.
- Reactions: doc id must equal caller's uid ⇒ one reaction per user per post.
- Reports: anyone signed in may create; only moderators/admins scoped to that town may read.
- `admin_roles`, `audit_logs`, `announcements`, `towns`: no client writes at all.
- `users_private`: owner read/write only.

**Worker:** verifies Firebase ID token signature/issuer/audience on every request, loads the
caller's `admin_roles`, checks the role **and** the town scope of the target record
(a Town Admin of Odomi cannot touch a Todzi record), performs the change and the audit-log
write together. Rate-limited per user.

**Other:** input validated with shared zod schemas on client and Worker; text rendered as
plain text (no HTML ⇒ no XSS); no secrets in frontend (Firebase web config is public by
design; service-account key only as a Worker secret); CSP headers via Pages;
account deletion removes the profile and anonymises content per the privacy notice.

All of this is proven by automated rules tests (cross-town admin attempts, duplicate
reactions, suspended users, editing others' posts, etc.).

---

### Role hierarchy (confirmed)

| Capability | Moderator | Town Admin (later) | Super Admin |
|---|---|---|---|
| Review/resolve reports, remove posts & comments | assigned towns | own town | all towns |
| Publish/pin announcements and posts | — | own town | all towns + platform-wide |
| Suspend/restore users | — | own town | all |
| Assign/remove roles, town configuration, platform settings | — | — | ✓ |
| View audit log | — | — | ✓ |

Launch staffing: 2 Super Admins + Moderators. Moderators may be scoped to all five towns.

## 5. Implementation plan (module by module)

Each module ends with: files changed, explanation, exact run/test commands, PROJECT_LOG update.

1. **Foundation** — monorepo, Vite app, Tailwind, shared package, lint/format, CI, Firebase emulators.
2. **Auth & onboarding** — register/login/logout/password reset, onboarding, unique usernames, rules tests.
3. **Towns & feeds** — town seed (clearly labelled), town feed, Akpafu-wide feed, pagination.
4. **Posts** — create/edit/delete, post detail, plain-text rendering.
5. **Engagement** — reactions (no duplicates), comments, counters.
6. **Profiles & photos** — profile page, edit profile, Worker + R2 photo upload.
7. **Search** — username prefix search, post keyword search, town filter.
8. **Safety** — report flow, block users, community rules & privacy pages.
9. **Admin & moderation (Worker)** — roles, reports queue, remove content, suspend, announcements & pins, audit log.
10. **PWA & polish** — installable, offline shell, performance budget, accessibility pass.
11. **Acceptance** — run brief §13 checklist on staging with real devices, fix, then small pilot group.

---

## 6. Deployment plan

- **Environments:** local (Firebase emulators + `wrangler dev`), **staging**
  (separate Firebase project + Pages preview), **production**.
- **Web:** Cloudflare Pages, build from `main`; preview deploys per branch.
- **API:** `wrangler deploy` (staging/prod configs).
- **Firestore rules/indexes:** `firebase deploy --only firestore` from CI after rules tests pass.
- **Secrets:** GitHub Actions secrets + Wrangler secrets; never committed.
- **Domain:** custom domain on Cloudflare once chosen.

---

## 7. Realistic cost risks

| Item | Free allowance (approx., verify at signup) | Risk |
|---|---|---|
| Firestore (Spark) | 50k reads, 20k writes, 1 GiB/day/total | Each feed page ≈ 20 reads. ~300 active users browsing heavily can hit the daily read cap → app stops working for the day on Spark. Moving to Blaze removes the cap but **has no hard spending limit**, only budget alerts. |
| Firebase Auth | Email/Google free at this scale | **Phone/SMS login is billed per SMS** — not recommended for Phase 1. |
| Cloudflare Pages | Generous free tier | Low. |
| Workers | 100k requests/day free | Low; only admin actions and uploads use it. |
| R2 | 10 GB storage free, no egress fees | Low with 256 px avatars; grows in Phase 2 (photos). |
| Search | Firestore token search is free but basic | A real search service (Algolia, Typesense) would add cost — deferred. |
| Domain | ~US$10–20/year | Fixed. |
| Abuse | Bot sign-ups/spam inflate reads/writes | Mitigated by Turnstile, rate limits, rules. |

Expected Phase 1 recurring cost at pilot scale: **≈ US$0/month + domain**. No paid service
will be added without explicit approval.

---

## 8. Founder decisions needed

See the list in `PROJECT_LOG.md` → *Open decisions*. Defaults proposed there will be used
only if the founder approves them.
