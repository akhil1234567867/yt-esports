# Achievement proof and verification setup

The browser UI uses Firebase Storage for temporary evidence uploads and calls the `submitAchievement` and `reviewAchievement` Cloud Functions in `us-central1`. The functions validate and normalize image bytes on the server, create the pending Firestore record, and are the only path that can update a review status. The browser does not contain reviewer credentials or an admin flag.

## Deploy to `yt-esports-ad314`

1. In Firebase Console, enable Cloud Storage and create/select the configured project bucket. Enable Cloud Firestore and Firebase Authentication (email/password, as already used by the site). Cloud Functions deployment requires the Blaze billing plan.
2. Install the Firebase CLI and authenticate with an account authorized to deploy Functions, Firestore rules, and Storage rules.
3. From the repository root, install function dependencies and deploy:

   ```powershell
   npm --prefix functions install
   firebase deploy --project yt-esports-ad314 --only functions,firestore:rules,storage
   ```

   This deploys `firestore.rules`, `storage.rules`, and the two callable functions. Configure the website's deployed hostname as an Authentication authorized domain. Serve the site over HTTPS.
4. Evidence previews use authenticated Storage reads (`getBlob`), not long-lived download-token URLs. Add your exact production hostname to `storage.cors.json`, then apply the bucket CORS policy (the default bucket name from this project's web config is shown):

   ```powershell
   gcloud storage buckets update gs://yt-esports-ad314.firebasestorage.app --cors-file=storage.cors.json
   ```

   Reapply this command after editing the allowed origins. CORS is not authorization; the Storage rules still enforce owner/reviewer access.
5. Test a submission with a real signed-in test user. Check that the temporary object is normalized to a JPEG under `achievement-proofs/{uid}/{submissionId}/evidence.jpg`, and the matching `achievementSubmissions/{submissionId}` record starts with `status: "pending"`. Confirm the owner sees it and a different ordinary user cannot read it.

## Grant reviewer access

Reviewer access is a Firebase Authentication custom claim set only by a trusted operator with Firebase Admin IAM permissions. Never add a reviewer switch or claim-setting endpoint to the browser.

Use Application Default Credentials from a trusted administrator workstation or server. Do not commit credentials or service-account keys:

```powershell
gcloud auth application-default login
node functions/scripts/set-reviewer.js grant FIREBASE_USER_UID
```

To revoke access:

```powershell
node functions/scripts/set-reviewer.js revoke FIREBASE_USER_UID
```

The reviewer must refresh their ID token by signing out and back in. The reviewer queue is visible only when the ID token has `achievementReviewer: true`; the callable independently checks that claim, rejects self-review, and only transitions pending records to `verified` or `rejected`. Rejections require a reviewer note.

## Local checks

Run `npm --prefix functions test` for input, date, file metadata, image dimension, and review-decision validation. Run `npm --prefix functions run check` for backend JavaScript syntax. These checks do not replace deploying the rules/functions or a live Storage/Firestore permission test.
