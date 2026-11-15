"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

async function main() {
  const [action, uid] = process.argv.slice(2);
  const actions = {
    grant: { claim: "achievementReviewer", value: true },
    revoke: { claim: "achievementReviewer", value: false },
    "grant-player": { claim: "playerVerifier", value: true },
    "revoke-player": { claim: "playerVerifier", value: false },
    "grant-both": { claims: { achievementReviewer: true, playerVerifier: true } },
    "revoke-both": { claims: { achievementReviewer: false, playerVerifier: false } }
  };
  if (!actions[action] || !uid || process.argv.length !== 4) {
    throw new Error("Usage: node scripts/set-reviewer.js <grant|revoke|grant-player|revoke-player|grant-both|revoke-both> <firebase-user-uid>");
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || "yt-esports-ad314";
  initializeApp({ projectId });
  const auth = getAuth();
  const user = await auth.getUser(uid);
  const claims = { ...(user.customClaims || {}) };
  const update = actions[action];
  if (update.claim) {
    if (update.value) claims[update.claim] = true;
    else delete claims[update.claim];
  } else {
    Object.entries(update.claims).forEach(([claim, value]) => {
      if (value) claims[claim] = true;
      else delete claims[claim];
    });
  }
  await auth.setCustomUserClaims(uid, claims);
  console.log(`Reviewer permission ${action} for ${uid} in ${projectId}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
