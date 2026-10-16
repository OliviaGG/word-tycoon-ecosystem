'use strict';
const { randomUUID } = require('node:crypto');

function createPremiumWebGate({ gameShared, playBilling, resolveAccount }) {
  const reviewers = new WeakMap();
  const accounts = new WeakMap();
  return async function passesPremiumWebGate(data, socket, context) {
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        typeof data.message !== 'string' || !data.message.trim() || data.message.length > 160 ||
        !data.user || typeof data.user !== 'object' || Array.isArray(data.user)) return false;
    const u = data.user;
    for (const field of ['cosmetics', 'profilePic', 'customColor', 'badges', 'isSystem', 'isBot', 'fcTitle']) delete u[field];
    const candidates = [u.id, u.platformUserId, u.linkedDiscord, data.linkedDiscord];
    if (candidates.some(id => id != null && (typeof id !== 'string' || id.length > 128))) return false;
    const identity = await gameShared.resolveWebIdentity(candidates, socket);
    if (identity.verified && !identity.claimIsSamePerson) {
      socket.emit('premium-required', { loggedIn: true, context, reason: 'identity_mismatch' });
      return false;
    }
    const reviewer = playBilling.hasReviewerAccess(socket?.handshake?.headers?.cookie || '');
    if (!identity.verified && !reviewer) {
      socket.emit('premium-required', { loggedIn: false, context });
      return false;
    }
    let id = identity.id;
    if (!identity.verified) {
      if (!reviewers.has(socket)) reviewers.set(socket, 'guest_review_' + randomUUID());
      id = reviewers.get(socket);
    }
    // Browser metadata never selects a trusted transport or a second recipient.
    data.platform = 'web';
    data.linkedDiscord = identity.verified ? id : null;
    u.id = id;
    u.platformUserId = id;
    u.linkedDiscord = identity.verified ? id : null;
    u.platform = 'web';
    u.isDonor = u.isSuperfan = u.isFanClub = false;
    for (const field of ['username', 'nickname', 'displayName']) {
      u[field] = typeof u[field] === 'string' ? u[field].slice(0, 80) : (reviewer ? 'Reviewer' : 'Player');
    }
    try {
      const avatar = new URL(u.avatarUrl);
      u.avatarUrl = /^https?:$/.test(avatar.protocol) && avatar.href.length <= 512 ? avatar.href : '';
    } catch { u.avatarUrl = ''; }
    if (reviewer) { u.isDonor = true; return true; }
    // Purchases are bound to the WT anchor returned by the trusted Relay, which
    // may differ from the provider identity proven on this socket.
    // The cookie is fixed for this connection. Reuse its trusted account
    // resolution briefly, while checking the live subscription on every guess.
    // Never cache failures or let a different verified identity use the entry.
    const cachedAccount = accounts.get(socket);
    let accountId = cachedAccount && cachedAccount.identity === id &&
      cachedAccount.expiresAt > Date.now() ? cachedAccount.accountId : null;
    if (!accountId) {
      accountId = await resolveAccount({ headers: socket.handshake.headers });
      if (accountId) accounts.set(socket, { identity: id, accountId, expiresAt: Date.now() + 60000 });
    }
    if (accountId && await playBilling.hasActiveEntitlement(accountId)) {
      u.isDonor = true;
      return true;
    }
    if (!(await gameShared.passesPremiumWebGate([id], socket, context))) return false;
    const perks = await gameShared.getWebPlayerPerks(id);
    u.isSuperfan = !!perks.superfan;
    u.isDonor = !!perks.donor;
    u.isFanClub = !!perks.fanClub;
    return true;
  };
}
module.exports = { createPremiumWebGate };
