# Putting Siwu Connect on Google Play — step by step

Siwu Connect is a web app. On Google Play it is published as a small Android app that opens the website full-screen
(a "Trusted Web Activity"), so the app and the website are always the same and updates need no new upload.

Account type: **personal** → before going public, Google requires a **closed test with at least 12 testers who stay
opted in for 14 days in a row**. Plan for about 15 testers (3 per town).

---

## Step 1 — Buy the domain siwuconnect.com (Cloudflare, about $10–11 a year)

1. Open **dash.cloudflare.com** and sign in (the same account that runs Siwu Connect).
2. Left menu: **Domain Registration → Register Domains**.
3. Search **siwuconnect.com**. If it is available, add it, enter your contact details and pay.
   (If it is taken, pick an alternative such as siwu-connect.com and tell Claude.)
4. Wait until the domain shows as **Active** (usually minutes).
5. Tell Claude — Claude switches the app to the new address (website on siwuconnect.com, API on api.siwuconnect.com).
   The old addresses keep working, so nothing breaks.

## Step 2 — A free email address for the domain (privacy@siwuconnect.com)

The privacy notice and Google Play use **privacy@siwuconnect.com**. Make it forward to your Gmail:

1. Cloudflare → click **siwuconnect.com** → **Email → Email Routing** → **Get started / Enable**.
2. **Create address**: custom address `privacy`, action **Send to an email**, destination: your Gmail.
3. Open the confirmation email in Gmail and click the link.
4. Send a test email to privacy@siwuconnect.com and check it arrives.

## Step 3 — Google Play developer account ($25, one time)

1. Open **play.google.com/console/signup** with the Google account that will own the app (keep it for years).
2. Choose **Yourself** (personal account).
3. Fill in your details, pay $25, and complete **identity verification** (photo of your government ID). This can take a
   few hours to a few days. You'll also verify an Android phone through the Play Console app.

## Step 4 — Create the app in Play Console

1. **Create app** → App name **Siwu Connect**, default language English, **App** (not game), **Free**, accept the declarations.
2. Fill in everything under **Policy and programs → App content** using `policy-answers.md`
   (privacy policy, app access with a reviewer account, ads, content rating, target audience, data safety…).
3. **Store presence → Main store listing**: copy the texts from `listing.md` and upload the images from `graphics/`.

## Step 5 — Build the Android app (after Step 1 is done and Claude has switched the address)

The easiest way, from your laptop browser:

1. Open **www.pwabuilder.com**, enter **https://siwuconnect.com** and click **Start**.
2. Click **Package for stores → Android → Generate package**. Use:
   - **Package ID:** `com.siwuconnect.app` (must be exactly this; it can never change later)
   - **App name:** Siwu Connect · **Launcher name:** Siwu Connect
   - **Signing key:** "Create new" — fill in your name; PWABuilder makes the key
3. Download the zip. **Keep the zip, the `.keystore` file and the passwords in `signing-key-info.txt` somewhere safe and
   private** (e.g. a USB stick and a private cloud folder). Never send them in chat or put them in the code.
   (Google keeps the real app signing key; this one is your "upload key". If it's lost, Google can reset it.)
4. In the zip, the file ending **`.aab`** is what you upload to Google Play.

## Step 6 — Closed test (the 14 days)

1. Play Console → **Test and release → Testing → Closed testing** → **Create track** (or use "Alpha").
2. **Testers:** create an email list with your testers' **Gmail addresses** (the ones on their Android phones).
3. **Create new release** → upload the `.aab` → release name e.g. "1.0 pilot" → **Save → Review → Start rollout**.
4. Copy the **opt-in link** and send it to each tester. They open it, tap **Become a tester**, then install
   Siwu Connect from the Play Store link on that page.
5. **Make the app open full-screen (no browser bar):** Play Console → **Setup → App signing** (App integrity) →
   copy the **SHA-256 certificate fingerprint** of the *App signing key* and send it to Claude (it is not secret).
   Claude adds it to the website (`/.well-known/assetlinks.json`).
6. The 14 days start for each tester when they opt in. Ask testers to keep the app installed and use it every few
   days. Also add them as **pilot testers** in the app (Admin → Pilot testers) so they get the checklist.

## Step 7 — Apply for production (after 14 days with 12+ testers)

1. Play Console → **Dashboard → Apply for production**.
2. Answer the questions about your test (who tested, what feedback you got, what you changed). The answers come
   from Admin → Feedback and the project log.
3. Google usually replies within about 7 days. After approval: **Production → Create new release** → upload the
   same `.aab` (or a new one) → roll out. Siwu Connect is then on the Play Store for everyone.

---

### What Claude needs from you along the way

- When the domain is **Active** (Step 1) — to switch the app to siwuconnect.com.
- The **SHA-256 fingerprint** from Play Console (Step 6.5) — to make the app full-screen.
- Nothing secret: never send passwords, the keystore file, or ID documents in chat.
