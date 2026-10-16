'use strict';
const crypto = require('crypto');
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function authorizedService(socket, secret) {
  const key = socket.handshake?.auth?.apiKey || socket.handshake?.headers?.['x-api-key'];
  return !!secret && typeof key === 'string' && key.length <= 512
    && crypto.timingSafeEqual(crypto.createHash('sha256').update(key).digest(), crypto.createHash('sha256').update(secret).digest());
}
function installSocketSecurity(io, { secret, adminSecret, verifyGameSession, resolveUserFromCookie }) {
  // Register before either puzzle-decision listener so both share the gate.
  io.on('connection', socket => {
    if (authorizedService(socket, adminSecret)) socket.join('triangled-review-admin');
    socket.use(async (packet, next) => {
      const [event, data] = packet;
      if (!['submit-word', 'triangled-puzzle-decision'].includes(event)) return next();
      function reject(error) {
        socket.emit(event === 'submit-word' ? 'submit-result' : 'triangled-decision-result', { valid: false, error });
        next(new Error(error));
      }
      try {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return reject('invalid_request');
        if (event === 'triangled-puzzle-decision') {
          if (!authorizedService(socket, adminSecret)) return reject('auth_required');
          if (!validDate(data.date)) return reject('invalid_decision');
          const booleanDecision = typeof data.approved === 'boolean';
          const selection = Number.isInteger(data.puzzleChoice) && data.puzzleChoice >= 1 && data.puzzleChoice <= 3
            && (data.imageChoice == null || (Number.isInteger(data.imageChoice) && data.imageChoice >= 1 && data.imageChoice <= 3));
          if (booleanDecision === selection || (data.approved != null && !booleanDecision) || (booleanDecision && data.puzzleChoice != null)) return reject('invalid_decision');
          return next();
        }
        const token = socket.handshake?.auth?.gameSession || socket.handshake?.headers?.['x-game-session'] || data.gameSession;
        let identity = token ? verifyGameSession(secret, 'triangled', token) : null;
        if (token && !identity) return reject('auth_required');
        if (!identity) identity = await resolveUserFromCookie({ headers: socket.handshake?.headers || {} }, true);
        if (!identity) {
          const claimed = String(data.userId || '');
          if (!/^(web_[a-z0-9]{1,32}|guest_triangled_[a-z0-9_-]{1,64})$/.test(claimed)) return reject('auth_required');
          identity = { platform: 'web', userId: claimed, username: 'Guest', guest: true };
        }
        Object.assign(data, { platform: identity.platform, userId: identity.userId, username: identity.username });
        data.dailyPlayer = identity; // Bind each packet independently across asynchronous cookie verification.
        next();
      } catch { reject('auth_required'); }
    });
    // Socket.IO reports middleware rejection here; do not let it become an
    // unhandled EventEmitter error or log supplied identity/token values.
    socket.on('error', error => console.warn('[Triangled] Socket request rejected:', error.message));
  });
}
module.exports = { installSocketSecurity, authorizedService };
