"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  validateDecodedImage,
  validateEvidenceMetadata,
  validateReview,
  validateSubmission
} = require("../validation");

const validSubmission = {
  submissionId: "achievement_12345",
  tournamentName: "Regional Championship",
  game: "BGMI",
  placement: "1st place",
  organizer: "",
  eventDate: "2026-01-15",
  details: "Finals"
};

test("accepts and trims valid achievement details", () => {
  assert.equal(validateSubmission({ ...validSubmission, tournamentName: " Regional Championship " }).tournamentName, "Regional Championship");
});

test("rejects invalid dates including normalized impossible dates", () => {
  assert.throws(() => validateSubmission({ ...validSubmission, eventDate: "2026-02-30" }), /valid calendar date/);
  assert.throws(() => validateSubmission({ ...validSubmission, eventDate: "not-a-date" }), /YYYY-MM-DD/);
});

test("rejects oversized or invalid evidence upload metadata", () => {
  assert.throws(() => validateEvidenceMetadata({
    size: 10 * 1024 * 1024 + 1,
    contentType: "image/jpeg",
    customMetadata: { ownerUid: "player", submissionId: validSubmission.submissionId }
  }), /10 MB/);
  assert.throws(() => validateEvidenceMetadata({
    size: 10,
    contentType: "application/pdf",
    customMetadata: { ownerUid: "player", submissionId: validSubmission.submissionId }
  }), /JPEG, PNG, or WebP/);
});

test("accepts supported images and rejects malformed or oversized dimensions", () => {
  assert.doesNotThrow(() => validateDecodedImage({ format: "webp", width: 2000, height: 1000 }));
  assert.throws(() => validateDecodedImage({ format: "gif", width: 100, height: 100 }), /supported/);
  assert.throws(() => validateDecodedImage({ format: "jpeg", width: 10000, height: 10000 }), /dimensions/);
});

test("decodes and normalizes a supported evidence image", async () => {
  const input = await sharp({
    create: { width: 4, height: 3, channels: 4, background: { r: 20, g: 120, b: 240, alpha: 1 } }
  }).png().toBuffer();
  const image = sharp(input, { limitInputPixels: 50_000_000 });
  const metadata = await image.metadata();
  validateDecodedImage(metadata);
  const normalized = await image.rotate().resize({
    width: 4096,
    height: 4096,
    fit: "inside",
    withoutEnlargement: true
  }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  assert.equal((await sharp(normalized).metadata()).format, "jpeg");
});

test("requires reviewer notes for rejections and validates review decisions", () => {
  assert.deepEqual(validateReview({ submissionId: "achievement_12345", decision: "verified" }), {
    submissionId: "achievement_12345",
    decision: "verified",
    reviewNote: ""
  });
  assert.throws(() => validateReview({ submissionId: "achievement_12345", decision: "rejected" }), /required/);
  assert.throws(() => validateReview({ submissionId: "achievement_12345", decision: "pending" }), /verified or rejected/);
});
