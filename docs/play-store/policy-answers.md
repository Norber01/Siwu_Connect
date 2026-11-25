# Answers for Play Console policy forms — Siwu Connect

These forms are under Play Console → **Policy and programs → App content**. The answers match how the app actually
works (checked against the code on 25 Nov 2026). If something in the app changes, update these.

## Privacy policy

https://siwuconnect.com/privacy

## App access

**Choose:** "All or some functionality is restricted" → add instructions:

> Sign in with the test account below. All features are available after signing in.
> Email: (a reviewer account you create, e.g. playreview@siwuconnect.com)
> Password: (write it here in Play Console only — never in chat or in this file)

Create the account in the app like any member: choose a hometown and a username. Don't give it an admin role.

## Ads

**No**, the app does not contain ads.

## Content rating (IARC questionnaire)

- **Category:** Social Networking / Communication ("All other app types" if asked: Social)
- **Violence, sexuality, language, controlled substances, gambling:** No
- **Users can interact or exchange content with each other:** **Yes** (posts, comments, chat)
- **Shares the user's location with other users:** No (members only choose a hometown; no GPS)
- **Allows users to purchase digital goods:** No
- **Unrestricted internet access (e.g. a web browser):** No
- **Is it a news app?** No (community app; announcements are from the community itself)

Expected result: rated for teens (e.g. "Teen" / PEGI 12) because of user interaction.

## Target audience and content

- **Target age groups:** 13–15, 16–17, 18 and over (minimum age 13, checked at sign-up)
- **Appeals to children under 13?** No
- **Not a "Designed for Families" app**

## Data safety

**Does your app collect or share any of the required user data types?** Yes.
**Is all of the user data collected by your app encrypted in transit?** Yes.
**Do you provide a way for users to request that their data is deleted?** Yes.
Delete-account URL: https://siwuconnect.com/delete-account

**Shared with third parties:** No. Firebase and Cloudflare are service providers that process data for the app;
Google's form does not count service providers as "sharing".

| Data type (Play's names) | Collected | Required or optional | Why |
|---|---|---|---|
| Personal info → **Name** | Yes | Required | App functionality (profile) |
| Personal info → **Email address** | Yes | Required | Account management (sign-in) |
| Personal info → **User IDs** | Yes | Required | App functionality, account management |
| Personal info → **Other info** (hometown, residence country, birthday day and month, bio) | Yes | Optional | App functionality |
| Photos and videos → **Photos**, **Videos** | Yes | Optional | App functionality (posts, stories, chat, profile photo) |
| Audio → **Voice or sound recordings** | Yes | Optional | App functionality (voice notes, word pronunciations) |
| Messages → **Other in-app messages** | Yes | Optional | App functionality (chat) |
| App activity → **Other user-generated content** (posts, comments, listings, events) | Yes | Optional | App functionality |
| App activity → **Other actions** (likes, RSVPs, votes, predictions, friends) | Yes | Optional | App functionality |
| Device or other IDs (the phone's **push notification address**, only if notifications are turned on) | Yes | Optional | App functionality (notifications) |
| Location | **No** | — | — |
| Financial info, Health, Contacts, Calendar, Web history | **No** | — | — |
| App info and performance (crash logs, diagnostics) | **No** | — | — |

For each collected type: **processed ephemerally?** No. **Used for:** App functionality (plus Account management
for email and user IDs). **Not** used for advertising or analytics.

## Other declarations

- **Government app:** No
- **Financial features:** No
- **Health:** No
- **News app:** No
- **COVID-19 contact tracing:** No
- **Account deletion:** in the app (Settings → Delete account) and at https://siwuconnect.com/delete-account
