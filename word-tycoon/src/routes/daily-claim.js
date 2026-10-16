/**
 * Daily Claim + Streak routes — /api/daily-claim/*, /api/daily-progress/*, /api/player-game-stats/*
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const { canonicalGameId } = require('../game-ids');

function registerDailyClaimRoutes(app, { db, gameEngine, requireApiKey }) {
  const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

  // Daily claim status
  app.get('/api/daily-claim/status', requireApiKey, (req, res) => {
    const discordId = req.query.discordId || req.headers['x-discord-id'];
    if (!discordId) return res.json({ ok: false, error: 'Missing discordId' });
    try {
      const status = gameEngine.getDailyClaimStatus(discordId);
      res.json({ ok: true, ...status });
    } catch (err) {
      console.error('[DailyClaim] Status error:', err.message);
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
  });

  // Process daily claim
  app.post('/api/daily-claim', requireApiKey, (req, res) => {
    const discordId = req.body.discordId || req.headers['x-discord-id'];
    if (!discordId) return res.json({ ok: false, error: 'Missing discordId' });
    try {
      const result = gameEngine.processDailyClaim(discordId);
      res.json(result);
    } catch (err) {
      console.error('[DailyClaim] Claim error:', err.message);
      res.status(500).json({ ok: false, error: 'Internal error' });
    }
  });

  // Player game stats (per-game win counts, used by daily/weekly challenge UIs)
  app.get('/api/player-game-stats/:discordId', (req, res) => {
    const { discordId } = req.params;
    if (!hasText(discordId)) {
      return res.status(400).json({ ok: false, error: 'Missing discordId' });
    }
    const game = req.query.game || null;
    let playerIds = db.getAllPlayerIdsForDiscord(discordId);
    if (playerIds.length === 0) {
      // Top-likers and similar overlays may only have a raw TikTok identity.
      // Fall back to the direct TikTok player record when there is no Discord link.
      const fallbackPlayer =
        (typeof db.resolvePlayer === 'function' && db.resolvePlayer('tiktok', discordId)) ||
        (typeof db.getPlayerByUsername === 'function' && db.getPlayerByUsername('tiktok', discordId)) ||
        (typeof db.getPlayerByDisplayName === 'function' && db.getPlayerByDisplayName('tiktok', discordId)) ||
        null;
      if (fallbackPlayer && fallbackPlayer.id != null && typeof db.getAllPlayerIdsFromPlayer === 'function') {
        playerIds = db.getAllPlayerIdsFromPlayer(fallbackPlayer.id);
      }
    }
    if (playerIds.length === 0) {
      return res.json({ ok: true, totalWins: 0, games: {} });
    }
    const stats = db.getPlayerGameStats(playerIds, game);
    res.json({ ok: true, ...stats });
  });

  // Daily + weekly progress (for portal/frontend)
  app.get('/api/daily-progress/:platform/:userId', (req, res) => {
    const { platform, userId } = req.params;
    if (!hasText(platform) || !hasText(userId)) {
      return res.status(400).json({ ok: false, error: 'Missing platform or userId' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const REQUIRED_DAILY_GAMES = gameEngine.REQUIRED_DAILY_GAMES;
    const weekStart = gameEngine.getWeekStart ? gameEngine.getWeekStart() : today;
    const weeklyGames = gameEngine.REQUIRED_WEEKLY_GAMES;
    const player = db.resolvePlayer(platform, userId);
    if (!player) {
      return res.json({
        completions: [],
        required: REQUIRED_DAILY_GAMES.length,
        completed: 0,
        games: REQUIRED_DAILY_GAMES.map((game) => ({ game, done: false })),
        lootBoxAwarded: false,
        generatedCosmetics: [],
        weekStart,
        weeklyGames,
        weeklyCompletions: []
      });
    }

    // Aggregate completions across all linked player IDs (canonicalize legacy IDs)
    const allIds = db.getAllPlayerIdsFromPlayer(player.id);
    const allCompletions = new Set();
    const completionDetails = [];
    for (const pid of allIds) {
      const completions = db.getDailyCompletions(pid, today);
      for (const c of completions) {
        const canonical = canonicalGameId(c.game) || c.game;
        if (!allCompletions.has(canonical)) {
          allCompletions.add(canonical);
          completionDetails.push({ game: canonical, completedAt: c.completed_at });
        }
      }
    }

    const completed = REQUIRED_DAILY_GAMES.filter(g => allCompletions.has(g)).length;
    const lootBoxAwarded = allIds.some((pid) => db.hasGeneratedCosmeticForDate(pid, today));
    const generatedCosmetics = allIds
      .flatMap((pid) => db.getGeneratedCosmetics(pid))
      .sort((a, b) => String(b.date_awarded || '').localeCompare(String(a.date_awarded || '')))
      .filter((item, index, arr) => arr.findIndex((other) => other.id === item.id) === index);

    // Weekly challenge progress (canonicalize legacy IDs)
    const weeklyCompletionDetails = [];
    for (const pid of allIds) {
      const wc = db.getWeeklyCompletions(pid, weekStart);
      for (const c of wc) {
        const canonical = canonicalGameId(c.game) || c.game;
        if (!weeklyCompletionDetails.find(w => w.game === canonical)) {
          weeklyCompletionDetails.push({ game: canonical, completedAt: c.completed_at });
        }
      }
    }

    res.json({
      completions: completionDetails,
      required: REQUIRED_DAILY_GAMES.length,
      completed,
      games: REQUIRED_DAILY_GAMES.map(g => ({ game: g, done: allCompletions.has(g) })),
      lootBoxAwarded,
      generatedCosmetics: generatedCosmetics.slice(0, 30), // last 30 for display
      weekStart,
      weeklyGames,
      weeklyCompletions: weeklyCompletionDetails
    });
  });
}

module.exports = { registerDailyClaimRoutes };
