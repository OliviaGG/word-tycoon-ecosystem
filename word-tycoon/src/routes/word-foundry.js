'use strict';

const core = require('../../public/word-foundry/core');
const { createWordFoundryService } = require('../word-foundry');

function registerWordFoundryRoutes(app, { db, requireRelayKey, now }) {
  const service = createWordFoundryService({ db, core, now });

  app.get('/api/word-foundry/state', requireRelayKey, async (req, res) => {
    try {
    const result = service.load(req.query.accountId);
    if (result.ok) await db.flushDurable();
    res.status(result.ok ? 200 : 400).json(result);
    } catch { res.status(503).json({ ok: false, code: 'retryable', message: 'Foundry save interrupted. Retry the same action.' }); }
  });

  app.post('/api/word-foundry/action', requireRelayKey, async (req, res) => {
    try {
    const { accountId, actionId, type, payload } = req.body || {};
    const result = service.act(accountId, actionId, type, payload);
    if (result.state) await db.flushDurable();
    const status = result.code === 'account' || result.code === 'action-id' ? 400 : ['action-conflict', 'action-expired', 'action-history-full'].includes(result.code) ? 409 : 200;
    res.status(status).json(result);
    } catch { res.status(503).json({ ok: false, code: 'retryable', message: 'Foundry save interrupted. Retry the same action.' }); }
  });

  return service;
}

module.exports = { registerWordFoundryRoutes };
