/**
 * Business Managers — /api/admin/managers/*
 *
 * AdCap-style managers for the six managed businesses: hire one per business
 * and a server tick auto-collects that business on the player's behalf every
 * few minutes, so income keeps flowing without tapping Collect.
 *
 * Managers are keyed by discord_user_id (the account anchor) so linked-account
 * resolution stays the collect endpoint's job — the tick simply replays the
 * same HTTP call the portal makes.
 *
 * Tycoon.io v2 overhaul — 2026-07-12.
 */

const MANAGER_CATALOG = {
  newspaper:  { name: 'Route Supervisor', emoji: '🗞️', cost: 100000 },
  carwash:    { name: 'Shift Lead',       emoji: '🧽', cost: 500000 },
  pizza:      { name: 'Head Chef',        emoji: '👨‍🍳', cost: 1000000 },
  stockmogul: { name: 'Fund Manager',     emoji: '💼', cost: 2000000 },
  gym:        { name: 'Head Trainer',     emoji: '🏋️', cost: 5000000 },
  cinema:     { name: 'Theater Director', emoji: '🎬', cost: 20000000 },
  startup:    { name: 'CTO',              emoji: '🚀', cost: 50000000 },
  bank:       { name: 'Branch Director',  emoji: '🏦', cost: 100000000 }
};
// Foremen — auto-upgrade tier above managers (10× the manager cost). Requires the
// business's manager first. Each tick buys the cheapest affordable upgrade so
// progression stays steady without draining a wallet on one big purchase.
const FOREMAN_CATALOG = {
  newspaper:  { name: 'Route Foreman',            emoji: '📋', cost: 1000000 },
  carwash:    { name: 'Operations Foreman',       emoji: '🧰', cost: 5000000 },
  pizza:      { name: 'Kitchen Foreman',          emoji: '🫕', cost: 10000000 },
  stockmogul: { name: 'Trading Desk Chief',       emoji: '📊', cost: 20000000 },
  gym:        { name: 'Floor Foreman',            emoji: '📢', cost: 50000000 },
  cinema:     { name: 'Production Chief',         emoji: '🎞️', cost: 200000000 },
  startup:    { name: 'VP of Engineering',        emoji: '🧑‍💻', cost: 500000000 },
  bank:       { name: 'Chief Operations Officer', emoji: '🏛️', cost: 1000000000 }
};
const TICK_MS = 5 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 45 * 1000;
const PORT = process.env.PORT || 3020;

function registerManagerRoutes(app, { db }) {
  // The sql.js handle is not initialized at route-registration time, so the
  // table is created lazily on first use instead of here.
  let tableReady = false;
  function ensureTable() {
    if (tableReady) return true;
    try {
      db.run(`CREATE TABLE IF NOT EXISTS business_managers (
        discord_user_id TEXT NOT NULL,
        business_type TEXT NOT NULL,
        hired_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (discord_user_id, business_type)
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS business_foremen (
        discord_user_id TEXT NOT NULL,
        business_type TEXT NOT NULL,
        hired_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (discord_user_id, business_type)
      )`);
      db.save();
      tableReady = true;
    } catch (e) {
      console.error('[Managers] table init failed:', e.message);
    }
    return tableReady;
  }

  function getManagers(discordUserId) {
    if (!ensureTable()) return {};
    const rows = db.queryAll('SELECT * FROM business_managers WHERE discord_user_id = ?', [discordUserId]);
    const managers = {};
    rows.forEach(r => { managers[r.business_type] = { hired: true, hiredAt: r.hired_at }; });
    return managers;
  }

  function getForemen(discordUserId) {
    if (!ensureTable()) return {};
    const rows = db.queryAll('SELECT * FROM business_foremen WHERE discord_user_id = ?', [discordUserId]);
    const foremen = {};
    rows.forEach(r => { foremen[r.business_type] = { hired: true, hiredAt: r.hired_at }; });
    return foremen;
  }

  // Manager state + hire catalog for one account
  app.get('/api/admin/managers/:discordUserId', (req, res) => {
    const { discordUserId } = req.params;
    const managers = getManagers(discordUserId);
    const foremen = getForemen(discordUserId);
    const catalog = {};
    for (const [type, meta] of Object.entries(MANAGER_CATALOG)) {
      catalog[type] = { name: meta.name, emoji: meta.emoji, cost: meta.cost, hired: !!managers[type] };
    }
    const foremanCatalog = {};
    for (const [type, meta] of Object.entries(FOREMAN_CATALOG)) {
      foremanCatalog[type] = {
        name: meta.name, emoji: meta.emoji, cost: meta.cost,
        hired: !!foremen[type],
        requiresManager: !managers[type]
      };
    }
    res.json({ ok: true, managers, catalog, foremen, foremanCatalog });
  });

  // Hire a manager — costs XP (the single player currency)
  app.post('/api/admin/managers/:discordUserId/hire', (req, res) => {
    const { discordUserId } = req.params;
    const businessType = String(req.body?.businessType || '');
    const meta = MANAGER_CATALOG[businessType];
    if (!meta) return res.json({ ok: false, message: 'No manager available for that business' });
    if (getManagers(discordUserId)[businessType]) {
      return res.json({ ok: false, message: 'Manager already hired' });
    }
    const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    if ((Number(player.xp) || 0) < meta.cost) {
      return res.json({ ok: false, message: `Not enough XP — ${meta.name} costs ${meta.cost.toLocaleString()}` });
    }
    if (!db.deductPlayerCoins(player.id, meta.cost)) {
      return res.json({ ok: false, message: 'Not enough XP' });
    }
    db.run('INSERT OR IGNORE INTO business_managers (discord_user_id, business_type) VALUES (?, ?)', [discordUserId, businessType]);
    db.save();
    const updated = db.getWalletPlayerById(player.id);
    res.json({
      ok: true,
      message: `${meta.emoji} ${meta.name} hired!`,
      businessType,
      newBalance: updated ? (updated.xp || 0) : null
    });
  });

  // Hire a foreman — auto-upgrade tier. Requires that business's manager first.
  app.post('/api/admin/managers/:discordUserId/hire-foreman', (req, res) => {
    const { discordUserId } = req.params;
    const businessType = String(req.body?.businessType || '');
    const meta = FOREMAN_CATALOG[businessType];
    if (!meta) return res.json({ ok: false, message: 'No foreman available for that business' });
    if (!getManagers(discordUserId)[businessType]) {
      return res.json({ ok: false, message: 'Hire the manager first — the foreman reports to them' });
    }
    if (getForemen(discordUserId)[businessType]) {
      return res.json({ ok: false, message: 'Foreman already hired' });
    }
    const player = db.resolveUnifiedPlayerByDiscord(discordUserId);
    if (!player) return res.json({ ok: false, message: 'Player not found' });
    if ((Number(player.xp) || 0) < meta.cost) {
      return res.json({ ok: false, message: `Not enough XP — ${meta.name} costs ${meta.cost.toLocaleString()}` });
    }
    if (!db.deductPlayerCoins(player.id, meta.cost)) {
      return res.json({ ok: false, message: 'Not enough XP' });
    }
    db.run('INSERT OR IGNORE INTO business_foremen (discord_user_id, business_type) VALUES (?, ?)', [discordUserId, businessType]);
    db.save();
    const updated = db.getWalletPlayerById(player.id);
    res.json({
      ok: true,
      message: `${meta.emoji} ${meta.name} hired!`,
      businessType,
      newBalance: updated ? (updated.xp || 0) : null
    });
  });

  // ── Auto-collect tick ──────────────────────────────────────────────────────
  // Replays each hired business's own /collect endpoint over localhost so all
  // income math, caps, and anti-spam rules stay in one place.
  let ticking = false;
  async function managerTick() {
    if (ticking) return;
    ticking = true;
    try {
      if (!ensureTable()) return;
      const rows = db.queryAll('SELECT * FROM business_managers');
      let okCount = 0;
      for (const row of rows) {
        if (!MANAGER_CATALOG[row.business_type]) continue;
        try {
          const r = await fetch(`http://localhost:${PORT}/api/admin/${row.business_type}/${encodeURIComponent(row.discord_user_id)}/collect`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Admin self-call: prefer the dedicated admin secret so this keeps
              // working after the /api/admin split flips to strict; fall back to
              // the shared secret during the transition.
              'x-admin-key': process.env.ADMIN_API_SECRET || process.env.GAME_API_SECRET || '',
              'x-api-key': process.env.GAME_API_SECRET || ''
            },
            body: '{}'
          });
          const d = await r.json().catch(() => null);
          if (d && d.ok) okCount++;
        } catch (e) { /* single business failure must not stop the tick */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (rows.length) console.log(`[Managers] tick: ${okCount}/${rows.length} auto-collects ok`);

      // Foremen: buy the cheapest affordable upgrade for each staffed business.
      // Reads the business's own GET endpoint for the upgrade catalog, then
      // replays the real /upgrade endpoint — affordability, currency, and caps
      // all stay the upgrade handler's problem. One purchase per tick keeps
      // spending gradual.
      const adminHeaders = {
        'Content-Type': 'application/json',
        'x-admin-key': process.env.ADMIN_API_SECRET || process.env.GAME_API_SECRET || '',
        'x-api-key': process.env.GAME_API_SECRET || ''
      };
      const frows = db.queryAll('SELECT * FROM business_foremen');
      let upgCount = 0;
      for (const row of frows) {
        if (!FOREMAN_CATALOG[row.business_type]) continue;
        try {
          const detailRes = await fetch(`http://localhost:${PORT}/api/admin/${row.business_type}/${encodeURIComponent(row.discord_user_id)}`, {
            headers: adminHeaders
          });
          const detail = await detailRes.json().catch(() => null);
          const upgrades = detail && detail.availableUpgrades;
          if (!upgrades) continue;
          // Each business prices upgrades in its own wallet: XP for the generic
          // managed businesses, clean cash for carwash/stockmogul, pizza cash for
          // pizza. Read whichever balance the detail payload carries so we only
          // attempt upgrades the player can actually afford this tick.
          const wallet = Number(
            detail.playerCoins ??
            detail.shop?.cleanCash ??
            detail.shop?.pizzaCoins ??
            detail.portfolio?.cleanCash
          );
          let cheapest = null;
          for (const [key, u] of Object.entries(upgrades)) {
            if (!u || u.maxed) continue;
            const cost = Number(u.cost);
            if (!Number.isFinite(cost)) continue;
            if (Number.isFinite(wallet) && cost > wallet) continue;
            if (!cheapest || cost < cheapest.cost) cheapest = { key, cost };
          }
          if (!cheapest) continue;
          const upRes = await fetch(`http://localhost:${PORT}/api/admin/${row.business_type}/${encodeURIComponent(row.discord_user_id)}/upgrade`, {
            method: 'POST',
            headers: adminHeaders,
            body: JSON.stringify({ upgradeType: cheapest.key })
          });
          const upData = await upRes.json().catch(() => null);
          if (upData && upData.ok) upgCount++;
        } catch (e) { /* single business failure must not stop the tick */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (frows.length) console.log(`[Managers] foreman tick: ${upgCount}/${frows.length} auto-upgrades bought`);
    } catch (e) {
      console.error('[Managers] tick failed:', e.message);
    } finally {
      ticking = false;
    }
  }
  const timer = setInterval(managerTick, TICK_MS);
  if (timer.unref) timer.unref();
  const firstTimer = setTimeout(managerTick, FIRST_TICK_DELAY_MS);
  if (firstTimer.unref) firstTimer.unref();
}

module.exports = { registerManagerRoutes };
