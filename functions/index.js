"use strict";

const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const functionsV1 = require("firebase-functions/v1");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const sharp = require("sharp");
const QRCode = require("qrcode");
const { publicProfileData } = require("./gamer-profile");
const {
  GAMER_ID_PATTERN,
  MAX_EVIDENCE_BYTES,
  SUPPORTED_GAMER_COUNTRY_CODES,
  formatGamerId,
  normalizeGamerProfile,
  validateDecodedImage,
  validateEvidenceMetadata,
  validatePrivateProfile,
  validatePlayerVerification,
  validatePlayerVerificationReview,
  validateReview,
  validateSubmission
} = require("./validation");

initializeApp();
const db = getFirestore();
const bucket = getStorage().bucket("yt-esports-ad314.firebasestorage.app");

function callableError(error) {
  if (error instanceof HttpsError) return error;
  if (error instanceof TypeError || error instanceof RangeError) {
    return new HttpsError("invalid-argument", error.message);
  }
  logger.error("Firebase operation failed", error);
  return new HttpsError("internal", "The operation failed.");
}

function requireAuthenticated(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  return request.auth.uid;
}

exports.submitAchievement = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const uid = requireAuthenticated(request);
  let submission;
  try {
    submission = validateSubmission(request.data);
  } catch (error) {
    throw callableError(error);
  }

  const sourcePath = `achievement-proof-uploads/${uid}/${submission.submissionId}/evidence`;
  const finalPath = `achievement-proofs/${uid}/${submission.submissionId}/evidence.jpg`;
  const source = bucket.file(sourcePath);
  const destination = bucket.file(finalPath);
  let destinationCreated = false;

  try {
    const [exists] = await source.exists();
    if (!exists) throw new HttpsError("failed-precondition", "Upload the evidence image before submitting.");
    const [sourceMetadata] = await source.getMetadata();
    try {
      validateEvidenceMetadata({
        size: Number(sourceMetadata.size),
        contentType: sourceMetadata.contentType,
        customMetadata: sourceMetadata.metadata
      });
    } catch (error) {
      throw callableError(error);
    }
    if (sourceMetadata.metadata.ownerUid !== uid || sourceMetadata.metadata.submissionId !== submission.submissionId) {
      throw new HttpsError("permission-denied", "Evidence upload does not belong to this account.");
    }
    const [imageBuffer] = await source.download();
    const image = sharp(imageBuffer, { limitInputPixels: 50_000_000 });
    let imageMetadata;
    try {
      imageMetadata = await image.metadata();
      validateDecodedImage(imageMetadata);
    } catch (error) {
      throw callableError(error);
    }
    const normalizedImage = await image.rotate().resize({
      width: 4096,
      height: 4096,
      fit: "inside",
      withoutEnlargement: true
    }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    if (!normalizedImage.length || normalizedImage.length > MAX_EVIDENCE_BYTES) {
      throw new HttpsError("invalid-argument", "Processed evidence exceeds the 10 MB limit.");
    }

    await destination.save(normalizedImage, {
      resumable: false,
      metadata: {
        contentType: "image/jpeg",
        cacheControl: "private, no-store",
        metadata: { ownerUid: uid, submissionId: submission.submissionId }
      }
    });
    destinationCreated = true;

    const submissionRef = db.collection("achievementSubmissions").doc(submission.submissionId);
    await submissionRef.create({
      ownerUid: uid,
      tournamentName: submission.tournamentName,
      game: submission.game,
      placement: submission.placement,
      organizer: submission.organizer,
      eventDate: submission.eventDate,
      details: submission.details,
      evidencePath: finalPath,
      evidenceContentType: "image/jpeg",
      evidenceSize: normalizedImage.length,
      status: "pending",
      createdAt: FieldValue.serverTimestamp()
    });

    try {
      await source.delete();
    } catch (error) {
      logger.warn("Could not remove the temporary evidence upload", { uid, submissionId: submission.submissionId, error });
    }
    return { submissionId: submission.submissionId, status: "pending" };
  } catch (error) {
    if (destinationCreated) {
      try {
        await destination.delete({ ignoreNotFound: true });
      } catch (cleanupError) {
        logger.error("Could not remove an uncommitted normalized evidence image", cleanupError);
      }
    }
    throw callableError(error);
  }
});

exports.reviewAchievement = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const reviewerUid = requireAuthenticated(request);
  if (request.auth.token.achievementReviewer !== true) {
    throw new HttpsError("permission-denied", "Only an authorized achievement reviewer may review submissions.");
  }

  let review;
  try {
    review = validateReview(request.data);
  } catch (error) {
    throw callableError(error);
  }

  const submissionRef = db.collection("achievementSubmissions").doc(review.submissionId);
  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(submissionRef);
      if (!snapshot.exists) throw new HttpsError("not-found", "Achievement submission was not found.");
      const submission = snapshot.data();
      if (submission.ownerUid === reviewerUid) {
        throw new HttpsError("permission-denied", "Reviewers cannot review their own submissions.");
      }
      if (submission.status !== "pending") {
        throw new HttpsError("failed-precondition", "Only pending submissions can be reviewed.");
      }
      const userRef = db.collection("users").doc(submission.ownerUid);
      const publicProfileRef = db.collection("publicProfiles").doc(submission.ownerUid);
      const [userSnapshot, publicProfileSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(publicProfileRef)
      ]);
      transaction.update(submissionRef, {
        status: review.decision,
        reviewerUid,
        reviewNote: review.reviewNote,
        reviewedAt: FieldValue.serverTimestamp()
      });
      if (review.decision === "verified" && userSnapshot.exists) {
        const userData = userSnapshot.data();
        const verifiedAchievements = Array.isArray(userData.verifiedAchievements)
          ? userData.verifiedAchievements.filter((item) => item.submissionId !== review.submissionId)
          : [];
        verifiedAchievements.unshift({
          submissionId: review.submissionId,
          tournamentName: submission.tournamentName,
          game: submission.game,
          placement: submission.placement,
          eventDate: submission.eventDate
        });
        const savedAchievements = verifiedAchievements.slice(0, 30);
        transaction.update(userRef, { verifiedAchievements: savedAchievements });
        if (publicProfileSnapshot.exists) {
          transaction.update(publicProfileRef, { verifiedAchievements: savedAchievements });
        }
      }
    });
    return { submissionId: review.submissionId, status: review.decision };
  } catch (error) {
    throw callableError(error);
  }
});

function gamerRole(userData, requestedRole) {
  const role = userData.role || requestedRole || "Player";
  if (!["Player", "Teammate", "Sponsor", "Organizer"].includes(role)) {
    throw new HttpsError("invalid-argument", "Account role is invalid.");
  }
  return role;
}

async function reserveGamerId(transaction, uid, userData, countryCode) {
  const currentId = typeof userData.gamerId === "string" ? userData.gamerId : "";
  const match = currentId.match(GAMER_ID_PATTERN);
  const prefix = match ? match[1] : countryCode;
  const counterRef = db.collection("gamerIdCounters").doc(prefix);
  const counterSnapshot = await transaction.get(counterRef);
  const counterValue = counterSnapshot.exists ? Number(counterSnapshot.data().lastSerial) || 0 : 0;
  if (match) {
    const serial = Number(match[2]);
    if (!Number.isSafeInteger(serial) || serial < 1) throw new HttpsError("failed-precondition", "Existing Gamer ID is invalid.");
    const indexRef = db.collection("gamerIdIndex").doc(currentId);
    const indexSnapshot = await transaction.get(indexRef);
    if (indexSnapshot.exists && indexSnapshot.data().ownerUid !== uid) {
      throw new HttpsError("already-exists", "This Gamer ID is already assigned.");
    }
    transaction.set(indexRef, {
      ownerUid: uid,
      countryCode: prefix,
      assignedAt: userData.gamerIdIssuedAt || FieldValue.serverTimestamp()
    }, { merge: true });
    if (serial > counterValue) transaction.set(counterRef, { lastSerial: serial }, { merge: true });
    return currentId;
  }

  let serial = counterValue;
  let id;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    serial += 1;
    if (!Number.isSafeInteger(serial)) throw new HttpsError("resource-exhausted", "Gamer ID capacity has been reached.");
    id = formatGamerId(prefix, serial);
    const indexSnapshot = await transaction.get(db.collection("gamerIdIndex").doc(id));
    if (!indexSnapshot.exists) break;
    id = "";
  }
  if (!id) throw new HttpsError("resource-exhausted", "Could not reserve a unique Gamer ID.");
  transaction.set(db.collection("gamerIdIndex").doc(id), {
    ownerUid: uid,
    countryCode: prefix,
    assignedAt: FieldValue.serverTimestamp()
  });
  transaction.set(counterRef, { lastSerial: serial }, { merge: true });
  return id;
}

exports.ensureGamerIdentity = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const uid = requireAuthenticated(request);
  const requestedCountryCode = typeof request.data?.countryCode === "string"
    ? request.data.countryCode.toUpperCase() : "IND";
  if (!SUPPORTED_GAMER_COUNTRY_CODES.has(requestedCountryCode)) {
    throw new HttpsError("invalid-argument", "Choose a supported country code.");
  }
  const userRef = db.collection("users").doc(uid);
  try {
    return await db.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      const userData = userSnapshot.exists ? userSnapshot.data() : {};
      const role = gamerRole(userData, request.data?.role);
      const base = {
        uid,
        role,
        createdAt: userData.createdAt || FieldValue.serverTimestamp()
      };
      if (!userSnapshot.exists) base.email = request.auth.token.email || "";
      if (!["Player", "Teammate"].includes(role)) {
        transaction.set(userRef, base, { merge: true });
        return { role, gamerId: null, verificationStatus: "unverified" };
      }

      const countryCode = userData.gamerId
        ? String(userData.gamerId.match(GAMER_ID_PATTERN)?.[1] || userData.gamerIdCountryCode || requestedCountryCode)
        : requestedCountryCode;
      const gamerId = await reserveGamerId(transaction, uid, userData, countryCode);
      const verificationStatus = userData.verificationStatus || "unverified";
      const updatedUser = {
        ...base,
        gamerId,
        gamerIdCountryCode: countryCode,
        gamerIdIssuedAt: userData.gamerIdIssuedAt || FieldValue.serverTimestamp(),
        joinedAt: userData.joinedAt || userData.createdAt || FieldValue.serverTimestamp(),
        verificationStatus
      };
      transaction.set(userRef, updatedUser, { merge: true });
      return { role, gamerId, verificationStatus };
    });
  } catch (error) {
    throw callableError(error);
  }
});

exports.saveGamerProfile = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const uid = requireAuthenticated(request);
  let profile;
  let privateProfile;
  try {
    profile = normalizeGamerProfile(request.data?.gamerProfile);
    privateProfile = validatePrivateProfile(request.data?.privateProfile);
  } catch (error) {
    throw callableError(error);
  }
  const userRef = db.collection("users").doc(uid);
  const publicRef = db.collection("publicProfiles").doc(uid);
  try {
    await db.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists) throw new HttpsError("failed-precondition", "Complete account setup before editing your Gamer ID profile.");
      const userData = userSnapshot.data();
      if (!["Player", "Teammate"].includes(userData.role) || !GAMER_ID_PATTERN.test(userData.gamerId || "")) {
        throw new HttpsError("failed-precondition", "This account does not have a Gamer ID.");
      }
      const indexRef = db.collection("gamerIdIndex").doc(userData.gamerId);
      const indexSnapshot = await transaction.get(indexRef);
      if (!indexSnapshot.exists || indexSnapshot.data().ownerUid !== uid) {
        throw new HttpsError("failed-precondition", "Gamer ID ownership could not be confirmed.");
      }
      const updated = { ...userData, gamerProfile: profile };
      transaction.set(userRef, {
        ...privateProfile,
        uid,
        email: request.auth.token.email || userData.email || "",
        gamerProfile: profile,
        profileUpdatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      if (profile.profileVisibility === "public") {
        transaction.set(publicRef, publicProfileData(updated, userData.verificationStatus, () => FieldValue.serverTimestamp()), { merge: true });
      } else {
        transaction.delete(publicRef);
      }
    });
    return { status: "saved" };
  } catch (error) {
    throw callableError(error);
  }
});

exports.searchGamers = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const term = typeof request.data?.term === "string" ? request.data.term.trim().slice(0, 80) : "";
  const game = typeof request.data?.game === "string" ? request.data.game.trim().slice(0, 40) : "";
  const country = typeof request.data?.country === "string" ? request.data.country.trim().slice(0, 80) : "";
  const team = typeof request.data?.team === "string" ? request.data.team.trim().slice(0, 80) : "";
  if (!term && !game && !country && !team) {
    throw new HttpsError("invalid-argument", "Enter a Gamer ID, username, game, country, or team.");
  }
  const normalizedTerm = term.toLowerCase();
  try {
    let candidates = [];
    if (/^YT-[A-Z]{3}-\d{6,}$/i.test(term)) {
      const index = await db.collection("gamerIdIndex").doc(term.toUpperCase()).get();
      if (index.exists) {
        const profile = await db.collection("publicProfiles").doc(index.data().ownerUid).get();
        if (profile.exists && profile.data().profileVisibility === "public") candidates = [profile.data()];
      }
    } else {
      const searchable = (term || game || country || team).toLowerCase().normalize("NFKC");
      const token = searchable.split(/[^\p{L}\p{N}]+/u).filter(Boolean)[0]?.slice(0, 24);
      if (!token || token.length < 2) throw new HttpsError("invalid-argument", "Enter at least two searchable characters.");
      const snapshot = await db.collection("publicProfiles")
        .where("profileVisibility", "==", "public")
        .where("searchTokens", "array-contains", token)
        .limit(100).get();
      candidates = snapshot.docs.map((item) => item.data());
    }
    const tokens = normalizedTerm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const filtered = candidates.filter((profile) => {
      const fields = [profile.gamerTag, profile.gamerId, profile.country, profile.currentTeam,
        ...(profile.preferredGames || [])].map((value) => String(value || "").toLowerCase());
      const termMatches = !tokens.length || tokens.every((part) => fields.some((value) => value.includes(part)));
      return termMatches &&
        (!game || (profile.preferredGames || []).some((value) => value.toLowerCase() === game.toLowerCase())) &&
        (!country || String(profile.country || "").toLowerCase() === country.toLowerCase()) &&
        (!team || String(profile.currentTeam || "").toLowerCase().includes(team.toLowerCase()));
    });
    return { profiles: filtered.slice(0, 50).map(({ searchTokens, ...profile }) => profile) };
  } catch (error) {
    throw callableError(error);
  }
});

exports.getPublicGamerProfile = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const gamerId = typeof request.data?.gamerId === "string" ? request.data.gamerId.trim().toUpperCase() : "";
  if (!GAMER_ID_PATTERN.test(gamerId)) throw new HttpsError("invalid-argument", "Gamer ID is invalid.");
  try {
    const index = await db.collection("gamerIdIndex").doc(gamerId).get();
    if (!index.exists) throw new HttpsError("not-found", "Public Gamer ID profile was not found.");
    const profileSnapshot = await db.collection("publicProfiles").doc(index.data().ownerUid).get();
    if (!profileSnapshot.exists || profileSnapshot.data().profileVisibility !== "public") {
      throw new HttpsError("not-found", "Public Gamer ID profile was not found.");
    }
    const { searchTokens, ...profile } = profileSnapshot.data();
    return { profile };
  } catch (error) {
    throw callableError(error);
  }
});

exports.getMyPlayerVerification = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const uid = requireAuthenticated(request);
  try {
    const snapshot = await db.collection("playerVerificationSubmissions")
      .where("ownerUid", "==", uid).orderBy("createdAt", "desc").limit(10).get();
    const submissions = snapshot.docs.map((item) => {
      const data = item.data();
      return {
        requestId: item.id,
        status: data.status,
        details: data.details,
        evidenceUrl: data.evidenceUrl,
        reviewNote: data.reviewNote || "",
        createdAt: data.createdAt
      };
    });
    submissions.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    return { submissions };
  } catch (error) {
    throw callableError(error);
  }
});

exports.getMyGamerPortfolio = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const uid = requireAuthenticated(request);
  try {
    const [userSnapshot, publicSnapshot] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("publicProfiles").doc(uid).get()
    ]);
    if (!userSnapshot.exists) throw new HttpsError("not-found", "Gamer ID profile was not found.");
    const userData = userSnapshot.data();
    const publicData = publicSnapshot.exists ? publicSnapshot.data() : {};
    const { searchTokens, ...publicProfile } = publicData;
    return {
      gamerId: userData.gamerId || "",
      verificationStatus: userData.verificationStatus || "unverified",
      profile: publicData.profileVisibility === "public" ? publicProfile : null,
      verifiedAchievements: Array.isArray(userData.verifiedAchievements) ? userData.verifiedAchievements : []
    };
  } catch (error) {
    throw callableError(error);
  }
});

exports.submitPlayerVerification = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const uid = requireAuthenticated(request);
  let submission;
  try {
    submission = validatePlayerVerification(request.data);
  } catch (error) {
    throw callableError(error);
  }
  const userRef = db.collection("users").doc(uid);
  const requestRef = db.collection("playerVerificationSubmissions").doc();
  try {
    await db.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists || !GAMER_ID_PATTERN.test(userSnapshot.data().gamerId || "")) {
        throw new HttpsError("failed-precondition", "A Gamer ID profile is required before requesting verification.");
      }
      const userData = userSnapshot.data();
      if (userData.verificationStatus === "verified") {
        throw new HttpsError("failed-precondition", "This Gamer ID is already verified.");
      }
      if (userData.verificationStatus === "pending") {
        throw new HttpsError("failed-precondition", "A verification request is already being reviewed.");
      }
      const publicRef = db.collection("publicProfiles").doc(uid);
      const publicSnapshot = await transaction.get(publicRef);
      transaction.create(requestRef, {
        ownerUid: uid,
        gamerId: userData.gamerId,
        details: submission.details,
        evidenceUrl: submission.evidenceUrl,
        status: "pending",
        createdAt: FieldValue.serverTimestamp()
      });
      transaction.update(userRef, { verificationStatus: "pending" });
      if (publicSnapshot.exists) transaction.update(publicRef, { verificationStatus: "pending" });
    });
    return { requestId: requestRef.id, status: "pending" };
  } catch (error) {
    throw callableError(error);
  }
});

exports.listPlayerVerificationRequests = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  requireAuthenticated(request);
  if (request.auth.token.playerVerifier !== true) {
    throw new HttpsError("permission-denied", "Only an authorized player verifier may review Gamer ID requests.");
  }
  try {
    const snapshot = await db.collection("playerVerificationSubmissions")
      .where("status", "==", "pending").limit(50).get();
    return { submissions: snapshot.docs.map((item) => {
      const data = item.data();
      return {
        requestId: item.id,
        gamerId: data.gamerId,
        ownerUid: data.ownerUid,
        details: data.details,
        evidenceUrl: data.evidenceUrl,
        createdAt: data.createdAt
      };
    }) };
  } catch (error) {
    throw callableError(error);
  }
});

exports.reviewPlayerVerification = onCall({ region: "us-central1", maxInstances: 10 }, async (request) => {
  const reviewerUid = requireAuthenticated(request);
  if (request.auth.token.playerVerifier !== true) {
    throw new HttpsError("permission-denied", "Only an authorized player verifier may review Gamer ID requests.");
  }
  let review;
  try {
    review = validatePlayerVerificationReview(request.data);
  } catch (error) {
    throw callableError(error);
  }
  const requestRef = db.collection("playerVerificationSubmissions").doc(review.requestId);
  try {
    await db.runTransaction(async (transaction) => {
      const submissionSnapshot = await transaction.get(requestRef);
      if (!submissionSnapshot.exists) throw new HttpsError("not-found", "Verification request was not found.");
      const submission = submissionSnapshot.data();
      if (submission.ownerUid === reviewerUid) {
        throw new HttpsError("permission-denied", "Reviewers cannot review their own verification requests.");
      }
      if (submission.status !== "pending") {
        throw new HttpsError("failed-precondition", "Only pending requests can be reviewed.");
      }
      const userRef = db.collection("users").doc(submission.ownerUid);
      const publicRef = db.collection("publicProfiles").doc(submission.ownerUid);
      const [userSnapshot, publicSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(publicRef)
      ]);
      if (!userSnapshot.exists || userSnapshot.data().gamerId !== submission.gamerId) {
        throw new HttpsError("failed-precondition", "Gamer ID ownership has changed.");
      }
      const verificationStatus = review.decision === "verified" ? "verified" : "unverified";
      transaction.update(requestRef, {
        status: review.decision,
        reviewerUid,
        reviewNote: review.reviewNote,
        reviewedAt: FieldValue.serverTimestamp()
      });
      transaction.update(userRef, { verificationStatus });
      if (publicSnapshot.exists) transaction.update(publicRef, { verificationStatus });
    });
    return { requestId: review.requestId, status: review.decision };
  } catch (error) {
    throw callableError(error);
  }
});

exports.getGamerQr = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const uid = requireAuthenticated(request);
  try {
    const snapshot = await db.collection("users").doc(uid).get();
    const gamerId = snapshot.exists ? snapshot.data().gamerId : "";
    if (!GAMER_ID_PATTERN.test(gamerId || "")) {
      throw new HttpsError("failed-precondition", "A Gamer ID is required before creating a QR card.");
    }
    const publicProfile = await db.collection("publicProfiles").doc(uid).get();
    if (!publicProfile.exists || publicProfile.data().profileVisibility !== "public") {
      throw new HttpsError("failed-precondition", "Set your profile to public before creating a scannable Gamer ID card.");
    }
    const url = `https://yt-esports-ad314.web.app/#gamer/${encodeURIComponent(gamerId)}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 360,
      color: { dark: "#10101B", light: "#FFFFFF" }
    });
    return { url, qrDataUrl };
  } catch (error) {
    throw callableError(error);
  }
});

exports.cleanupDeletedUser = functionsV1.auth.user().onDelete(async (user) => {
  const uid = user.uid;
  try {
    const verificationQuery = db.collection("playerVerificationSubmissions")
      .where("ownerUid", "==", uid).limit(400);
    let verification = await verificationQuery.get();
    while (!verification.empty) {
      const batch = db.batch();
      verification.docs.forEach((item) => batch.delete(item.ref));
      await batch.commit();
      verification = await verificationQuery.get();
    }
    const batch = db.batch();
    batch.delete(db.collection("users").doc(uid));
    batch.delete(db.collection("publicProfiles").doc(uid));
    await batch.commit();
  } catch (error) {
    logger.error("Could not clean up deleted account data", { uid, error });
    throw error;
  }
});
