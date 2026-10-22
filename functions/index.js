"use strict";

const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const sharp = require("sharp");
const {
  MAX_EVIDENCE_BYTES,
  validateDecodedImage,
  validateEvidenceMetadata,
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
  logger.error("Achievement operation failed", error);
  return new HttpsError("internal", "The achievement operation failed.");
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
      transaction.update(submissionRef, {
        status: review.decision,
        reviewerUid,
        reviewNote: review.reviewNote,
        reviewedAt: FieldValue.serverTimestamp()
      });
    });
    return { submissionId: review.submissionId, status: review.decision };
  } catch (error) {
    throw callableError(error);
  }
});
