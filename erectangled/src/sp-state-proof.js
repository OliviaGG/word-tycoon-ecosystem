const crypto = require('node:crypto');

// Sign the complete server-generated snapshot, including ring transitions.
// Browser restore data may display progress, but cannot certify a solve.
function createSpStateProof(secret, gameId) {
  if (!secret) throw new Error('Missing SP state proof secret');
  function signature(state, context) {
    const { rewardProof, ...snapshot } = state;
    return crypto.createHmac('sha256', secret)
      .update('sp-state-v1:' + gameId + ':' + JSON.stringify(context) + ':' + JSON.stringify(snapshot))
      .digest('hex');
  }
  return {
    sign(state, context) { const snapshot = { ...state, rewardProofVersion: 2 }; return { ...snapshot, rewardProof: signature(snapshot, context) }; },
    verify(state, context) {
      if (!state || typeof state !== 'object' || Array.isArray(state) || state.rewardProofVersion !== 2) return false;
      if (JSON.stringify(state).length > 128 * 1024) return false;
      if (typeof state.rewardProof !== 'string' || !/^[a-f0-9]{64}$/.test(state.rewardProof)) return false;
      return crypto.timingSafeEqual(Buffer.from(state.rewardProof, 'hex'), Buffer.from(signature(state, context), 'hex'));
    },
    generation(grid) { return crypto.createHash('sha256').update(JSON.stringify(grid)).digest('hex'); }
  };
}
module.exports = { createSpStateProof };
