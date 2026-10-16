/**
 * Pizza Shop routes — /api/admin/pizza/*
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

const pizzaConfig = require('../pizza-config');
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

function registerPizzaRoutes(app, { db, ledger }) {

  // Get full pizza shop state
  app.get('/api/admin/pizza/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolvePizzaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    presence.touch(player.id, 'portal-pizza');

    const shop = db.getPizzaShop(player.id);
    if (!shop) return res.json({ ok: true, hasShop: false });

    const upgradeRows = db.getPizzaUpgrades(player.id);
    const upgrades = {};
    for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

    const customizationRows = db.getPizzaCustomizations(player.id);
    const customizations = {};
    for (const row of customizationRows) customizations[row.category] = row.value;

    // Calculate pending income
    // Phase 2: display multiplier includes tax season × managed-business online/offline
    const deliveryLevel = upgrades.delivery || 0;
    const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
    const pending = scaleObjectFields(pizzaConfig.calculatePendingIncome(
      upgrades, shop.shop_level, shop.prestige_level, shop.last_collected_at, deliveryLevel
    ), ['pizzaCoins', 'xpGained', 'pizzasServed'], multiplier);

    const incomePerSecond = pizzaConfig.getIncomePerSecond(upgrades, shop.shop_level, shop.prestige_level) * multiplier;
    const ovenLevel = upgrades.oven || 0;
    const cycleTime = pizzaConfig.getCycleSeconds(ovenLevel);
    const incomePerCycle = scaleIncomeAmount(pizzaConfig.getIncomePerCycle(upgrades, shop.shop_level, shop.prestige_level), multiplier);
    const effDelivery = pizzaConfig.effectiveLevel(deliveryLevel, pizzaConfig.PIZZA_UPGRADES.delivery.decay);
    const deliveryBonus = 1 + (effDelivery * 0.15);
    const xpNeeded = pizzaConfig.xpForLevel(shop.shop_level, shop.prestige_level);

    res.json({
      ok: true,
      hasShop: true,
      shop: {
        shopName: shop.shop_name,
        prestigeLevel: shop.prestige_level,
        prestigeTier: pizzaConfig.getPrestigeTierName(shop.prestige_level),
        prestigeMultiplier: pizzaConfig.getPrestigeMultiplier(shop.prestige_level),
        shopLevel: shop.shop_level,
        shopXp: shop.shop_xp,
        xpNeeded,
        pizzaCoins: shop.pizza_coins,
        totalPizzasServed: shop.total_pizzas_served,
        totalCoinsEarned: shop.total_coins_earned,
        lastCollectedAt: shop.last_collected_at,
        incomePerSecond,
        cycleTime,
        incomePerCycle,
        deliveryBonus
      },
      upgrades,
      customizations,
      pending,
      availableUpgrades: Object.fromEntries(
        Object.entries(pizzaConfig.PIZZA_UPGRADES).map(([key, def]) => {
          const currentLevel = upgrades[key] || 0;
          const preview = pizzaConfig.getUpgradeEffectPreview(key, currentLevel, shop.shop_level, shop.prestige_level, upgrades);
          const maxBuy = pizzaConfig.calculateMaxBuy(key, currentLevel, shop.pizza_coins);
          return [key, {
            ...def,
            currentLevel,
            cost: pizzaConfig.getUpgradeCost(key, currentLevel),
            maxed: currentLevel >= def.maxLevel,
            effectPreview: preview,
            maxBuy
          }];
        })
      ),
      availableCustomizations: pizzaConfig.getAvailableCustomizations(shop.prestige_level)
    });
  });

  // Initialize pizza shop (called when pizza business is purchased)
  app.post('/api/admin/pizza/:discordUserId/init', (req, res) => {
    const { discordUserId } = req.params;
    const existingPlayer = db.resolvePizzaPlayerByDiscord(discordUserId);
    const existingShop = existingPlayer ? db.getPizzaShop(existingPlayer.id) : null;
    if (existingShop) {
      return res.json({ ok: true, message: 'Pizza Shop already initialized!', shop: existingShop });
    }

    // Find which linked player owns the pizza business
    const allIds = db.getAllPlayerIdsForDiscord(discordUserId);
    let pizzaPlayerId = null;
    for (const pid of allIds) {
      const biz = db.getPlayerBusiness(pid, 'pizza');
      if (biz) { pizzaPlayerId = pid; break; }
    }
    if (!pizzaPlayerId) {
      // Fall back to primary player check
      const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
      if (!player) return res.json({ ok: false, message: 'Player not found' });
      const pizzaBiz = db.getPlayerBusiness(player.id, 'pizza');
      if (!pizzaBiz) return res.json({ ok: false, message: 'Must own Pizza Shop business first' });
      pizzaPlayerId = player.id;
    }

    const shop = db.createPizzaShop(pizzaPlayerId);
    res.json({ ok: true, message: 'Pizza Shop initialized!', shop });
  });

  // Upgrade a pizza shop component
  app.post('/api/admin/pizza/:discordUserId/upgrade', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = pizzaConfig.PIZZA_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolvePizzaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    try {
      const result = await accrual.settleAndMutate(player.id, 'pizza', () => {
        const shop = db.getPizzaShop(player.id);
        if (!shop) return { ok: false, message: 'No pizza shop found' };

        const currentLevel = (db.getPizzaUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const cost = pizzaConfig.getUpgradeCost(upgradeType, currentLevel);
        if (shop.pizza_coins < cost) {
          return { ok: false, message: `Need ${cost} pizza cash (have ${Math.floor(shop.pizza_coins)})` };
        }

        if (!db.deductPizzaCoins(player.id, cost)) {
          return { ok: false, message: 'Insufficient pizza cash (race condition)' };
        }

        const newLevel = currentLevel + 1;
        db.setPizzaUpgrade(player.id, upgradeType, newLevel);
        const updatedShop = db.getPizzaShop(player.id);
        return {
          ok: true,
          message: `${def.emoji} ${def.name} upgraded to level ${newLevel}!`,
          newLevel,
          pizzaCoins: updatedShop?.pizza_coins ?? Math.max(0, shop.pizza_coins - cost)
        };
      });

      presence.touch(player.id, 'pizza-upgrade');
      res.json(result);
    } catch (err) {
      console.error('[pizza] upgrade failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  // Max-buy: purchase as many levels of an upgrade as affordable
  app.post('/api/admin/pizza/:discordUserId/upgrade-max', async (req, res) => {
    const { discordUserId } = req.params;
    const { upgradeType } = req.body;
    if (!upgradeType) return res.status(400).json({ ok: false, message: 'Missing upgradeType' });

    const def = pizzaConfig.PIZZA_UPGRADES[upgradeType];
    if (!def) return res.json({ ok: false, message: 'Unknown upgrade type' });

    const player = db.resolvePizzaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    try {
      const result = await accrual.settleAndMutate(player.id, 'pizza', () => {
        const shop = db.getPizzaShop(player.id);
        if (!shop) return { ok: false, message: 'No pizza shop found' };

        const currentLevel = (db.getPizzaUpgrade(player.id, upgradeType)?.level) || 0;
        if (currentLevel >= def.maxLevel) return { ok: false, message: `${def.name} is already at max level` };

        const { levels, totalCost } = pizzaConfig.calculateMaxBuy(upgradeType, currentLevel, shop.pizza_coins);
        if (levels === 0) return { ok: false, message: `Not enough pizza cash for even one level` };

        if (!db.deductPizzaCoins(player.id, totalCost)) {
          return { ok: false, message: 'Insufficient pizza cash (race condition)' };
        }

        const newLevel = currentLevel + levels;
        db.setPizzaUpgrade(player.id, upgradeType, newLevel);
        const updatedShop = db.getPizzaShop(player.id);
        return {
          ok: true,
          message: `${def.emoji} ${def.name} upgraded ${levels} level${levels > 1 ? 's' : ''} to level ${newLevel}!`,
          newLevel,
          levelsGained: levels,
          pizzaCoins: updatedShop?.pizza_coins ?? Math.max(0, shop.pizza_coins - totalCost)
        };
      });

      presence.touch(player.id, 'pizza-upgrade-max');
      res.json(result);
    } catch (err) {
      console.error('[pizza] upgrade-max failed', err);
      res.status(500).json({ ok: false, message: 'Upgrade failed', error: err.message });
    }
  });

  // Collect accumulated pizza income (converts pizza coins to real coins)
  app.post('/api/admin/pizza/:discordUserId/collect', async (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolvePizzaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    const beforePlayer = db.getWalletPlayerById(player.id);

    try {
      const result = await db.withTransaction(async () => {
        const shop = db.getPizzaShop(player.id);
        if (!shop) return { ok: false, message: 'No pizza shop found' };

        const upgradeRows = db.getPizzaUpgrades(player.id);
        const upgrades = {};
        for (const row of upgradeRows) upgrades[row.upgrade_type] = row.level;

        const deliveryLevel = upgrades.delivery || 0;
        // Phase 2: collect multiplier includes managed offline rate
        const multiplier = getIncomeMultiplier(player.id) * accrual.getManagedPresenceMultiplier(player.id);
        const pending = scaleObjectFields(pizzaConfig.calculatePendingIncome(
          upgrades, shop.shop_level, shop.prestige_level, shop.last_collected_at, deliveryLevel
        ), ['pizzaCoins', 'xpGained', 'pizzasServed'], multiplier);

        const claimedAt = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
        if (!db.claimBusinessCollectSnapshot('pizza_shops', player.id, shop.last_collected_at || null, claimedAt)) {
          const refreshedShop = db.getPizzaShop(player.id);
          const refreshedClaimMs = parseStoredTimestamp(refreshedShop?.last_collected_at || '');
          const originalClaimMs = parseStoredTimestamp(shop.last_collected_at || '');
          const isRecentClaim =
            Number.isFinite(refreshedClaimMs) &&
            refreshedClaimMs !== originalClaimMs &&
            Math.abs(refreshedClaimMs - parseStoredTimestamp(claimedAt)) <= 10000;

          if (refreshedShop && isRecentClaim) {
            return {
              ok: true,
              alreadyProcessed: true,
              collected: 0,
              realCoinBonus: 0,
              newBalance: db.getWalletPlayerById(player.id)?.xp ?? beforePlayer?.xp ?? 0,
              pizzaCoins: refreshedShop.pizza_coins,
              shopLevel: refreshedShop.shop_level,
              shopXp: refreshedShop.shop_xp,
              totalPizzasServed: refreshedShop.total_pizzas_served
            };
          }

          return { ok: false, message: 'Collect already processed. Try again.' };
        }

        let newPizzaCoins = shop.pizza_coins + pending.pizzaCoins;
        let newXp = shop.shop_xp + pending.xpGained;
        let newLevel = shop.shop_level;
        let newPizzasServed = shop.total_pizzas_served + pending.pizzasServed;

        while (newLevel < pizzaConfig.MAX_SHOP_LEVEL) {
          const xpNeeded = pizzaConfig.xpForLevel(newLevel, shop.prestige_level);
          if (newXp >= xpNeeded) {
            newXp -= xpNeeded;
            newLevel++;
          } else {
            break;
          }
        }

        const realCoinBonus = Math.floor(pending.pizzaCoins * 0.1);
        if (realCoinBonus > 0) {
          db.updatePlayerCoins(player.id, realCoinBonus);
        }

        db.updatePizzaShop(player.id, {
          pizza_coins: newPizzaCoins,
          shop_xp: newXp,
          shop_level: newLevel,
          total_pizzas_served: newPizzasServed,
          total_coins_earned: shop.total_coins_earned + Math.floor(pending.pizzaCoins),
          last_collected_at: claimedAt
        });

        const updatedPlayer = db.getWalletPlayerById(player.id);
        return {
          ok: true,
          collected: Math.floor(pending.pizzaCoins),
          realCoinBonus,
          newBalance: (updatedPlayer.xp || 0),
          pizzaCoins: newPizzaCoins,
          shopLevel: newLevel,
          shopXp: newXp,
          totalPizzasServed: newPizzasServed
        };
      });

      if (result?.ok && ledger && beforePlayer && result.realCoinBonus > 0) {
        ledger.record({
          playerId: player.id,
          playerName: player.display_name || player.username,
          platform: player.platform || 'unknown',
          eventType: 'biz-collect',
          command: 'pizza collect',
          coinsBefore: (beforePlayer.xp || 0),
          coinsAfter: result.newBalance,
          success: 1,
          response: `Collected ${result.realCoinBonus} XP from Pizza Shop`,
          detail: {
            business: 'pizza',
            realCoinBonus: result.realCoinBonus,
            pizzaCoinsCollected: result.collected,
            pizzaCoinsBalance: result.pizzaCoins,
            shopLevel: result.shopLevel,
            totalPizzasServed: result.totalPizzasServed
          }
        });
      }

      presence.touch(player.id, 'pizza-collect');
      res.json(result);
    } catch (err) {
      console.error('[pizza] collect failed', err);
      res.status(500).json({ ok: false, message: 'Collect failed', error: err.message });
    }
  });

  // Prestige the pizza shop
  app.post('/api/admin/pizza/:discordUserId/prestige', (req, res) => {
    const { discordUserId } = req.params;
    const player = db.resolvePizzaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const result = db.prestigePizzaShop(player.id);
    if (!result.ok) return res.json(result);

    const tierName = pizzaConfig.getPrestigeTierName(result.newPrestigeLevel);
    const multiplier = pizzaConfig.getPrestigeMultiplier(result.newPrestigeLevel);

    res.json({
      ok: true,
      message: `Prestiged to ${tierName}! (${multiplier}x income)`,
      prestigeLevel: result.newPrestigeLevel,
      tierName,
      multiplier
    });
  });

  // Set a customization option
  app.post('/api/admin/pizza/:discordUserId/customize', (req, res) => {
    const { discordUserId } = req.params;
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ ok: false, message: 'Missing category or value' });

    const player = db.resolvePizzaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const shop = db.getPizzaShop(player.id);
    if (!shop) return res.json({ ok: false, message: 'No pizza shop found' });

    if (!pizzaConfig.isCustomizationAllowed(category, value, shop.prestige_level)) {
      return res.json({ ok: false, message: 'This option requires a higher prestige level' });
    }

    db.setPizzaCustomization(player.id, category, value);
    db.save();

    res.json({ ok: true, message: 'Customization updated', category, value });
  });

  // Rename the pizza shop
  app.post('/api/admin/pizza/:discordUserId/rename', (req, res) => {
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

    const player = db.resolvePizzaPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });

    const shop = db.getPizzaShop(player.id);
    if (!shop) return res.json({ ok: false, message: 'No pizza shop found' });

    db.updatePizzaShop(player.id, { shop_name: cleanName });
    db.save();

    res.json({ ok: true, message: 'Shop renamed!', shopName: cleanName });
  });
}

module.exports = { registerPizzaRoutes };
