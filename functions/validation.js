"use strict";

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;
const ALLOWED_IMAGE_FORMATS = new Set(["jpeg", "png", "webp"]);

function requiredText(value, field, maxLength, minLength = 1) {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new RangeError(`${field} must be between ${minLength} and ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new RangeError(`${field} must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function validateSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Submission data must be an object.");
  }
  const submissionId = requiredText(input.submissionId, "Submission ID", 80, 10);
  if (!/^[A-Za-z0-9_-]+$/.test(submissionId)) {
    throw new TypeError("Submission ID contains invalid characters.");
  }
  const eventDate = requiredText(input.eventDate, "Tournament date", 10, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new TypeError("Tournament date must use YYYY-MM-DD.");
  }
  const date = new Date(`${eventDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== eventDate) {
    throw new TypeError("Tournament date is not a valid calendar date.");
  }
  if (eventDate > new Date().toISOString().slice(0, 10)) {
    throw new RangeError("Tournament date cannot be in the future.");
  }
  return {
    submissionId,
    tournamentName: requiredText(input.tournamentName, "Tournament name", 120, 3),
    game: requiredText(input.game, "Game", 60),
    placement: requiredText(input.placement, "Placement", 80),
    organizer: optionalText(input.organizer, "Organizer", 120),
    eventDate,
    details: optionalText(input.details, "Details", 1200)
  };
}

function validateEvidenceMetadata(metadata) {
  if (!metadata || !Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > MAX_EVIDENCE_BYTES) {
    throw new RangeError("Evidence must be a non-empty image no larger than 10 MB.");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(metadata.contentType)) {
    throw new TypeError("Evidence must be a JPEG, PNG, or WebP image.");
  }
  if (!metadata.customMetadata || typeof metadata.customMetadata.ownerUid !== "string" || typeof metadata.customMetadata.submissionId !== "string") {
    throw new TypeError("Evidence upload ownership metadata is invalid.");
  }
}

function validateDecodedImage(metadata) {
  if (!metadata || !ALLOWED_IMAGE_FORMATS.has(metadata.format)) {
    throw new TypeError("Uploaded evidence is not a supported JPEG, PNG, or WebP image.");
  }
  if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) ||
      metadata.width < 1 || metadata.height < 1 ||
      metadata.width > 12000 || metadata.height > 12000 ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new RangeError("Image dimensions exceed the allowed limits.");
  }
}

function validateReview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Review data must be an object.");
  }
  const submissionId = requiredText(input.submissionId, "Submission ID", 80, 10);
  if (!/^[A-Za-z0-9_-]+$/.test(submissionId)) {
    throw new TypeError("Submission ID contains invalid characters.");
  }
  if (input.decision !== "verified" && input.decision !== "rejected") {
    throw new TypeError("Decision must be verified or rejected.");
  }
  const reviewNote = optionalText(input.reviewNote, "Reviewer note", 1000);
  if (input.decision === "rejected" && !reviewNote) {
    throw new TypeError("A reviewer note is required when rejecting a submission.");
  }
  return { submissionId, decision: input.decision, reviewNote };
}

module.exports = {
  ALLOWED_IMAGE_FORMATS,
  MAX_EVIDENCE_BYTES,
  MAX_IMAGE_PIXELS,
  validateDecodedImage,
  validateEvidenceMetadata,
  validateReview,
  validateSubmission
};
