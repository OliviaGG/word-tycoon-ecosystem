/**
 * Cinema routes — /api/admin/cinema/*
 */

const cinemaConfig = require('../cinema-config');
const { getIncomeMultiplier, scaleObjectFields, scaleIncomeAmount } = require('../tax-season');
const presence = require('../presence');
const accrual = require('../accrual');
const { validateUsername } = require('../username-moderation');

function registerCinemaRoutes(app, { db, ledger }) {

  app.get('/api/admin/cinema/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveCinemaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-cinema');

    const theater = db.getCinemaTheater(player.id);
    if (!theater) return res.json({ ok: true, hasCinema: false });

    const upgradeRows = db.getCinemaUpgrades(player.id);
    const upgrades = {};
    for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

    const customizationRows = db.getCinemaCustomizations(player.id);
    const customizations = {};
    for (const row of customizationRows) customizations[row.category] = row.value;

    const membershipLevel = upgrades.membership || 0;
    const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
    const pending = scaleObjectFields(cinemaConfig.calculatePendingIncome(
      upgrades, theater.theater_level, theater.prestige_level, theater.last_collected_at, membershipLevel
    ), ['xpEarned', 'xpGained', 'showsRun', 'viewersServed'], multiplier);

    const incomePerSecond = cinemaConfig.getIncomePerSecond(upgrades, theater.theater_level, theater.prestige_level) * multiplier;
    const cycleTime = cinemaConfig.getCycleSeconds(upgrades.projectors || 0);
    const incomePerCycle = scaleIncomeAmount(cinemaConfig.getIncomePerCycle(upgrades, theater.theater_level, theater.prestige_level), multiplier);
    const membershipBonus = cinemaConfig.getMembershipBonus(membershipLevel);
    const xpNeeded = cinemaConfig.xpForLevel(theater.theater_level, theater.prestige_level);
    const freshPlayer = db.getWalletPlayerById(player.id);

    res.json({
      ok: true,
      hasCinema: true,
      playerCoins: (freshPlayer.xp || 0),
      cinema: {
        cinemaName: theater.theater_name,
        prestigeLevel: theater.prestige_level,
        prestigeTier: cinemaConfig.getPrestigeTierName(theater.prestige_level),
        prestigeMultiplier: cinemaConfig.getPrestigeMultiplier(theater.prestige_level),
        cinemaLevel: theater.theater_level,
        cinemaXp: theater.theater_xp,
        xpNeeded,
        totalViewersServed: theater.total_viewers_served,
        totalXpEarned: theater.total_xp_earned,
        lastCollectedAt: theater.last_collected_at,
        incomePerSecond,
        cycleTime,
        incomePerCycle,
        membershipBonus
      },
      upgrades,
      customizations,
      pending,
      availableUpgrades: Object.fromEntries(
        Object.entries(cinemaConfig.CINEMA_UPGRADES).map(([key, def]) => {
          const currentLevel = upgrades[key] || 0;
          const preview = cinemaConfig.getUpgradeEffectPreview(key, currentLevel, theater.theater_level, theater.prestige_level, upgrades);
          const maxBuy = cinemaConfig.calculateMaxBuy(key, currentLevel, (freshPlayer.xp || 0));
          return [key, {
            ...def,
            currentLevel,
            cost: cinemaConfig.getUpgradeCost(key, currentLevel),
            maxed: currentLevel >= def.maxLevel,
            effectPreview: preview,
            maxBuy
          }];
        })
      ),
      collectCap: cinemaConfig.getCollectCap(theater.prestige_level),
      availableCustomizations: cinemaConfig.getAvailableCustomizations(theater.prestige_level)
    });
  });

  app.post('/api/admin/cinema/:discordUserId/init', (req, res) => {
    const { discordUserId } = req.params;
    const existingPlayer = db.resolveCinemaPlayerByDiscord(discordUserId);
    const existingTheater = existingPlayer ? db.getCinemaTheater(existingPlayer.id) : null;
    if (existingTheater) {
      return res.json({ ok: true, message: 'Cinema already initialized!', theater: existingTheater });
    }

    const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
    let cinemaPlayerId = null;
    for (const pid of allIds) {
      const biz = db.getPlayerBusiness(pid, 'cinema');
      if (biz) { cinemaPlayerId = pid; break; }
    }
    if (!cinemaPlayerId) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (!player) return res.json({ ok: false, message: 'Player not found' });
      const cinemaBiz = db.getPlayerBusiness(player.id, 'cinema');
      if (!cinemaBiz) return res.json({ ok: false, message: 'Must own Movie Theater business first' });
      cinemaPlayerId = player.id;
    }

    const theater = db.createCinemaTheater(cinemaPlayerId);
    res.json({ ok: true, message: 'Cinema initialized!', theater });
  });

  app.post('/api/admin/cinema/:discordUserId/upgrade', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = cinemaConfig.CINEMA_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveCinemaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'cinema', () => {
        const theater = db.getCinemaTheater(player.id);
        if (!theater) return { ok: false, message: 'No cinema found' };

        const currentLevel = (db.getCinemaUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const cost = cinemaConfig.getUpgradeCost(upgradeType, currentLevel);
        const freshPlayer = db.getWalletPlayerById(player.id);
        if ((freshPlayer.xp || 0) < cost) {
          return { ok: false, message: `Need ${cost} XP (have ${Math.floor((freshPlayer.xp || 0))})` };
        }

        if (!db.deductPlayerCoins(player.id, cost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setCinemaUpgrade(player.id, upgradeType, currentLevel + 1);

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          message: `${def.emoji} ${def.name} upgraded to level ${currentLevel + 1}!`,
          newLevel: currentLevel + 1,
          playerCoins: (updatedPlayer.xp || 0)
        };
      });
      presence.touch(player.id, 'cinema-upgrade');
      res.json(result);
    } catch (err) {
      console.error('[cinema] upgrade failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  app.post('/api/admin/cinema/:discordUserId/upgrade-max', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = cinemaConfig.CINEMA_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveCinemaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'cinema', () => {
        const theater = db.getCinemaTheater(player.id);
        if (!theater) return { ok: false, message: 'No cinema found' };

        const currentLevel = (db.getCinemaUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const freshPlayer = db.getWalletPlayerById(player.id);
        const { levels, totalCost } = cinemaConfig.calculateMaxBuy(upgradeType, currentLevel, (freshPlayer.xp || 0));
        if (levels === 0) return { ok: false, message: `Not enough XP for ${def.name}` };

        if (!db.deductPlayerCoins(player.id, totalCost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setCinemaUpgrade(player.id, upgradeType, currentLevel + levels);

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
      presence.touch(player.id, 'cinema-upgrade-max');
      res.json(result);
    } catch (err) {
      console.error('[cinema] upgrade-max failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade-max failed', error: err.message });
    }
  });

  app.post('/api/admin/cinema/:discordUserId/collect', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveCinemaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    const beforePlayer = db.getWalletPlayerById(player.id);

    try {
      const result = await db.withTransaction(async () => {
        const theater = db.getCinemaTheater(player.id);
        if (!theater) return { ok: false, message: 'No cinema found' };

        const upgradeRows = db.getCinemaUpgrades(player.id);
        const upgrades = {};
        for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

        const membershipLevel = upgrades.membership || 0;
        const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
        const pending = scaleObjectFields(cinemaConfig.calculatePendingIncome(
          upgrades, theater.theater_level, theater.prestige_level, theater.last_collected_at, membershipLevel
        ), ['xpEarned', 'xpGained', 'showsRun', 'viewersServed'], multiplier);

        let newXp = theater.theater_xp + pending.xpGained;
        let newLevel = theater.theater_level;
        const newViewersServed = theater.total_viewers_served + pending.viewersServed;

        while (newLevel < cinemaConfig.MAX_CINEMA_LEVEL) {
          const xpNeeded = cinemaConfig.xpForLevel(newLevel, theater.prestige_level);
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

        db.updateCinemaTheater(player.id, {
          theater_xp: newXp,
          theater_level: newLevel,
          total_viewers_served: newViewersServed,
          total_xp_earned: theater.total_xp_earned + pending.xpEarned,
          last_collected_at: new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]
        });

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          collected: pending.xpEarned,
          showsRun: pending.showsRun,
          viewersServed: pending.viewersServed,
          capped: pending.capped,
          collectCap: pending.collectCap,
          newBalance: (updatedPlayer.xp || 0),
          cinemaLevel: newLevel,
          cinemaXp: newXp,
          totalViewersServed: newViewersServed
        };
      });

      if (result?.ok && ledger && beforePlayer && result.collected > 0) {
        ledger.record({
          playerId: player.id,
          playerName: player.display_name || player.username,
          platform: player.platform || 'unknown',
          eventType: 'biz-collect',
          command: 'cinema collect',
          coinsBefore: (beforePlayer.xp || 0),
          coinsAfter: result.newBalance,
          success: 1,
          response: `Collected ${result.collected} XP from Movie Theater`,
          detail: {
            business: 'cinema',
            coinsCollected: result.collected,
            showsRun: result.showsRun,
            viewersServed: result.viewersServed,
            cinemaLevel: result.cinemaLevel,
            totalViewersServed: result.totalViewersServed
          }
        });
      }

      presence.touch(player.id, 'cinema-collect');
      res.json(result);
    } catch (err) {
      console.error('[cinema] collect failed', err);
      res.status(500).json({ ok: false, message: 'Collect failed', error: err.message });
    }
  });

  app.post('/api/admin/cinema/:discordUserId/prestige', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveCinemaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'cinema', () => {
        const prestigeResult = db.prestigeCinemaTheater(player.id);
        if (!prestigeResult.ok) return prestigeResult;

        const tierName = cinemaConfig.getPrestigeTierName(prestigeResult.newPrestigeLevel);
        const multiplier = cinemaConfig.getPrestigeMultiplier(prestigeResult.newPrestigeLevel);

        return {
          ok: true,
          message: `Prestiged to ${tierName}! (${multiplier}x income)`,
          prestigeLevel: prestigeResult.newPrestigeLevel,
          tierName,
          multiplier
        };
      });
      presence.touch(player.id, 'cinema-prestige');
      res.json(result);
    } catch (err) {
      console.error('[cinema] prestige failed', err);
      res.status(500).json({ ok: false, message: 'Prestige failed', error: err.message });
    }
  });

  app.post('/api/admin/cinema/:discordUserId/customize', (req, res) => {
    const { discordUserId } = req.params;
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ ok: false, message: 'Missing category or value' });

    const player = db.resolveCinemaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const theater = db.getCinemaTheater(player.id);
    if (!theater) return res.json({ ok: false, message: 'No cinema found' });

    if (!cinemaConfig.isCustomizationAllowed(category, value, theater.prestige_level)) {
      return res.json({ ok: false, message: 'This option requires a higher prestige level' });
    }

    db.setCinemaCustomization(player.id, category, value);
    db.save();

    res.json({ ok: true, message: 'Customization updated', category, value });
  });

  app.post('/api/admin/cinema/:discordUserId/rename', (req, res) => {
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

    const player = db.resolveCinemaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const theater = db.getCinemaTheater(player.id);
    if (!theater) return res.json({ ok: false, message: 'No cinema found' });

    db.updateCinemaTheater(player.id, { theater_name: cleanName });
    db.save();

    res.json({ ok: true, message: 'Cinema renamed!', cinemaName: cleanName });
  });
}

module.exports = { registerCinemaRoutes };
