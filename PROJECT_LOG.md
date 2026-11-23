# Siwu Connect — Project Log

## Status
**Stage:** Phase 1 built and passing all automated tests locally (emulators). **Not yet deployed** —
needs founder-owned Firebase/Cloudflare accounts (see `docs/DEPLOYMENT.md`).

## Completed
- 2026-11-23 — Inspected repository: empty. Added brief, Phase 1 plan, this log.
- 2026-11-23 — **Foundation:** npm workspaces (web, api, shared), TypeScript, ESLint, Vitest, Playwright, GitHub Actions CI.
- 2026-11-23 — **Shared package:** towns (stable IDs), limits, zod validation, search tokens, role permissions.
- 2026-11-23 — **Security rules** (`firebase/firestore.rules`): sign-in required to read; own-profile/post/comment
  writes only; unique usernames; one like per user; exact like/comment counters; posting (20 s) and commenting (5 s)
  cooldowns; blocked users cannot comment on the blocker's posts; reports readable only by moderators of that town;
  roles, announcements, audit log and moderation never writable from the client. 30 tests.
- 2026-11-23 — **API Worker** (`apps/api`): verified Firebase tokens; remove/restore posts and comments; pin posts;
  resolve reports (dismiss / remove / remove + suspend; all reports on the same item resolved together; permission
  checked against the item's real town); suspend/restore users; announcements; roles (Super Admin only; last Super
  Admin protected); avatar upload to R2 with type/size/content checks; account deletion. Every privileged action
  writes an audit-log entry atomically. 18 tests.
- 2026-11-23 — **Web app:** welcome, register, login (email + Google), password reset, onboarding, home (my town /
  All Akpafu), towns, town feed, announcements, pinned posts, create/edit/delete post, post detail with comments,
  likes, report dialog, profiles, block/unblock, search (posts + people, town filter), settings (edit profile,
  blocked users, sign out, delete account), community rules, privacy notice, admin area (reports, users,
  announcements, roles, audit log). PWA with icons; Firebase and React in separate cached chunks; admin code
  loaded only for admins.
- 2026-11-23 — **End-to-end tests:** journeys 1–6 of the brief on mobile (Pixel 7) and desktop, plus access control
  and password reset. 6 tests passing.
- 2026-11-23 — Admin CLI: `seed-towns`, `grant-super-admin <username>`.

## Phase 1 acceptance criteria (brief §13) — status in the local test environment
| Criterion | Status |
|---|---|
| Register, log in, log out, recover access | ✅ e2e (reset email sending must be verified on real Firebase) |
| Select and later view hometown | ✅ e2e |
| Town feeds show only that town's posts | ✅ e2e + rules |
| Akpafu-wide feed shows public posts from all towns | ✅ e2e |
| Create, edit, delete own posts | ✅ e2e + rules |
| React and comment, no duplicate reactions | ✅ e2e + rules |
| Report content; moderators review and resolve | ✅ e2e + API |
| Town admins cannot modify another town's records | ✅ rules + API tests |
| Works on common mobile sizes and desktop | ✅ e2e on Pixel 7 + 1280px desktop; real-device check pending |
| Loading, empty, error, permission-denied states | ✅ implemented on every screen |
| No fake buttons; no secret keys in frontend | ✅ only public Firebase web config in frontend |

"Real test environment" (a deployed staging project) is still outstanding — needs accounts.

## Decisions made
- 2026-11-23 — **D1** Town names confirmed: Akpafu Odomi, Akpafu Mempeasem, Akpafu Todzi, Akpafu Adokor. IDs `odomi`, `mempeasem`, `todzi`, `adokor`.
- 2026-11-23 — **D10** Launch roles: Super Admins and Moderators. Town Admin role exists but is unused at launch.
- 2026-11-23 — Super Admin can do everything Town Admins and Moderators can, in all towns, plus roles, settings and audit log.
- 2026-11-23 — **D10a** Founder chose **one shared Super Admin login** for now. Recorded risk: the audit log cannot tell
  the two people apart, and one leaked password exposes all admin powers. Can be split into two accounts later with
  no code change (Admin → Roles).
- 2026-11-23 — Founder said "continue with everything else": defaults applied for D2–D8:
  - D2 sign-in: email + password and Google; no SMS.
  - D3 sign-in required to read.
  - D4 users may post in any town; hometown pre-selected.
  - D5 posts are "All Akpafu" by default, optional "This town only".
  - D6 a single "Like" reaction.
  - D7 Firebase free (Spark) plan.
  - D8 founder owns all accounts.
- Technical: admin actions run in a Cloudflare Worker (not Cloud Functions) so Firebase can stay on the free plan.
- Technical: usernames cannot be changed after onboarding (keeps uniqueness simple).
- Technical: post/comment deletion is a "soft delete" — the text is erased but a placeholder record remains so counts
  and reports stay consistent.
- Technical: Cloudflare Turnstile dropped from Phase 1 (it needs a server step before Firebase sign-up); rely on
  Firebase's built-in abuse protection plus rule-enforced cooldowns. Revisit if spam sign-ups appear.

## Open decisions (founder)
- **D9 Minimum age** — the app currently shows **13** as a provisional value (`packages/shared/src/constants.ts`).
- Community rules and privacy notice text — drafts are in the app, clearly marked "Draft"; need approval and a privacy contact.
- Logo, colours (current green/gold palette and logo are provisional), domain, social handles.
- People for Moderator roles.
- Pilot group from all four towns.

## Known limitations / issues
- Search is basic: whole-word match for posts, start-of-name match for people (Firestore has no full-text search).
- Author names on posts are loaded per author (cached 5 min) — fine at pilot scale; revisit if reads grow.
- Email verification is sent but not required to post.
- Production build warns about the Firebase chunk size (≈110 KB gzip); it is cached after the first visit.
- Moderators can see "Users" only if they are Town/Super Admins (Moderators cannot suspend, by design).

## Next steps
1. Founder creates Firebase + Cloudflare accounts → deploy **staging** following `docs/DEPLOYMENT.md`.
2. Test on real Android/iPhone devices on mobile data; verify password-reset and Google sign-in emails/popups.
3. Founder approves rules/privacy text and minimum age; add privacy contact.
4. Pilot with a small group from all four towns; collect feedback before Phase 2.
