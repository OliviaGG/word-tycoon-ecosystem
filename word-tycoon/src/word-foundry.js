'use strict';
const crypto = require('node:crypto');
const ACTION_RETENTION_MS = 30 * 86400000;
const MAX_ACCOUNT_ACTIONS = 10000;
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])); return value; }

const ACTION_ID_PATTERN = /^[a-zA-Z0-9_.:-]{8,120}$/;
const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,128}$/;

function parseJson(value) {
  if (!value || typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeAccountId(value) {
  const accountId = String(value || '').trim();
  return ACCOUNT_ID_PATTERN.test(accountId) ? accountId : null;
}

function normalizeActionId(value) {
  const actionId = String(value || '').trim();
  return ACTION_ID_PATTERN.test(actionId) ? actionId : null;
}

function publicResult(result, state) {
  const response = { ...result, state };
  delete response.unlocked;
  response.unlocked = Array.isArray(result.unlocked) ? result.unlocked : [];
  return response;
}

function createWordFoundryService({ db, core, now = () => Date.now() }) {
  if (!db || !core) throw new TypeError('Word Foundry requires db and core dependencies.');

  function restoreOrCreate(accountId, timestamp) {
    const row = db.getWordFoundryState(accountId);
    const saved = parseJson(row?.state_json);
    const restored = saved ? core.restoreGame(saved, timestamp) : null;
    if (restored) return {
      row,
      state: restored.state,
      earned: restored.earned,
      elapsed: restored.elapsed,
      autoUpgrades: restored.autoUpgrades || 0
    };
    return { row, state: core.createGame(timestamp, `account:${accountId}`), earned: 0, elapsed: 0, autoUpgrades: 0 };
  }

  function load(accountValue) {
    const accountId = normalizeAccountId(accountValue);
    if (!accountId) return { ok: false, code: 'account', message: 'Invalid account.' };
    const timestamp = now();
    const loaded = restoreOrCreate(accountId, timestamp);
    db.saveWordFoundryState(accountId, loaded.state, timestamp);
    return {
      ok: true,
      state: loaded.state,
      offline: { earned: loaded.earned, elapsed: loaded.elapsed, autoUpgrades: loaded.autoUpgrades }
    };
  }

  function runAction(state, type, payload, timestamp) {
    switch (type) {
      case 'build-word': return core.buildWord(state, Array.isArray(payload.tileIds) ? payload.tileIds : [], timestamp);
      case 'buy-letter': return core.buyLetter(state, payload.offerId, timestamp);
      case 'refresh-market': return core.refreshMarket(state, timestamp);
      case 'buy-research': return core.buyUpgrade(state, payload.upgradeId, timestamp);
      case 'upgrade-line': return core.upgradeLine(state, payload.lineId, timestamp);
      case 'dismantle-word': return core.dismantleWord(state, payload.lineId, timestamp);
      case 'claim-order': return core.claimDailyOrder(state, payload.orderId, timestamp);
      case 'buy-legacy': return core.buyLegacyUpgrade(state, payload.upgradeId, timestamp);
      case 'hire-manager': return core.hirePressManager(state, timestamp);
      case 'publish-edition': return core.publishEdition(state, timestamp);
      case 'reset': return { ok: true, state: core.createGame(timestamp, `account:${payload.accountId}`), reset: true, unlocked: [] };
      default: return { ok: false, code: 'action', message: 'Unknown Foundry action.', state, unlocked: [] };
    }
  }

  function act(accountValue, actionIdValue, typeValue, payloadValue) {
    const accountId = normalizeAccountId(accountValue);
    const actionId = normalizeActionId(actionIdValue);
    const type = String(typeValue || '').trim();
    const payload = payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue)
      ? { ...payloadValue, accountId }
      : { accountId };
    if (!accountId) return { ok: false, code: 'account', message: 'Invalid account.' };
    if (!actionId) return { ok: false, code: 'action-id', message: 'Invalid action id.' };

    const timestamp = now();
    if (actionId.startsWith('wf2:')) {
      const match = /^wf2:(\d{13}):[a-zA-Z0-9_.:-]{8,80}$/.exec(actionId), opening = match ? Number(match[1]) : NaN;
      if (!Number.isFinite(opening) || opening > timestamp + 300000 || opening < timestamp - ACTION_RETENTION_MS) {
        return { ok: false, code: 'action-expired', message: 'This action is too old. Reload your current foundry.' };
      }
    }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(stable({ type, payload }))).digest('hex');
    const existing = db.getWordFoundryState(accountId), receipt = db.getWordFoundryAction(accountId, actionId);
    if (receipt) {
      if (receipt.request_hash && receipt.request_hash !== fingerprint) return { ok: false, code: 'action-conflict', message: 'Action id belongs to a different request.' };
      const replay = parseJson(receipt.result_json), replayState = parseJson(existing?.state_json);
      if (!replay || !replayState) throw new Error('Foundry action history invalid');
      return { ...replay, state: replayState, replayed: true, actionAppliedAt: receipt.created_at };
    }
    if (db.countWordFoundryActions(accountId, timestamp) >= MAX_ACCOUNT_ACTIONS) {
      return { ok: false, code: 'action-history-full', message: 'Action history is full. No purchase was made.', state: parseJson(existing?.state_json) };
    }
    const loaded = restoreOrCreate(accountId, timestamp);
    const result = runAction(loaded.state, type, payload, timestamp);
    const response = publicResult(result, result.state || loaded.state);
    const cachedResult = { ...response };
    delete cachedResult.state;
    db.saveWordFoundryAction(accountId, response.state, timestamp, actionId, cachedResult, fingerprint);
    return response;
  }

  return { load, act };
}

module.exports = {
  ACTION_ID_PATTERN,
  ACCOUNT_ID_PATTERN,
  normalizeAccountId,
  normalizeActionId,
  createWordFoundryService
};
