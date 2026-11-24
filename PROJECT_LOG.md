# Siwu Connect — Project Log

## Status
**2026-11-24: LIVE** at https://siwu-connect.fnorxx.workers.dev (API https://siwu-connect-api.fnorxx.workers.dev).
Setup completed 2026-11-24 from the founder's laptop: key + founder email added, /setup ran all steps green
(rules, 29 indexes, five towns, sign-in domain, Super Admin = fnorxx@gmail.com account).

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
- 2026-11-23 — **Redesign to the founder's mockup** (green, white and yellow): three-figure logo (SVG redraw),
  "Four Towns. One Community." welcome screen with town chips (pre-selects hometown at sign-up), town chip
  selector on the home feed, post cards with Like / Comment / Share (Share uses the phone's share sheet or copies
  the link), centre "+" create button, town cards, profile cover, chat-style comments, green admin tabs.
- 2026-11-23 — `scripts/demo-data.mjs`: SAMPLE data for local emulator screenshots only (writes only to the local
  demo-siwu emulator).

- 2026-11-23 — **Launch scope expanded (founder request):**
  - **Events** — calendar with categories (festival, funeral, wedding, church, meeting, sports, community), photo,
    Going/Interested RSVPs with exact counters, add-to-calendar (.ics), share, cancel/edit, report, moderation.
  - **Marketplace** — listings with photo, price in GH₵ (or "contact for price"/free), town and category filters,
    search, WhatsApp and call buttons, mark as sold, safety notice, "For sale" on seller profiles. No payments.
  - **Sports Centre** — matches between town teams (or other teams), live score and minute updated in real time,
    live-update timeline (goals, cards, subs, chances), fixtures, results, league table, "Who will win?" voting
    (one free vote per member, closes at full time). New **Sports reporter** role (no moderation powers).
  - **For early testers** — notification bell (likes and comments on your posts), "Beta" badge + Settings →
    send feedback (Super Admins read it in Admin → Feedback), invite friends via the share sheet, "Welcome our
    newest members" strip on the home feed.
  - Tests: rules 41, API 22, unit 14, end-to-end 8 (mobile + desktop) — all passing.

- 2026-11-23 — **Phone-only setup:** founder can set everything up from a phone. New `/setup` page ("Set up
  Siwu Connect") calls the API, which installs the Firestore rules and indexes (bundled into the Worker by
  `npm run gen:assets`), adds the five towns, authorises the website domain for sign-in and makes the founder
  Super Admin. Only the account whose verified email equals the Worker's `FOUNDER_EMAIL` can run it while no
  Super Admin exists; afterwards only a Super Admin can re-run it. Tested in the emulator end-to-end and against
  a simulated Google API.

- 2026-11-24 — **Founder feedback after first live test:** added **photo posts** (one photo per post, text optional
  when there is a photo; photo must be the author's own upload) and a **"Coming up" events strip** on the home feed.
  Deployed; founder re-runs /setup to install the updated rules.

- 2026-11-24 — **Automatic match clock:** matches store match length and half-time break; the clock counts from
  kick-off, pauses at half time (with a countdown) and resumes, on every device; reporters can correct it.
- 2026-11-24 — **Photos and videos in posts:** up to 4 per post (photos resized on the phone; videos MP4/MOV/WebM,
  ≤50 MB and ≤3 min, preview frame captured on the phone), upload progress, grid view, full-screen photo viewer,
  videos served with byte ranges for phone playback. Limit 30 videos per member.
  Storage cost note: R2 free 10 GB, then about $0.015/GB-month.

- 2026-11-24 — **Big feature round (founder: "complete the project, add chat, Gen Z features"):**
  - Fixes: reporter updates no longer default to a home-team goal; bottom nav Home · Sports · + · Events · Chat
    (profile via the top avatar); Admin → Users lists every member (filters, paging, total).
  - **Chat:** private 1-to-1 messages (only the two members can read them — not admins; block-aware) and group chats
    for All Akpafu + each town (photos, delete own, report, moderators remove with audit log), unread badges.
  - **Gen Z:** Stories (24 h, photo/video/text, rings, viewer), emoji reactions (👍❤️😂🔥😮😢), polls, #hashtags with
    tag pages and trending, @mentions with notifications, bio + vibe emoji, dark mode, weekly town leaderboard.
  - **Directory:** Businesses, Jobs, Scholarships, Training (WhatsApp/call/apply link, deadlines, close/reopen).
  - Explore page (search, trending, leaderboard, directory). Tests: unit 18, rules+API 82, e2e 12.
  - Not built (need paid providers or a budget decision): livestreaming, live audio rooms, in-app payments.
    Phone push notifications need a Firebase Web Push key from the founder — next step.
- 2026-11-24 — **Approvals, friends, video and X-style redesign (founder feedback):**
  - **Who can post what:** members post feeds and stories freely. **Events are admin-only.** Members ask an admin
    with "Request event", which goes to the team's feedback inbox. **Marketplace listings and Businesses & jobs**
    from members wait as "pending" until a moderator approves them in **Admin → Approvals**. The member gets an
    "approved" or "not approved" notification with the moderator's note. Editing re-sends the item for approval.
    Admins' own items go live at once. All of this is enforced in the security rules and the API, with an audit log.
  - **Friends and chat requests:** to chat privately, send a friend request; once the other person accepts, you
    can chat. Unfriending or blocking stops new messages. Requests show in Chat → Requests and as notifications.
  - **Stories for friends only:** a story is visible only to the author's friends at the time it was posted. The
    author sees **how many people viewed it, and who** (tap "N views").
  - **Video:** space is reserved before a video loads (no jumping text), the preview frame shows at once, and
    videos play muted when on screen and **stop when you scroll past**. Only one plays at a time, and none
    autoplay in data-saver mode. Large phone videos are **shrunk to 720p on the phone** before upload (H.264, quick
    start) for faster uploads and playback; the original is used if the phone can't.
  - **X-inspired design:** edge-to-edge posts with an avatar column and an icon action row; underlined town tabs;
    icon bottom bar (Home · Explore · Sports · Notifications · Chat); floating "+" button; side menu from your
    avatar (Profile, Events, Marketplace, Businesses & jobs, Towns, Admin, Settings, theme, invite, sign out); and
    a three-column layout on computers with "What's happening" and "Coming up".
  - **Live match bar** at the top while a game is on (hides on scroll down). **Verified badge**: Super Admins
    (anyone) and Town Admins (their towns) verify accounts; a blue tick shows next to the name everywhere.
  - **Setup fix:** "Run setup" was failing with "Too many subrequests" (Cloudflare's free plan allows 50 outgoing
    calls per request). Setup now runs in parts: the core steps first, then the indexes in batches of 20.
- 2026-11-24 — **Speed and fun round:**
  - **Faster:** posts, profiles and chats are kept on the phone (Firestore offline cache), so the feed opens at once
    with what was seen last and refreshes behind it. The feed loads 10 posts at a time and fetches more automatically
    as you scroll. Videos get a light **360p data-saver copy**, which plays on 2G/3G or in data-saver mode.
  - **Voice notes in chat:** tap the mic, record (up to 2 minutes), and send. Notes are stored as small Opus/AAC files.
  - **Repost and quote:** share someone's post again in the feed, or quote it with your own words. The original
    author is notified.
  - **Siwu word of the day:** admins add words or proverbs with a meaning, an example and a recorded pronunciation
    (Admin → Siwu words). One word shows on everyone's home feed each day. No words are pre-filled: they must
    come from Siwu speakers.
  - **Predictions league:** predict the score of a match before kick-off (3 points for the exact score, 1 for the
    right result). Sports → 🔮 League ranks members and towns over the last 7 days.
  - Speed ideas not done yet: a custom domain (lets Cloudflare cache photos and videos near users); smaller photo
    thumbnails; Cloudflare Stream adaptive video (paid).
- 2026-11-24 — **Search, comments, friends fix and new look:**
  - People search suggests members as you type, matching any part of a name ("men" → Kofi Mensah).
  - Comments open TikTok-style in a sheet over the feed.
  - Friend requests are sent and accepted through the API, with a clear reason when one is refused.
  - New look from the founder's second mockup: teal-navy and gold on a soft sky background, a labelled bottom bar
    with a gold + button, a stories card, quick-action buttons, and a chat list with filters and unread counts.
    The X-style feed and the original logo are kept.
  - Lesson: after each update that changes the security rules, the founder must tap **Run setup again**.
    Private chat failed until this was done.
- 2026-11-24 — **Maintenance round:**
  - **Setup reminder:** when an update brings new security rules or indexes, Super Admins see a gold bar
    "An update needs setup — tap to run it" until setup has run. Setup records a version stamp of the rules and
    indexes in `settings/setup`.
  - **Daily backups:** at 02:23 UTC every night the API copies every collection to a gzipped JSON file in the
    private R2 bucket (`backups/`) and keeps the newest 14. Admin → Backups offers "Back up now" and downloads.
    `scripts/restore-backup.mjs` writes a backup back (tested: a deleted post came back). The free plan's limit
    on outgoing calls per run caps very large databases; a partial backup says so.
  - **Photo previews:** each post photo also gets a ~70 KB preview. The feed shows the preview, the full photo
    opens on tap, and slow connections always get the preview.
  - **Housekeeping:** Wrangler 3 → 4.159.0. React Router: `v7_relativeSplatPath` is on, so admin links are
    absolute. `v7_startTransition` stays off: with it, a page could still show briefly after a tap, and quick
    typing went into the old page (caught by the password-reset test).
- 2026-11-24 — **Admin stories for everyone:** when posting a story, admins choose who sees it: "My friends", or
  "Everyone" in all towns (Super Admin), or "Everyone from <town>" (Super Admin, or that town's Town
  Admin/Moderator). These stories show first in the stories row with a gold ring and a 📢 badge, and an
  "All towns"/town label, for announcements and promotions. Enforced in the security rules: members cannot
  post to everyone, and nobody can see another town's stories by faking their hometown. Needs **Run setup again**.
- 2026-11-24 — **Founder fixes:**
  - The town and All-Akpafu feeds are mixed instead of strictly newest first. Each batch of 20 recent posts is
    ordered by freshness, liveliness (reactions, comments) and a shuffle that changes each time the app is
    opened. Your own post from the last 15 minutes stays on top. Pinned posts stay first; profiles stay newest first.
  - "Town spirit this week" on Explore is now for admins only.
  - Removed the "Photos are made smaller on your phone" sentences.
  - Fixtures show a gold "🔮 Predict the score" button (or "Your prediction: 2 – 1") on upcoming matches.
- 2026-11-24 — **Voice notes fix:** the site's `Permissions-Policy` header turned the microphone off
  (`microphone=()`), so the phone refused it; it now allows it for the site itself (`microphone=(self)`). The
  offline app cache kept serving the old page with the old header, so pages are now loaded network-first (cached
  copy only when offline) and header changes apply at once. Lesson: browser tests run on the dev server, which
  doesn't send the site Worker's headers; check headers on the live site after such changes.
- 2026-11-24 — **Chat upgrades, social extras, safety net:**
  - Chat: "typing…" and ✓ Sent / ✓✓ Seen in private and group chats (`chats/{id}/presence/{uid}`, not town
    rooms); "Active now" and green dots from `users.lastActiveAt`, refreshed while the app is open. Members can hide
    it in Settings → Privacy (then they don't see others' either). Reply to a message (quoted) and react with one
    emoji (❤️😂👍🔥😮😢🙏🏾), on every message.
  - Group chats made by members (only with their friends; up to 50), created through the API. Add friends,
    rename (group admin), members list, leave (the group keeps an admin). Chat → Groups.
  - Saved posts (⋯ → Save post; More → Saved; private). Reply to a friend's story straight into private chat.
    Shared photo album on every event (anyone adds; the author deletes; the town moderator removes).
    Birthdays (opt-in, day and month only: "🎂 Birthdays today" on the home feed). "I'm home" visits (town + until
    date, up to 90 days: "🏡 Home right now").
  - Safety net: website security-header tests (`apps/site/test`) and `npm run check:live` (live site + API
    checks after each deploy, all passing). Fixed along the way: message menus could go off-screen or hide
    under the header, and all pop-up windows shared one title id (screen readers read the wrong title).
  - Needs **Run setup again** (new rules and an index for album photos).
- 2026-11-24 — **Founder decisions and pilot tools:**
  - Minimum age: **13** (final; no longer provisional).
  - Sports reporters per town: when giving the Sports reporter role, choose their town(s). They then add and
    update only matches involving those towns; with no towns chosen they cover all. This is enforced in the rules.
    Sports shows "📣 Match reporters" for each town. The people are chosen by the founder in Admin → Roles.
  - Pilot testers: Admin → Pilot testers (Super Admins and Town Admins) shows testers per town against a goal of
    5, with search to add and an option to remove; there is also a "🧪 Make pilot tester" button on profiles.
    Testers get a 🧪 badge, a notification, a "things to try" checklist on their home page and a feedback button.
    The founder chooses the testers.
  - Share a post in chat: Share → "Send in chat" (friends, groups or town chats, several at once, optional
    note) or "Share outside (WhatsApp…)". The message shows a tappable preview of the post.

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
- 2026-11-24 — **Photos stored in Cloudflare Workers KV** for now (R2 needs a payment card, which the founder
  doesn't have yet). KV free plan: ~1 GB (≈5,000–7,000 photos), 1,000 uploads/day. Switch to R2 later by binding
  `AVATARS` to a bucket — no app changes; existing photos would need copying across.
- 2026-11-23 — **Fifth town added: Akpafu Sokpo** (founder correction; it was missing from the brief). ID `sokpo`.
  Tagline updated to "Five Towns. One Community." Added to rules, shared code, chips, sign-up, welcome banner,
  admin CLI and tests. Existing databases need `npm run admin -- seed-towns` re-run to add the town record.
- 2026-11-23 — **Founder brought Sports, Events and Marketplace into the first release** (brief §6 had them in
  Phases 2–3). Still excluded: livestreaming, audio rooms, private messaging, stories, payments/escrow,
  betting of any kind (votes are free and for fun). Bottom navigation is now Home · Sports · + · Events · Profile,
  matching the founder's design; Search and notifications are in the header.
- 2026-11-23 — **Design:** follow the founder's mockup. Sports Centre, Events, Marketplace and the notification bell
  shown in the mockup were first left out as later-phase features; superseded the same day (see above).
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
- Who will be **Sports reporters** for the first tournaments (Admin → Roles → "Sports reporter").
- Whether marketplace phone numbers should be visible to all members (current) or only after a buyer taps "show".
- Community rules and privacy notice text — drafts are in the app, clearly marked "Draft"; need approval and a privacy contact.
- Logo artwork: the app uses an SVG redraw of the mockup logo; supply the original logo file to use it exactly. Real town photos for the town cards. Domain, social handles.
- People for Moderator roles.
- Pilot group from all five towns.

## Known limitations / issues
- Fixed 2026-11-23: right after signing up or switching accounts on the same phone, the app could briefly treat
  the user as having no profile and send them back to the setup form. The app now tracks whose profile is loaded,
  retries the profile listener if the database refuses it during a sign-in switch, and only trusts a brand-new
  profile once the server has confirmed it. Verified with repeated end-to-end runs.
- Notifications are in-app only (no phone push yet). Push via Firebase Cloud Messaging is the natural next step.
- Team crests are coloured initials; real club badges can be uploaded later.
- Photos: one per event/listing, max 1280 px / 400 KB, 200 photos per member (R2 free tier is 10 GB).
- Search is basic: whole-word match for posts, start-of-name match for people (Firestore has no full-text search).
- Author names on posts are loaded per author (cached 5 min) — fine at pilot scale; revisit if reads grow.
- Email verification is sent but not required to post.
- Production build warns about the Firebase chunk size (≈110 KB gzip); it is cached after the first visit.
- Moderators can see "Users" only if they are Town/Super Admins (Moderators cannot suspend, by design).

## Next steps
1. Founder creates Firebase + Cloudflare accounts → deploy **staging** following `docs/DEPLOYMENT.md`.
2. Test on real Android/iPhone devices on mobile data; verify password-reset and Google sign-in emails/popups.
3. Founder approves rules/privacy text and minimum age; add privacy contact.
4. Pilot with a small group from all five towns; collect feedback before Phase 2.
