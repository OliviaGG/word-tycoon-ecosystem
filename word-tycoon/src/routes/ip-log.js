/**
 * IP logging routes — /api/report-ip
 *
 * Receives IP reports from game servers (via game-shared.js) and stores
 * them in the player_ips table for anti-cheat lookups.
 */

function registerIPLogRoutes(app, { db, requireApiKey }) {

  app.post('/api/report-ip', requireApiKey, (req, res) => {
    const { platform, platformUserId, ip, game } = req.body;
    if (!platform || !platformUserId || !ip) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const player = db.resolvePlayer(platform, platformUserId);
    if (!player) return res.json({ ok: false, message: 'Unknown player' });
    db.upsertPlayerIP(player.id, ip, game || null);
    res.json({ ok: true });
  });

  // Admin lookup: get all IPs for a player
  app.get('/api/admin/player-ips/:playerId', requireApiKey, (req, res) => {
    const rows = db.getPlayerIPs(Number(req.params.playerId));
    res.json({ ok: true, ips: rows });
  });

  // Admin lookup: find all players sharing an IP
  app.get('/api/admin/ip-lookup/:ip', requireApiKey, (req, res) => {
    const rows = db.getPlayersByIP(req.params.ip);
    res.json({ ok: true, players: rows });
  });
}

module.exports = { registerIPLogRoutes };
