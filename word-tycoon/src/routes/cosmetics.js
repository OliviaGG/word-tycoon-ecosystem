/**
 * Cosmetics routes — /api/cosmetics/*, /api/cosmetic-visibility/*
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const cosmeticsModule = require('../cosmetics');

// ── Admin cosmetic override ──
// Discord user IDs in this set bypass normal ownership/cost checks and
// auto-receive any cosmetic they try to equip or buy. Used so the project
// owner can stress-test cosmetic presentation across every item without
// having to grind XP for each one. Existing cosmetics for these accounts
// are pre-granted via a one-shot SQL insert at deploy time; this hook
// covers cosmetics added LATER.
const ADMIN_DISCORD_IDS = new Set([
  '179331908499406849', // Jorry (project owner)
]);
function _isAdminRequest(platform, userId) {
  return platform === 'discord' && ADMIN_DISCORD_IDS.has(String(userId || ''));
}
// Ensures the admin's primary player owns the cosmetic so the subsequent
// equip-call succeeds. No-op if they already own it. Returns true when
// the cosmetic exists in the catalog (regardless of grant outcome).
function _grantCosmeticForAdmin(db, platform, userId, cosmeticId) {
  if (!_isAdminRequest(platform, userId)) return false;
  const cosmetic = db.queryOne('SELECT id FROM cosmetics WHERE id = ?', [cosmeticId]);
  if (!cosmetic) return false;
  const player = db.resolvePlayer(platform, userId);
  if (!player) return false;
  db.run(
    'INSERT OR IGNORE INTO player_cosmetics (player_id, cosmetic_id, equipped) VALUES (?, ?, 0)',
    [player.id, cosmeticId]
  );
  return true;
}

function registerCosmeticsRoutes(app, { db, gameEngine, requireApiKey, broadcastCosmeticsUpdate }) {

  // Cosmetics shop catalog (grouped by category)
  app.get('/api/cosmetics/shop', (req, res) => {
    const items = cosmeticsModule.COSMETICS_CATALOG;
    const grouped = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      const entry = {
        id: item.id,
        name: item.name,
        rarity: item.rarity,
        cost: item.cost,
        css: item.css,
        render: item.render || null,
        fallbackCss: item.fallbackCss || null,
        renderType: item.renderType || 'css',
        buff: item.buff || null,
        sort: item.sort,
        unlockSource: item.unlockSource || 'store',
        membershipTier: item.membershipTier || null,
        battlePassTier: item.battlePassTier || null,
        battlePassLevel: item.battlePassLevel || null
      };
      if (item.buffs) entry.buffs = item.buffs;
      if (item.audioReactive) entry.audioReactive = true;
      if (item.setId) entry.setId = item.setId;
      if (item.giftSet) entry.giftSet = true;
      if (item.fanClubOnly) entry.fanClubOnly = true;
      if (item.superfanOnly) entry.superfanOnly = true;
      if (item.donorClassOnly) entry.donorClassOnly = true;
      if (item.superDonorOnly) entry.superDonorOnly = true;
      grouped[item.category].push(entry);
    }
    res.json(grouped);
  });

  // Get cosmetics by Discord ID (used by Chat Relay to enrich chat messages)
  // IMPORTANT: must be registered BEFORE /api/cosmetics/:platform/:userId to avoid shadowing
  // Returns filtered cosmetics respecting the user's cosmetic_visibility preferences
  app.get('/api/cosmetics/discord/:discordId', (req, res) => {
    const { discordId } = req.params;
    // A Discord login can be an alias of a Google/GitHub-owned account.
    // Resolve that anchor before reading its preferences and equipped set.
    const accountId = db.getDiscordUserForPlatform('discord', discordId) || discordId;
    const prefs = db.queryOne(
      'SELECT preferred_display_name FROM account_preferences WHERE discord_user_id = ?',
      [accountId]
    );
    const preferredDisplayName = prefs?.preferred_display_name || null;
    const resolvedProfile = db.resolveAccountProfileImage(accountId);
    const profilePic = resolvedProfile?.profilePic || null;
    const profileLogo = resolvedProfile?.profileLogo || null;

    // The account resolver finds the primary player even when the first linked
    // identity has never played and therefore has no player row of its own.
    const equipped = gameEngine.getPlayerCosmeticsForAPI('discord', accountId);
    res.json({ equipped, preferredDisplayName, profilePic, profileLogo });
  });

  // Get equipped cosmetics for a player (generic platform lookup)
  app.get('/api/cosmetics/:platform/:userId', (req, res) => {
    const { platform, userId } = req.params;
    const equipped = gameEngine.getPlayerCosmeticsForAPI(platform, userId);
    res.json({ equipped });
  });

  // Get cosmetic visibility settings for a Discord user (lightweight, used by game pages)
  app.get('/api/cosmetic-visibility/:discordId', requireApiKey, (req, res) => {
    const vis = db.getCosmeticVisibility(req.params.discordId);
    // null = never saved → apply defaults; {} = all ON; { word_color: false } = specific off
    const DEFAULT_VIS = { word_color: false, word_glow: false };
    res.json({ ok: true, visibility: vis === null ? DEFAULT_VIS : vis });
  });

  // Buy a cosmetic
  app.post('/api/cosmetics/buy', requireApiKey, (req, res) => {
    const { platform, userId, username, displayName, cosmeticId } = req.body;
    if (!platform || !userId || !cosmeticId) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    // Admin bypass: grant the cosmetic for free and return a synthetic
    // "purchased" response so the portal UI flips the chip to owned/
    // equipped without ever decrementing the admin's XP balance.
    if (_isAdminRequest(platform, userId)) {
      if (_grantCosmeticForAdmin(db, platform, userId, cosmeticId)) {
        const equipResult = gameEngine.handleEquipCosmetic(platform, userId, cosmeticId);
        const player = db.resolvePlayer(platform, userId);
        if (player) broadcastCosmeticsUpdate(player.id);
        return res.json({
          ok: true,
          message: 'Admin override — cosmetic granted + equipped.',
          adminOverride: true,
          equip: equipResult,
        });
      }
      return res.status(404).json({ ok: false, message: 'Cosmetic not found.' });
    }
    const result = gameEngine.handleBuyCosmetic(platform, userId, username || userId, displayName || username || userId, cosmeticId);
    res.json(result);
    if (result.ok) {
      const player = db.resolvePlayer(platform, userId);
      if (player) broadcastCosmeticsUpdate(player.id);
    }
  });

  // Equip a cosmetic
  app.post('/api/cosmetics/equip', requireApiKey, (req, res) => {
    const { platform, userId, cosmeticId } = req.body;
    if (!platform || !userId || !cosmeticId) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    // Admin bypass: auto-grant the cosmetic before equip so ownership
    // check inside equipCosmetic passes. No XP deducted, no purchase
    // logged — pure presentation override.
    _grantCosmeticForAdmin(db, platform, userId, cosmeticId);
    const result = gameEngine.handleEquipCosmetic(platform, userId, cosmeticId);
    res.json(result);
    if (result.ok) {
      const player = db.resolvePlayer(platform, userId);
      if (player) broadcastCosmeticsUpdate(player.id);
    }
  });

  // Unequip a cosmetic
  app.post('/api/cosmetics/unequip', requireApiKey, (req, res) => {
    const { platform, userId, category } = req.body;
    if (!platform || !userId || !category) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const result = gameEngine.handleUnequipCosmetic(platform, userId, category);
    res.json(result);
    if (result.ok) {
      const player = db.resolvePlayer(platform, userId);
      if (player) broadcastCosmeticsUpdate(player.id);
    }
  });

  // List all cosmetic sets
  app.get('/api/cosmetics/sets', (req, res) => {
    res.json({ sets: cosmeticsModule.COSMETIC_SETS });
  });

  // Get player's set completion status
  app.get('/api/cosmetics/sets/:platform/:userId', (req, res) => {
    const { platform, userId } = req.params;
    const player = db.resolvePlayer(platform, userId);
    if (!player) return res.status(404).json({ ok: false, message: 'Player not found' });
    const status = cosmeticsModule.getPlayerSetStatus(db, player.id);
    res.json({ ok: true, sets: status, giftCoins: player.gift_coins || 0 });
  });

  // Buy a cosmetic set
  app.post('/api/cosmetics/buyset', requireApiKey, (req, res) => {
    const { platform, userId, username, displayName, setKey } = req.body;
    if (!platform || !userId || !setKey) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const result = gameEngine.handleBuySet(platform, userId, username || userId, displayName || username || userId, setKey);
    res.json(result);
    if (result.ok) {
      const player = db.resolvePlayer(platform, userId);
      if (player) broadcastCosmeticsUpdate(player.id);
    }
  });

  // Admin: status check for a one-off set grant against a platform user.
  // Used by the portal store card to render locked/unlocked state.
  app.get('/api/cosmetics/grant-status', requireApiKey, (req, res) => {
    const { platform, platformUserId, setKey } = req.query;
    const key = setKey || 'tiktok_fc';
    if (!platform || !platformUserId) {
      return res.status(400).json({ ok: false, message: 'platform and platformUserId required' });
    }
    const player = db.resolvePlayer(platform, String(platformUserId));
    let granted = false;
    let queued = false;
    if (player && player.id) {
      const row = db.queryOne(
        'SELECT granted_at FROM player_cosmetic_grants WHERE player_id = ? AND grant_key = ?',
        [player.id, key]
      );
      granted = !!row;
    }
    if (!granted) {
      const q = db.queryOne(
        'SELECT id FROM pending_cosmetic_grants WHERE platform = ? AND platform_user_id = ? AND grant_key = ?',
        [platform, String(platformUserId), key]
      );
      queued = !!q;
    }
    res.json({ ok: true, granted, queued, playerId: player?.id || null });
  });

  // Admin: grant a fan-club-style set to a platform user.
  //
  // Behavior:
  //   • Existing player (any platform / linked account)  → grant immediately
  //   • No existing player on this platform              → AUTO-CREATE a
  //     player row for them so cosmetics can attach. This lets fan-club
  //     viewers see their equipped cosmetics in-game without first having
  //     to link a Discord account (per design call — Discord linking is
  //     friction we want to remove for the FC viewer experience).
  //
  //   Auto-create uses any (optional) `username` / `displayName` /
  //   `profilePic` fields from the request body. These can be sent by
  //   chat-relay when the grant call originates from a TikTok chat event
  //   so the new player has identifying info instead of a bare
  //   (platform, id) tuple.
  app.post('/api/cosmetics/grant-fanclub-set', requireApiKey, (req, res) => {
    const { platform, platformUserId, setKey, source,
            username, displayName, profilePic, country } = req.body || {};
    const key = setKey || 'tiktok_fc';

    if (!platform || !platformUserId) {
      return res.status(400).json({ ok: false, message: 'platform and platformUserId required' });
    }
    if (!cosmeticsModule.COSMETIC_SETS[key]) {
      return res.status(400).json({ ok: false, message: `Unknown setKey: ${key}` });
    }

    let player = db.resolvePlayer(platform, String(platformUserId));

    // Auto-provision when no existing player. This bypasses the "link your
    // Discord first" friction for fan-club viewers who chat from TikTok
    // and earn cosmetics passively — they should see the cosmetics
    // immediately on their next guess, not after a portal sign-up flow.
    if (!player || !player.id) {
      try {
        player = db.getOrCreatePlayer(
          platform,
          String(platformUserId),
          username || String(platformUserId),
          displayName || username || String(platformUserId),
          profilePic || null,
          country || null,
        );
      } catch (e) {
        // If auto-create fails (rare — schema constraints, etc.), fall
        // back to the legacy queue path so the grant isn't lost.
        cosmeticsModule.enqueuePendingGrant(db, platform, String(platformUserId), key, source);
        return res.json({ ok: true, granted: false, queued: true,
          alreadyGranted: false, autoCreateFailed: true, message: e.message });
      }
    }

    const result = cosmeticsModule.grantSetToPlayer(db, player.id, key, source);
    if (result.ok && !result.alreadyGranted && ((result.equippedItems && result.equippedItems.length) || (result.grantedItems && result.grantedItems.length))) {
      try { broadcastCosmeticsUpdate(player.id); } catch (_) {}
    }
    return res.json({
      ok: result.ok,
      granted: !result.alreadyGranted && result.ok,
      queued: false,
      alreadyGranted: !!result.alreadyGranted,
      autoCreated: !player.created_at || (Date.now() - new Date(player.created_at).getTime()) < 5000,
      playerId: player.id,
      grantedCount: (result.grantedItems && result.grantedItems.length) || 0,
      equippedCount: (result.equippedItems && result.equippedItems.length) || 0,
      message: result.message
    });
  });
}

module.exports = { registerCosmeticsRoutes };
