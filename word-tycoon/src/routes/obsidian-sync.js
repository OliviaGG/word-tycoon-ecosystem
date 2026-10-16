function registerObsidianSyncRoutes(app, { syncService }) {
  const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
  const parseBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  };

  app.get('/api/admin/obsidian-sync/root', (req, res) => {
    res.json({ ok: true, root: syncService.getSyncRoot() });
  });

  app.get('/api/admin/obsidian-sync/player/:identifier/preview', (req, res) => {
    const { identifier } = req.params;
    if (!hasText(identifier)) {
      return res.status(400).json({ ok: false, error: 'Missing player identifier' });
    }
    const result = syncService.previewPlayer(identifier.trim());
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post('/api/admin/obsidian-sync/player/:identifier', (req, res) => {
    const { identifier } = req.params;
    if (!hasText(identifier)) {
      return res.status(400).json({ ok: false, error: 'Missing player identifier' });
    }
    const result = syncService.syncPlayer(identifier.trim());
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post('/api/admin/obsidian-sync/all', (req, res) => {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
    const includeStandalone = parseBoolean(req.query.includeStandalone);
    res.json(syncService.syncAll(limit, includeStandalone));
  });
}

module.exports = { registerObsidianSyncRoutes };
