'use strict';

const path = require('node:path');
const COMPANIONS = new Set(['wikisearchle', 'wikirectangled']);

function createCompanionRankAuth({ selfKey, policy } = {}) {
  if (!policy) {
    const economyDir = process.platform === 'win32' ? 'C:/Word Tycoon' : '/opt/word-tycoon';
    try {
      policy = require(path.join(economyDir, 'src/service-key-policy')).createServiceKeyPolicy({
        filename: path.join(economyDir, 'data/service-keys.json'),
      });
    } catch {
      console.error('[CompanionRankAuth] Service registry unavailable; companion requests denied');
    }
  }
  return function canRank(req) {
    const key = req.headers?.['x-api-key'];
    if (typeof key !== 'string' || !key || key.length > 256) return false;
    if (selfKey && key === selfKey) return true;
    const principal = policy?.identify(key);
    return !!principal && !principal.legacy && COMPANIONS.has(principal.id);
  };
}

module.exports = { createCompanionRankAuth };
