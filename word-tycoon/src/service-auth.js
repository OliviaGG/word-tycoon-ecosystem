'use strict';

function isLoopback(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
}
function presentedKeys(req) {
  const keys = [req.headers?.['x-admin-key'], req.headers?.['x-api-key']];
  if (isLoopback(req)) keys.push(req.headers?.['x-relay-auth']);
  return keys.filter(key => typeof key === 'string' && key.length > 0 && key.length <= 256);
}
function createServiceAuth({ policy, adminKey }) {
  function permitted(req, adminOnly = false) {
    const keys = presentedKeys(req);
    if (typeof adminKey === 'string' && adminKey && keys.includes(adminKey)) return true;
    for (const key of keys) {
      const principal = policy.identify(key);
      if (adminOnly && principal?.id !== 'searchle') continue;
      if (policy.canEconomy(principal, req.method, req.originalUrl || req.path,
          { body: req.body, params: req.params, query: req.query })) {
        req.servicePrincipal = principal;
        return true;
      }
    }
    return false;
  }
  function requireApiKey(req, res, next) {
    if (permitted(req)) return next();
    return res.status(401).json({ ok: false, message: 'Unauthorized: service capability required' });
  }
  function requireAdminKey(req, res, next) {
    if (permitted(req, true)) return next();
    return res.status(401).json({ ok: false, message: 'Unauthorized: admin key required' });
  }
  return { requireApiKey, requireAdminKey };
}
module.exports = { createServiceAuth, presentedKeys, isLoopback };
