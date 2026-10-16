/**
 * Startup routes — /api/admin/startup/*
 */

const startupConfig = require('../startup-config');
const { getIncomeMultiplier, scaleObjectFields, scaleIncomeAmount } = require('../tax-season');
const presence = require('../presence');
const accrual = require('../accrual');
const { validateUsername } = require('../username-moderation');

function registerStartupRoutes(app, { db, ledger }) {

  app.get('/api/admin/startup/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveStartupPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-startup');

    const startup = db.getStartupHub(player.id);
    if (!startup) return res.json({ ok: true, hasStartup: false });

    const upgradeRows = db.getStartupUpgrades(player.id);
    const upgrades = {};
    for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

    const customizationRows = db.getStartupCustomizations(player.id);
    const customizations = {};
    for (const row of customizationRows) customizations[row.category] = row.value;

    const investorsLevel = upgrades.investors || 0;
    const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
    const pending = scaleObjectFields(startupConfig.calculatePendingIncome(
      upgrades, startup.hub_level, startup.prestige_level, startup.last_collected_at, investorsLevel
    ), ['xpEarned', 'xpGained', 'launchesCompleted', 'usersServed'], multiplier);

    const incomePerSecond = startupConfig.getIncomePerSecond(upgrades, startup.hub_level, startup.prestige_level) * multiplier;
    const cycleTime = startupConfig.getCycleSeconds(upgrades.automation || 0);
    const incomePerCycle = scaleIncomeAmount(startupConfig.getIncomePerCycle(upgrades, startup.hub_level, startup.prestige_level), multiplier);
    const investorBonus = startupConfig.getInvestorBonus(investorsLevel);
    const xpNeeded = startupConfig.xpForLevel(startup.hub_level, startup.prestige_level);
    const freshPlayer = db.getWalletPlayerById(player.id);

    res.json({
      ok: true,
      hasStartup: true,
      playerCoins: (freshPlayer.xp || 0),
      startup: {
        startupName: startup.hub_name,
        prestigeLevel: startup.prestige_level,
        prestigeTier: startupConfig.getPrestigeTierName(startup.prestige_level),
        prestigeMultiplier: startupConfig.getPrestigeMultiplier(startup.prestige_level),
        startupLevel: startup.hub_level,
        startupXp: startup.hub_xp,
        xpNeeded,
        totalUsersServed: startup.total_users_served,
        totalXpEarned: startup.total_xp_earned,
        lastCollectedAt: startup.last_collected_at,
        incomePerSecond,
        cycleTime,
        incomePerCycle,
        investorBonus
      },
      upgrades,
      customizations,
      pending,
      availableUpgrades: Object.fromEntries(
        Object.entries(startupConfig.STARTUP_UPGRADES).map(([key, def]) => {
          const currentLevel = upgrades[key] || 0;
          const preview = startupConfig.getUpgradeEffectPreview(key, currentLevel, startup.hub_level, startup.prestige_level, upgrades);
          const maxBuy = startupConfig.calculateMaxBuy(key, currentLevel, (freshPlayer.xp || 0));
          return [key, {
            ...def,
            currentLevel,
            cost: startupConfig.getUpgradeCost(key, currentLevel),
            maxed: currentLevel >= def.maxLevel,
            effectPreview: preview,
            maxBuy
          }];
        })
      ),
      collectCap: startupConfig.getCollectCap(startup.prestige_level),
      availableCustomizations: startupConfig.getAvailableCustomizations(startup.prestige_level)
    });
  });

  app.post('/api/admin/startup/:discordUserId/init', (req, res) => {
    const { discordUserId } = req.params;
    const existingPlayer = db.resolveStartupPlayerByDiscord(discordUserId);
    const existingHub = existingPlayer ? db.getStartupHub(existingPlayer.id) : null;
    if (existingHub) {
      return res.json({ ok: true, message: 'Startup already initialized!', hub: existingHub });
    }

    const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
    let startupPlayerId = null;
    for (const pid of allIds) {
      const biz = db.getPlayerBusiness(pid, 'startup');
      if (biz) { startupPlayerId = pid; break; }
    }
    if (!startupPlayerId) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (!player) return res.json({ ok: false, message: 'Player not found' });
      const startupBiz = db.getPlayerBusiness(player.id, 'startup');
      if (!startupBiz) return res.json({ ok: false, message: 'Must own Tech Startup business first' });
      startupPlayerId = player.id;
    }

    const hub = db.createStartupHub(startupPlayerId);
    res.json({ ok: true, message: 'Startup initialized!', hub });
  });

  app.post('/api/admin/startup/:discordUserId/upgrade', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = startupConfig.STARTUP_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveStartupPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'startup', () => {
        const startup = db.getStartupHub(player.id);
        if (!startup) return { ok: false, message: 'No startup found' };

        const currentLevel = (db.getStartupUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const cost = startupConfig.getUpgradeCost(upgradeType, currentLevel);
        const freshPlayer = db.getWalletPlayerById(player.id);
        if ((freshPlayer.xp || 0) < cost) {
          return { ok: false, message: `Need ${cost} XP (have ${Math.floor((freshPlayer.xp || 0))})` };
        }

        if (!db.deductPlayerCoins(player.id, cost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setStartupUpgrade(player.id, upgradeType, currentLevel + 1);

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          message: `${def.emoji} ${def.name} upgraded to level ${currentLevel + 1}!`,
          newLevel: currentLevel + 1,
          playerCoins: (updatedPlayer.xp || 0)
        };
      });
      presence.touch(player.id, 'startup-upgrade');
      res.json(result);
    } catch (err) {
      console.error('[startup] upgrade failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  app.post('/api/admin/startup/:discordUserId/upgrade-max', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = startupConfig.STARTUP_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveStartupPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'startup', () => {
        const startup = db.getStartupHub(player.id);
        if (!startup) return { ok: false, message: 'No startup found' };

        const currentLevel = (db.getStartupUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const freshPlayer = db.getWalletPlayerById(player.id);
        const { levels, totalCost } = startupConfig.calculateMaxBuy(upgradeType, currentLevel, (freshPlayer.xp || 0));
        if (levels === 0) return { ok: false, message: `Not enough XP for ${def.name}` };

        if (!db.deductPlayerCoins(player.id, totalCost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setStartupUpgrade(player.id, upgradeType, currentLevel + levels);

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
      presence.touch(player.id, 'startup-upgrade-max');
      res.json(result);
    } catch (err) {
      console.error('[startup] upgrade-max failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade-max failed', error: err.message });
    }
  });

  app.post('/api/admin/startup/:discordUserId/collect', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveStartupPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    const beforePlayer = db.getWalletPlayerById(player.id);

    try {
      const result = await db.withTransaction(async () => {
        const startup = db.getStartupHub(player.id);
        if (!startup) return { ok: false, message: 'No startup found' };

        const upgradeRows = db.getStartupUpgrades(player.id);
        const upgrades = {};
        for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

        const investorsLevel = upgrades.investors || 0;
        const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
        const pending = scaleObjectFields(startupConfig.calculatePendingIncome(
          upgrades, startup.hub_level, startup.prestige_level, startup.last_collected_at, investorsLevel
        ), ['xpEarned', 'xpGained', 'launchesCompleted', 'usersServed'], multiplier);

        let newXp = startup.hub_xp + pending.xpGained;
        let newLevel = startup.hub_level;
        const newUsersServed = startup.total_users_served + pending.usersServed;

        while (newLevel < startupConfig.MAX_STARTUP_LEVEL) {
          const xpNeeded = startupConfig.xpForLevel(newLevel, startup.prestige_level);
          if (newXp >= xpNeeded) {
            newXp -= xpNeeded;
            newLevel++;
          } else {
            break;
          }
        }

        if (pending.xpEarned > 0) {
          db.updatePlayerCoins(player.id, pending.xpEarned);
        }

        db.updateStartupHub(player.id, {
          hub_xp: newXp,
          hub_level: newLevel,
          total_users_served: newUsersServed,
          total_xp_earned: startup.total_xp_earned + pending.xpEarned,
          last_collected_at: new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]
        });

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          collected: pending.xpEarned,
          launchesCompleted: pending.launchesCompleted,
          usersServed: pending.usersServed,
          capped: pending.capped,
          collectCap: pending.collectCap,
          newBalance: (updatedPlayer.xp || 0),
          startupLevel: newLevel,
          startupXp: newXp,
          totalUsersServed: newUsersServed
        };
      });

      if (result?.ok && ledger && beforePlayer && result.collected > 0) {
        ledger.record({
          playerId: player.id,
          playerName: player.display_name || player.username,
          platform: player.platform || 'unknown',
          eventType: 'biz-collect',
          command: 'startup collect',
          coinsBefore: (beforePlayer.xp || 0),
          coinsAfter: result.newBalance,
          success: 1,
          response: `Collected ${result.collected} XP from Tech Startup`,
          detail: {
            business: 'startup',
            coinsCollected: result.collected,
            launchesCompleted: result.launchesCompleted,
            usersServed: result.usersServed,
            startupLevel: result.startupLevel,
            totalUsersServed: result.totalUsersServed
          }
        });
      }

      presence.touch(player.id, 'startup-collect');
      res.json(result);
    } catch (err) {
      console.error('[startup] collect failed', err);
      res.status(500).json({ ok: false, message: 'Collect failed', error: err.message });
    }
  });

  app.post('/api/admin/startup/:discordUserId/prestige', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveStartupPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'startup', () => {
        const prestigeResult = db.prestigeStartupHub(player.id);
        if (!prestigeResult.ok) return prestigeResult;

        const tierName = startupConfig.getPrestigeTierName(prestigeResult.newPrestigeLevel);
        const multiplier = startupConfig.getPrestigeMultiplier(prestigeResult.newPrestigeLevel);

        return {
          ok: true,
          message: `Prestiged to ${tierName}! (${multiplier}x income)`,
          prestigeLevel: prestigeResult.newPrestigeLevel,
          tierName,
          multiplier
        };
      });
      presence.touch(player.id, 'startup-prestige');
      res.json(result);
    } catch (err) {
      console.error('[startup] prestige failed', err);
      res.status(500).json({ ok: false, message: 'Prestige failed', error: err.message });
    }
  });

  app.post('/api/admin/startup/:discordUserId/customize', (req, res) => {
    const { discordUserId } = req.params;
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ ok: false, message: 'Missing category or value' });

    const player = db.resolveStartupPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const startup = db.getStartupHub(player.id);
    if (!startup) return res.json({ ok: false, message: 'No startup found' });

    if (!startupConfig.isCustomizationAllowed(category, value, startup.prestige_level)) {
      return res.json({ ok: false, message: 'This option requires a higher prestige level' });
    }

    db.setStartupCustomization(player.id, category, value);
    db.save();

    res.json({ ok: true, message: 'Customization updated', category, value });
  });

  app.post('/api/admin/startup/:discordUserId/rename', (req, res) => {
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

    const player = db.resolveStartupPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const startup = db.getStartupHub(player.id);
    if (!startup) return res.json({ ok: false, message: 'No startup found' });

    db.updateStartupHub(player.id, { hub_name: cleanName });
    db.save();

    res.json({ ok: true, message: 'Startup renamed!', startupName: cleanName });
  });
}

module.exports = { registerStartupRoutes };
