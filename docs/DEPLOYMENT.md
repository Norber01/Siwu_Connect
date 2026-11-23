# Deploying Siwu Connect

Nothing here creates a paid service. Every step uses a free tier; the cost notes in
`docs/PHASE1_PLAN.md` §7 still apply. Recommended: create a **staging** setup first (a second Firebase
project + Worker), test with a small group, then repeat for **production**.

The founder should own all accounts (decision D8).

## 1. Firebase project

1. Create a project at console.firebase.google.com (e.g. `siwu-connect-prod`). Keep the **Spark (free)** plan.
2. **Authentication → Sign-in method:** enable *Email/Password* and *Google*.
   Under *Settings → Authorized domains* add your web domain.
3. **Firestore Database:** create in production mode. Choose a region close to users and data rules
   (e.g. `europe-west1`); it cannot be changed later.
4. **Project settings → General → Your apps:** add a Web app and copy its config values.
5. **Service account for the API:** Google Cloud console → IAM → Service accounts → create
   `siwu-api` with roles **Cloud Datastore User** and **Firebase Authentication Admin**. Create a JSON key.
   Treat it like a password: never commit or share it.

Deploy rules and indexes:

```bash
npx firebase login
npx firebase deploy --only firestore --project <project-id>
```

Seed the towns:

```bash
FIREBASE_PROJECT_ID=<project-id> GOOGLE_APPLICATION_CREDENTIALS=/secure/path/key.json npm run admin -- seed-towns
```

## 2. Cloudflare R2 (profile, event and marketplace photos)

```bash
cd apps/api
npx wrangler login
npx wrangler r2 bucket create siwu-avatars
```

## 3. API Worker

Edit `apps/api/wrangler.toml` → `[env.production.vars]`: Firebase project id, your web origin, and the
Worker's public URL (e.g. `https://api.yourdomain.org`). Then:

```bash
cd apps/api
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --env production   # paste the JSON key
npx wrangler deploy --env production
curl https://<worker-url>/health    # {"ok":true}
```

## 4. Web app (Cloudflare Pages)

Create a Pages project connected to this GitHub repository:

- Build command: `npm run build`
- Build output directory: `apps/web/dist`
- Environment variables (production): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_API_URL`, `VITE_USE_EMULATORS=false`,
  `NODE_VERSION=22`

These Firebase web values are public by design; security comes from the Firestore rules and the Worker.

Deep links such as `/towns/odomi` work automatically: Pages serves `index.html` for unknown paths when the
site has no `404.html`.

## 5. First Super Admin

1. Open the live site, sign up with the shared Super Admin login, and finish onboarding.
2. Grant the role:

```bash
FIREBASE_PROJECT_ID=<project-id> GOOGLE_APPLICATION_CREDENTIALS=/secure/path/key.json \
  npm run admin -- grant-super-admin <username>
```

3. From the Admin → Roles screen the Super Admin can now add Moderators.

## 6. Before public launch (brief §16)

- Approve the community rules and privacy notice (currently marked *Draft* in the app) and add a privacy contact.
- Confirm the minimum age (currently 13, provisional).
- Review Ghana Data Protection Act obligations (registration with the Data Protection Commission may apply).
- Set a Google Cloud **budget alert** even on the free plan.
- Pilot with a small group from all four towns.
