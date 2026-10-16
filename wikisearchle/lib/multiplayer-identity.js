'use strict';
const crypto = require('node:crypto');
function createCookieIdentityResolver({ relayUrl, secret, request = fetch }) {
  return async socket => {
    const cookie = socket.handshake?.headers?.cookie;
    if (typeof cookie !== 'string' || cookie.length > 16384 || !/(?:^|;\s*)(?:wt_remember|connect\.sid)=/.test(cookie)) return null;
    const response = await request(`${relayUrl}/api/internal/whoami`, {
      headers: { 'x-api-key': secret, 'x-forwarded-cookie': cookie },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.json(), u = body?.ok && body.user;
    const id = u && (u.anchorId || u.id);
    if (typeof id !== 'string' || !id || id.length > 128) return null;
    const name = String(u.username || 'player').slice(0, 64);
    return { platform: 'web', platformUserId: id, linkedDiscord: id, username: name, displayName: name };
  };
}
function createWebGuessHandler({ socket, context, resolveIdentity, isPremium, getPerks, getCosmetics, isSuspended, onGuess,
  now = Date.now, minInterval = 250, rateCap = 4 }) {
  let lastGuess = -Infinity, windowStart = now(), count = 0;
  return async data => {
    const at = now();
    if (at - lastGuess < minInterval) return;
    lastGuess = at;
    if (at - windowStart > 1000) { windowStart = at; count = 0; }
    if (++count > rateCap) return;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.word !== 'string') return;
    const word = data.word.trim().slice(0, 64);
    if (!word) return;
    try {
      // Each invocation owns its verified identity. Never use payload claims
      // or mutable socket properties to attribute a later asynchronous guess.
      const identity = await resolveIdentity(socket);
      if (!identity) { socket.emit('premium-required', { loggedIn: false, context, reason: 'auth_required' }); return; }
      const ip = socket.handshake?.headers?.['x-forwarded-for'] || socket.handshake?.address;
      if (isSuspended(identity, ip)) {
        socket.emit('wikisearchle-suspension', { message: 'Your account has been suspended from WikiSearchle. Please contact Jorry to resolve this.' }); return;
      }
      if (!await isPremium(identity.platformUserId)) {
        socket.emit('premium-required', { loggedIn: true, context }); return;
      }
      const perks = await getPerks(identity.platformUserId).catch(() => ({}));
      const user = { ...identity, cosmetics: getCosmetics(identity.platformUserId),
        badges: [...(perks.superfan ? ['superfan'] : []), ...(perks.fanClub ? ['fan-club'] : [])],
        isDonor: !!perks.donor, isSuperfan: !!perks.superfan, isFanClub: !!perks.fanClub };
      await onGuess({ message: word, linkedDiscord: identity.linkedDiscord, user }, ip);
    } catch {
      // No IDs/cookies/tokens in errors, and no unhandled async socket callback.
      socket.emit('wikisearchle-guess-error', { error: 'guess_unavailable' });
    }
  };
}
function playerIdentity(user) {
  if (user?.linkedDiscord) return 'account:' + user.linkedDiscord;
  // Existing browser snapshots stored the same anchor under web without
  // linkedDiscord. Retain their score owner across this deployment.
  if (user?.platformUserId && ['web', 'discord'].includes(user.platform)) return 'account:' + user.platformUserId;
  if (user?.platformUserId) return String(user.platform || 'unknown') + ':' + user.platformUserId;
  return null;
}
function isolateRoundUser(round, user) {
  const identity = playerIdentity(user);
  const rows = Object.values(round.playerStats || {});
  const prior = identity && rows.find(row => playerIdentity(row.user) === identity);
  if (prior) return { ...user, displayName: prior.nickname };
  const base = String(user.displayName || 'viewer');
  let name = base, counter = 0;
  const suffix = crypto.createHash('sha256').update(identity || 'guest:' + base).digest('hex').slice(0, 10);
  while (Object.prototype.hasOwnProperty.call(Object.prototype, name.toLowerCase()) ||
    rows.some(row => String(row.nickname).toLowerCase() === name.toLowerCase() && playerIdentity(row.user) !== identity)) {
    name = `${base} (${suffix}${counter ? '-' + counter : ''})`; counter++;
  }
  return { ...user, displayName: name };
}
module.exports = { createCookieIdentityResolver, createWebGuessHandler, isolateRoundUser };
