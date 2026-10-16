// ===== ELO Utilities =====
// Resolve a user's ELO from the leaderboard using the 3-key identity lookup.

export function resolveElo(eloLeaderboard, user) {
  if (!eloLeaderboard || !Array.isArray(eloLeaderboard) || !user) return null;
  const keys = [];
  if (user.linkedDiscord) keys.push(`discord:${user.linkedDiscord}`);
  if (user.platform && (user.platformUserId || user.id)) {
    keys.push(`${user.platform}:${user.platformUserId || user.id}`);
  }
  keys.push(`nick:${(user.displayName || user.username || '').toLowerCase()}`);

  for (const entry of eloLeaderboard) {
    if (!entry || !entry.identityKey) continue;
    if (keys.includes(entry.identityKey)) {
      return entry;
    }
  }
  return null;
}

export function formatElo(eloEntry) {
  if (!eloEntry || typeof eloEntry.elo !== 'number') return '';
  return String(eloEntry.elo);
}
