'use strict';
// Browser identity comes from fresh Relay proof. Client profile fields never
// authorize an account or attach a socket to another player's solo session.
function createWebIdentity({ sdk, sessions }) {
  function account(socket, verified) { return verified ? (socket._wtVerifiedAnchorId || verified) : null; }
  async function resolve(socket, input = {}) {
    const request = (socket.data.identityRequest || 0) + 1;
    socket.data.identityRequest = request;
    const verified = socket.data.daily3Preview ? null : await sdk.verifySocketIdentity(socket);
    if (socket.connected === false || socket.data.identityRequest !== request) return null;
    const id = account(socket, verified);
    const claimed = input && input.discordUserId;
    if (id && claimed && !socket._wtVerifiedAliases?.has(String(claimed))) {
      socket.data.session = null; socket.data.solo = null;
      socket.data.identityEpoch = (socket.data.identityEpoch || 0) + 1;
      socket.emit('identity-required', { reason: 'identity_mismatch' });
      return null;
    }
    const profile = {
      sessionId: socket.data.guestSessionId || (typeof input.sessionId === 'string' ? input.sessionId : null),
      displayName: String(input.discordDisplayName || input.displayName || 'Guest').slice(0, 64),
      profileImage: typeof (input.discordAvatar || input.profileImage) === 'string' ? String(input.discordAvatar || input.profileImage).slice(0, 2048) : null,
    };
    const session = sessions.resolveWebSession(profile, id);
    if (session.platform === 'web') socket.data.guestSessionId = session.sessionId;
    if (socket.data.session?.identityKey !== session.identityKey) {
      socket.data.identityEpoch = (socket.data.identityEpoch || 0) + 1;
      socket.data.solo = null;
    }
    socket.data.session = session;
    return session;
  }
  async function authorize(socket, context) {
    const session = socket.data.session, epoch = socket.data.identityEpoch;
    if (!session || socket.connected === false || context && socket.data.solo !== context) return false;
    const verified = socket.data.daily3Preview ? null : await sdk.verifySocketIdentity(socket);
    if (socket.connected === false || socket.data.session !== session || socket.data.identityEpoch !== epoch || context && socket.data.solo !== context) return false;
    const id = account(socket, verified);
    if ((session.platform === 'discord' ? session.platformUserId : null) !== id || context && context.identityKey !== session.identityKey) {
      socket.data.session = null; socket.data.solo = null;
      socket.data.identityEpoch = (socket.data.identityEpoch || 0) + 1;
      socket.emit('identity-required', { reason: 'identity_changed' });
      return false;
    }
    return true;
  }
  return { resolve, authorize };
}
module.exports = { createWebIdentity };
