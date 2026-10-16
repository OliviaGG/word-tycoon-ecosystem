(function attachWordFoundryCloud(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WordFoundryCloud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWordFoundryCloud() {
  'use strict';

  const STATE_ENDPOINT = '/api/word-foundry/state';
  const ACTION_ENDPOINT = '/api/word-foundry/action';

  function isSave(value) {
    return Boolean(value && typeof value === 'object' && Array.isArray(value.inventory)
      && Array.isArray(value.words) && Array.isArray(value.market));
  }

  function defaultStorage() { try { return globalThis.sessionStorage || null; } catch { return null; } }
  function createClient(fetchImpl, endpoints = {}, storage = defaultStorage()) {
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    const stateEndpoint = endpoints.state || STATE_ENDPOINT;
    const actionEndpoint = endpoints.action || ACTION_ENDPOINT;
    let owner = null;
    function storageKey() { return owner ? 'word-foundry-pending-v1:' + owner : null; }
    function pending() {
      if (!storageKey() || !storage) return null;
      const raw = storage.getItem(storageKey()); if (!raw) return null;
      const value = JSON.parse(raw);
      if (!value || typeof value.type !== 'string' || typeof value.actionId !== 'string' || !value.payload || typeof value.payload !== 'object') throw new Error('Pending Foundry action invalid.');
      return value;
    }
    async function send(action) {
      const payload = await request(actionEndpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action)
      });
      if (!payload.state || !isSave(payload.state) || payload.accountKey !== owner) throw new Error(payload.message || 'Foundry action was not accepted.');
      if (storageKey() && storage) storage.removeItem(storageKey());
      return payload;
    }
    async function request(url, options) {
      const response = await fetchImpl(url, options);
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok) {
        if (response.status === 409 && ['action-expired', 'action-conflict', 'action-history-full'].includes(payload?.code) && storageKey() && storage) storage.removeItem(storageKey());
        const error = new Error(payload?.message || payload?.error || `Cloud save request failed (${response.status}).`); error.code = payload?.code; throw error;
      }
      return payload || {};
    }
    return {
      async load() {
        const payload = await request(stateEndpoint, { credentials: 'same-origin', cache: 'no-store' });
        owner = payload.authenticated !== false && payload.ok && /^[a-f0-9]{64}$/.test(payload.accountKey || '') ? payload.accountKey : null;
        return {
          authenticated: payload.authenticated !== false && Boolean(payload.ok),
          state: isSave(payload.state) ? payload.state : null,
          offline: payload.offline || null
        };
      },
      async recover() {
        const action = pending(); return action ? send(action) : null;
      },
      async act(type, actionPayload, actionId) {
        if (!owner) throw new Error('Reload your signed-in foundry before acting.');
        if (!storage) throw new Error('Browser action recovery storage is unavailable.');
        if (pending()) throw new Error('Recover your previous Foundry action first.');
        const action = { type, payload: actionPayload || {}, actionId };
        // Reserve before transport so a lost response/reload retries the original id.
        if (storageKey() && storage) storage.setItem(storageKey(), JSON.stringify(action));
        return send(action);
      }

    };
  }

  return { STATE_ENDPOINT, ACTION_ENDPOINT, isSave, createClient };
});
