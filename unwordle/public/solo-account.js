(function (global) {
  'use strict';
  function create(options) {
    var nativeStorage = options.storage || global.localStorage, NativeXHR = global.XMLHttpRequest;
    var owner = null, ready = false, identityRequest = null, revision = 0, busy = false, dirty = false, retryTimer = null, retries = 0;
    var prefix = 'wt-solo-v1:' + options.game + ':', statusEl = null;
    function identity(user) { return user && user.id ? { id: String(user.id), provider: user.provider || 'discord', anchorId: String(user.anchorId || user.id) } : null; }
    function ownerKey(value) { return value ? value.provider + ':' + value.id + ':' + value.anchorId : 'guest'; }
    function key(name, value) { return prefix + encodeURIComponent(ownerKey(value === undefined ? owner : value)) + ':' + name; }
    function storageGet(name) {
      var value = nativeStorage.getItem(key(name));
      // Unowned legacy browser records remain available only to guest play.
      return value === null && !owner ? nativeStorage.getItem(name) : value;
    }
    var storage = { getItem: storageGet, setItem: function (name, value) { nativeStorage.setItem(key(name), value); }, removeItem: function (name) { nativeStorage.removeItem(key(name)); if (!owner) nativeStorage.removeItem(name); } };
    function status(message) {
      if (!statusEl && global.document) {
        statusEl = global.document.createElement('p'); statusEl.id = 'solo-save-status'; statusEl.setAttribute('role', 'status'); statusEl.setAttribute('aria-live', 'polite');
        statusEl.style.cssText = 'font:12px/1.4 system-ui;text-align:center;margin:8px 12px;color:inherit;';
        var app = global.document.getElementById('app') || global.document.body; app.appendChild(statusEl);
      }
      if (statusEl) statusEl.textContent = message || '';
      if (options.onStatus) options.onStatus(message || '');
    }
    function same(a, b) { return ownerKey(a) === ownerKey(b); }
    function bind(user) { owner = identity(user); ready = true; revision++; if (owner) void deliver(true); }
    async function refresh() {
      if (!ready || identityRequest) return identityRequest;
      var version = revision;
      identityRequest = (async function () {
        try {
          var response = await global.fetch(options.authBase + '/api/me/session', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(7000) });
          if (!response.ok) throw Error('identity unavailable');
          var data = await response.json(), next = identity(data.ok ? data.user : null);
          if (version !== revision) return;
          if (!same(owner, next)) {
            revision++; ready = false; if (retryTimer) global.clearTimeout(retryTimer); retryTimer = null;
            status('Your account changed. Loading your own progress…');
            if (options.onChanged) options.onChanged(next); else global.location.reload();
          } else if (owner) void deliver(true);
        } catch (_) { if (version === revision) status('Connection unavailable. Your saved progress will retry when you reconnect.'); }
        finally { identityRequest = null; }
      })();
      return identityRequest;
    }
    function XHR() {
      var x = new NativeXHR(), originalOpen = x.open, originalSend = x.send, expected = owner;
      var guarded = false;
      x.open = function (method, url) {
        var parsed = new URL(url, global.location.href);
        guarded = expected && (parsed.origin === new URL(options.authBase).origin || parsed.origin === global.location.origin) && /^\/api\/(?:sp-state\/|sp-daily\/(?:status|complete)\/|sp-weekly\/(?:status|complete)\/|library\/word$)/.test(parsed.pathname);
        return originalOpen.apply(x, arguments);
      };
      x.send = function () { if (guarded) x.setRequestHeader('x-solo-session-context', JSON.stringify(expected)); return originalSend.apply(x, arguments); };
      if (x.addEventListener) x.addEventListener('load', function () { if (x.status === 409 || x.status === 401) void refresh(); });
      return x;
    }
    function pendingFor(value) {
      var raw = nativeStorage.getItem(key('pending-completions', value)), records = raw ? JSON.parse(raw) : {};
      if (!records || Array.isArray(records) || typeof records !== 'object' || Object.keys(records).length > 90) throw Error('invalid pending history');
      for (var date of Object.keys(records)) {
        var record = records[date];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !record || !record.payload || record.payload.date !== date || JSON.stringify(record.payload).length > 50000) throw Error('invalid pending completion');
      }
      return records;
    }
    function persist(value, records) { nativeStorage.setItem(key('pending-completions', value), JSON.stringify(records)); }
    function schedule() {
      if (retryTimer || !owner || !ready) return;
      var delay = Math.min(60000, 1000 * Math.pow(2, Math.min(retries++, 6)));
      retryTimer = global.setTimeout(function () { retryTimer = null; void deliver(false); }, delay);
    }
    async function deliver(recovered) {
      if (!owner || !ready) return;
      if (busy) { dirty = true; return; }
      busy = true; dirty = false; var expected = owner, version = revision;
      try {
        var records = pendingFor(expected);
        for (var date of Object.keys(records).sort()) {
          var record = records[date]; if (record.terminal) continue;
          if (!same(owner, expected) || version !== revision || !ready) return;
          var response = await global.fetch(options.authBase + '/api/sp-daily/complete/' + options.game, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-solo-session-context': JSON.stringify(expected) }, body: JSON.stringify(record.payload), signal: AbortSignal.timeout(7000) });
          var result = await response.json();
          if (response.ok && result.ok) {
            var latest = pendingFor(expected); delete latest[date]; persist(expected, latest); retries = 0;
            if (same(owner, expected) && version === revision) {
              status(result.rewardPending ? 'Completion saved. Your reward is still being delivered.' : 'Completion synced.');
              try { global.dispatchEvent(new CustomEvent('sp-daily-recorded', { detail: { game: options.game, date: date } })); } catch (_) {}
              if (recovered && result.won !== false && result.reward && options.onRecovered) options.onRecovered(record, result);
            }
          } else if (response.status === 401 || response.status === 409) { if (same(owner, expected) && version === revision) { status('Your completion is saved for its original account.'); schedule(); void refresh(); } return; }
          else if (response.status === 422 || response.status === 400 || response.ok && !result.ok) {
            var retained = pendingFor(expected); if (retained[date]) retained[date].terminal = true; persist(expected, retained);
            if (same(owner, expected)) status('This completion could not be synced. Your local history is retained.');
          } else { if (same(owner, expected) && version === revision) { status('Your completion is saved here. Waiting to sync…'); schedule(); } return; }
        }
      } catch (_) { if (same(owner, expected) && version === revision) { status('Your completion is saved here. Waiting to reconnect…'); schedule(); } }
      finally { busy = false; if (dirty && ready && owner && !retryTimer) { dirty = false; global.setTimeout(function () { void deliver(true); }, 0); } }
    }
    function complete(payload) {
      if (!owner || !ready) return;
      try {
        var frozen = JSON.parse(JSON.stringify(payload)), records = pendingFor(owner);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(frozen.date)) throw Error('invalid date');
        if (!records[frozen.date]) {
          if (Object.keys(records).length >= 90) throw Error('pending history full');
          records[frozen.date] = { payload: frozen, acceptedLocallyAt: Date.now() }; persist(owner, records);
        }
        status('Saving your completion…'); void deliver(false);
      } catch (_) { status('Your completion could not be saved. Keep this page open and try again.'); }
    }
    if (global.document) global.document.addEventListener('visibilitychange', function () { if (!global.document.hidden) void refresh(); });
    if (global.addEventListener) {
      global.addEventListener('focus', function () { void refresh(); });
      global.addEventListener('online', function () { void refresh(); });
    }
    return { storage: storage, XMLHttpRequest: XHR, bind: bind, refresh: refresh, complete: complete };
  }
  global.WordTycoonSoloAccount = { create: create };
  if (typeof module !== 'undefined') module.exports = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
