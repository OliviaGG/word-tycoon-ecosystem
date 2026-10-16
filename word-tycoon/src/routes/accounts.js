/**
 * Account/identity/linking routes — /api/link/*, /api/admin/accounts/*,
 * /api/admin/players/*, /api/admin/cosmetics/*, /api/admin/business/buy,
 * /api/admin/linked-account/update-info
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const crypto = require('crypto');
const presence = require('../presence');
const accrual = require('../accrual');

function registerAccountRoutes(app, {
  db, gameEngine, ledger,
  requireApiKey, broadcastCosmeticsUpdate, computePlayerIncome, computeCombinedIncome,
  cosmetics, businesses
}) {
  const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
  const VERIFICATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const INCOME_BUFF_TYPES = ['biz_boost', 'offline_boost', 'coin_bonus', 'prestige', 'library_boost'];
  const INCOME_BUFF_ORDER = {
    tax_season_bonus: 0,
    biz_boost: 1,
    offline_boost: 2,
    prestige: 3,
    coin_bonus: 4,
    library_boost: 5
  };

  function generateVerificationCode(length = 8) {
    const bytes = crypto.randomBytes(length);
    let token = '';
    for (let i = 0; i < length; i++) {
      token += VERIFICATION_ALPHABET[bytes[i] % VERIFICATION_ALPHABET.length];
    }
    return token;
  }

  function summarizeAccountPresence(playerIds) {
    const ids = Array.isArray(playerIds) ? playerIds : [];
    const players = ids.map((playerId) => {
      const state = presence.getState(playerId);
      return {
        playerId,
        isOnline: !!state.isOnline,
        lastActivityAt: state.lastActivityAt || null,
        source: state.source || null
      };
    });

    const totalPlayers = players.length;
    const onlineCount = players.filter((player) => player.isOnline).length;
    const offlineCount = totalPlayers - onlineCount;
    const lastActivityAt = players.reduce((latest, player) => {
      if (!player.lastActivityAt) return latest;
      return !latest || player.lastActivityAt > latest ? player.lastActivityAt : latest;
    }, null);

    let status = 'offline';
    if (onlineCount > 0 && offlineCount > 0) status = 'mixed';
    else if (onlineCount > 0) status = 'online';

    return {
      status,
      totalPlayers,
      onlineCount,
      offlineCount,
      thresholdMs: presence.OFFLINE_THRESHOLD_MS,
      thresholdMinutes: Math.round(presence.OFFLINE_THRESHOLD_MS / 60000),
      lastActivityAt: lastActivityAt ? new Date(lastActivityAt).toISOString() : null,
      players
    };
  }

  function buildActiveIncomeBuffs(playerIds) {
    const uniquePlayerIds = [...new Set((Array.isArray(playerIds) ? playerIds : []).filter(Boolean))];
    const totals = {};

    for (const buffType of INCOME_BUFF_TYPES) {
      totals[buffType] = 0;
    }

    for (const playerId of uniquePlayerIds) {
      const playerBuffs = cosmetics.getPlayerBuffs(db, playerId) || cosmetics.DEFAULT_BUFFS;
      for (const buffType of INCOME_BUFF_TYPES) {
        totals[buffType] += Number(playerBuffs[buffType]) || 0;
      }
    }

    const activeBuffs = [];
    for (const buffType of INCOME_BUFF_TYPES) {
      const value = totals[buffType];
      if (value > 0) {
        activeBuffs.push({
          key: buffType,
          label: cosmetics.BUFF_TYPE_NAMES[buffType] || buffType,
          value,
          source: 'cosmetics'
        });
      }
    }

    const taxSeasonState = uniquePlayerIds.length > 0 ? db.getTaxSeasonState(uniquePlayerIds[0]) : null;
    const taxSeasonBonus = Math.max(0, (Number(taxSeasonState?.bonusMultiplier) || 1) - 1);
    if (taxSeasonBonus > 0) {
      activeBuffs.push({
        key: 'tax_season_bonus',
        label: 'First Full Reset',
        value: taxSeasonBonus,
        source: 'tax_season'
      });
    }

    return activeBuffs.sort((a, b) => {
      const aOrder = Object.prototype.hasOwnProperty.call(INCOME_BUFF_ORDER, a.key) ? INCOME_BUFF_ORDER[a.key] : 999;
      const bOrder = Object.prototype.hasOwnProperty.call(INCOME_BUFF_ORDER, b.key) ? INCOME_BUFF_ORDER[b.key] : 999;
      return aOrder - bOrder || a.label.localeCompare(b.label);
    });
  }

  // ==================== ADMIN PLAYER API ====================

  app.get('/api/admin/players', (req, res) => {
    const search = req.query.search || '';
    if (!search || search.length < 1) {
      return res.json([]);
    }
    res.json(db.searchPlayers(search, 20));
  });

  app.get('/api/admin/player/:playerId/cosmetics', (req, res) => {
    const playerId = parseInt(req.params.playerId);
    const player = db.getPlayerById(playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const owned = db.getPlayerOwnedCosmetics(playerId).map(item => {
      const catalogItem = cosmetics.getCosmeticById(item.cosmetic_id);
      return { ...item, buff: catalogItem?.buff || null };
    });
    res.json({ player, owned });
  });

  app.post('/api/admin/cosmetics/grant', (req, res) => {
    const { playerId, cosmeticId } = req.body;
    if (!playerId || !cosmeticId) {
      return res.status(400).json({ ok: false, message: 'Missing playerId or cosmeticId' });
    }
    const item = cosmetics.getCosmeticById(cosmeticId);
    if (!item) return res.status(400).json({ ok: false, message: 'Unknown cosmetic ID' });
    const player = db.getPlayerById(playerId);
    if (!player) return res.status(404).json({ ok: false, message: 'Player not found' });
    db.grantCosmetic(playerId, cosmeticId);
    res.json({ ok: true, message: `Granted ${item.name} to ${player.display_name}` });
    broadcastCosmeticsUpdate(playerId);
  });

  app.post('/api/admin/cosmetics/equip', (req, res) => {
    const { playerId, cosmeticId, equip } = req.body;
    if (!playerId || !cosmeticId) {
      return res.status(400).json({ ok: false, message: 'Missing playerId or cosmeticId' });
    }
    presence.touch(playerId, 'cosmetic-equip');
    // Phase 2: settle all income before equip — cosmetics can change income buffs
    // (biz_boost, offline_boost, prestige, coin_bonus, library_boost, etc.)
    try { accrual.settleAll(playerId); } catch (e) { /* non-fatal */ }
    db.adminEquipCosmetic(playerId, cosmeticId, equip !== false);
    res.json({ ok: true });
    broadcastCosmeticsUpdate(playerId);
  });

  app.post('/api/admin/cosmetics/revoke', (req, res) => {
    const { playerId, cosmeticId } = req.body;
    if (!playerId || !cosmeticId) {
      return res.status(400).json({ ok: false, message: 'Missing playerId or cosmeticId' });
    }
    db.revokeCosmetic(playerId, cosmeticId);
    res.json({ ok: true });
    broadcastCosmeticsUpdate(playerId);
  });

  // Admin: merge two player accounts
  app.post('/api/admin/players/merge', (req, res) => {
    const { keepId, removeId } = req.body;
    if (!keepId || !removeId) {
      return res.status(400).json({ ok: false, message: 'Missing keepId or removeId' });
    }

    const keepBefore = db.getPlayerById(Number(keepId));
    const removeBefore = db.getPlayerById(Number(removeId));
    const coinsBefore = keepBefore ? (keepBefore.xp || 0) : 0;

    const result = db.mergePlayers(Number(keepId), Number(removeId));

    if (result.ok) {
      const keepAfter = db.getPlayerById(Number(keepId));
      ledger.record({
        playerId: Number(keepId),
        playerName: keepBefore ? keepBefore.display_name : 'unknown',
        platform: keepBefore ? keepBefore.platform : 'unknown',
        eventType: 'merge',
        command: null,
        coinsBefore,
        coinsAfter: keepAfter ? (keepAfter.xp || 0) : coinsBefore,
        giftCoinsBefore: null,
        giftCoinsAfter: null,
        success: 1,
        response: result.message,
        detail: {
          mergedFromId: Number(removeId),
          mergedFromName: removeBefore ? removeBefore.display_name : 'unknown',
          coinsAbsorbed: removeBefore ? ((removeBefore.xp || 0) + (removeBefore.coins || 0)) : 0
        }
      });
    }

    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  // Admin: find all duplicate players (same display_name + platform)
  app.get('/api/admin/players/duplicates', (req, res) => {
    const groups = db.findDuplicatePlayers();
    res.json({ ok: true, groups, totalGroups: groups.length });
  });

  // Admin: merge ALL duplicate players at once
  app.post('/api/admin/players/merge-all-duplicates', (req, res) => {
    const report = db.cleanupDuplicatePlayers();
    res.json({ ok: true, merged: report.merged, details: report.details });
  });

  // ==================== ACCOUNT LINKING API ====================

  app.post('/api/link/create-code', requireApiKey, (req, res) => {
    const { discordUserId, discordUsername } = req.body;
    if (!discordUserId) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    // Generate unique high-entropy code
    let code;
    let attempts = 0;
    do {
      code = generateVerificationCode(8);
      attempts++;
    } while (db.getVerificationCode(code) && attempts < 50);

    if (attempts >= 50) {
      return res.json({ ok: false, message: 'Could not generate unique code. Try again.' });
    }

    // 10-minute expiry
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
    db.createVerificationCode(code, discordUserId, discordUsername || discordUserId, expiresAt);
    db.cleanupExpiredCodes();

    res.json({ ok: true, code });
  });

  // Consume a /link verification code on behalf of a chat viewer. Called by
  // Chat Relay when a viewer types !verify in ANY streamer's TikTok chat —
  // messages from non-Tycoon streams never reach this game server's own
  // chat-command path, so without this endpoint linking only worked on
  // streams whose chat routes to Word Tycoon. Mirrors commands.handleVerify.
  app.post('/api/link/verify-code', requireApiKey, (req, res) => {
    const { code, platform, platformUserId, displayName } = req.body || {};
    if (!hasText(code) || !hasText(platform) || !hasText(platformUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing code, platform, or platformUserId' });
    }
    const codeRecord = db.getVerificationCode(String(code).trim().toUpperCase());
    if (!codeRecord) {
      return res.json({ ok: false, message: 'Invalid or expired code. Get a new one with /link in Discord.' });
    }

    db.markCodeUsed(codeRecord.id);
    db.createLinkedAccount(codeRecord.discord_user_id, codeRecord.discord_username, platform, String(platformUserId));
    const { merged, discarded } = db.mergeLinkedAccounts(codeRecord.discord_user_id);

    const linkedAccounts = db.getLinkedAccounts(codeRecord.discord_user_id);
    const platforms = linkedAccounts.map(a => a.platform);
    gameEngine.emitEvent('account-linked', {
      discordUserId: codeRecord.discord_user_id,
      platform,
      platformUsername: displayName || platformUserId,
      linkedPlatforms: platforms,
      mergedCount: merged,
      discardedCount: discarded
    });

    res.json({
      ok: true,
      merged,
      discarded,
      platforms,
      discordUsername: codeRecord.discord_username || null
    });
  });

  app.get('/api/link/status/:discordUserId', requireApiKey, (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const accounts = db.getLinkedAccounts(discordUserId);
    res.json({ ok: true, linked: accounts.length > 0, accounts });
  });

  app.get('/api/link/check/:discordUserId', requireApiKey, (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    res.json({ linked: db.hasLinkedAccount(discordUserId) });
  });

  // Resolve a platform account to its linked Discord user (used by Chat Relay for self-service linking)
  app.get('/api/link/resolve', requireApiKey, (req, res) => {
    const { platform, platformUserId } = req.query;
    if (!platform || !platformUserId) {
      return res.status(400).json({ ok: false, message: 'Missing platform or platformUserId' });
    }
    const discordUserId = db.getDiscordUserForPlatform(platform, platformUserId);
    res.json({ ok: true, linked: !!discordUserId, discordUserId: discordUserId || null });
  });

  // Upsert a verified email for a platform account (called on OAuth login).
  app.post('/api/link/verified-email', requireApiKey, (req, res) => {
    const { platform, platformUserId, verifiedEmail } = req.body || {};
    if (!platform || !platformUserId || !verifiedEmail) {
      return res.status(400).json({ ok: false, message: 'Missing platform, platformUserId, or verifiedEmail' });
    }
    const stored = db.upsertVerifiedEmail(platform, platformUserId, verifiedEmail);
    res.json({ ok: !!stored });
  });

  // Look up accounts that share a verified email. Used to auto-link.
  // Returns { ok, accounts, discordAnchor, anchorInfo }
  app.get('/api/link/by-email', requireApiKey, (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ ok: false, message: 'Missing email' });
    }
    const accounts = db.findAccountsByEmail(email);
    const discordAnchor = db.findDiscordAnchorByEmail(email);
    const anchorInfo = discordAnchor ? db.getDiscordIdentityDisplayInfo(discordAnchor) : null;
    res.json({ ok: true, accounts, discordAnchor, anchorInfo });
  });

  // Aggregate progression check for a platform user id. Decides silent-vs-confirm.
  app.get('/api/account/zero-state', requireApiKey, (req, res) => {
    const { platform, platformUserId } = req.query;
    if (!platform || !platformUserId) {
      return res.status(400).json({ ok: false, message: 'Missing platform or platformUserId' });
    }
    const state = db.getAccountProgressionState(platform, platformUserId);
    res.json({ ok: true, ...state });
  });

  // Record a "Keep separate" decline so we stop re-prompting.
  app.post('/api/link/decline', requireApiKey, (req, res) => {
    const { platform, platformUserId, declinedAnchor } = req.body || {};
    if (!platform || !platformUserId || !declinedAnchor) {
      return res.status(400).json({ ok: false, message: 'Missing platform, platformUserId, or declinedAnchor' });
    }
    const stored = db.recordLinkDecline(platform, platformUserId, declinedAnchor);
    res.json({ ok: !!stored });
  });

  // Check whether a previous decline exists for a (platform, id, anchor) tuple.
  app.get('/api/link/decline-check', requireApiKey, (req, res) => {
    const { platform, platformUserId, anchor } = req.query;
    if (!platform || !platformUserId || !anchor) {
      return res.status(400).json({ ok: false, message: 'Missing platform, platformUserId, or anchor' });
    }
    const declined = db.hasLinkDecline(platform, platformUserId, anchor);
    res.json({ ok: true, declined });
  });

  // Manually trigger sync/merge for all accounts linked to a Discord user
  app.post('/api/link/sync/:discordUserId', requireApiKey, (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    if (!db.hasLinkedAccount(discordUserId)) {
      return res.json({ ok: false, message: 'No linked accounts found for this Discord user' });
    }
    const result = db.mergeLinkedAccounts(discordUserId);
    res.json({
      ok: true,
      merged: result.merged,
      discarded: result.discarded,
      primaryPlayer: result.primaryPlayer ? {
        id: result.primaryPlayer.id,
        displayName: result.primaryPlayer.display_name,
        coins: result.primaryPlayer.xp || 0,
        xp: result.primaryPlayer.xp || 0,
        dollars: result.primaryPlayer.coins || 0,
        totalTaps: result.primaryPlayer.total_taps
      } : null,
      linkedPlatforms: (result.accounts || []).map(a => ({ platform: a.platform, platformUserId: a.platform_user_id }))
    });
  });

  // ==================== ACCOUNT ADMIN API (for Chat Relay admin panel) ====================

  // Search players across all accounts
  app.get('/api/admin/accounts/search', (req, res) => {
    const q = req.query.q || '';
    if (!q || q.length < 1) return res.json([]);
    res.json(db.searchPlayers(q, 20));
  });

  // Get all linked account groups (must come before :discordUserId route)
  app.get('/api/admin/accounts/linked-groups', (req, res) => {
    const groups = db.getLinkedGroups();
    res.json({ ok: true, groups, total: groups.length });
  });

  // Canonical daily/weekly completion status for linked account groups
  app.get('/api/completion-status/:discordUserId', requireApiKey, (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const status = db.getCompletionStatus(discordUserId);
    res.json({ ok: true, ...status });
  });

  // Get unique won words for a game (used by Searchle for word exclusion)
  app.get('/api/admin/game-won-words', (req, res) => {
    const game = req.query.game;
    if (!game) return res.status(400).json({ error: 'game parameter required' });
    res.json({ ok: true, words: db.getGameWonWords(game) });
  });

  // Get recent games with stats for a game (used by Searchle for stats drawer)
  app.get('/api/admin/game-recent', (req, res) => {
    const game = req.query.game;
    if (!game) return res.status(400).json({ error: 'game parameter required' });
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    res.json({ ok: true, ...db.getGameRecent(game, limit) });
  });

  // Find potential matches for a player (similar names, different platforms)
  app.get('/api/admin/accounts/potential-matches/:playerId', (req, res) => {
    const playerId = parseInt(req.params.playerId);
    if (isNaN(playerId)) return res.status(400).json({ ok: false, message: 'Invalid player ID' });
    const matches = db.findPotentialMatches(playerId, 10);
    res.json({ ok: true, matches });
  });

  // Multi-link: link multiple players to a Discord user in one action
  app.post('/api/admin/accounts/multi-link', (req, res) => {
    const { discordUserId, players } = req.body;
    if (!discordUserId || !Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId or players array' });
    }
    const results = [];
    for (const p of players) {
      if (!p.platform || !p.platformUserId) continue;
      try {
        db.createLinkedAccount(discordUserId, discordUserId, p.platform, p.platformUserId);
        results.push({ platform: p.platform, platformUserId: p.platformUserId, linked: true });
      } catch (e) {
        results.push({ platform: p.platform, platformUserId: p.platformUserId, linked: false, error: e.message });
      }
    }
    const mergeResult = db.mergeLinkedAccounts(discordUserId);
    res.json({ ok: true, results, ...mergeResult });
  });

  // Search Discord/mobile players only (for quicklink)
  app.get('/api/admin/accounts/search-discord', (req, res) => {
    const q = req.query.q || '';
    if (!q || q.length < 1) return res.json([]);
    res.json(db.searchDiscordPlayers(q, 20));
  });

  // Buy/upgrade a business for a Discord user (portal proxy)
  app.post('/api/admin/business/buy', (req, res) => {
    const { discordUserId, businessType } = req.body;
    if (!discordUserId || !businessType) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId or businessType' });
    }
    const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-buy-business');
    const result = gameEngine.buyBusiness(player, businessType);
    if (result.ok) {
      const refreshed = db.getAccountOverview(discordUserId);
      result.coins = refreshed.primaryPlayer?.xp || 0;
      result.businesses = refreshed.businesses || [];
    }
    res.json(result);
  });

  app.post('/api/admin/tap-upgrade', (req, res) => {
    const { discordUserId, upgradeType } = req.body;
    if (!discordUserId || !upgradeType) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId or upgradeType' });
    }
    const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-tap-upgrade');

    const result = gameEngine.upgradeTap(player, upgradeType);
    if (result.ok) {
      const refreshed = db.getAccountOverview(discordUserId);
      result.coins = refreshed.primaryPlayer?.xp || 0;
      result.profile = refreshed.primaryPlayer
        ? {
            tapPower: refreshed.primaryPlayer.tap_power || 1,
            critChance: refreshed.primaryPlayer.crit_chance || 0,
            multiTap: refreshed.primaryPlayer.multi_tap || 1
          }
        : null;
    }
    res.json(result);
  });

  // Buy cosmetic for a Discord user (resolves through unified player)
  // Mark owned cosmetics as "seen in the wardrobe" for every linked player.
  // Account-level (not browser-level) so a new browser doesn't re-alert.
  app.post('/api/admin/cosmetics/mark-seen', (req, res) => {
    const { discordUserId, cosmeticIds } = req.body;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const playerIds = [...new Set([
      ...db.getAllPlayerIdsForDiscord(discordUserId),
      db.resolveUnifiedPlayerByDiscord(discordUserId)?.id
    ].filter(Boolean))];
    if (!playerIds.length) return res.json({ ok: false, message: 'Player not found' });
    const pidPh = playerIds.map(() => '?').join(',');
    if (Array.isArray(cosmeticIds) && cosmeticIds.length) {
      const ids = cosmeticIds.slice(0, 400).map(String);
      const idPh = ids.map(() => '?').join(',');
      db.run(
        `UPDATE player_cosmetics SET seen = 1 WHERE player_id IN (${pidPh}) AND cosmetic_id IN (${idPh})`,
        [...playerIds, ...ids]
      );
    } else {
      db.run(`UPDATE player_cosmetics SET seen = 1 WHERE player_id IN (${pidPh})`, playerIds);
    }
    db.save();
    res.json({ ok: true });
  });

  app.post('/api/admin/cosmetics/buy-for-discord', (req, res) => {
    const { discordUserId, cosmeticId } = req.body;
    if (!discordUserId || !cosmeticId) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId or cosmeticId' });
    }
    const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    // ── Admin cosmetic override ──
    // Allowlisted Discord IDs auto-grant + auto-equip any cosmetic with
    // zero XP cost. Bypasses cosmetics.buyCosmetic entirely so the
    // "already owned" / "insufficient XP" / "gift set" rejections
    // become no-ops for these accounts.
    const ADMIN_DISCORD_IDS = new Set(['179331908499406849']);
    if (ADMIN_DISCORD_IDS.has(String(discordUserId))) {
      const cat = db.queryOne('SELECT id FROM cosmetics WHERE id = ?', [cosmeticId]);
      if (!cat) return res.json({ ok: false, message: 'Cosmetic not found' });
      // Idempotent grant. UNIQUE(player_id, cosmetic_id) guards dupes.
      db.run(
        'INSERT OR IGNORE INTO player_cosmetics (player_id, cosmetic_id, equipped) VALUES (?, ?, 0)',
        [player.id, cosmeticId]
      );
      const equipResult = cosmetics.equipCosmetic(
        db,
        player.id,
        cosmeticId,
        [...gameEngine.getAllLinkedPlayerIds(player.platform, player.platform_user_id)]
      );
      broadcastCosmeticsUpdate(player.id);
      const refreshed = db.getAccountOverview(discordUserId);
      return res.json({
        ok: true,
        adminOverride: true,
        message: 'Admin override — cosmetic granted + equipped.',
        equip: equipResult,
        coins: refreshed.primaryPlayer?.xp || 0,
        xp: refreshed.primaryPlayer?.xp || 0,
        cosmetics: refreshed.cosmetics || [],
      });
    }
    const allPlayerIds = [...gameEngine.getAllLinkedPlayerIds(player.platform, player.platform_user_id)];
    const result = cosmetics.buyCosmetic(db, player.id, cosmeticId, player.xp || 0, allPlayerIds);
    if (result.ok) {
      broadcastCosmeticsUpdate(player.id);
      const refreshed = db.getAccountOverview(discordUserId);
      result.coins = refreshed.primaryPlayer?.xp || 0;
      result.xp = refreshed.primaryPlayer?.xp || 0;
      result.cosmetics = refreshed.cosmetics || [];
    }
    res.json(result);
  });

  // Buy gift set for a Discord user (resolves through unified player)
  app.post('/api/admin/cosmetics/buyset-for-discord', (req, res) => {
    const { discordUserId, setKey } = req.body;
    if (!discordUserId || !setKey) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId or setKey' });
    }
    const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    // Admin bypass: pre-grant every cosmetic in the set so cosmetics.buySet
    // sees them all as owned and stops on the gift-coin check rather than
    // ownership. We then short-circuit to a synthetic success WITHOUT
    // calling buySet (which would still try to charge gift coins). The
    // admin's primary player already has all items via DB grant — this
    // just covers any added-later set members.
    const ADMIN_DISCORD_IDS = new Set(['179331908499406849']);
    if (ADMIN_DISCORD_IDS.has(String(discordUserId))) {
      // Look up the set definition to enumerate its members.
      const setDef = cosmetics.COSMETIC_SETS && cosmetics.COSMETIC_SETS[setKey];
      if (!setDef) return res.json({ ok: false, message: 'Set not found' });
      const memberIds = Array.isArray(setDef.items) ? setDef.items : [];
      for (const cid of memberIds) {
        db.run(
          'INSERT OR IGNORE INTO player_cosmetics (player_id, cosmetic_id, equipped) VALUES (?, ?, 0)',
          [player.id, cid]
        );
      }
      broadcastCosmeticsUpdate(player.id);
      const refreshed = db.getAccountOverview(discordUserId);
      return res.json({
        ok: true,
        adminOverride: true,
        message: `Admin override — ${memberIds.length} items in "${setDef.name || setKey}" granted.`,
        giftCoins: refreshed.primaryPlayer?.gift_coins || 0,
        cosmetics: refreshed.cosmetics || [],
      });
    }
    const allSetPlayerIds = [...gameEngine.getAllLinkedPlayerIds(player.platform, player.platform_user_id)];
    const result = cosmetics.buySet(db, player.id, setKey, player.gift_coins || 0, allSetPlayerIds);
    if (result.ok) {
      broadcastCosmeticsUpdate(player.id);
      const refreshed = db.getAccountOverview(discordUserId);
      result.giftCoins = refreshed.primaryPlayer?.gift_coins || 0;
      result.cosmetics = refreshed.cosmetics || [];
    }
    res.json(result);
  });

  // Full account overview for a Discord user
  app.get('/api/admin/accounts/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const overview = db.getAccountOverview(discordUserId);
    overview.linkedPlayerIds = [...new Set([
      ...db.getAllPlayerIdsForDiscord(discordUserId),
      overview.primaryPlayer?.id
    ].filter(Boolean))];

    // Ensure Library exists and stays synced to linked word count.
    if (!Array.isArray(overview.businesses)) overview.businesses = [];
    const linkedPlayerIds = [...new Set([
      ...db.getAllPlayerIdsForDiscord(discordUserId),
      overview.primaryPlayer?.id
    ].filter(Boolean))];
    const libraryOwnerId = overview.primaryPlayer?.id || linkedPlayerIds[0] || null;
    const correctLibraryLevel = libraryOwnerId
      ? businesses.getLibraryLevel(db.getLinkedLibraryWordCount(libraryOwnerId))
      : 1;
    let libraryBiz = overview.businesses.find((biz) => businesses.isWordUpgrade(biz.business_type));
    let libraryChanged = false;

    if (!libraryBiz && libraryOwnerId) {
      let persistedLibrary = db.getPlayerBusiness(libraryOwnerId, 'library');
      if (!persistedLibrary) {
        db.createPlayerBusiness(libraryOwnerId, 'library');
        persistedLibrary = db.getPlayerBusiness(libraryOwnerId, 'library');
        libraryChanged = true;
      }
      if (persistedLibrary) {
        libraryBiz = persistedLibrary;
        overview.businesses.push(libraryBiz);
      }
    }

    if (libraryBiz && libraryBiz.level !== correctLibraryLevel) {
      if (libraryBiz.id) db.setBusinessLevel(libraryBiz.id, correctLibraryLevel);
      libraryBiz.level = correctLibraryLevel;
      libraryChanged = true;
    }

    if (libraryBiz && overview.businessStats) {
      overview.businessStats.businesses_owned = overview.businesses.length;
    }

    if (libraryChanged) db.save();

    // Enrich cosmetics with buff data (not stored in DB, computed from catalog/seed)
    if (Array.isArray(overview.cosmetics)) {
      overview.cosmetics = overview.cosmetics.map(c => {
        const id = c.cosmetic_id;
        let buff = null;
        let buffs = null;
        if (id && id.startsWith('gen_')) {
          buff = cosmetics.getGeneratedCosmeticBuff(id);
        } else {
          const catalogItem = cosmetics.getCosmeticById(id);
          if (catalogItem) {
            buff = catalogItem.buff || null;
            buffs = catalogItem.buffs || null;
          }
        }
        return { ...c, buff, buffs };
      });
    }

    // Enrich management businesses with shop_level and prestige_level for portal display
    if (Array.isArray(overview.businesses)) {
      for (const biz of overview.businesses) {
        try {
          const pid = biz.player_id;
          let row = null;
          if (biz.business_type === 'carwash') {
            row = db.queryOne('SELECT shop_level, prestige_level FROM carwash_shops WHERE player_id = ?', [pid]);
          } else if (biz.business_type === 'pizza') {
            row = db.queryOne('SELECT shop_level, prestige_level FROM pizza_shops WHERE player_id = ?', [pid]);
          } else if (biz.business_type === 'newspaper') {
            row = db.queryOne('SELECT route_level AS shop_level, prestige_level FROM newspaper_routes WHERE player_id = ?', [pid]);
          } else if (biz.business_type === 'stockmogul') {
            row = db.queryOne('SELECT portfolio_level AS shop_level, prestige_level FROM stockmogul_portfolios WHERE player_id = ?', [pid]);
          } else if (biz.business_type === 'gym') {
            row = db.queryOne('SELECT club_level AS shop_level, prestige_level FROM gym_clubs WHERE player_id = ?', [pid]);
          } else if (biz.business_type === 'cinema') {
            row = db.queryOne('SELECT theater_level AS shop_level, prestige_level FROM cinema_theaters WHERE player_id = ?', [pid]);
          } else if (biz.business_type === 'startup') {
            row = db.queryOne('SELECT hub_level AS shop_level, prestige_level FROM startup_hubs WHERE player_id = ?', [pid]);
          } else if (biz.business_type === 'bank') {
            row = db.queryOne('SELECT vault_level AS shop_level, prestige_level FROM bank_vaults WHERE player_id = ?', [pid]);
          }
          if (row) {
            biz.level = row.shop_level;
            biz.shop_level = row.shop_level;
            biz.prestige_level = row.prestige_level;
          }
        } catch (e) {
          // Non-fatal — portal falls back to the stored business level
        }
      }
    }

    // Compute income/sec from all sources
    const primaryId = overview.primaryPlayer?.id;
    const accountPlayerIds = db.getAllPlayerIdsForDiscord(discordUserId);
    if (accountPlayerIds.length > 0) {
      const currentIncome = computeCombinedIncome
        ? computeCombinedIncome(accountPlayerIds)
        : computePlayerIncome(primaryId);
      const currentIncomeNoBuffs = computeCombinedIncome
        ? computeCombinedIncome(accountPlayerIds, { includeIncomeBuffs: false })
        : computePlayerIncome(primaryId, { includeIncomeBuffs: false });
      const onlineIncome = computeCombinedIncome
        ? computeCombinedIncome(accountPlayerIds, { presenceMode: 'online' })
        : computePlayerIncome(primaryId, { presenceMode: 'online' });
      const onlineIncomeNoBuffs = computeCombinedIncome
        ? computeCombinedIncome(accountPlayerIds, { presenceMode: 'online', includeIncomeBuffs: false })
        : computePlayerIncome(primaryId, { presenceMode: 'online', includeIncomeBuffs: false });
      const offlineIncome = computeCombinedIncome
        ? computeCombinedIncome(accountPlayerIds, { presenceMode: 'offline' })
        : computePlayerIncome(primaryId, { presenceMode: 'offline' });
      const offlineIncomeNoBuffs = computeCombinedIncome
        ? computeCombinedIncome(accountPlayerIds, { presenceMode: 'offline', includeIncomeBuffs: false })
        : computePlayerIncome(primaryId, { presenceMode: 'offline', includeIncomeBuffs: false });
      overview.incomePerSecond = {
        ...currentIncome,
        current: currentIncome,
        currentNoBuffs: currentIncomeNoBuffs,
        online: onlineIncome,
        onlineNoBuffs: onlineIncomeNoBuffs,
        offline: offlineIncome,
        offlineNoBuffs: offlineIncomeNoBuffs,
        presence: summarizeAccountPresence(accountPlayerIds),
        activeBuffs: buildActiveIncomeBuffs(accountPlayerIds),
        rates: {
          regularOfflineRate: accrual.OFFLINE_INCOME_RATE,
          managedOfflineRate: accrual.MANAGED_OFFLINE_INCOME_RATE
        }
      };
    } else {
      const emptyIncome = {
        bizIncome: 0,
        pizzaIncome: 0,
        newsIncome: 0,
        gymIncome: 0,
        cinemaIncome: 0,
        startupIncome: 0,
        bankIncome: 0,
        carwashCleanRate: 0,
        stockmogulIncome: 0,
        byBusinessType: {},
        total: 0
      };
      overview.incomePerSecond = {
        ...emptyIncome,
        current: { ...emptyIncome },
        currentNoBuffs: { ...emptyIncome },
        online: { ...emptyIncome },
        onlineNoBuffs: { ...emptyIncome },
        offline: { ...emptyIncome },
        offlineNoBuffs: { ...emptyIncome },
        presence: summarizeAccountPresence([]),
        activeBuffs: [],
        rates: {
          regularOfflineRate: accrual.OFFLINE_INCOME_RATE,
          managedOfflineRate: accrual.MANAGED_OFFLINE_INCOME_RATE
        }
      };
    }

    res.json({ ok: true, ...overview });
  });

  app.post('/api/admin/accounts/:discordUserId/presence-heartbeat', (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    const playerIds = db.getAllPlayerIdsForDiscord(discordUserId);
    if (!playerIds.length) {
      return res.status(404).json({ ok: false, message: 'No linked players found for account' });
    }

    const source = trimHeartbeatSource(req.body && req.body.source);
    for (const playerId of playerIds) {
      presence.touch(playerId, source);
    }

    res.json({
      ok: true,
      source,
      presence: summarizeAccountPresence(playerIds)
    });
  });

  // Manually link a platform account to a Discord user
  app.post('/api/admin/accounts/:discordUserId/link', (req, res) => {
    const { discordUserId } = req.params;
    const { platform, platformUserId } = req.body;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    if (!platform || !platformUserId) {
      return res.status(400).json({ ok: false, message: 'Missing platform or platformUserId' });
    }
    db.createLinkedAccount(discordUserId, discordUserId, platform, platformUserId);
    const result = db.mergeLinkedAccounts(discordUserId);
    res.json({ ok: true, message: `Linked ${platform}:${platformUserId}`, ...result });
  });

  // Unlink a platform account from a Discord user
  app.post('/api/admin/accounts/:discordUserId/unlink', (req, res) => {
    const { discordUserId } = req.params;
    const { platform, platformUserId } = req.body;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    if (!platform || !platformUserId) {
      return res.status(400).json({ ok: false, message: 'Missing platform or platformUserId' });
    }
    db.unlinkAccount(discordUserId, platform, platformUserId);
    res.json({ ok: true, message: `Unlinked ${platform}:${platformUserId}` });
  });

  // Trigger re-merge for a Discord user
  app.post('/api/admin/accounts/:discordUserId/merge', (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    if (!db.hasLinkedAccount(discordUserId)) {
      return res.json({ ok: false, message: 'No linked accounts found' });
    }
    const result = db.mergeLinkedAccounts(discordUserId);
    res.json({ ok: true, ...result });
  });

  // Update linked account display info (profile pic, display name, username)
  app.post('/api/admin/linked-account/update-info', (req, res) => {
    const { platform, platformUserId, displayName, profilePic, username } = req.body;
    if (!platform || !platformUserId) {
      return res.status(400).json({ ok: false, message: 'Missing platform or platformUserId' });
    }
    db.refreshLinkedAccountInfo(platform, platformUserId, displayName || null, profilePic || null, username || null);
    db.save();
    res.json({ ok: true, message: `Updated ${platform}:${platformUserId}` });
  });

  // Update account preferences (preferred pfp, profile logo, display name, cosmetic visibility)
  app.put('/api/admin/accounts/:discordUserId/prefs', (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }

    // Map camelCase request body keys to snake_case DB column names
    const fieldMap = {
      preferredPfpPlatform: 'preferred_pfp_platform',
      preferredProfileLogoId: 'preferred_profile_logo_id',
      preferredDisplayName: 'preferred_display_name',
      cosmeticVisibility: 'cosmetic_visibility',
      gameHelpSeen: 'game_help_seen',
      customAvatarUrl: 'custom_avatar_url',
      cityLayout: 'city_layout',
      cityDecorations: 'city_decorations',
      cityBuildingStyle: 'city_building_style',
      cityDistrict: 'city_district',
      citySignText: 'city_sign_text',
    };

    const results = [];
    for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
      if (req.body[camelKey] !== undefined) {
        let val = req.body[camelKey];
        // JSON-stringify objects for text columns
        if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
        results.push(db.setAccountPreference(discordUserId, snakeKey, val));
      }
    }

    const failed = results.find(r => !r.ok);
    if (failed) return res.status(400).json(failed);

    // Flush to disk immediately so user doesn't lose data on refresh
    db.saveImmediate();

    // Profile image and cosmetic visibility changes affect overlay/account rendering.
    if (req.body.cosmeticVisibility !== undefined || req.body.preferredPfpPlatform !== undefined || req.body.preferredProfileLogoId !== undefined) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (player) broadcastCosmeticsUpdate(player.id);
    }

    res.json({ ok: true, message: 'Preferences updated' });
  });

  // Get account inventory (businesses + cosmetics)
  app.get('/api/admin/accounts/:discordUserId/inventory', (req, res) => {
    const { discordUserId } = req.params;
    if (!hasText(discordUserId)) {
      return res.status(400).json({ ok: false, message: 'Missing discordUserId' });
    }
    const overview = db.getAccountOverview(discordUserId);
    res.json({
      ok: true,
      primaryPlayer: overview.primaryPlayer ? {
        id: overview.primaryPlayer.id,
        displayName: overview.primaryPlayer.display_name,
        coins: overview.primaryPlayer.xp || 0,
        xp: overview.primaryPlayer.xp || 0,
        dollars: overview.primaryPlayer.coins || 0,
        totalTaps: overview.primaryPlayer.total_taps,
        profilePic: overview.primaryPlayer.profile_pic || overview.resolvedProfilePic || null
      } : null,
      businesses: overview.businesses,
      cosmetics: overview.cosmetics,
      profileLogos: overview.profileLogos || [],
      selectedProfileLogo: overview.selectedProfileLogo || null,
      resolvedProfilePic: overview.resolvedProfilePic || null
    });
  });

  function trimHeartbeatSource(value) {
    const source = hasText(value) ? String(value).trim().toLowerCase() : 'web-heartbeat';
    if (source === 'web-focus' || source === 'portal-focus' || source === 'web-heartbeat') return source;
    return 'web-heartbeat';
  }
}

module.exports = { registerAccountRoutes };
