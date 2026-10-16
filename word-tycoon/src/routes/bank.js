/**
 * Bank routes — /api/admin/bank/*
 */

const bankConfig = require('../bank-config');
const { getIncomeMultiplier, scaleObjectFields, scaleIncomeAmount } = require('../tax-season');
const presence = require('../presence');
const accrual = require('../accrual');
const { validateUsername } = require('../username-moderation');

function registerBankRoutes(app, { db, ledger }) {

  app.get('/api/admin/bank/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveBankPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-bank');

    const bank = db.getBankVault(player.id);
    if (!bank) return res.json({ ok: true, hasBank: false });

    const upgradeRows = db.getBankUpgrades(player.id);
    const upgrades = {};
    for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

    const customizationRows = db.getBankCustomizations(player.id);
    const customizations = {};
    for (const row of customizationRows) customizations[row.category] = row.value;

    const privateLevel = upgrades.private_banking || 0;
    const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
    const pending = scaleObjectFields(bankConfig.calculatePendingIncome(
      upgrades, bank.vault_level, bank.prestige_level, bank.last_collected_at, privateLevel
    ), ['xpEarned', 'xpGained', 'transactionsProcessed', 'clientsServed'], multiplier);

    const incomePerSecond = bankConfig.getIncomePerSecond(upgrades, bank.vault_level, bank.prestige_level) * multiplier;
    const cycleTime = bankConfig.getCycleSeconds(upgrades.systems || 0);
    const incomePerCycle = scaleIncomeAmount(bankConfig.getIncomePerCycle(upgrades, bank.vault_level, bank.prestige_level), multiplier);
    const privateBankingBonus = bankConfig.getPrivateBankingBonus(privateLevel);
    const xpNeeded = bankConfig.xpForLevel(bank.vault_level, bank.prestige_level);
    const freshPlayer = db.getWalletPlayerById(player.id);

    res.json({
      ok: true,
      hasBank: true,
      playerCoins: (freshPlayer.xp || 0),
      bank: {
        bankName: bank.vault_name,
        prestigeLevel: bank.prestige_level,
        prestigeTier: bankConfig.getPrestigeTierName(bank.prestige_level),
        prestigeMultiplier: bankConfig.getPrestigeMultiplier(bank.prestige_level),
        bankLevel: bank.vault_level,
        bankXp: bank.vault_xp,
        xpNeeded,
        totalClientsServed: bank.total_clients_served,
        totalXpEarned: bank.total_xp_earned,
        lastCollectedAt: bank.last_collected_at,
        incomePerSecond,
        cycleTime,
        incomePerCycle,
        privateBankingBonus
      },
      upgrades,
      customizations,
      pending,
      availableUpgrades: Object.fromEntries(
        Object.entries(bankConfig.BANK_UPGRADES).map(([key, def]) => {
          const currentLevel = upgrades[key] || 0;
          const preview = bankConfig.getUpgradeEffectPreview(key, currentLevel, bank.vault_level, bank.prestige_level, upgrades);
          const maxBuy = bankConfig.calculateMaxBuy(key, currentLevel, (freshPlayer.xp || 0));
          return [key, {
            ...def,
            currentLevel,
            cost: bankConfig.getUpgradeCost(key, currentLevel),
            maxed: currentLevel >= def.maxLevel,
            effectPreview: preview,
            maxBuy
          }];
        })
      ),
      collectCap: bankConfig.getCollectCap(bank.prestige_level),
      availableCustomizations: bankConfig.getAvailableCustomizations(bank.prestige_level)
    });
  });

  app.post('/api/admin/bank/:discordUserId/init', (req, res) => {
    const { discordUserId } = req.params;
    const existingPlayer = db.resolveBankPlayerByDiscord(discordUserId);
    const existingVault = existingPlayer ? db.getBankVault(existingPlayer.id) : null;
    if (existingVault) {
      return res.json({ ok: true, message: 'Bank already initialized!', vault: existingVault });
    }

    const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
    let bankPlayerId = null;
    for (const pid of allIds) {
      const biz = db.getPlayerBusiness(pid, 'bank');
      if (biz) { bankPlayerId = pid; break; }
    }
    if (!bankPlayerId) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (!player) return res.json({ ok: false, message: 'Player not found' });
      const bankBiz = db.getPlayerBusiness(player.id, 'bank');
      if (!bankBiz) return res.json({ ok: false, message: 'Must own Bank business first' });
      bankPlayerId = player.id;
    }

    const vault = db.createBankVault(bankPlayerId);
    res.json({ ok: true, message: 'Bank initialized!', vault });
  });

  app.post('/api/admin/bank/:discordUserId/upgrade', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = bankConfig.BANK_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveBankPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'bank', () => {
        const bank = db.getBankVault(player.id);
        if (!bank) return { ok: false, message: 'No bank found' };

        const currentLevel = (db.getBankUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const cost = bankConfig.getUpgradeCost(upgradeType, currentLevel);
        const freshPlayer = db.getWalletPlayerById(player.id);
        if ((freshPlayer.xp || 0) < cost) {
          return { ok: false, message: `Need ${cost} XP (have ${Math.floor((freshPlayer.xp || 0))})` };
        }

        if (!db.deductPlayerCoins(player.id, cost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setBankUpgrade(player.id, upgradeType, currentLevel + 1);

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          message: `${def.emoji} ${def.name} upgraded to level ${currentLevel + 1}!`,
          newLevel: currentLevel + 1,
          playerCoins: (updatedPlayer.xp || 0)
        };
      });
      presence.touch(player.id, 'bank-upgrade');
      res.json(result);
    } catch (err) {
      console.error('[bank] upgrade failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  app.post('/api/admin/bank/:discordUserId/upgrade-max', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = bankConfig.BANK_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveBankPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'bank', () => {
        const bank = db.getBankVault(player.id);
        if (!bank) return { ok: false, message: 'No bank found' };

        const currentLevel = (db.getBankUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const freshPlayer = db.getWalletPlayerById(player.id);
        const { levels, totalCost } = bankConfig.calculateMaxBuy(upgradeType, currentLevel, (freshPlayer.xp || 0));
        if (levels === 0) return { ok: false, message: `Not enough XP for ${def.name}` };

        if (!db.deductPlayerCoins(player.id, totalCost)) {
          return { ok: false, message: 'Insufficient XP (race condition)' };
        }
        db.setBankUpgrade(player.id, upgradeType, currentLevel + levels);

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
      presence.touch(player.id, 'bank-upgrade-max');
      res.json(result);
    } catch (err) {
      console.error('[bank] upgrade-max failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade-max failed', error: err.message });
    }
  });

  app.post('/api/admin/bank/:discordUserId/collect', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveBankPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    const beforePlayer = db.getWalletPlayerById(player.id);

    try {
      const result = await db.withTransaction(async () => {
        const bank = db.getBankVault(player.id);
        if (!bank) return { ok: false, message: 'No bank found' };

        const upgradeRows = db.getBankUpgrades(player.id);
        const upgrades = {};
        for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

        const privateLevel = upgrades.private_banking || 0;
        const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
        const pending = scaleObjectFields(bankConfig.calculatePendingIncome(
          upgrades, bank.vault_level, bank.prestige_level, bank.last_collected_at, privateLevel
        ), ['xpEarned', 'xpGained', 'transactionsProcessed', 'clientsServed'], multiplier);

        let newXp = bank.vault_xp + pending.xpGained;
        let newLevel = bank.vault_level;
        const newClientsServed = bank.total_clients_served + pending.clientsServed;

        while (newLevel < bankConfig.MAX_BANK_LEVEL) {
          const xpNeeded = bankConfig.xpForLevel(newLevel, bank.prestige_level);
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

        db.updateBankVault(player.id, {
          vault_xp: newXp,
          vault_level: newLevel,
          total_clients_served: newClientsServed,
          total_xp_earned: bank.total_xp_earned + pending.xpEarned,
          last_collected_at: new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]
        });

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          collected: pending.xpEarned,
          transactionsProcessed: pending.transactionsProcessed,
          clientsServed: pending.clientsServed,
          capped: pending.capped,
          collectCap: pending.collectCap,
          newBalance: (updatedPlayer.xp || 0),
          bankLevel: newLevel,
          bankXp: newXp,
          totalClientsServed: newClientsServed
        };
      });

      if (result?.ok && ledger && beforePlayer && result.collected > 0) {
        ledger.record({
          playerId: player.id,
          playerName: player.display_name || player.username,
          platform: player.platform || 'unknown',
          eventType: 'biz-collect',
          command: 'bank collect',
          coinsBefore: (beforePlayer.xp || 0),
          coinsAfter: result.newBalance,
          success: 1,
          response: `Collected ${result.collected} XP from Bank`,
          detail: {
            business: 'bank',
            coinsCollected: result.collected,
            transactionsProcessed: result.transactionsProcessed,
            clientsServed: result.clientsServed,
            bankLevel: result.bankLevel,
            totalClientsServed: result.totalClientsServed
          }
        });
      }

      presence.touch(player.id, 'bank-collect');
      res.json(result);
    } catch (err) {
      console.error('[bank] collect failed', err);
      res.status(500).json({ ok: false, message: 'Collect failed', error: err.message });
    }
  });

  app.post('/api/admin/bank/:discordUserId/prestige', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveBankPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'bank', () => {
        const prestigeResult = db.prestigeBankVault(player.id);
        if (!prestigeResult.ok) return prestigeResult;

        const tierName = bankConfig.getPrestigeTierName(prestigeResult.newPrestigeLevel);
        const multiplier = bankConfig.getPrestigeMultiplier(prestigeResult.newPrestigeLevel);

        return {
          ok: true,
          message: `Prestiged to ${tierName}! (${multiplier}x income)`,
          prestigeLevel: prestigeResult.newPrestigeLevel,
          tierName,
          multiplier
        };
      });
      presence.touch(player.id, 'bank-prestige');
      res.json(result);
    } catch (err) {
      console.error('[bank] prestige failed', err);
      res.status(500).json({ ok: false, message: 'Prestige failed', error: err.message });
    }
  });

  app.post('/api/admin/bank/:discordUserId/customize', (req, res) => {
    const { discordUserId } = req.params;
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ ok: false, message: 'Missing category or value' });

    const player = db.resolveBankPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const bank = db.getBankVault(player.id);
    if (!bank) return res.json({ ok: false, message: 'No bank found' });

    if (!bankConfig.isCustomizationAllowed(category, value, bank.prestige_level)) {
      return res.json({ ok: false, message: 'This option requires a higher prestige level' });
    }

    db.setBankCustomization(player.id, category, value);
    db.save();

    res.json({ ok: true, message: 'Customization updated', category, value });
  });

  app.post('/api/admin/bank/:discordUserId/rename', (req, res) => {
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

    const player = db.resolveBankPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const bank = db.getBankVault(player.id);
    if (!bank) return res.json({ ok: false, message: 'No bank found' });

    db.updateBankVault(player.id, { vault_name: cleanName });
    db.save();

    res.json({ ok: true, message: 'Bank renamed!', bankName: cleanName });
  });
}

module.exports = { registerBankRoutes };
