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
- **D1 Town names:** confirm spelling — Akpafu Odomi, Akpafu Mempeasem, Akpafu Todzi, Akpafu Adokor. [use as written; IDs `odomi`, `mempeasem`, `todzi`, `adokor`]
- **D2 Sign-in methods:** [email + password and Google sign-in; no phone/SMS (billed per message)]
- **D3 Logged-out access:** can visitors read posts without an account? [No — sign-in required to read in Phase 1]
- **D4 Posting scope:** can users post in any of the four towns, or only their hometown? [any town; hometown pre-selected]
- **D5 Post visibility:** should a post be able to stay town-only (not in the Akpafu-wide feed)? [yes: "All Akpafu" default, optional "This town only"]
- **D6 Reactions:** single "Like" or a small set? [single Like in Phase 1; data model supports more later]
- **D7 Firebase plan:** stay on free Spark plan (hard daily caps) or Blaze (no caps, pay-as-you-go, budget alerts only)? [Spark for development and pilot]
- **D8 Accounts:** who will hold the Firebase, Cloudflare and domain accounts (founder should own them)? [founder-owned]
- **D9 Minimum age** for sign-up. [needs founder/legal decision]
- **D10 Roles:** who are the first Super Admin, Town Admins and Moderators.
- From brief §16: logo, colours, domain, social handles; community rules; privacy notice; pilot group.

## Decisions made
- (none yet)

## Known bugs
- (none — no code yet)

## Next steps
1. Founder reviews plan and answers D1–D10.
2. Build Module 1 (Foundation): monorepo, React/Vite app shell, shared package, Firebase emulators, CI.
