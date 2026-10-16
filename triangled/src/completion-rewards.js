'use strict';
const crypto = require('crypto');
function completionEventId(identity, date) {
  const account = identity.accountId || identity.platform + ':' + String(identity.userId);
  return 'triangled-daily:' + crypto.createHash('sha256').update(JSON.stringify([date, account])).digest('hex');
}
function createCompletionRewards(shared) {
  function guest(identity) {
    return identity.guest || ['bot', 'system'].includes(identity.platform)
      || (identity.platform === 'web' && /^(web_|guest_triangled_)/.test(String(identity.userId)));
  }
  function prepare(identity, date, hintsUsed) {
    if (guest(identity)) return null;
    if (!shared?.reservePlayerReward) throw Error('Durable reward reservation unavailable');
    const eventId = completionEventId(identity, date), old = shared.getPlayerRewardDelivery(eventId);
    if (old) return old;
    const coins = Math.max(100, 500 - hintsUsed * 75);
    return shared.reservePlayerReward(identity.platform, String(identity.userId), identity.username || String(identity.userId),
      identity.username || String(identity.userId), coins, 'triangled', 'daily-win', { eventId, rewardPeriod: date });
  }
  async function deliver(identity, date) {
    if (guest(identity)) return null;
    return shared.deliverPlayerReward(completionEventId(identity, date));
  }
  function status(identity, date) {
    if (guest(identity)) return null;
    const record = shared?.getPlayerRewardDelivery?.(completionEventId(identity, date));
    if (!record) return null; // Never reconstruct an award from a historical completed flag.
    return { rewardEventId: record.payload.eventId, rewardPending: record.state === 'pending',
      rewardNeedsReview: ['check', 'rejected'].includes(record.state),
      rewardConfirmed: record.state === 'delivered',
      confirmedCoins: record.state === 'delivered' ? (record.result.coinsAwarded ?? record.payload.coins) : 0 };
  }
  return { prepare, deliver, status };
}
module.exports = { completionEventId, createCompletionRewards };
