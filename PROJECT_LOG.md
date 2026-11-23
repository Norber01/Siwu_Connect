# Siwu Connect — Project Log

## Status
**Stage:** Planning (Phase 1). No application code yet.

## Completed
- 2026-11-23 — Inspected repository: empty (no commits, no branches on GitHub). No existing framework or code.
- 2026-11-23 — Added product brief to `docs/` and drafted `docs/PHASE1_PLAN.md` (architecture, screen map, data model, security, implementation plan, deployment, cost risks).

## Outstanding
- Founder approval of `docs/PHASE1_PLAN.md` and the open decisions below.
- Module 1 (Foundation) — starts after approval.

## Open decisions (founder) — proposed default in brackets
- **D2 Sign-in methods:** [email + password and Google sign-in; no phone/SMS (billed per message)]
- **D3 Logged-out access:** can visitors read posts without an account? [No — sign-in required to read in Phase 1]
- **D4 Posting scope:** can users post in any of the four towns, or only their hometown? [any town; hometown pre-selected]
- **D5 Post visibility:** should a post be able to stay town-only (not in the Akpafu-wide feed)? [yes: "All Akpafu" default, optional "This town only"]
- **D6 Reactions:** single "Like" or a small set? [single Like in Phase 1; data model supports more later]
- **D7 Firebase plan:** stay on free Spark plan (hard daily caps) or Blaze (no caps, pay-as-you-go, budget alerts only)? [Spark for development and pilot]
- **D8 Accounts:** who will hold the Firebase, Cloudflare and domain accounts (founder should own them)? [founder-owned]
- **D9 Minimum age** for sign-up. [needs founder/legal decision]
- **D10a Super admin login:** founder proposed two super admins sharing one login. [Recommended: two separate accounts, both with the Super Admin role — see note in Decisions made]
- **D10b People:** names/emails of the first Super Admins and Moderators (needed at the admin module).
- From brief §16: logo, colours, domain, social handles; community rules; privacy notice; pilot group.

## Decisions made
- 2026-11-23 — **D1** Town names confirmed as spelled: Akpafu Odomi, Akpafu Mempeasem, Akpafu Todzi, Akpafu Adokor. Stable IDs: `odomi`, `mempeasem`, `todzi`, `adokor`.
- 2026-11-23 — **D10** Launch roles: Super Admins and Moderators only. No Town Admins at launch; the Town Admin role stays in the data model for later.
- 2026-11-23 — Role hierarchy: **Super Admin can do everything a Town Admin and a Moderator can do, in all four towns**, plus manage roles, platform settings, town configuration and view the audit log.
- 2026-11-23 — 2 Super Admins. Note: a shared login would make the audit log unable to tell who did what, and one leaked password would expose all admin powers. Recommendation pending founder reply (D10a).

## Known bugs
- (none — no code yet)

## Next steps
1. Founder reviews plan and answers D1–D10.
2. Build Module 1 (Foundation): monorepo, React/Vite app shell, shared package, Firebase emulators, CI.
