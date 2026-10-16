const db = require('./database');
const { getLibraryLevel } = require('./businesses');
// Lazy-loaded to avoid circular dependency (accrual requires tax-season for getIncomeMultiplier)
let accrual = null;
function getAccrual() {
  if (!accrual) accrual = require('./accrual');
  return accrual;
}

const TAX_SEASON_CONFIRMATION = 'RESET MY EMPIRE';
const TAX_SEASON_BONUS_MULTIPLIER = 1.10;
const TAX_SEASON_TRIGGER_BUSINESS = 'carwash';

const MANAGED_BUSINESS_RESET_CONFIG = {
  pizza: {
    table: 'pizza_shops',
    levelColumn: 'shop_level',
    xpColumn: 'shop_xp',
    prestigeColumn: 'prestige_level',
    lastCollectedColumn: 'last_collected_at',
    zeroColumns: ['pizza_coins', 'total_pizzas_served', 'total_coins_earned'],
    upgradesTable: 'pizza_upgrades'
  },
  newspaper: {
    table: 'newspaper_routes',
    levelColumn: 'route_level',
    xpColumn: 'route_xp',
    prestigeColumn: 'prestige_level',
    lastCollectedColumn: 'last_collected_at',
    zeroColumns: ['total_papers_delivered', 'total_xp_earned'],
    upgradesTable: 'newspaper_upgrades'
  },
  carwash: {
    table: 'carwash_shops',
    levelColumn: 'shop_level',
    xpColumn: 'shop_xp',
    prestigeColumn: 'prestige_level',
    lastCollectedColumn: 'last_collected_at',
    zeroColumns: ['clean_cash', 'total_cars_washed', 'total_clean_earned'],
    upgradesTable: 'carwash_upgrades'
  },
  stockmogul: {
    table: 'stockmogul_portfolios',
    levelColumn: 'portfolio_level',
    xpColumn: 'portfolio_xp',
    prestigeColumn: 'prestige_level',
    lastCollectedColumn: 'last_collected_at',
    zeroColumns: ['portfolio_coins', 'total_trades', 'total_coins_earned'],
    upgradesTable: 'stockmogul_upgrades'
  },
  gym: {
    table: 'gym_clubs',
    levelColumn: 'club_level',
    xpColumn: 'club_xp',
    prestigeColumn: 'prestige_level',
    lastCollectedColumn: 'last_collected_at',
    zeroColumns: ['gym_points', 'total_members_trained', 'total_points_earned'],
    upgradesTable: 'gym_upgrades'
  },
  cinema: {
    table: 'cinema_theaters',
    levelColumn: 'theater_level',
    xpColumn: 'theater_xp',
    prestigeColumn: 'prestige_level',
    lastCollectedColumn: 'last_collected_at',
    zeroColumns: ['total_viewers_served', 'total_xp_earned'],
    upgradesTable: 'cinema_upgrades'
  },
  startup: {
    table: 'startup_hubs',
    levelColumn: 'hub_level',
    xpColumn: 'hub_xp',
    prestigeColumn: 'prestige_level',
    lastCollectedColumn: 'last_collected_at',
    zeroColumns: ['total_users_served', 'total_xp_earned'],
    upgradesTable: 'startup_upgrades'
  },
  bank: {
    table: 'bank_vaults',
    levelColumn: 'vault_level',
    xpColumn: 'vault_xp',
    prestigeColumn: 'prestige_level',
    lastCollectedColumn: 'last_collected_at',
    zeroColumns: ['total_clients_served', 'total_xp_earned'],
    upgradesTable: 'bank_upgrades'
  }
};

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function getTaxSeasonEligibility(playerId) {
  const state = db.getTaxSeasonState(playerId);
  const ids = state.playerIds;
  const ph = placeholders(ids);
  const carwashRows = db.queryAll(
    `SELECT player_id, prestige_level, shop_level
     FROM carwash_shops
     WHERE player_id IN (${ph})`,
    ids
  );

  const eligibleRows = carwashRows.filter(row => Number(row.prestige_level) >= 1);
  return {
    playerIds: ids,
    completed: state.completed,
    completedAt: state.completedAt,
    triggerBusiness: state.triggerBusiness,
    bonusMultiplier: state.bonusMultiplier,
    eligible: !state.completed && eligibleRows.length > 0,
    reason: state.completed
      ? 'already_completed'
      : eligibleRows.length > 0
        ? 'eligible'
        : 'carwash_prestige_required',
    requiredConfirmation: TAX_SEASON_CONFIRMATION,
    carwashRows,
    eligibleRows
  };
}

function getTaxSeasonState(playerId) {
  return db.getTaxSeasonState(playerId);
}

function getIncomeMultiplier(playerId) {
  const state = db.getTaxSeasonState(playerId);
  const mult = Number(state?.bonusMultiplier);
  return Number.isFinite(mult) && mult > 0 ? mult : 1.0;
}

function scaleIncomeAmount(amount, multiplier, mode = 'floor') {
  const numeric = Number(amount) || 0;
  const scaled = numeric * (Number(multiplier) || 1);
  if (mode === 'round') return Math.round(scaled);
  if (mode === 'ceil') return Math.ceil(scaled);
  if (mode === 'none') return scaled;
  return Math.floor(scaled);
}

function scaleObjectFields(source, fields, multiplier, mode = 'floor') {
  const out = { ...source };
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(out, field)) {
      out[field] = scaleIncomeAmount(out[field], multiplier, mode);
    }
  }
  return out;
}

function buildSnapshot(playerIds) {
  const ph = placeholders(playerIds);
  const players = db.queryAll(
    `SELECT id, platform, platform_user_id, username, display_name, coins, gift_coins,
            library_words, tax_season_completed, tax_season_bonus_multiplier
     FROM players
     WHERE id IN (${ph})
     ORDER BY id ASC`,
    playerIds
  );
  const businesses = db.queryAll(
    `SELECT player_id, business_type, level, last_collected_at
     FROM player_businesses
     WHERE player_id IN (${ph})
     ORDER BY player_id ASC, business_type ASC`,
    playerIds
  );

  const managed = {};
  for (const [businessType, cfg] of Object.entries(MANAGED_BUSINESS_RESET_CONFIG)) {
    managed[businessType] = db.queryAll(
      `SELECT * FROM ${cfg.table} WHERE player_id IN (${ph}) ORDER BY player_id ASC`,
      playerIds
    );
  }

  return { playerIds, players, businesses, managed };
}

function ensureManagedRows(playerIds) {
  const ph = placeholders(playerIds);
  for (const [businessType, cfg] of Object.entries(MANAGED_BUSINESS_RESET_CONFIG)) {
    db.run(
      `INSERT INTO ${cfg.table} (player_id)
       SELECT pb.player_id
       FROM player_businesses pb
       LEFT JOIN ${cfg.table} managed ON managed.player_id = pb.player_id
       WHERE pb.business_type = ? AND pb.player_id IN (${ph}) AND managed.player_id IS NULL`,
      [businessType, ...playerIds]
    );
  }
}

function resetPlayerCurrencies(playerIds) {
  // Single-currency economy: the spendable balance lives in players.xp
  // (players.coins is a merged-away legacy column kept at 0).
  const ph = placeholders(playerIds);
  db.run(
    `UPDATE players
     SET xp = 0, coins = 0
     WHERE id IN (${ph})`,
    playerIds
  );
}

function resetPlayerBusinesses(playerIds) {
  const ph = placeholders(playerIds);
  db.run(
    `UPDATE player_businesses
     SET level = 1,
         last_collected_at = datetime('now')
     WHERE player_id IN (${ph}) AND business_type NOT IN ('library', 'newspaper')`,
    playerIds
  );

  const libraries = db.queryAll(
    `SELECT pb.id AS business_id, p.library_words
     FROM player_businesses pb
     JOIN players p ON p.id = pb.player_id
     WHERE pb.player_id IN (${ph}) AND pb.business_type = 'library'`,
    playerIds
  );

  for (const row of libraries) {
    db.run(
      `UPDATE player_businesses
       SET level = ?, last_collected_at = datetime('now')
       WHERE id = ?`,
      [getLibraryLevel(Number(row.library_words) || 0), row.business_id]
    );
  }
}

function resetManagedBusinesses(playerIds) {
  const ph = placeholders(playerIds);

  for (const [businessType, cfg] of Object.entries(MANAGED_BUSINESS_RESET_CONFIG)) {
    if (businessType === 'newspaper') continue;

    const sets = [
      `${cfg.levelColumn} = 1`,
      `${cfg.xpColumn} = 0`,
      `${cfg.prestigeColumn} = 0`,
      `${cfg.lastCollectedColumn} = datetime('now')`
    ];

    for (const col of cfg.zeroColumns) {
      sets.push(`${col} = 0`);
    }

    db.run(
      `UPDATE ${cfg.table}
       SET ${sets.join(', ')}
       WHERE player_id IN (${ph})`,
      playerIds
    );
    db.run(`DELETE FROM ${cfg.upgradesTable} WHERE player_id IN (${ph})`, playerIds);
  }
}

function markTaxSeasonComplete(playerIds, {
  completedAt,
  triggerBusiness,
  resetReason,
  bonusMultiplier
}) {
  const ph = placeholders(playerIds);
  db.run(
    `UPDATE players
     SET tax_season_completed = 1,
         tax_season_completed_at = ?,
         tax_season_trigger_business = ?,
         tax_season_bonus_multiplier = ?,
         tax_season_reset_reason = ?
     WHERE id IN (${ph})`,
    [completedAt, triggerBusiness, bonusMultiplier, resetReason, ...playerIds]
  );
}

async function runTaxSeasonReset(playerId, {
  confirmation = null,
  resetReason = 'rsa_tax_evasion_money_laundering',
  triggerBusiness = TAX_SEASON_TRIGGER_BUSINESS
} = {}) {
  const eligibility = getTaxSeasonEligibility(playerId);

  if (eligibility.completed) {
    return { ok: false, code: 'already_completed', eligibility };
  }
  if (!eligibility.eligible) {
    return { ok: false, code: 'not_eligible', eligibility };
  }
  if (confirmation !== TAX_SEASON_CONFIRMATION) {
    return {
      ok: false,
      code: 'confirmation_required',
      requiredConfirmation: TAX_SEASON_CONFIRMATION,
      eligibility
    };
  }

  const completedAt = new Date().toISOString();

  return db.withTransaction(async () => {
    const latest = getTaxSeasonEligibility(playerId);
    if (latest.completed) {
      return { ok: false, code: 'already_completed', eligibility: latest };
    }
    if (!latest.eligible) {
      return { ok: false, code: 'not_eligible', eligibility: latest };
    }

    const playerIds = latest.playerIds;
    const snapshot = buildSnapshot(playerIds);

    // Phase 2: settle ALL pending income for all linked accounts
    // before the global reset wipes everything. This ensures no
    // retroactive loss of earned income.
    try {
      for (const pid of playerIds) {
        getAccrual().settleAll(pid);
      }
    } catch (e) {
      console.warn('[TaxSeason] Pre-reset settlement warning:', e.message);
      // Non-fatal — better to proceed with reset than fail entirely
    }

    ensureManagedRows(playerIds);
    resetPlayerCurrencies(playerIds);
    resetPlayerBusinesses(playerIds);
    resetManagedBusinesses(playerIds);
    markTaxSeasonComplete(playerIds, {
      completedAt,
      triggerBusiness,
      resetReason,
      bonusMultiplier: TAX_SEASON_BONUS_MULTIPLIER
    });

    db.run(
      `INSERT INTO tax_season_audit
       (player_id, trigger_business, bonus_multiplier, reset_reason, snapshot_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        playerId,
        triggerBusiness,
        TAX_SEASON_BONUS_MULTIPLIER,
        resetReason,
        JSON.stringify(snapshot)
      ]
    );

    return {
      ok: true,
      code: 'tax_season_completed',
      playerIds,
      resetReason,
      completedAt,
      bonusMultiplier: TAX_SEASON_BONUS_MULTIPLIER,
      state: db.getTaxSeasonState(playerId)
    };
  });
}

module.exports = {
  TAX_SEASON_CONFIRMATION,
  TAX_SEASON_BONUS_MULTIPLIER,
  TAX_SEASON_TRIGGER_BUSINESS,
  getTaxSeasonEligibility,
  getTaxSeasonState,
  getIncomeMultiplier,
  scaleIncomeAmount,
  scaleObjectFields,
  runTaxSeasonReset
};
