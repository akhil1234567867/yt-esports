# YT Gamer ID

YT Gamer IDs are assigned by the `ensureGamerIdentity` callable Cloud Function. The ID is stored in the account's private `users/{uid}` document and indexed by `gamerIdIndex/{gamerId}`. A country-scoped counter and Firestore transaction reserve each ID; the index entry is retained after account deletion so an ID is never reused. Existing UID-derived IDs are migrated to the sequential format the first time the account signs in after deployment.

## Firestore collections

- `users/{uid}` — private account and profile fields; readable only by the owner. Client writes are denied.
- `publicProfiles/{uid}` — an allowlisted profile projection containing only fields selected for public display. Public reads require `profileVisibility == "public"`; all client writes are denied.
- `gamerIdIndex/{gamerId}` — private ID-to-owner reservation; client access is denied.
- `gamerIdCounters/{countryCode}` — private transaction counters; client access is denied.
- `playerVerificationSubmissions/{requestId}` — private requests and reviewer decisions; the owner and authorized player verifiers may read, while writes go through callable Functions.
- `achievementSubmissions/{submissionId}` — existing evidence records remain owner/reviewer-only. Only reviewer-approved achievement metadata is copied to a public profile; proof files remain private.

Public profiles do not include email, phone number, real name, age, gender, city, state, or evidence files. Private account profile data remains in `users/{uid}`.

## Deploy

From the repository root, after signing in to the correct Firebase project:

```powershell
npx firebase-tools deploy --only functions,firestore:rules,firestore:indexes --project yt-esports-ad314
```

The public profile search and player-verification history use the indexes declared in `firestore.indexes.json`. Deploying the Firestore rules also disables direct client writes to private account documents; the updated frontend saves profiles through Cloud Functions.

The QR card points to `https://yt-esports-ad314.web.app/#gamer/<GAMER_ID>`. Deploy Hosting to that Firebase Hosting site (or change the canonical URL in `getGamerQr` if using a custom domain).

The scanner can read QR codes from a live camera or an image file. Camera access requires HTTPS (or localhost) and the user's permission. The browser decoder is hosted locally at `vendor/jsQR.js`, so scanning does not depend on a third-party runtime CDN; its Apache-2.0 license is included beside the bundle.

## Reviewer access

Use the existing Admin SDK reviewer utility from the `functions` directory. It requires Application Default Credentials with permission to manage Firebase Authentication custom claims:

```powershell
node scripts/set-reviewer.js grant-player <firebase-user-uid>
node scripts/set-reviewer.js revoke-player <firebase-user-uid>
```

Existing achievement reviewer commands remain `grant` and `revoke`; `grant-both` and `revoke-both` manage both claims without clobbering unrelated custom claims. Only authorized player verifiers can approve or reject Gamer ID requests. Rejections require a reviewer note.

## Test

```powershell
npm test --prefix functions
npm run check --prefix functions
```

For an end-to-end Firebase test, deploy the Functions, rules and indexes to a development Firebase project. Create a player account, complete the Gamer ID profile, check that the ID is stable after changing the gamer tag, search by ID and game, scan the public QR profile while signed out, submit a verification request, and review it with a separate account granted the `playerVerifier` claim. Also verify that the Firestore client cannot write `users`, `publicProfiles`, `gamerIdIndex`, `gamerIdCounters`, or verification records, and that private account fields do not appear in the public profile response.

This feature requires a trusted backend: the callable Cloud Functions allocate IDs, save profiles, search private indexes, process verification requests, and create QR data. Client code must not allocate IDs or assign verification status.
