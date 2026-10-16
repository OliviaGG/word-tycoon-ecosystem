/**
 * Stock Mogul routes — /api/admin/stockmogul/*
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const stockMogulCfg = require('../stockmogul-config');
const { getIncomeMultiplier, scaleObjectFields, scaleIncomeAmount } = require('../tax-season');
const presence = require('../presence');
const accrual = require('../accrual');
const { validateUsername } = require('../username-moderation');

function registerStockMogulRoutes(app, { db, ledger }) {

  // Get full Stock Mogul portfolio state
  app.get('/api/admin/stockmogul/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveStockMogulPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-stockmogul');

    const portfolio = db.getStockMogulPortfolio(player.id);
    if (!portfolio) return res.json({ ok: true, hasPortfolio: false });

    const upgradeRows = db.getStockMogulUpgrades(player.id);
    const upgrades = {};
    for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

    const customizationRows = db.getStockMogulCustomizations(player.id);
    const customizations = {};
    for (const row of customizationRows) customizations[row.category] = row.value;

    // Get player's clean cash balance from carwash_shops
    const carwashShop = db.getCarwashShop(player.id);
    const cleanCash = carwashShop ? (carwashShop.clean_cash || 0) : 0;

    const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
    const pending = scaleObjectFields(stockMogulCfg.calculatePendingPortfolioCoins(
      upgrades, portfolio.portfolio_level, portfolio.prestige_level,
      portfolio.last_collected_at, portfolio.portfolio_coins
    ), ['portfolioCoins', 'xpGained', 'tradesCompleted'], multiplier);

    const incomePerSecond = stockMogulCfg.getIncomePerSecond(upgrades, portfolio.portfolio_level, portfolio.prestige_level) * multiplier;
    const cycleTime = stockMogulCfg.getCycleSeconds(upgrades.broker || 0);
    const coinsPerCycle = scaleIncomeAmount(stockMogulCfg.getPortfolioCoinsPerCycle(upgrades, portfolio.portfolio_level, portfolio.prestige_level), multiplier);
    const dividendBonus = stockMogulCfg.getDividendBonus(upgrades.dividend || 0);
    const portfolioCoinsCap = stockMogulCfg.getPortfolioCoinsCap(upgrades.offshore_hold || 0, portfolio.prestige_level);
    const xpNeeded = stockMogulCfg.xpForLevel(portfolio.portfolio_level, portfolio.prestige_level);

    res.json({
      ok: true,
      hasPortfolio: true,
      portfolio: {
        portfolioName: portfolio.portfolio_name,
        prestigeLevel: portfolio.prestige_level,
        prestigeTier: stockMogulCfg.getPrestigeTierName(portfolio.prestige_level),
        prestigeMultiplier: stockMogulCfg.getPrestigeMultiplier(portfolio.prestige_level),
        portfolioLevel: portfolio.portfolio_level,
        portfolioXp: portfolio.portfolio_xp,
        xpNeeded,
        portfolioCoins: portfolio.portfolio_coins,
        portfolioCoinsCap,
        totalTrades: portfolio.total_trades,
        totalCoinsEarned: portfolio.total_coins_earned,
        lastCollectedAt: portfolio.last_collected_at,
        incomePerSecond,
        cycleTime,
        coinsPerCycle,
        dividendBonus,
        cleanCash
      },
      upgrades,
      customizations,
      pending,
      availableUpgrades: Object.fromEntries(
        Object.entries(stockMogulCfg.STOCKMOGUL_UPGRADES).map(([key, def]) => {
          const currentLevel = upgrades[key] || 0;
          const preview = stockMogulCfg.getUpgradeEffectPreview(key, currentLevel, portfolio.portfolio_level, portfolio.prestige_level, upgrades);
          const maxBuy = stockMogulCfg.calculateMaxBuy(key, currentLevel, cleanCash);
          return [key, {
            ...def,
            currentLevel,
            cost: stockMogulCfg.getUpgradeCost(key, currentLevel),
            maxed: currentLevel >= def.maxLevel,
            effectPreview: preview,
            maxBuy
          }];
        })
      ),
      availableCustomizations: stockMogulCfg.getAvailableCustomizations(portfolio.prestige_level)
    });
  });

  // Initialize Stock Mogul portfolio
  app.post('/api/admin/stockmogul/:discordUserId/init', (req, res) => {
    const { discordUserId } = req.params;
    const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
    let smPlayerId = null;
    for (const pid of allIds) {
      const biz = db.getPlayerBusiness(pid, 'stockmogul');
      if (biz) { smPlayerId = pid; break; }
    }
    if (!smPlayerId) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (!player) return res.json({ ok: false, message: 'Player not found' });
      const smBiz = db.getPlayerBusiness(player.id, 'stockmogul');
      if (!smBiz) return res.json({ ok: false, message: 'Must own Stock Mogul business first' });
      smPlayerId = player.id;
    }
    const portfolio = db.createStockMogulPortfolio(smPlayerId);
    res.json({ ok: true, message: 'Stock Mogul Portfolio initialized!', portfolio });
  });

  // Upgrade a Stock Mogul component (costs clean cash)
  app.post('/api/admin/stockmogul/:discordUserId/upgrade', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = stockMogulCfg.STOCKMOGUL_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveStockMogulPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'stockmogul', () => {
        const portfolio = db.getStockMogulPortfolio(player.id);
        if (!portfolio) return { ok: false, message: 'No portfolio found' };

        const carwashShop = db.getCarwashShop(player.id);
        const cleanCash = carwashShop ? (carwashShop.clean_cash || 0) : 0;

        const currentLevel = (db.getStockMogulUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const cost = stockMogulCfg.getUpgradeCost(upgradeType, currentLevel);
        if (cleanCash < cost) {
          return { ok: false, message: `Need ${cost} clean cash (have ${Math.floor(cleanCash)})` };
        }

        if (!db.deductCarwashCleanCash(player.id, cost)) {
          return { ok: false, message: 'Insufficient clean cash (race condition)' };
        }

        const newLevel = currentLevel + 1;
        db.upsertStockMogulUpgrade(player.id, upgradeType, newLevel);
        const updatedCarwash = db.getCarwashShop(player.id);
        return {
          ok: true,
          message: `${def.name} upgraded to Lv.${newLevel}!`,
          newLevel,
          newCleanCash: updatedCarwash?.clean_cash ?? Math.max(0, cleanCash - cost)
        };
      });

      presence.touch(player.id, 'stockmogul-upgrade');
      res.json(result);
    } catch (err) {
      console.error('[stockmogul] upgrade failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  // Max-buy Stock Mogul upgrade
  app.post('/api/admin/stockmogul/:discordUserId/upgrade-max', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = stockMogulCfg.STOCKMOGUL_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveStockMogulPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'stockmogul', () => {
        const portfolio = db.getStockMogulPortfolio(player.id);
        if (!portfolio) return { ok: false, message: 'No portfolio found' };

        const carwashShop = db.getCarwashShop(player.id);
        const cleanCash = carwashShop ? (carwashShop.clean_cash || 0) : 0;

        const currentLevel = (db.getStockMogulUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is at max level` };

        const { levels, totalCost } = stockMogulCfg.calculateMaxBuy(upgradeType, currentLevel, cleanCash);
        if (levels === 0) return { ok: false, message: `Not enough clean cash for ${def.name}` };

        if (!db.deductCarwashCleanCash(player.id, totalCost)) {
          return { ok: false, message: 'Insufficient clean cash (race condition)' };
        }

        const newLevel = currentLevel + levels;
        db.upsertStockMogulUpgrade(player.id, upgradeType, newLevel);
        const updatedCarwash = db.getCarwashShop(player.id);
        return {
          ok: true,
          message: `${def.name} upgraded ${levels} levels to Lv.${newLevel}!`,
          newLevel,
          levelsGained: levels,
          totalCost,
          newCleanCash: updatedCarwash?.clean_cash ?? Math.max(0, cleanCash - totalCost)
        };
      });

      presence.touch(player.id, 'stockmogul-upgrade-max');
      res.json(result);
    } catch (err) {
      console.error('[stockmogul] upgrade-max failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  // Collect accumulated portfolio coins (converts to real player coins)
  app.post('/api/admin/stockmogul/:discordUserId/collect', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveStockMogulPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    const beforePlayer = db.getWalletPlayerById(player.id);

    try {
      const result = await db.withTransaction(async () => {
        const portfolio = db.getStockMogulPortfolio(player.id);
        if (!portfolio) return { ok: false, message: 'No portfolio found' };

        const upgradeRows = db.getStockMogulUpgrades(player.id);
        const upgrades = {};
        for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

        const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
        const pending = scaleObjectFields(stockMogulCfg.calculatePendingPortfolioCoins(
          upgrades, portfolio.portfolio_level, portfolio.prestige_level,
          portfolio.last_collected_at, portfolio.portfolio_coins
        ), ['portfolioCoins', 'xpGained', 'tradesCompleted'], multiplier);

        const dividendBonus = stockMogulCfg.getDividendBonus(upgrades.dividend || 0);
        const rawCoins = pending.portfolioCoins;
        const coinsWithBonus = Math.floor(rawCoins * dividendBonus);
        const xpGained = pending.xpGained;
        const newPortfolioCoins = portfolio.portfolio_coins + coinsWithBonus;

        if (newPortfolioCoins <= 0) {
          return { ok: false, message: 'No portfolio dividends to collect yet' };
        }
        const realCoinsEarned = Math.floor(newPortfolioCoins * 0.5);

        let newPortfolioXp = portfolio.portfolio_xp + xpGained;
        let newPortfolioLevel = portfolio.portfolio_level;

        while (newPortfolioLevel < stockMogulCfg.MAX_PORTFOLIO_LEVEL) {
          const xpNeeded = stockMogulCfg.xpForLevel(newPortfolioLevel, portfolio.prestige_level);
          if (newPortfolioXp >= xpNeeded) { newPortfolioXp -= xpNeeded; newPortfolioLevel++; }
          else break;
        }

        const newTotalTrades = portfolio.total_trades + pending.tradesCompleted;
        const newTotalCoinsEarned = portfolio.total_coins_earned + realCoinsEarned;

        db.updateStockMogulPortfolio(player.id, {
          portfolio_coins: 0,
          portfolio_xp: newPortfolioXp,
          portfolio_level: newPortfolioLevel,
          total_trades: newTotalTrades,
          total_coins_earned: newTotalCoinsEarned,
          last_collected_at: new Date().toISOString()
        });

        if (realCoinsEarned > 0) {
          db.updatePlayerCoins(player.id, realCoinsEarned);
        }

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          message: realCoinsEarned > 0 ? `Collected ${realCoinsEarned} coins from dividends!` : 'Nothing to collect yet',
          rawPortfolioCoins: rawCoins,
          collectedWithBonus: coinsWithBonus,
          realCoinsEarned,
          dividendBonus,
          newPortfolioLevel,
          newPortfolioXp,
          tradesCompleted: pending.tradesCompleted,
          newBalance: updatedPlayer ? (updatedPlayer.xp || 0) : null
        };
      });

      if (result?.ok && ledger && beforePlayer && result.realCoinsEarned > 0) {
        ledger.record({
          playerId: player.id,
          playerName: player.display_name || player.username,
          platform: player.platform || 'unknown',
          eventType: 'biz-collect',
          command: 'stockmogul collect',
          coinsBefore: (beforePlayer.xp || 0),
          coinsAfter: result.newBalance,
          success: 1,
          response: `Collected ${result.realCoinsEarned} coins from Stock Mogul dividends`,
          detail: {
            business: 'stockmogul',
            rawPortfolioCoins: result.rawPortfolioCoins,
            collectedWithBonus: result.collectedWithBonus,
            realCoinsEarned: result.realCoinsEarned,
            dividendBonus: result.dividendBonus,
            tradesCompleted: result.tradesCompleted,
            portfolioLevel: result.newPortfolioLevel
          }
        });
      }

      presence.touch(player.id, 'stockmogul-collect');
      res.json(result);
    } catch (err) {
      console.error('[stockmogul] collect failed', err);
      res.status(500).json({ ok: false, message: 'Collect failed', error: err.message });
    }
  });

  // Prestige the Stock Mogul portfolio
  app.post('/api/admin/stockmogul/:discordUserId/prestige', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveStockMogulPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'stockmogul', () => {
        const portfolio = db.getStockMogulPortfolio(player.id);
        if (!portfolio) return { ok: false, message: 'No portfolio found' };
        if (portfolio.portfolio_level < 100) return { ok: false, message: `Reach Level 100 first (currently ${portfolio.portfolio_level}/100)` };

        const newPortfolio = db.prestigeStockMogulPortfolio(player.id);
        return {
          ok: true,
          message: `Prestige ${newPortfolio.prestige_level}! Now a ${stockMogulCfg.getPrestigeTierName(newPortfolio.prestige_level)}`,
          newPrestigeLevel: newPortfolio.prestige_level,
          tierName: stockMogulCfg.getPrestigeTierName(newPortfolio.prestige_level),
          multiplier: stockMogulCfg.getPrestigeMultiplier(newPortfolio.prestige_level)
        };
      });

      presence.touch(player.id, 'stockmogul-prestige');
      res.json(result);
    } catch (err) {
      console.error('[stockmogul] prestige failed', err);
      res.status(500).json({ ok: false, message: 'Prestige failed', error: err.message });
    }
  });

  // Set a customization option
  app.post('/api/admin/stockmogul/:discordUserId/customize', (req, res) => {
    const { discordUserId } = req.params;
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ ok: false, message: 'Missing category or value' });

    const player = db.resolveStockMogulPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const portfolio = db.getStockMogulPortfolio(player.id);
    if (!portfolio) return res.json({ ok: false, message: 'No portfolio found' });

    if (!stockMogulCfg.isCustomizationAllowed(category, value, portfolio.prestige_level)) {
      return res.json({ ok: false, message: 'Not unlocked at current prestige level' });
    }

    db.upsertStockMogulCustomization(player.id, category, value);
    db.save();
    res.json({ ok: true, message: 'Customization updated!' });
  });

  // Rename the portfolio
  app.post('/api/admin/stockmogul/:discordUserId/rename', (req, res) => {
    const { discordUserId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ ok: false, message: 'Missing name' });

    const player = db.resolveStockMogulPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const portfolio = db.getStockMogulPortfolio(player.id);
    if (!portfolio) return res.json({ ok: false, message: 'No portfolio found' });

    const validation = validateUsername(name, { maxLength: 24, minLength: 1 });
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        message: validation.code === 'blocked' ? 'That name is not allowed.' : 'Invalid name'
      });
    }
    const sanitized = validation.sanitized;

    db.updateStockMogulPortfolio(player.id, { portfolio_name: sanitized });
    db.save();
    res.json({ ok: true, message: `Portfolio renamed to "${sanitized}"!`, portfolioName: sanitized });
  });
}

module.exports = { registerStockMogulRoutes };
