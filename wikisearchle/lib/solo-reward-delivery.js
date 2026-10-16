'use strict';
const crypto = require('node:crypto');
function legacyKey(userId, entry) { return `discord:${userId}:${entry.meta.setAt}`; }
function actionEventId(userId, entry) {
  const period = entry.isDaily ? entry.meta.dateKey : String(entry.meta.setAt);
  if (!period) throw Error('Solo reward period unavailable');
  return 'wiki-solo:' + crypto.createHash('sha256').update(JSON.stringify([entry.mode, String(userId), period])).digest('hex');
}
function createSoloRewardDelivery({ shared, legacy, dailyCompleted, now = Date.now }) {
  if (!['reservePlayerReward', 'getPlayerRewardDelivery', 'deliverPlayerReward'].every(name => typeof shared?.[name] === 'function'))
    throw Error('Durable solo reward SDK unavailable');
  if (typeof legacy?.entries !== 'function') throw Error('Legacy claim inventory unavailable');
  function legacyClaim(userId, entry) {
    const exact = legacy.get(legacyKey(userId, entry));
    if (exact || !entry.isDaily) return exact;
    const prefix = `discord:${userId}:`;
    for (const [key] of legacy.entries()) {
      if (!key.startsWith(prefix)) continue;
      const generation = new Date(key.slice(prefix.length));
      if (!Number.isFinite(generation.getTime())) continue;
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(generation);
      const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
      if (`${date.year}-${date.month}-${date.day}` === entry.meta.dateKey)
        return { status: 'ambiguous-generation' }; // Old keys omit the daily/weekly mode.
    }
    return null;
  }
  function record(userId, entry) { return shared.getPlayerRewardDelivery(actionEventId(userId, entry)); }
  function view(userId, entry) {
    if (!userId) return { completed: false };
    const row = record(userId, entry);
    if (row) return { completed: true, rewardEventId: row.payload.eventId, rewardPending: row.state === 'pending',
      rewardNeedsReview: ['check', 'rejected'].includes(row.state), rewardConfirmed: row.state === 'delivered',
      confirmedCoins: row.state === 'delivered' ? (row.result.coinsAwarded ?? row.payload.coins) : 0 };
    const old = legacyClaim(userId, entry);
    if (!old) return { completed: false };
    // Old flags have no immutable request ID. Never synthesize or replay an award.
    return { completed: true, legacyStatus: old.status, rewardPending: false,
      rewardNeedsReview: old.status !== 'awarded', rewardConfirmed: false, confirmedCoins: null };
  }
  function response(userId, entry, alreadyRedeemed) {
    const status = view(userId, entry), row = record(userId, entry);
    return { ok: true, alreadyRedeemed, coins: status.rewardConfirmed ? status.confirmedCoins : 0,
      mode: entry.mode, isDaily: entry.isDaily, isWeekly: entry.isWeekly, ...status,
      ...(row?.state === 'delivered' ? { reward: row.result } : {}) };
  }
  function canonicalView(entry) {
    return { completed: true, canonicalCompletion: true, rewardConfirmed: false,
      confirmedCoins: null, rewardPending: false, rewardNeedsReview: false };
  }
  async function status(userId, entry) {
    const local = view(userId, entry);
    if (!userId || local.rewardEventId || local.legacyStatus === 'awarded' || !entry.isDaily) return local;
    try { return await dailyCompleted(String(userId), entry.meta.dateKey) ? canonicalView(entry) : local; }
    catch { return { ...local, completionStatusUnavailable: true }; }
  }
  async function settle(row) {
    if (row.state === 'pending' && (row.nextAttemptAt || 0) <= now()) await shared.deliverPlayerReward(row.payload.eventId);
  }
  async function claim(userId, entry, score, guessCount) {
    let row = record(userId, entry);
    if (row) { await settle(row); return response(userId, entry, true); }
    const old = legacyClaim(userId, entry);
    if (old?.status === 'awarded') return response(userId, entry, true);
    // Includes claims made before durable event IDs existed. A canonical current
    // daily completion establishes the consumed day but does not reconstruct XP.
    if (entry.isDaily && await dailyCompleted(String(userId), entry.meta.dateKey))
      return { ok: true, alreadyRedeemed: true, coins: 0, ...canonicalView(entry),
        mode: entry.mode, isDaily: true, isWeekly: false };
    if (old) return response(userId, entry, true);
    // Another request may have reserved while the canonical status was awaited.
    row = record(userId, entry);
    const alreadyRedeemed = !!row;
    if (!row) {
      const eventId = actionEventId(userId, entry), meta = entry.meta;
      const extras = { eventId, guessCount, word: meta.cleanTitle, soloMode: entry.mode,
        soloKey: meta.key, soloGeneration: meta.setAt, soloClaimKey: legacyKey(userId, entry),
        ...(entry.isDaily ? { dailyKey: meta.key, dailyDate: meta.dateKey, rewardPeriod: meta.dateKey } : { weeklyKey: meta.key }) };
      row = shared.reservePlayerReward('discord', String(userId), String(userId), String(userId),
        score, 'wikisearchle', entry.isDaily ? 'daily-win' : 'weekly-win', extras);
      if (!row) throw Error('Solo reward reservation unavailable');
    }
    await settle(row);
    return response(userId, entry, alreadyRedeemed);
  }
  return { claim, view, status };
}
module.exports = { createSoloRewardDelivery, actionEventId, legacyKey };
