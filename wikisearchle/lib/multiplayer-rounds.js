'use strict';
const crypto = require('node:crypto');
function createRoundActions({ isCurrent, maxPending = 64, maxWaitMs = 60000, now = Date.now }) {
  const queues = new WeakMap();
  function run(round, work) {
    if (!round || !isCurrent(round) || round.won) return Promise.resolve({ skipped: true });
    let queue = queues.get(round);
    if (!queue) { queue = { tail: Promise.resolve(), pending: 0 }; queues.set(round, queue); }
    if (queue.pending >= maxPending) return Promise.resolve({ skipped: true, busy: true });
    queue.pending++;
    const queuedAt = now();
    const task = queue.tail.then(() => !isCurrent(round) || round.won || now() - queuedAt > maxWaitMs ? { skipped: true } : work(round));
    queue.tail = task.catch(() => {});
    return task.finally(() => { queue.pending--; });
  }
  return { run };
}
function roundEventId(round) {
  const scope = round.sessionHandle ? 'session:' + String(round.sessionHandle).toLowerCase() : 'public';
  const generation = round.rewardRoundId || JSON.stringify([round.startTime, round.articleTitle, round.targetWord]);
  if (!round.rewardRoundId && (!Number.isFinite(new Date(round.startTime).getTime()) || !round.targetWord)) throw Error('Round identity unavailable');
  return 'wiki-mp:' + crypto.createHash('sha256').update(JSON.stringify([scope, generation])).digest('hex');
}
function createMultiplayerRewards({ shared, now = Date.now, onError = () => {} }) {
  if (!['reservePlayerReward', 'getPlayerRewardDelivery', 'deliverPlayerReward', 'isGuestId'].every(name => typeof shared?.[name] === 'function'))
    throw Error('Durable multiplayer reward SDK unavailable');
  function reserve(round, winner) {
    const eventId = roundEventId(round);
    const old = shared.getPlayerRewardDelivery(eventId);
    if (old) return old;
    const user = winner?.user || {}, userId = user.platformUserId;
    const platform = user.platform || 'web';
    if (!userId || shared.isGuestId(userId) || ['bot', 'system'].includes(String(platform).toLowerCase())) return null;
    const points = Math.max(0, Math.floor(Number(winner.points) || 0));
    if (!Number.isSafeInteger(points)) throw Error('Invalid round score');
    const coins = Math.floor(points / 10);
    if (!coins) return null;
    const row = shared.reservePlayerReward(platform, userId, user.username || user.displayName || winner.nickname,
      user.displayName || winner.nickname, coins, 'wikisearchle', 'win', {
        eventId, guessCount: round.guessCount || 0, word: round.targetWord, roundPoints: points,
        roundScope: round.sessionHandle ? 'session:' + String(round.sessionHandle).toLowerCase() : 'public',
        roundStartTime: round.startTime, roundGeneration: round.rewardRoundId || null,
      });
    if (!row) throw Error('Round reward reservation unavailable');
    return row;
  }
  function deliver(row) {
    if (!row || row.state !== 'pending' || (row.nextAttemptAt || 0) > now()) return;
    // The SDK worker recovers independently of round rotation and Relay connectivity.
    Promise.resolve().then(() => shared.deliverPlayerReward(row.payload.eventId)).catch(onError);
  }
  function recover(round) {
    if (!round || round.won) return false; // Legacy finished flags authorize no replay.
    const row = shared.getPlayerRewardDelivery(roundEventId(round));
    if (!row) return false;
    // A request reserved before the gameplay snapshot was saved consumes this
    // round even if delivery requires retry/review. Never pick a second winner.
    round.won = true;
    round.rewardEventId = row.payload.eventId;
    delete round.completionPending;
    deliver(row);
    return true;
  }
  function view(round) {
    if (!round?.won) return {};
    const row = shared.getPlayerRewardDelivery(roundEventId(round));
    if (!row) return { rewardConfirmed: false, confirmedCoins: null };
    return { rewardEventId: row.payload.eventId, rewardPending: row.state === 'pending',
      rewardNeedsReview: ['check', 'rejected'].includes(row.state), rewardConfirmed: row.state === 'delivered',
      confirmedCoins: row.state === 'delivered' ? (row.result.coinsAwarded ?? row.payload.coins) : null };
  }
  return { reserve, deliver, recover, view };
}
module.exports = { createRoundActions, createMultiplayerRewards, roundEventId };
