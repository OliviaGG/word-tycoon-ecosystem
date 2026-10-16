/**
 * Backup & Data Redundancy routes — /api/admin/backups/*
 *
 * Phase 2 B3 extraction from server.js (2026-03-20).
 */


function registerBackupRoutes(app, { db, backup }) {

  // List all backups (grouped stats)
  app.get('/api/admin/backups', (req, res) => {
    const stats = backup.listBackupStats();
    res.json({ ok: true, ...stats });
  });

  // List all backup files (flat list, newest first)
  app.get('/api/admin/backups/list', (req, res) => {
    const all = backup.listAllBackups();
    res.json({ ok: true, count: all.length, backups: all });
  });

  // Dry-run prune report (no deletions)
  app.get('/api/admin/backups/prune-report', (req, res) => {
    const recommended = backup.buildPruneReport(backup.RECOMMENDED_RETENTION_TARGETS);
    const configured = backup.buildPruneReport(backup.getConfiguredRetentionTargets());
    res.json({
      ok: true,
      recommended,
      configured
    });
  });

  // Apply configured or recommended retention targets immediately
  app.post('/api/admin/backups/prune', (req, res) => {
    const mode = (req.body?.mode || 'configured').toLowerCase();
    const targets = mode === 'recommended'
      ? backup.RECOMMENDED_RETENTION_TARGETS
      : backup.getConfiguredRetentionTargets();
    const result = backup.applyRetentionTargets(targets);
    res.json({
      ok: true,
      mode,
      ...result
    });
  });

  // Create manual backup
  app.post('/api/admin/backups/create', (req, res) => {
    const result = backup.createBackup('manual');
    res.json(result);
  });

  // Create JSON snapshot of all player data
  app.post('/api/admin/backups/snapshot', (req, res) => {
    const result = backup.createJsonSnapshot(db);
    res.json(result);
  });

  // sql.js retains authoritative state in memory: online file replacement is unsafe.
  app.post('/api/admin/backups/restore', (_req, res) => {
    res.status(409).json({ ok: false, message: 'Restore requires a stopped economy service and a validated offline cohort.',
      procedure: 'tools/economy-snapshot.cjs restore COHORT (dry run); stop mobile-tycoon before --apply' });
  });
}

module.exports = { registerBackupRoutes };
