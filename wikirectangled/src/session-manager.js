// session-manager.js - Player identity normalization + persistent sessions.
//
// Two kinds of clients connect to WiKirecTangled:
//   - **Web players** — browser tabs. We hand each browser a UUID sessionId
//     the first time it connects, persisted client-side in localStorage so
//     refreshing keeps the same identity. Their identity key is `web:<sessionId>`.
//   - **Chat-platform players** — Discord/Twitch/etc users whose identity arrives
//     pre-resolved from Chat Relay. Their identity key is `<platform>:<platformUserId>`.
//
// Both flow through `resolveSession()` which returns a normalized session
// object: { sessionId, identityKey, platform, platformUserId, displayName,
// profileImage }. The `identityKey` is what every downstream system uses —
// game.guess, db.recordFind, db.upsertParticipant, leaderboards, ELO reports.
//
// Sessions are persisted to the `sessions` table (see src/database.js) so
// display-name + profile-image survive server restarts.

const crypto = require('crypto');
const db = require('./database');

const VALID_PLATFORMS = new Set(['web', 'discord', 'twitch', 'youtube', 'kick', 'tiktok']);

function generateSessionId() {
  // Short, URL-safe, 16 random bytes → 22 chars base64url.
  return crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalizePlatform(platform) {
  const p = String(platform || 'web').toLowerCase();
  return VALID_PLATFORMS.has(p) ? p : 'web';
}

// Identity-key shape — single source of truth. Used everywhere. Format:
//   web:<sessionId>            (browser players, sessionId persists across refreshes)
//   discord:<snowflake>        (Discord)
//   twitch:<userId>            (Twitch)
//   <platform>:<platformUserId> (anything else)
function buildIdentityKey(platform, platformUserId) {
  const p = normalizePlatform(platform);
  return `${p}:${platformUserId}`;
}

// Web entry point. Called from socket connection handshake.
//   - If client sent a sessionId we recognize, return that session.
//   - If client sent an unknown sessionId, honor it and create the session row.
//   - If client sent no sessionId, generate one.
// Display name is updated if the client sent one (lets players rename mid-game).
function resolveWebSession({ sessionId, displayName, profileImage } = {}, verifiedAccountId = null) {
  // Logged-in via wordtycoon.live: discord id becomes the canonical identity.
  // Anonymous: fall back to random sessionId-as-platformUserId.
  if (typeof verifiedAccountId === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(verifiedAccountId)) {
    const platform = 'discord';
    const platformUserId = verifiedAccountId;
    const identityKey = buildIdentityKey(platform, platformUserId);
    const existing = db.findSessionByIdentity(identityKey);
    const session = {
      sessionId: existing ? existing.session_id : generateSessionId(),
      platform,
      platformUserId,
      identityKey,
      displayName: displayName || (existing && existing.display_name) || null,
      profileImage: profileImage || (existing && existing.profile_image) || null,
      createdAt: existing ? existing.created_at : Date.now(),
      lastSeenAt: Date.now(),
    };
    db.upsertSession(session);
    return session;
  }

  // Anonymous web player — same as before.
  let id = sessionId && /^[A-Za-z0-9_-]{8,64}$/.test(sessionId) ? sessionId : null;
  let existing = id ? db.getSessionById(id) : null;
  if (existing && existing.identity_key !== buildIdentityKey('web', id)) { id = null; existing = null; }
  if (!id) id = generateSessionId();
  const session = {
    sessionId: id,
    platform: 'web',
    platformUserId: 'web_guest_' + id,
    identityKey: buildIdentityKey('web', id),
    displayName: displayName || (existing && existing.display_name) || null,
    profileImage: profileImage || (existing && existing.profile_image) || null,
    createdAt: existing ? existing.created_at : Date.now(),
    lastSeenAt: Date.now(),
  };
  db.upsertSession(session);
  return session;
}

// Chat-platform entry point. Called from the Chat Relay bridge (Roadmap #4)
// when a chat user submits a guess. The (platform, platformUserId) pair is the
// canonical identity — Chat Relay has already done OAuth + ID resolution.
function resolveChatSession({ platform, platformUserId, displayName, profileImage, linkedDiscord, isFanClub }) {
  if (!platformUserId) throw new Error('resolveChatSession: platformUserId required');
  // Cross-platform account linking: when chat-relay marks a user with a
  // linked Discord, use 'discord:<discordId>' as the canonical identity so
  // the same person on TikTok / YouTube / Discord / web all resolve to one
  // profile. (Mirrors searchle/server/guess-processor.js & session-manager.js.)
  const useDiscord = !!(linkedDiscord && /^\d{5,}$/.test(String(linkedDiscord)));
  const p = useDiscord ? 'discord' : normalizePlatform(platform);
  const canonicalUserId = useDiscord ? String(linkedDiscord) : String(platformUserId);
  const identityKey = buildIdentityKey(p, canonicalUserId);
  const existing = db.findSessionByIdentity(identityKey);

  const session = {
    sessionId: existing ? existing.session_id : generateSessionId(),
    platform: p,
    platformUserId: canonicalUserId,
    identityKey,
    // Keep the chat platform's displayName/avatar — that's what the player
    // recognizes in chat and what the streamer sees on screen.
    displayName: displayName || (existing && existing.display_name) || null,
    profileImage: profileImage || (existing && existing.profile_image) || null,
    isFanClub: !!isFanClub,
    createdAt: existing ? existing.created_at : Date.now(),
    lastSeenAt: Date.now(),
  };

  db.upsertSession(session);
  return session;
}

// Update profile fields without touching identity. Called when a player edits
// their display name or a chat platform sends a fresh profile image URL.
function updateProfile(session, { displayName, profileImage }) {
  if (!session) return session;
  let changed = false;
  if (displayName && displayName !== session.displayName) {
    session.displayName = String(displayName).slice(0, 32);
    changed = true;
  }
  if (profileImage && profileImage !== session.profileImage) {
    session.profileImage = profileImage;
    changed = true;
  }
  if (changed) {
    session.lastSeenAt = Date.now();
    db.upsertSession(session);
  }
  return session;
}

// Bump last_seen_at without re-writing the whole row — cheap, called on every
// heartbeat / activity ping to keep the "online players" view honest.
function touch(sessionId) {
  if (sessionId) db.touchSession(sessionId);
}

module.exports = {
  buildIdentityKey,
  resolveWebSession,
  resolveChatSession,
  updateProfile,
  touch,
  generateSessionId,
};
