"use strict";

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;
const ALLOWED_IMAGE_FORMATS = new Set(["jpeg", "png", "webp"]);
const GAMER_ID_PATTERN = /^YT-([A-Z]{3})-(\d{6,})$/;
const PROFILE_GAMES_LIMIT = 5;
const SUPPORTED_GAMER_COUNTRY_CODES = new Set([
  "IND", "USA", "GBR", "CAN", "AUS", "BRA", "IDN", "JPN", "KOR", "PHL",
  "PAK", "BGD", "DEU", "FRA", "MEX", "ZAF", "ARE", "NZL", "SGP", "NPL",
  "LKA", "TUR", "POL", "ESP", "ITA", "OTH"
]);

function formatGamerId(countryCode, serial) {
  if (!/^[A-Z]{3}$/.test(countryCode) || !Number.isSafeInteger(serial) || serial < 1) {
    throw new TypeError("Gamer ID components are invalid.");
  }
  return `YT-${countryCode}-${String(serial).padStart(6, "0")}`;
}

function normalizeGamerProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Gamer profile data must be an object.");
  }
  const gamerTag = requiredText(input.gamerTag, "Gaming username", 24, 2);
  if (!/^[\p{L}\p{N}_. -]+$/u.test(gamerTag)) {
    throw new TypeError("Gaming username contains unsupported characters.");
  }
  const country = requiredText(input.country, "Country", 80);
  const countryCode = requiredText(input.countryCode, "Country code", 3, 3).toUpperCase();
  if (!SUPPORTED_GAMER_COUNTRY_CODES.has(countryCode)) throw new TypeError("Choose a supported country code.");
  const preferredGames = input.preferredGames;
  if (!Array.isArray(preferredGames) || preferredGames.length < 1 || preferredGames.length > PROFILE_GAMES_LIMIT) {
    throw new RangeError(`Choose between 1 and ${PROFILE_GAMES_LIMIT} preferred games.`);
  }
  const games = [...new Set(preferredGames.map((game) => requiredText(game, "Game", 40)))];
  if (games.length !== preferredGames.length) throw new TypeError("Preferred games must be unique.");

  const avatar = optionalText(input.avatar, "Profile picture", 200_000);
  if (avatar && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) {
    throw new TypeError("Profile picture must be an uploaded JPEG, PNG, or WebP image.");
  }
  const socialInput = input.socialLinks && typeof input.socialLinks === "object" && !Array.isArray(input.socialLinks)
    ? input.socialLinks : {};
  const socialLinks = {};
  for (const [name, host] of Object.entries({
    instagram: ["instagram.com"],
    youtube: ["youtube.com", "youtu.be"],
    twitch: ["twitch.tv"]
  })) {
    const value = optionalText(socialInput[name], `${name} link`, 240);
    if (!value) continue;
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError(`${name} link must be a valid HTTPS URL.`);
    }
    if (url.protocol !== "https:" || !host.some((domain) => url.hostname === domain || url.hostname === `www.${domain}`) || url.username || url.password) {
      throw new TypeError(`${name} link must use its official HTTPS domain.`);
    }
    socialLinks[name] = url.toString();
  }

  const startYear = input.experienceStartYear === "" || input.experienceStartYear == null
    ? null : Number(input.experienceStartYear);
  const currentYear = new Date().getUTCFullYear();
  if (startYear !== null && (!Number.isInteger(startYear) || startYear < 1970 || startYear > currentYear)) {
    throw new RangeError("Gaming experience year is invalid.");
  }
  const teamHistory = input.teamHistory === undefined || input.teamHistory === null ? [] : input.teamHistory;
  if (!Array.isArray(teamHistory) || teamHistory.length > 8) {
    throw new RangeError("Team history can contain up to 8 teams.");
  }
  const cleanTeamHistory = [...new Set(teamHistory.map((team) => requiredText(team, "Team history entry", 60)))];
  const highlightUrl = optionalText(input.highlightUrl, "Gaming highlight link", 500);
  if (highlightUrl) {
    let url;
    try {
      url = new URL(highlightUrl);
    } catch {
      throw new TypeError("Gaming highlight must be a valid HTTPS URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new TypeError("Gaming highlight must be a public HTTPS link.");
    }
  }
  if (input.profileVisibility !== undefined && !["public", "private"].includes(input.profileVisibility)) {
    throw new TypeError("Profile visibility must be public or private.");
  }
  return {
    gamerTag,
    gameId: optionalText(input.gameId, "In-game ID", 80),
    avatar,
    country,
    countryCode,
    preferredGames: games,
    currentTeam: optionalText(input.currentTeam, "Current team", 80),
    experienceStartYear: startYear,
    playerRole: optionalText(input.playerRole, "Player role", 60),
    bio: optionalText(input.bio, "Introduction", 240),
    socialLinks,
    teamHistory: cleanTeamHistory,
    highlightUrl,
    profileVisibility: input.profileVisibility || "public"
  };
}

function validatePlayerVerification(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Verification request data must be an object.");
  }
  const details = requiredText(input.details, "Verification details", 1000, 20);
  const evidenceUrl = optionalText(input.evidenceUrl, "Evidence link", 500);
  if (evidenceUrl) {
    let url;
    try {
      url = new URL(evidenceUrl);
    } catch {
      throw new TypeError("Evidence link must be a valid HTTPS URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new TypeError("Evidence link must be a public HTTPS URL.");
    }
  }
  return { details, evidenceUrl };
}

function validatePrivateProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Private profile data must be an object.");
  }
  const age = Number(input.age);
  if (!Number.isInteger(age) || age < 16 || age > 60) throw new RangeError("Age must be between 16 and 60.");
  const phone = requiredText(input.phone, "Phone number", 10, 10);
  if (!/^[6-9]\d{9}$/.test(phone)) throw new TypeError("Phone number must be a valid 10-digit number.");
  const email = requiredText(input.email, "Contact email", 254);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new TypeError("Contact email is invalid.");
  const avatar = optionalText(input.avatar, "Profile picture", 200_000);
  if (avatar && !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) {
    throw new TypeError("Profile picture must be an uploaded JPEG, PNG, or WebP image.");
  }
  const startYear = input.startYear === "" || input.startYear == null ? null : Number(input.startYear);
  if (startYear !== null && (!Number.isInteger(startYear) || startYear < 1970 || startYear > new Date().getUTCFullYear())) {
    throw new RangeError("Gaming experience year is invalid.");
  }
  return {
    n: requiredText(input.gamerTag, "Gaming username", 24, 2),
    gid: optionalText(input.gameId, "In-game ID", 80),
    fn: optionalText(input.realName, "Real name", 80),
    t: optionalText(input.team, "Current team", 80) || "Solo",
    g: requiredText(input.game, "Game", 40),
    r: optionalText(input.role, "Player role", 60) || "Player",
    lv: optionalText(input.level, "Experience level", 30) || "Beginner",
    c: requiredText(input.city, "City", 80),
    st: requiredText(input.state, "State or region", 80),
    s: startYear || new Date().getUTCFullYear(),
    b: optionalText(input.introduction, "Introduction", 1000),
    a: age,
    ph: phone,
    em: email,
    gd: requiredText(input.gender, "Gender", 30),
    img: avatar
  };
}

function validatePlayerVerificationReview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Verification review data must be an object.");
  }
  const requestId = requiredText(input.requestId, "Verification request ID", 80, 10);
  if (!/^[A-Za-z0-9_-]+$/.test(requestId)) throw new TypeError("Verification request ID is invalid.");
  if (!["verified", "rejected"].includes(input.decision)) {
    throw new TypeError("Decision must be verified or rejected.");
  }
  const reviewNote = optionalText(input.reviewNote, "Reviewer note", 1000);
  if (input.decision === "rejected" && !reviewNote) {
    throw new TypeError("A reviewer note is required when rejecting verification.");
  }
  return { requestId, decision: input.decision, reviewNote };
}

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
  GAMER_ID_PATTERN,
  MAX_EVIDENCE_BYTES,
  MAX_IMAGE_PIXELS,
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
};
