/**
 * Newspaper Route routes — /api/admin/newspaper/*
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const newspaperConfig = require('../newspaper-config');
const { getIncomeMultiplier, scaleObjectFields, scaleIncomeAmount } = require('../tax-season');
const presence = require('../presence');
const accrual = require('../accrual');
const { validateUsername } = require('../username-moderation');

function parseStoredTimestamp(value) {
  if (!value) return NaN;
  if (value.includes('T') || value.includes('Z') || value.includes('+')) {
    return new Date(value).getTime();
  }
  return new Date(value.replace(' ', 'T') + 'Z').getTime();
}

function registerNewspaperRoutes(app, { db, ledger }) {

  // Get full newspaper route state
  app.get('/api/admin/newspaper/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveNewspaperPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-newspaper');

    const route = db.getNewspaperRoute(player.id);
    if (!route) return res.json({ ok: true, hasRoute: false });

    const upgradeRows = db.getNewspaperUpgrades(player.id);
    const upgrades = {};
    for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

    const customizationRows = db.getNewspaperCustomizations(player.id);
    const customizations = {};
    for (const row of customizationRows) customizations[row.category] = row.value;

    // Calculate pending income
    const bundlesLevel = upgrades.bundles || 0;
    const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
    const pending = scaleObjectFields(newspaperConfig.calculatePendingIncome(
      upgrades, route.route_level, route.prestige_level, route.last_collected_at, bundlesLevel
    ), ['xpEarned', 'papersDelivered', 'routesCompleted'], multiplier);

    const incomePerSecond = newspaperConfig.getIncomePerSecond(upgrades, route.route_level, route.prestige_level) * multiplier;
    const xpNeeded = newspaperConfig.xpForLevel(route.route_level);

    // Player's real XP balance (used for upgrades)
    const freshPlayer = db.getWalletPlayerById(player.id);

    res.json({
      ok: true,
      hasRoute: true,
      playerCoins: (freshPlayer.xp || 0),
      route: {
        routeName: route.route_name,
        prestigeLevel: route.prestige_level,
        prestigeTier: newspaperConfig.getPrestigeTierName(route.prestige_level),
        prestigeMultiplier: newspaperConfig.getPrestigeMultiplier(route.prestige_level),
        routeLevel: route.route_level,
        routeXp: route.route_xp,
        xpNeeded,
        totalPapersDelivered: route.total_papers_delivered,
        totalXpEarned: route.total_xp_earned,
        lastCollectedAt: route.last_collected_at,
        incomePerSecond
      },
      upgrades,
      customizations,
      pending,
      availableUpgrades: Object.fromEntries(
        Object.entries(newspaperConfig.NEWSPAPER_UPGRADES).map(([key, def]) => {
          const currentLevel = upgrades[key] || 0;
          const preview = newspaperConfig.getUpgradeEffectPreview(key, currentLevel, route.route_level, route.prestige_level, upgrades);
          const maxBuy = newspaperConfig.calculateMaxBuy(key, currentLevel, (freshPlayer.xp || 0));
          return [key, {
            ...def,
            currentLevel,
            cost: newspaperConfig.getUpgradeCost(key, currentLevel),
            maxed: currentLevel >= def.maxLevel,
            effectPreview: preview,
            maxBuy
          }];
        })
      ),
      collectCap: newspaperConfig.getCollectCap(route.prestige_level),
      availableCustomizations: newspaperConfig.getAvailableCustomizations(route.prestige_level)
    });
  });

  // Initialize newspaper route
  app.post('/api/admin/newspaper/:discordUserId/init', (req, res) => {
    const { discordUserId } = req.params;
    const existingPlayer = db.resolveNewspaperPlayerByDiscord(discordUserId);
    const existingRoute = existingPlayer ? db.getNewspaperRoute(existingPlayer.id) : null;
    if (existingRoute) {
      return res.json({ ok: true, message: 'Newspaper Route already initialized!', route: existingRoute });
    }

    const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
    let newspaperPlayerId = null;
    for (const pid of allIds) {
      const biz = db.getPlayerBusiness(pid, 'newspaper');
      if (biz) { newspaperPlayerId = pid; break; }
    }
    if (!newspaperPlayerId) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (!player) return res.json({ ok: false, message: 'Player not found' });
      const newspaperBiz = db.getPlayerBusiness(player.id, 'newspaper');
      if (!newspaperBiz) return res.json({ ok: false, message: 'Must own Newspaper Route business first' });
      newspaperPlayerId = player.id;
    }

    const route = db.createNewspaperRoute(newspaperPlayerId);
    res.json({ ok: true, message: 'Newspaper Route initialized!', route });
  });

  // Upgrade a newspaper route component (costs real XP)
  app.post('/api/admin/newspaper/:discordUserId/upgrade', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = newspaperConfig.NEWSPAPER_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveNewspaperPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    try {
      const result = await accrual.settleAndMutate(player.id, 'newspaper', () => {
        const route = db.getNewspaperRoute(player.id);
        if (!route) return { ok: false, message: 'No newspaper route found' };

        const currentLevel = (db.getNewspaperUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const cost = newspaperConfig.getUpgradeCost(upgradeType, currentLevel);
        const freshPlayer = db.getWalletPlayerById(player.id);
        if ((freshPlayer.xp || 0) < cost) {
          return { ok: false, message: `Need ${cost} XP (have ${Math.floor((freshPlayer.xp || 0))})` };
        }

        if (!db.deductPlayerCoins(player.id, cost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setNewspaperUpgrade(player.id, upgradeType, currentLevel + 1);

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          message: `${def.emoji} ${def.name} upgraded to level ${currentLevel + 1}!`,
          newLevel: currentLevel + 1,
          playerCoins: (updatedPlayer.xp || 0)
        };
      });
      presence.touch(player.id, 'newspaper-upgrade');
      res.json(result);
    } catch (err) {
      console.error('[newspaper] upgrade failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  // Max-buy newspaper upgrade (costs real XP)
  app.post('/api/admin/newspaper/:discordUserId/upgrade-max', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = newspaperConfig.NEWSPAPER_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveNewspaperPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    try {
      const result = await accrual.settleAndMutate(player.id, 'newspaper', () => {
        const route = db.getNewspaperRoute(player.id);
        if (!route) return { ok: false, message: 'No newspaper route found' };

        const currentLevel = (db.getNewspaperUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const freshPlayer = db.getWalletPlayerById(player.id);
        const { levels, totalCost } = newspaperConfig.calculateMaxBuy(upgradeType, currentLevel, (freshPlayer.xp || 0));
        if (levels === 0) return { ok: false, message: 'Not enough XP for even one level' };

        if (!db.deductPlayerCoins(player.id, totalCost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setNewspaperUpgrade(player.id, upgradeType, currentLevel + levels);

        const updatedPlayer = db.getWalletPlayerById(player.id);
        const newLevel = currentLevel + levels;
        return {
          ok: true,
          message: `${def.emoji} ${def.name} upgraded ${levels} level${levels > 1 ? 's' : ''} to level ${newLevel}!`,
          newLevel,
          levelsGained: levels,
          playerCoins: (updatedPlayer.xp || 0)
        };
      });
      presence.touch(player.id, 'newspaper-upgrade-max');
      res.json(result);
    } catch (err) {
      console.error('[newspaper] upgrade-max failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  // Collect accumulated newspaper income (pays out XP directly)
  app.post('/api/admin/newspaper/:discordUserId/collect', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveNewspaperPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    const beforePlayer = db.getWalletPlayerById(player.id);

    try {
      const result = await db.withTransaction(async () => {
        const route = db.getNewspaperRoute(player.id);
        if (!route) return { ok: false, message: 'No newspaper route found' };

        const upgradeRows = db.getNewspaperUpgrades(player.id);
        const upgrades = {};
        for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

        const bundlesLevel = upgrades.bundles || 0;
        const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
        const pending = scaleObjectFields(newspaperConfig.calculatePendingIncome(
          upgrades, route.route_level, route.prestige_level, route.last_collected_at, bundlesLevel
        ), ['xpEarned', 'papersDelivered', 'routesCompleted'], multiplier);

        const claimedAt = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
        if (!db.claimBusinessCollectSnapshot('newspaper_routes', player.id, route.last_collected_at || null, claimedAt)) {
          const refreshedRoute = db.getNewspaperRoute(player.id);
          const refreshedClaimMs = parseStoredTimestamp(refreshedRoute?.last_collected_at || '');
          const originalClaimMs = parseStoredTimestamp(route.last_collected_at || '');
          const isRecentClaim =
            Number.isFinite(refreshedClaimMs) &&
            refreshedClaimMs !== originalClaimMs &&
            Math.abs(refreshedClaimMs - parseStoredTimestamp(claimedAt)) <= 10000;

          if (refreshedRoute && isRecentClaim) {
            return {
              ok: true,
              alreadyProcessed: true,
              collected: 0,
              papersDelivered: 0,
              routesCompleted: 0,
              capped: false,
              collectCap: newspaperConfig.getCollectCap(refreshedRoute.prestige_level),
              newBalance: db.getWalletPlayerById(player.id)?.xp ?? beforePlayer?.xp ?? 0,
              routeLevel: refreshedRoute.route_level,
              routeXp: refreshedRoute.route_xp,
              totalPapersDelivered: refreshedRoute.total_papers_delivered
            };
          }

          return { ok: false, message: 'Collect already processed. Try again.' };
        }

        if (pending.xpEarned > 0) {
          db.updatePlayerCoins(player.id, pending.xpEarned);
        }

        let newXp = route.route_xp + pending.routesCompleted;
        let newLevel = route.route_level;
        while (newLevel < newspaperConfig.MAX_ROUTE_LEVEL) {
          const xpNeeded = newspaperConfig.xpForLevel(newLevel);
          if (newXp >= xpNeeded) {
            newXp -= xpNeeded;
            newLevel++;
          } else {
            break;
          }
        }

        const totalPapersDelivered = route.total_papers_delivered + pending.papersDelivered;
        db.updateNewspaperRoute(player.id, {
          route_xp: newXp,
          route_level: newLevel,
          total_papers_delivered: totalPapersDelivered,
          total_xp_earned: route.total_xp_earned + pending.xpEarned,
          last_collected_at: claimedAt
        });

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          collected: pending.xpEarned,
          papersDelivered: pending.papersDelivered,
          routesCompleted: pending.routesCompleted,
          capped: pending.capped,
          collectCap: pending.collectCap,
          newBalance: (updatedPlayer.xp || 0),
          routeLevel: newLevel,
          routeXp: newXp,
          totalPapersDelivered
        };
      });

      if (result?.ok && ledger && beforePlayer && result.collected > 0) {
        ledger.record({
          playerId: player.id,
          playerName: player.display_name || player.username,
          platform: player.platform || 'unknown',
          eventType: 'biz-collect',
          command: 'newspaper collect',
          coinsBefore: (beforePlayer.xp || 0),
          coinsAfter: result.newBalance,
          success: 1,
          response: `Collected ${result.collected} XP from Newspaper Route`,
          detail: {
            business: 'newspaper',
            coinsCollected: result.collected,
            papersDelivered: result.papersDelivered,
            routesCompleted: result.routesCompleted,
            routeLevel: result.routeLevel,
            totalPapersDelivered: result.totalPapersDelivered
          }
        });
      }

      presence.touch(player.id, 'newspaper-collect');
      res.json(result);
    } catch (err) {
      console.error('[newspaper] collect failed', err);
      res.status(500).json({ ok: false, message: 'Collect failed', error: err.message });
    }
  });

  // Prestige the newspaper route
  app.post('/api/admin/newspaper/:discordUserId/prestige', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveNewspaperPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'newspaper', () => {
        const prestigeResult = db.prestigeNewspaperRoute(player.id);
        if (!prestigeResult.ok) return prestigeResult;

        const tierName = newspaperConfig.getPrestigeTierName(prestigeResult.newPrestigeLevel);
        const multiplier = newspaperConfig.getPrestigeMultiplier(prestigeResult.newPrestigeLevel);

        return {
          ok: true,
          message: `Prestiged to ${tierName}! (${multiplier}x income)`,
          prestigeLevel: prestigeResult.newPrestigeLevel,
          tierName,
          multiplier
        };
      });
      presence.touch(player.id, 'newspaper-prestige');
      res.json(result);
    } catch (err) {
      console.error('[newspaper] prestige failed', err);
      res.status(500).json({ ok: false, message: 'Prestige failed', error: err.message });
    }
  });

  // Set a customization option
  app.post('/api/admin/newspaper/:discordUserId/customize', (req, res) => {
    const { discordUserId } = req.params;
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ ok: false, message: 'Missing category or value' });

    const player = db.resolveNewspaperPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const route = db.getNewspaperRoute(player.id);
    if (!route) return res.json({ ok: false, message: 'No newspaper route found' });

    if (!newspaperConfig.isCustomizationAllowed(category, value, route.prestige_level)) {
      return res.json({ ok: false, message: 'This option requires a higher prestige level' });
    }

    db.setNewspaperCustomization(player.id, category, value);
    db.save();

    res.json({ ok: true, message: 'Customization updated', category, value });
  });

  // Rename the newspaper route
  app.post('/api/admin/newspaper/:discordUserId/rename', (req, res) => {
    const { discordUserId } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ ok: false, message: 'Missing name' });

    const validation = validateUsername(name, { maxLength: 24, minLength: 1 });
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        message: validation.code === 'blocked' ? 'That name is not allowed.' : 'Invalid name'
      });
    }
    const cleanName = validation.sanitized;

    const player = db.resolveNewspaperPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const route = db.getNewspaperRoute(player.id);
    if (!route) return res.json({ ok: false, message: 'No newspaper route found' });

    db.updateNewspaperRoute(player.id, { route_name: cleanName });
    db.save();

    res.json({ ok: true, message: 'Route renamed!', routeName: cleanName });
  });
}

module.exports = { registerNewspaperRoutes };
