"use strict";

function publicProfileData(userData, verificationStatus, serverTimestamp) {
  const profile = userData.gamerProfile || {};
  const values = [
    profile.gamerTag, profile.currentTeam, profile.country,
    ...(Array.isArray(profile.preferredGames) ? profile.preferredGames : [])
  ].filter((value) => typeof value === "string");
  const searchTokens = new Set();
  for (const value of values) {
    for (const word of value.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      for (let length = 2; length <= Math.min(word.length, 24); length += 1) {
        searchTokens.add(word.slice(0, length));
      }
    }
  }
  if (typeof userData.gamerId === "string") searchTokens.add(userData.gamerId.toLowerCase());
  const timestamp = serverTimestamp();
  return {
    gamerId: userData.gamerId,
    gamerTag: profile.gamerTag || "",
    gameId: profile.gameId || "",
    avatar: profile.avatar || "",
    country: profile.country || "",
    countryCode: profile.countryCode || "",
    preferredGames: Array.isArray(profile.preferredGames) ? profile.preferredGames : [],
    currentTeam: profile.currentTeam || "",
    experienceStartYear: profile.experienceStartYear || null,
    playerRole: profile.playerRole || "",
    bio: profile.bio || "",
    socialLinks: profile.socialLinks || {},
    teamHistory: Array.isArray(profile.teamHistory) ? profile.teamHistory : [],
    highlightUrl: profile.highlightUrl || "",
    joinedAt: userData.joinedAt || timestamp,
    verificationStatus: verificationStatus || "unverified",
    verifiedAchievements: Array.isArray(userData.verifiedAchievements) ? userData.verifiedAchievements : [],
    profileVisibility: profile.profileVisibility || "public",
    searchTokens: [...searchTokens].slice(0, 250),
    updatedAt: timestamp
  };
}

module.exports = { publicProfileData };
