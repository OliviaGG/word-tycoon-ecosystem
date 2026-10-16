/**
 * Ledger/audit routes — /api/admin/ledger/*
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */

function registerLedgerRoutes(app, { ledger }) {

  // Search ledger entries (main endpoint for Accounts page)
  app.get('/api/admin/ledger/search', (req, res) => {
    const { q, player_id, event_type, from, to, page, limit } = req.query;
    const result = ledger.searchLedger({
      query: q || '',
      playerId: player_id ? Number(player_id) : null,
      eventType: event_type || null,
      from: from || null,
      to: to || null,
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 50, 200)
    });
    res.json({ ok: true, ...result });
  });

  // Get ledger for a specific player
  app.get('/api/admin/ledger/player/:playerId', (req, res) => {
    const playerId = parseInt(req.params.playerId);
    if (!playerId) return res.status(400).json({ ok: false, message: 'Invalid player ID' });
    const { event_type, from, to, page, limit } = req.query;
    const result = ledger.getPlayerLedger(playerId, {
      eventType: event_type || null,
      from: from || null,
      to: to || null,
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 50, 200)
    });
    res.json({ ok: true, ...result });
  });

  // Per-player ledger summary
  app.get('/api/admin/ledger/player/:playerId/summary', (req, res) => {
    const playerId = parseInt(req.params.playerId);
    if (!playerId) return res.status(400).json({ ok: false, message: 'Invalid player ID' });
    const summary = ledger.getPlayerLedgerSummary(playerId);
    res.json({ ok: true, ...summary });
  });

  // Aggregate ledger stats
  app.get('/api/admin/ledger/stats', (req, res) => {
    const stats = ledger.getLedgerStats();
    res.json({ ok: true, ...stats });
  });
}

module.exports = { registerLedgerRoutes };
