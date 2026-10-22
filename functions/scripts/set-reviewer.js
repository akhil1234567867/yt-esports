"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

async function main() {
  const [action, uid] = process.argv.slice(2);
  if (!["grant", "revoke"].includes(action) || !uid || process.argv.length !== 4) {
    throw new Error("Usage: node scripts/set-reviewer.js <grant|revoke> <firebase-user-uid>");
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || "yt-esports-ad314";
  initializeApp({ projectId });
  const auth = getAuth();
  const user = await auth.getUser(uid);
  const claims = { ...(user.customClaims || {}) };
  if (action === "grant") {
    claims.achievementReviewer = true;
  } else {
    delete claims.achievementReviewer;
  }
  await auth.setCustomUserClaims(uid, claims);
  console.log(`Achievement reviewer permission ${action === "grant" ? "granted to" : "revoked for"} ${uid} in ${projectId}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
