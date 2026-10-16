/**
 * Car Wash routes — /api/admin/carwash/*
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const carwashCfg = require('../carwash-config');
const {
  TAX_SEASON_CONFIRMATION,
  getTaxSeasonEligibility,
  getTaxSeasonState,
  getIncomeMultiplier,
  scaleObjectFields,
  scaleIncomeAmount,
  runTaxSeasonReset
} = require('../tax-season');
const { BUSINESSES } = require('../businesses');
const presence = require('../presence');
const accrual = require('../accrual');
const { validateUsername } = require('../username-moderation');

function registerCarwashRoutes(app, { db, getPlayerTotalIncomePerSec }) {
  const taxSeasonEnabled = String(process.env.TAX_SEASON_ENABLED || '').toLowerCase() === 'true';

  // Get full car wash state
  app.get('/api/admin/carwash/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-carwash');

    const shop = db.getCarwashShop(player.id);
    if (!shop) return res.json({ ok: true, hasShop: false });

    const upgradeRows = db.getCarwashUpgrades(player.id);
    const upgrades = {};
    for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

    const customizationRows = db.getCarwashCustomizations(player.id);
    const customizations = {};
    for (const row of customizationRows) customizations[row.category] = row.value;

    const totalBizIncome = getPlayerTotalIncomePerSec(player.id);
    const offshoreLevel = upgrades.offshore || 0;
    const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
    const pending = scaleObjectFields(carwashCfg.calculatePendingCleanCash(
      upgrades, shop.shop_level, shop.prestige_level, shop.last_collected_at, totalBizIncome, shop.clean_cash
    ), ['cleanCash', 'xpGained', 'carsWashed'], multiplier);

    const incomePerSecond = carwashCfg.getIncomePerSecond(upgrades, shop.shop_level, shop.prestige_level) * multiplier;
    const cycleTime = carwashCfg.getCycleSeconds(upgrades.dryers || 0);
    const incomePerCycle = scaleIncomeAmount(carwashCfg.getIncomePerCycle(upgrades, shop.shop_level, shop.prestige_level), multiplier);
    const launderingRate = carwashCfg.getLaunderingRate(upgrades.shell || 0, shop.prestige_level);
    const cleanCashCap = carwashCfg.getCleanCashCap(upgrades.cameras || 0, shop.prestige_level);
    const offshoreBonus = carwashCfg.getOffshoreBonus(offshoreLevel);
    const xpNeeded = carwashCfg.xpForLevel(shop.shop_level, shop.prestige_level);
    const cleanCashPerSec = launderingRate * totalBizIncome;

    // Check if player has stockmogul (to show clean cash spending option)
    const hasStockMogul = !!(db.getPlayerBusiness ? db.getPlayerBusiness(player.id, 'stockmogul') : null);
    const stockMogulDef = BUSINESSES.stockmogul;

    res.json({
      ok: true,
      hasShop: true,
      shop: {
        shopName: shop.shop_name,
        prestigeLevel: shop.prestige_level,
        prestigeTier: carwashCfg.getPrestigeTierName(shop.prestige_level),
        prestigeMultiplier: carwashCfg.getPrestigeMultiplier(shop.prestige_level),
        shopLevel: shop.shop_level,
        shopXp: shop.shop_xp,
        xpNeeded,
        cleanCash: shop.clean_cash,
        cleanCashCap,
        totalCarsWashed: shop.total_cars_washed,
        totalCleanEarned: shop.total_clean_earned,
        lastCollectedAt: shop.last_collected_at,
        incomePerSecond,
        cycleTime,
        incomePerCycle,
        launderingRate,
        cleanCashPerSec,
        offshoreBonus,
        totalBizIncome
      },
      upgrades,
      customizations,
      pending,
      hasStockMogul,
      stockMogulCost: stockMogulDef ? stockMogulDef.cleanCashCost : 5000,
      availableUpgrades: Object.fromEntries(
        Object.entries(carwashCfg.CARWASH_UPGRADES).map(([key, def]) => {
          const currentLevel = upgrades[key] || 0;
          const preview = carwashCfg.getUpgradeEffectPreview(key, currentLevel, shop.shop_level, shop.prestige_level, upgrades);
          const maxBuy = carwashCfg.calculateMaxBuy(key, currentLevel, shop.clean_cash);
          return [key, {
            ...def,
            currentLevel,
            cost: carwashCfg.getUpgradeCost(key, currentLevel),
            maxed: currentLevel >= def.maxLevel,
            effectPreview: preview,
            maxBuy
          }];
        })
      ),
      availableCustomizations: carwashCfg.getAvailableCustomizations(shop.prestige_level)
    });
  });

  // Initialize car wash (called when carwash business is purchased)
  app.post('/api/admin/carwash/:discordUserId/init', (req, res) => {
    const { discordUserId } = req.params;
    const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
    let cwPlayerId = null;
    for (const pid of allIds) {
      const biz = db.getPlayerBusiness(pid, 'carwash');
      if (biz) { cwPlayerId = pid; break; }
    }
    if (!cwPlayerId) {
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (!player) return res.json({ ok: false, message: 'Player not found' });
      const cwBiz = db.getPlayerBusiness(player.id, 'carwash');
      if (!cwBiz) return res.json({ ok: false, message: 'Must own Car Wash business first' });
      cwPlayerId = player.id;
    }
    const shop = db.createCarwashShop(cwPlayerId);
    res.json({ ok: true, message: 'Car Wash initialized!', shop });
  });

  // Upgrade a car wash component (costs clean cash)
  app.post('/api/admin/carwash/:discordUserId/upgrade', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = carwashCfg.CARWASH_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'carwash', () => {
        const shop = db.getCarwashShop(player.id);
        if (!shop) return { ok: false, message: 'No car wash found' };

        const currentLevel = (db.getCarwashUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const cost = carwashCfg.getUpgradeCost(upgradeType, currentLevel);
        if (shop.clean_cash < cost) {
          return { ok: false, message: `Need ${cost} clean cash (have ${Math.floor(shop.clean_cash)})` };
        }

        if (!db.deductCarwashCleanCash(player.id, cost)) {
          return { ok: false, message: 'Insufficient clean cash (race condition)' };
        }

        const newLevel = currentLevel + 1;
        db.upsertCarwashUpgrade(player.id, upgradeType, newLevel);
        const updatedShop = db.getCarwashShop(player.id);
        return {
          ok: true,
          message: `${def.name} upgraded to Lv.${newLevel}!`,
          newLevel,
          newCleanCash: updatedShop?.clean_cash ?? Math.max(0, shop.clean_cash - cost)
        };
      });

      presence.touch(player.id, 'carwash-upgrade');
      res.json(result);
    } catch (err) {
      console.error('[carwash] upgrade failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  // Max-buy car wash upgrade
  app.post('/api/admin/carwash/:discordUserId/upgrade-max', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = carwashCfg.CARWASH_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'carwash', () => {
        const shop = db.getCarwashShop(player.id);
        if (!shop) return { ok: false, message: 'No car wash found' };

        const currentLevel = (db.getCarwashUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const { levels, totalCost } = carwashCfg.calculateMaxBuy(upgradeType, currentLevel, shop.clean_cash);
        if (levels === 0) return { ok: false, message: `Not enough clean cash for ${def.name}` };

        if (!db.deductCarwashCleanCash(player.id, totalCost)) {
          return { ok: false, message: 'Insufficient clean cash (race condition)' };
        }

        const newLevel = currentLevel + levels;
        db.upsertCarwashUpgrade(player.id, upgradeType, newLevel);
        const updatedShop = db.getCarwashShop(player.id);
        return {
          ok: true,
          message: `${def.name} upgraded ${levels} levels to Lv.${newLevel}!`,
          newLevel,
          levelsGained: levels,
          totalCost,
          newCleanCash: updatedShop?.clean_cash ?? Math.max(0, shop.clean_cash - totalCost)
        };
      });

      presence.touch(player.id, 'carwash-upgrade-max');
      res.json(result);
    } catch (err) {
      console.error('[carwash] upgrade-max failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  // Collect accumulated clean cash
  app.post('/api/admin/carwash/:discordUserId/collect', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await db.withTransaction(async () => {
        const shop = db.getCarwashShop(player.id);
        if (!shop) return { ok: false, message: 'No car wash found' };

        const upgradeRows = db.getCarwashUpgrades(player.id);
        const upgrades = {};
        for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

        const totalBizIncome = getPlayerTotalIncomePerSec(player.id);
        const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
        const pending = scaleObjectFields(carwashCfg.calculatePendingCleanCash(
          upgrades, shop.shop_level, shop.prestige_level, shop.last_collected_at, totalBizIncome, shop.clean_cash
        ), ['cleanCash', 'xpGained', 'carsWashed'], multiplier);

        const offshoreLevel = upgrades.offshore || 0;
        const offshoreBonus = carwashCfg.getOffshoreBonus(offshoreLevel);
        const rawClean = pending.cleanCash;
        const cleanWithBonus = Math.floor(rawClean * offshoreBonus);
        const xpGained = pending.xpGained;

        const newCleanCash = shop.clean_cash + cleanWithBonus;
        let newShopXp = shop.shop_xp + xpGained;
        let newShopLevel = shop.shop_level;
        let leveled = false;

        while (newShopLevel < carwashCfg.MAX_SHOP_LEVEL) {
          const xpNeeded = carwashCfg.xpForLevel(newShopLevel, shop.prestige_level);
          if (newShopXp >= xpNeeded) {
            newShopXp -= xpNeeded;
            newShopLevel++;
            leveled = true;
          } else break;
        }

        const newTotalCarsWashed = shop.total_cars_washed + pending.carsWashed;
        const newTotalCleanEarned = shop.total_clean_earned + cleanWithBonus;

        db.updateCarwashShop(player.id, {
          clean_cash: newCleanCash,
          shop_xp: newShopXp,
          shop_level: newShopLevel,
          total_cars_washed: newTotalCarsWashed,
          total_clean_earned: newTotalCleanEarned,
          last_collected_at: new Date().toISOString()
        });

        return {
          ok: true,
          message: cleanWithBonus > 0 ? `Collected ${cleanWithBonus} clean cash!` : 'No clean cash to collect yet',
          collected: cleanWithBonus,
          rawCollected: rawClean,
          offshoreBonus,
          newCleanCash,
          newShopLevel,
          newShopXp,
          leveled,
          carsWashed: pending.carsWashed,
          xpGained
        };
      });

      presence.touch(player.id, 'carwash-collect');
      res.json(result);
    } catch (err) {
      console.error('[carwash] collect failed', err);
      res.status(500).json({ ok: false, message: 'Collect failed', error: err.message });
    }
  });

  app.get('/api/admin/carwash/:discordUserId/tax-season', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const eligibility = getTaxSeasonEligibility(player.id);
    const state = getTaxSeasonState(player.id);

    res.json({
      ok: true,
      enabled: taxSeasonEnabled,
      confirmationPhrase: TAX_SEASON_CONFIRMATION,
      eligibility,
      state,
      warning: {
        oneTime: true,
        resets: ['coins', 'business levels', 'managed business progression', 'stored business income'],
        preserves: ['library', 'gift coins', 'cosmetics', 'account identity', 'history'],
        reward: '+10% permanent income'
      }
    });
  });

  app.post('/api/admin/carwash/:discordUserId/tax-season', async (req, res) => {
    const { discordUserId } = req.params;
    const { confirmation, resetReason } = req.body || {};
    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    if (!taxSeasonEnabled) {
      return res.json({ ok: false, code: 'disabled', message: 'Tax Season is not enabled' });
    }

    try {
      const result = await runTaxSeasonReset(player.id, { confirmation, resetReason });
      if (!result.ok) {
        return res.json({
          ok: false,
          code: result.code,
          message: result.code === 'confirmation_required'
            ? `Type "${TAX_SEASON_CONFIRMATION}" to confirm Tax Season`
            : result.code === 'already_completed'
              ? 'Tax Season has already been completed for this account'
              : 'Tax Season requirements not met',
          requiredConfirmation: result.requiredConfirmation,
          eligibility: result.eligibility
        });
      }

      return res.json({
        ok: true,
        message: 'Tax Season complete. Your empire has been seized and rebuilt with a permanent +10% income bonus. Your Library and Newspaper Route were spared, so they remain available after the reset.',
        completedAt: result.completedAt,
        bonusMultiplier: result.bonusMultiplier,
        playerIds: result.playerIds,
        state: result.state
      });
    } catch (err) {
      console.error('[tax-season] reset failed', err);
      return res.status(500).json({ ok: false, message: 'Tax Season failed', error: err.message });
    }
  });

  // Prestige the car wash
  app.post('/api/admin/carwash/:discordUserId/prestige', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'carwash', () => {
        const shop = db.getCarwashShop(player.id);
        if (!shop) return { ok: false, message: 'No car wash found' };
        if (shop.shop_level < 100) return { ok: false, message: `Reach Level 100 first (currently ${shop.shop_level}/100)` };

        const newShop = db.prestigeCarwashShop(player.id);
        return {
          ok: true,
          message: `Prestige ${newShop.prestige_level}! Now a ${carwashCfg.getPrestigeTierName(newShop.prestige_level)}`,
          newPrestigeLevel: newShop.prestige_level,
          tierName: carwashCfg.getPrestigeTierName(newShop.prestige_level),
          multiplier: carwashCfg.getPrestigeMultiplier(newShop.prestige_level)
        };
      });

      presence.touch(player.id, 'carwash-prestige');
      res.json(result);
    } catch (err) {
      console.error('[carwash] prestige failed', err);
      res.status(500).json({ ok: false, message: 'Prestige failed', error: err.message });
    }
  });

  // Set a customization option
  app.post('/api/admin/carwash/:discordUserId/customize', (req, res) => {
    const { discordUserId } = req.params;
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ ok: false, message: 'Missing category or value' });

    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const shop = db.getCarwashShop(player.id);
    if (!shop) return res.json({ ok: false, message: 'No car wash found' });

    if (!carwashCfg.isCustomizationAllowed(category, value, shop.prestige_level)) {
      return res.json({ ok: false, message: 'Customization not unlocked at current prestige level' });
    }

    db.upsertCarwashCustomization(player.id, category, value);
    db.save();
    res.json({ ok: true, message: 'Customization updated!' });
  });

  // Rename the car wash
  app.post('/api/admin/carwash/:discordUserId/rename', (req, res) => {
    const { discordUserId } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ ok: false, message: 'Missing name' });

    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const shop = db.getCarwashShop(player.id);
    if (!shop) return res.json({ ok: false, message: 'No car wash found' });

    const validation = validateUsername(name, { maxLength: 24, minLength: 1 });
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        message: validation.code === 'blocked' ? 'That name is not allowed.' : 'Invalid name'
      });
    }
    const sanitized = validation.sanitized;

    db.updateCarwashShop(player.id, { shop_name: sanitized });
    db.save();
    res.json({ ok: true, message: `Car wash renamed to "${sanitized}"!`, shopName: sanitized });
  });

  // Buy Stock Mogul with clean cash
  app.post('/api/admin/carwash/:discordUserId/buy-stockmogul', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolveCarwashPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    try {
      const result = await accrual.settleAndMutate(player.id, 'carwash', () => {
        const shop = db.getCarwashShop(player.id);
        if (!shop) return { ok: false, message: 'Must have a Car Wash to buy Stock Mogul' };

        const bizDef = BUSINESSES.stockmogul;
        const existing = db.getPlayerBusiness(player.id, 'stockmogul');
        const existingPortfolio = db.getStockMogulPortfolio ? db.getStockMogulPortfolio(player.id) : null;
        const currentLevel = Math.max(
          existing ? (existing.level || 0) : 0,
          existingPortfolio ? (existingPortfolio.portfolio_level || 0) : 0
        );
        if (existing && currentLevel >= bizDef.maxLevel) {
          return { ok: false, message: 'Stock Mogul is already at max level!' };
        }

        const cost = existing ? bizDef.cleanCashUpgradeCost : bizDef.cleanCashCost;
        if (shop.clean_cash < cost) {
          return { ok: false, message: `Need ${cost} clean cash (have ${Math.floor(shop.clean_cash)})` };
        }

        // Atomic conditional deduct — a concurrent purchase can't double-spend.
        if (!db.deductCarwashCleanCash(player.id, cost)) {
          return { ok: false, message: `Need ${cost} clean cash (balance changed, try again)` };
        }
        const newLevel = currentLevel + 1;
        if (existing) {
          db.upgradePlayerBusiness(existing.id);
          if (!existingPortfolio) {
            db.createStockMogulPortfolio(player.id);
          }
          db.updateStockMogulPortfolio(player.id, { portfolio_level: newLevel });
        } else {
          db.createPlayerBusiness(player.id, 'stockmogul');
          // Auto-init the portfolio management entry
          db.createStockMogulPortfolio(player.id);
        }

        const shopAfter = db.getCarwashShop(player.id);
        return {
          ok: true,
          message: existing ? `Stock Mogul upgraded to Lv.${newLevel}!` : '\u{1F4C8} Stock Mogul unlocked!',
          newLevel,
          newCleanCash: shopAfter ? shopAfter.clean_cash : shop.clean_cash - cost
        };
      });

      presence.touch(player.id, 'carwash-buy-stockmogul');
      res.json(result);
    } catch (err) {
      console.error('[carwash] buy-stockmogul failed', err);
      res.status(500).json({ ok: false, message: 'Buy Stock Mogul failed', error: err.message });
    }
  });
}

module.exports = { registerCarwashRoutes };
