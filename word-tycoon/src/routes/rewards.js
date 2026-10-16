/**
 * Rewards/balance routes — /api/reward, /api/balance, /api/deduct
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const {
  VALID_REWARD_GAMES,
  normalizeRewardGameId
} = require('../game-ids');
const { createRewardEvents, validRewardEventId } = require('../reward-events');

function isGuestId(userId) {
  if (!userId) return true;
  const id = String(userId).toLowerCase();
  return id.startsWith('web_guest_') ||
         id.startsWith('guest_') ||
         id.startsWith('wsguest_') ||
         id.startsWith('guest-') ||
         id.startsWith('anon_');
}

function registerRewardsRoutes(app, {
  db, gameEngine, ledger,
  sanitizeCoins, checkRewardRateLimit, MAX_SINGLE_REWARD
}) {

  const rewardEvents = createRewardEvents(db);
  app.get('/api/reward/protocol', (_req, res) => res.json({ ok: true, durableEvents: true, version: 1 }));
  // Protected by server.js's /api/reward API-key middleware, including subpaths.
  app.get('/api/reward/status/:game/:eventId', async (req, res) => {
    const game = normalizeRewardGameId(req.params.game);
    if (!VALID_REWARD_GAMES.includes(game) || !validRewardEventId(req.params.eventId))
      return res.status(400).json({ ok: false, message: 'Invalid reward event' });
    try { return res.json(await rewardEvents.status(game, req.params.eventId)); }
    catch (_) { return res.status(503).json({ ok: false, message: 'Reward database persistence unavailable' }); }
  });

  // Word game reward endpoint
  app.post('/api/reward', async (req, res) => {
    const { platform, userId, username, displayName, coins, xp, game, event, guessCount, word, durationSeconds } = req.body;
    // Optional analytics: ignore malformed/out-of-range metadata without
    // rejecting an otherwise legitimate durable reward. Preserve zero/seconds.
    const duration = Number.isFinite(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 7 * 24 * 60 * 60
      ? durationSeconds : null;
    const { eventId, rewardPeriod } = req.body;
    if (eventId != null && !validRewardEventId(eventId))
      return res.status(400).json({ ok: false, message: 'Invalid reward event ID' });
    if (rewardPeriod != null) {
      const date = new Date(rewardPeriod + 'T12:00:00Z');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const weekly = ['weekly-win','mp-weekly-win'].includes(event);
      const latestPeriod = weekly ? gameEngine.getWeekStart() : today;
      if (typeof rewardPeriod !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rewardPeriod)
          || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== rewardPeriod || rewardPeriod > latestPeriod
          || (weekly && date.getUTCDay() !== 1))
        return res.status(400).json({ ok: false, message: 'Invalid reward period' });
    }
    const requestedAmount = coins != null ? coins : xp;
    if (!platform || !userId || !requestedAmount || !game) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const sanitized = sanitizeCoins(requestedAmount);
    if (sanitized === null || sanitized <= 0) {
      return res.status(400).json({ ok: false, message: 'Invalid XP amount' });
    }
    // Normalize game names (handle aliases)
    const normalizedGame = normalizeRewardGameId(game);
    // Validate game name against known games
    if (!VALID_REWARD_GAMES.includes(normalizedGame)) {
      return res.status(400).json({ ok: false, message: 'Unknown game: ' + game });
    }
    // Rate limit
    if (!checkRewardRateLimit(normalizedGame, platform + ':' + userId)) {
      return res.status(429).json({ ok: false, message: 'Rate limit exceeded' });
    }
    // Cap raw input before multipliers
    const cappedCoins = Math.min(sanitized, MAX_SINGLE_REWARD);
    // Guest players get session-only rewards (no DB persistence)
    if (isGuestId(userId)) {
      return res.json({ ok: true, guest: true, coinsAwarded: cappedCoins, newBalance: 0 });
    }
    const payload = { platform: String(platform), userId: String(userId),
      username: username || userId, displayName: displayName || username || userId,
      coins: cappedCoins, game: normalizedGame, event: event || 'reward',
      guessCount: Number.isFinite(guessCount) ? guessCount : null, word: word || null,
      rewardPeriod: rewardPeriod || null, eventId: eventId || null,
      ...(duration != null ? { durationSeconds: duration } : {}) };
    const execute = () => gameEngine.handleReward(payload.platform, payload.userId, payload.username, payload.displayName,
      payload.coins, payload.game, payload.event, payload.guessCount, payload.word, payload.durationSeconds, { period: payload.rewardPeriod });
    try {
      const result = eventId ? await rewardEvents.apply(payload, execute) : execute();
      return res.json(result);
    } catch (error) {
      console.error('[RewardEvent]', error.message);
      return res.status(error.status === 409 ? 409 : 503).json({ ok: false,
        message: error.status === 409 ? error.message : 'Reward not acknowledged; retry the same event ID' });
    }
  });

  // Balance check endpoint (for external games like Monopoly)
  app.post('/api/balance', (req, res) => {
    const { platform, userId } = req.body;
    if (!platform || !userId) {
      return res.status(400).json({ ok: false, message: 'Missing platform or userId' });
    }
    const player = db.getPlayer(platform, userId);
    if (!player) {
      return res.json({ ok: false, xp: 0, coins: 0, message: 'Player not found' });
    }
    const xpBalance = Number(player.xp || 0) || 0;
    res.json({ ok: true, xp: xpBalance, coins: xpBalance, displayName: player.display_name });
  });

  // Deduct XP endpoint (legacy "coins" request field preserved for compatibility)
  app.post('/api/deduct', (req, res) => {
    const { platform, userId, coins, xp, game, event } = req.body;
    const requestedAmount = coins != null ? coins : xp;
    if (!platform || !userId || !requestedAmount || !game) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const amount = sanitizeCoins(requestedAmount);
    if (amount === null || amount <= 0) {
      return res.status(400).json({ ok: false, message: 'Amount must be a positive integer' });
    }
    const player = db.getPlayer(platform, userId);
    if (!player) {
      return res.json({ ok: false, message: 'Player not found' });
    }
    if (Number(player.xp || 0) < amount) {
      const xpBalance = Number(player.xp || 0) || 0;
      return res.json({ ok: false, message: 'Insufficient XP', xp: xpBalance, coins: xpBalance });
    }
    const coinsBefore = Number(player.xp || 0) || 0;
    db.deductPlayerXp(player.id, amount);
    db.logEvent('deduct', player.display_name, { xp: amount, game, event: event || 'deduct' });
    db.save();
    const updated = db.getPlayerById(player.id);

    ledger.record({
      playerId: player.id,
      playerName: player.display_name,
      platform,
      eventType: 'deduct',
      command: null,
      coinsBefore,
      coinsAfter: updated ? Number(updated.xp || 0) : coinsBefore - amount,
      giftCoinsBefore: null,
      giftCoinsAfter: null,
      success: 1,
      response: null,
      detail: { game, event: event || 'deduct', amount, currency: 'xp' }
    });

    const newXpBalance = Number(updated?.xp || 0) || 0;
    res.json({ ok: true, newXpBalance, newBalance: newXpBalance, deducted: amount, deductedXp: amount });
  });
}

module.exports = { registerRewardsRoutes };
