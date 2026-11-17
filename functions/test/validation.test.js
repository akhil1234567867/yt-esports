"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { publicProfileData } = require("../gamer-profile");
const {
  formatGamerId,
  normalizeGamerProfile,
  validateDecodedImage,
  validateEvidenceMetadata,
  validatePrivateProfile,
  validatePlayerVerification,
  validatePlayerVerificationReview,
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

test("formats a sequential country-prefixed Gamer ID", () => {
  assert.equal(formatGamerId("IND", 1), "YT-IND-000001");
  assert.equal(formatGamerId("USA", 1_000_000), "YT-USA-1000000");
  assert.throws(() => formatGamerId("IN", 1), /components/);
});

test("normalizes the public Gamer ID profile fields without private account data", () => {
  const profile = normalizeGamerProfile({
    gamerTag: "  PixelRift ",
    country: "India",
    countryCode: "ind",
    preferredGames: ["Valorant", "BGMI"],
    playerRole: "Entry",
    experienceStartYear: "2020",
    teamHistory: ["North Stars"],
    socialLinks: { youtube: "https://youtube.com/@pixelrift" },
    phone: "not copied"
  });
  assert.equal(profile.gamerTag, "PixelRift");
  assert.equal(profile.countryCode, "IND");
  assert.equal(profile.experienceStartYear, 2020);
  assert.deepEqual(profile.teamHistory, ["North Stars"]);
  assert.equal(profile.phone, undefined);
  assert.throws(() => normalizeGamerProfile({
    gamerTag: "Player",
    country: "India",
    countryCode: "IND",
    preferredGames: ["Valorant"],
    socialLinks: { youtube: "https://malicious.example/player" }
  }), /official HTTPS domain/);
  assert.throws(() => normalizeGamerProfile({
    gamerTag: "Player",
    country: "India",
    countryCode: "IND",
    preferredGames: []
  }), /preferred games/);
  assert.throws(() => normalizeGamerProfile({
    gamerTag: "Player",
    country: "Somewhere",
    countryCode: "XYZ",
    preferredGames: ["BGMI"]
  }), /supported country code/);
});

test("validates player verification requests and reviewer decisions", () => {
  assert.deepEqual(validatePlayerVerification({
    details: "I have competed in three regional tournaments.",
    evidenceUrl: "https://example.com/results"
  }), {
    details: "I have competed in three regional tournaments.",
    evidenceUrl: "https://example.com/results"
  });
  assert.throws(() => validatePlayerVerification({ details: "Too short" }), /between 20 and 1000 characters/);
  assert.throws(() => validatePlayerVerificationReview({
    requestId: "request_12345",
    decision: "rejected"
  }), /reviewer note/);
  assert.deepEqual(validatePlayerVerificationReview({
    requestId: "request_12345",
    decision: "verified",
    reviewNote: "Reviewed official tournament results."
  }), {
    requestId: "request_12345",
    decision: "verified",
    reviewNote: "Reviewed official tournament results."
  });
});

test("validates private account profile input separately from the public profile", () => {
  const profile = validatePrivateProfile({
    gamerTag: "PixelRift",
    gameId: "px-01",
    realName: "Private Name",
    team: "North Stars",
    game: "Valorant",
    role: "Entry",
    level: "Amateur",
    city: "Pune",
    state: "Maharashtra",
    startYear: "2020",
    introduction: "A short intro.",
    age: "20",
    phone: "9876543210",
    email: "player@example.com",
    gender: "Prefer not to say"
  });
  assert.equal(profile.fn, "Private Name");
  assert.equal(profile.ph, "9876543210");
  assert.throws(() => validatePrivateProfile({
    gamerTag: "Player", realName: "Name", game: "BGMI", city: "Pune", state: "Maharashtra",
    age: "15", phone: "9876543210", email: "player@example.com", gender: "Other"
  }), /between 16 and 60/);
});

test("projects only approved identity and achievement fields to the public profile", () => {
  const timestamp = { serverTimestamp: true };
  const profile = publicProfileData({
    gamerId: "YT-IND-000001",
    email: "private@example.com",
    ph: "9876543210",
    fn: "Private Name",
    a: 20,
    c: "Private City",
    verifiedAchievements: [{ tournamentName: "Final", game: "BGMI", placement: "Winner" }],
    gamerProfile: {
      gamerTag: "PixelRift",
      country: "India",
      countryCode: "IND",
      preferredGames: ["BGMI"],
      playerRole: "Duelist",
      currentTeam: "North Stars",
      experienceStartYear: 2020,
      profileVisibility: "public"
    }
  }, "verified", () => timestamp);
  assert.equal(profile.gamerId, "YT-IND-000001");
  assert.equal(profile.gamerTag, "PixelRift");
  assert.equal(profile.joinedAt, timestamp);
  assert.equal(profile.updatedAt, timestamp);
  assert.ok(profile.searchTokens.includes("pixel"));
  assert.ok(profile.searchTokens.includes("du"));
  for (const privateField of ["email", "ph", "fn", "a", "c"]) {
    assert.equal(Object.hasOwn(profile, privateField), false);
  }
});
