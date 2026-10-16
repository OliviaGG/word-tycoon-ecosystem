/**
 * Gym routes — /api/admin/gym/*
 */

const gymConfig = require('../gym-config');
const { getIncomeMultiplier, scaleObjectFields, scaleIncomeAmount } = require('../tax-season');
const presence = require('../presence');
const accrual = require('../accrual');
const { validateUsername } = require('../username-moderation');

function registerGymRoutes(app, { db, ledger }) {

  app.get('/api/admin/gym/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveGymPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-gym');

    const club = db.getGymClub(player.id);
    if (!club) return res.json({ ok: true, hasGym: false });

    const upgradeRows = db.getGymUpgrades(player.id);
    const upgrades = {};
    for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

    const customizationRows = db.getGymCustomizations(player.id);
    const customizations = {};
    for (const row of customizationRows) customizations[row.category] = row.value;

    const membershipLevel = upgrades.membership || 0;
    const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
    const pending = scaleObjectFields(gymConfig.calculatePendingIncome(
      upgrades, club.club_level, club.prestige_level, club.last_collected_at, membershipLevel
    ), ['xpEarned', 'xpGained', 'membersTrained'], multiplier);

    const incomePerSecond = gymConfig.getIncomePerSecond(upgrades, club.club_level, club.prestige_level) * multiplier;
    const cycleTime = gymConfig.getCycleSeconds(upgrades.trainers || 0);
    const incomePerCycle = scaleIncomeAmount(gymConfig.getIncomePerCycle(upgrades, club.club_level, club.prestige_level), multiplier);
    const membershipBonus = gymConfig.getMembershipBonus(membershipLevel);
    const xpNeeded = gymConfig.xpForLevel(club.club_level, club.prestige_level);
    const freshPlayer = db.getWalletPlayerById(player.id);

    res.json({
      ok: true,
      hasGym: true,
      playerCoins: (freshPlayer.xp || 0),
      gym: {
        gymName: club.club_name,
        prestigeLevel: club.prestige_level,
        prestigeTier: gymConfig.getPrestigeTierName(club.prestige_level),
        prestigeMultiplier: gymConfig.getPrestigeMultiplier(club.prestige_level),
        gymLevel: club.club_level,
        gymXp: club.club_xp,
        xpNeeded,
        totalMembersTrained: club.total_members_trained,
        totalXpEarned: club.total_points_earned,
        lastCollectedAt: club.last_collected_at,
        incomePerSecond,
        cycleTime,
        incomePerCycle,
        membershipBonus
      },
      upgrades,
      customizations,
      pending,
      availableUpgrades: Object.fromEntries(
        Object.entries(gymConfig.GYM_UPGRADES).map(([key, def]) => {
          const currentLevel = upgrades[key] || 0;
          const preview = gymConfig.getUpgradeEffectPreview(key, currentLevel, club.club_level, club.prestige_level, upgrades);
          const maxBuy = gymConfig.calculateMaxBuy(key, currentLevel, (freshPlayer.xp || 0));
          return [key, {
            ...def,
            currentLevel,
            cost: gymConfig.getUpgradeCost(key, currentLevel),
            maxed: currentLevel >= def.maxLevel,
            effectPreview: preview,
            maxBuy
          }];
        })
      ),
      collectCap: gymConfig.getCollectCap(club.prestige_level),
      availableCustomizations: gymConfig.getAvailableCustomizations(club.prestige_level)
    });
  });

  app.post('/api/admin/gym/:discordUserId/init', (req, res) => {
    const { discordUserId } = req.params;
    const existingPlayer = db.resolveGymPlayerByDiscord(discordUserId);
    const existingClub = existingPlayer ? db.getGymClub(existingPlayer.id) : null;
    if (existingClub) {
      return res.json({ ok: true, message: 'Gym already initialized!', club: existingClub });
    }

    const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
    let gymPlayerId = null;
    for (const pid of allIds) {
      const biz = db.getPlayerBusiness(pid, 'gym');
      if (biz) { gymPlayerId = pid; break; }
    }
    if (!gymPlayerId) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (!player) return res.json({ ok: false, message: 'Player not found' });
      const gymBiz = db.getPlayerBusiness(player.id, 'gym');
      if (!gymBiz) return res.json({ ok: false, message: 'Must own Gym business first' });
      gymPlayerId = player.id;
    }

    const club = db.createGymClub(gymPlayerId);
    res.json({ ok: true, message: 'Gym initialized!', club });
  });

  app.post('/api/admin/gym/:discordUserId/upgrade', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = gymConfig.GYM_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveGymPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'gym', () => {
        const club = db.getGymClub(player.id);
        if (!club) return { ok: false, message: 'No gym found' };

        const currentLevel = (db.getGymUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const cost = gymConfig.getUpgradeCost(upgradeType, currentLevel);
        const freshPlayer = db.getWalletPlayerById(player.id);
        if ((freshPlayer.xp || 0) < cost) {
          return { ok: false, message: `Need ${cost} XP (have ${Math.floor((freshPlayer.xp || 0))})` };
        }

        if (!db.deductPlayerCoins(player.id, cost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setGymUpgrade(player.id, upgradeType, currentLevel + 1);

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          message: `${def.emoji} ${def.name} upgraded to level ${currentLevel + 1}!`,
          newLevel: currentLevel + 1,
          playerCoins: (updatedPlayer.xp || 0)
        };
      });
      presence.touch(player.id, 'gym-upgrade');
      res.json(result);
    } catch (err) {
      console.error('[gym] upgrade failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  app.post('/api/admin/gym/:discordUserId/upgrade-max', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = gymConfig.GYM_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveGymPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'gym', () => {
        const club = db.getGymClub(player.id);
        if (!club) return { ok: false, message: 'No gym found' };

        const currentLevel = (db.getGymUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const freshPlayer = db.getWalletPlayerById(player.id);
        const { levels, totalCost } = gymConfig.calculateMaxBuy(upgradeType, currentLevel, (freshPlayer.xp || 0));
        if (levels === 0) return { ok: false, message: `Not enough XP for ${def.name}` };

        if (!db.deductPlayerCoins(player.id, totalCost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setGymUpgrade(player.id, upgradeType, currentLevel + levels);

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
      presence.touch(player.id, 'gym-upgrade-max');
      res.json(result);
    } catch (err) {
      console.error('[gym] upgrade-max failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  app.post('/api/admin/gym/:discordUserId/collect', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveGymPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    const beforePlayer = db.getWalletPlayerById(player.id);

    try {
      const result = await db.withTransaction(async () => {
        const club = db.getGymClub(player.id);
        if (!club) return { ok: false, message: 'No gym found' };

        const upgradeRows = db.getGymUpgrades(player.id);
        const upgrades = {};
        for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

        const membershipLevel = upgrades.membership || 0;
        const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
        const pending = scaleObjectFields(gymConfig.calculatePendingIncome(
          upgrades, club.club_level, club.prestige_level, club.last_collected_at, membershipLevel
        ), ['xpEarned', 'xpGained', 'membersTrained'], multiplier);

        let newXp = club.club_xp + pending.xpGained;
        let newLevel = club.club_level;
        const newMembersTrained = club.total_members_trained + pending.membersTrained;

        while (newLevel < gymConfig.MAX_GYM_LEVEL) {
          const xpNeeded = gymConfig.xpForLevel(newLevel, club.prestige_level);
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

        db.updateGymClub(player.id, {
          club_xp: newXp,
          club_level: newLevel,
          total_members_trained: newMembersTrained,
          total_points_earned: club.total_points_earned + pending.xpEarned,
          last_collected_at: new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]
        });

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          collected: pending.xpEarned,
          capped: pending.capped,
          collectCap: pending.collectCap,
          newBalance: (updatedPlayer.xp || 0),
          gymLevel: newLevel,
          gymXp: newXp,
          totalMembersTrained: newMembersTrained
        };
      });

      if (result?.ok && ledger && beforePlayer && result.collected > 0) {
        ledger.record({
          playerId: player.id,
          playerName: player.display_name || player.username,
          platform: player.platform || 'unknown',
          eventType: 'biz-collect',
          command: 'gym collect',
          coinsBefore: (beforePlayer.xp || 0),
          coinsAfter: result.newBalance,
          success: 1,
          response: `Collected ${result.collected} XP from Gym`,
          detail: {
            business: 'gym',
            coinsCollected: result.collected,
            gymLevel: result.gymLevel,
            gymXp: result.gymXp,
            totalMembersTrained: result.totalMembersTrained
          }
        });
      }

      presence.touch(player.id, 'gym-collect');
      res.json(result);
    } catch (err) {
      console.error('[gym] collect failed', err);
      res.status(500).json({ ok: false, message: 'Collect failed', error: err.message });
    }
  });

  app.post('/api/admin/gym/:discordUserId/prestige', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveGymPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'gym', () => {
        const prestigeResult = db.prestigeGymClub(player.id);
        if (!prestigeResult.ok) return prestigeResult;

        const tierName = gymConfig.getPrestigeTierName(prestigeResult.newPrestigeLevel);
        const multiplier = gymConfig.getPrestigeMultiplier(prestigeResult.newPrestigeLevel);

        return {
          ok: true,
          message: `Prestiged to ${tierName}! (${multiplier}x income)`,
          prestigeLevel: prestigeResult.newPrestigeLevel,
          tierName,
          multiplier
        };
      });
      presence.touch(player.id, 'gym-prestige');
      res.json(result);
    } catch (err) {
      console.error('[gym] prestige failed', err);
      res.status(500).json({ ok: false, message: 'Prestige failed', error: err.message });
    }
  });

  app.post('/api/admin/gym/:discordUserId/customize', (req, res) => {
    const { discordUserId } = req.params;
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ ok: false, message: 'Missing category or value' });

    const player = db.resolveGymPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const club = db.getGymClub(player.id);
    if (!club) return res.json({ ok: false, message: 'No gym found' });

    if (!gymConfig.isCustomizationAllowed(category, value, club.prestige_level)) {
      return res.json({ ok: false, message: 'This option requires a higher prestige level' });
    }

    db.setGymCustomization(player.id, category, value);
    db.save();

    res.json({ ok: true, message: 'Customization updated', category, value });
  });

  app.post('/api/admin/gym/:discordUserId/rename', (req, res) => {
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

    const player = db.resolveGymPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const club = db.getGymClub(player.id);
    if (!club) return res.json({ ok: false, message: 'No gym found' });

    db.updateGymClub(player.id, { club_name: cleanName });
    db.save();

    res.json({ ok: true, message: 'Gym renamed!', gymName: cleanName });
  });
}

module.exports = { registerGymRoutes };
