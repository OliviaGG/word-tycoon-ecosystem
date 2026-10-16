'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PACKAGE_NAME = 'com.subtextle.app';
const DEFAULT_PRODUCT_ID = 'subtextle_online';
const HANDOFF_TTL_MS = 10 * 60 * 1000;
const ENTITLEMENT_REFRESH_MS = 6 * 60 * 60 * 1000;
const OUTAGE_GRACE_MS = 24 * 60 * 60 * 1000;
const REVIEW_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HANDOFFS = 1000;
const MAX_OPERATIONS = 64;
const ALLOWED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function loadServiceAccount(env) {
  const inline = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  const file = env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  if (inline) return JSON.parse(inline);
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return null;
}

function subscriptionStatus(payload, expectedProductId, now = Date.now()) {
  const lineItems = Array.isArray(payload && payload.lineItems) ? payload.lineItems : [];
  const matchingItems = lineItems.filter((item) => item && item.productId === expectedProductId);
  const expiryMs = matchingItems.reduce((latest, item) => {
    const parsed = Date.parse(item.expiryTime || '');
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
  const state = String((payload && payload.subscriptionState) || '');
  const replaced = !!payload?.canceledStateContext?.replacementCancellation;
  return {
    active: !replaced && ALLOWED_STATES.has(state) && expiryMs > now,
    expiryTime: expiryMs ? new Date(expiryMs).toISOString() : null,
    state, replaced,
  };
}

class PlayBilling {
  constructor(options = {}) {
    this.packageName = options.packageName || DEFAULT_PACKAGE_NAME;
    this.productId = options.productId || DEFAULT_PRODUCT_ID;
    this.dataFile = options.dataFile || path.join(__dirname, '..', 'data', 'play-subscriptions.json');
    this.env = options.env || process.env;
    this.fetch = options.fetchImpl || global.fetch;
    this.now = options.now || (() => Date.now());
    this.handoffs = new Map();
    this.entitlements = new Map();
    this.locks = new Map();
    this.refreshes = new Map();
    this.filesystem = options.filesystem || fs;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this._load();
  }

  _load() {
    try {
      const stat = this.filesystem.statSync(this.dataFile);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid entitlement store');
      const parsed = JSON.parse(this.filesystem.readFileSync(this.dataFile, 'utf8'));
      if (parsed.version !== 1 || !parsed.entitlements || typeof parsed.entitlements !== 'object' || Array.isArray(parsed.entitlements)) throw new Error('Invalid entitlement store');
      for (const [accountId, value] of Object.entries(parsed.entitlements || {})) {
        if (!accountId || accountId.length > 128 || !value || value.productId !== this.productId ||
            typeof value.purchaseToken !== 'string' || !value.purchaseToken || value.purchaseToken.length > 4096 ||
            typeof value.state !== 'string' || value.state.length > 80 ||
            (value.expiryTime != null && !Number.isFinite(Date.parse(value.expiryTime))) ||
            !Number.isFinite(Date.parse(value.lastCheckedAt))) throw new Error('Invalid entitlement record');
        this.entitlements.set(accountId, Object.freeze(value));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Play Billing entitlement store unavailable or invalid');
    }
  }

  _save(entitlements = this.entitlements) {
    if (this.storageUncertain) throw new Error('Entitlement storage requires recovery');
    const payload = {
      version: 1,
      updatedAt: new Date(this.now()).toISOString(),
      entitlements: Object.fromEntries(entitlements),
    };
    const disk = this.filesystem;
    const directory = path.dirname(this.dataFile);
    disk.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const tempFile = `${this.dataFile}.tmp-${process.pid}-${crypto.randomUUID()}`;
    let fd, renamed = false;
    try {
      fd = disk.openSync(tempFile, 'wx', 0o600);
      disk.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
      disk.fsyncSync(fd);
      disk.closeSync(fd); fd = undefined;
      disk.renameSync(tempFile, this.dataFile);
      renamed = true;
      if (process.platform !== 'win32') {
        fd = disk.openSync(directory, 'r');
        disk.fsyncSync(fd); disk.closeSync(fd); fd = undefined;
      }
      this.entitlements = entitlements;
    } catch (error) {
      if (renamed) {
        this.entitlements = entitlements;
        this.storageUncertain = true;
      }
      throw error;
    } finally {
      if (fd !== undefined) { try { disk.closeSync(fd); } catch {} }
      try { disk.unlinkSync(tempFile); } catch {}
    }
  }

  createHandoff(accountId) {
    if (this.storageUncertain) throw new Error('Entitlement storage requires recovery');
    if (typeof accountId !== 'string' || !accountId || accountId.length > 128 || /^(?:guest|anon|web_guest|wsguest)[_-]/i.test(accountId)) throw new Error('Invalid account');
    this._pruneHandoffs();
    for (const [id, handoff] of this.handoffs) {
      if (handoff.accountId === accountId && !handoff.claimed) return id;
    }
    if (this.handoffs.size >= MAX_HANDOFFS) throw new Error('Purchase sessions busy');
    const id = crypto.randomBytes(32).toString('base64url');
    this.handoffs.set(id, { accountId: String(accountId), expiresAt: this.now() + HANDOFF_TTL_MS });
    return id;
  }

  _pruneHandoffs() {
    const now = this.now();
    for (const [id, handoff] of this.handoffs) {
      if (handoff.expiresAt <= now) this.handoffs.delete(id);
    }
  }

  _consumeHandoff(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const handoff = this.handoffs.get(id);
    if (!handoff || handoff.expiresAt <= this.now()) {
      if (handoff) this.handoffs.delete(String(id));
      return null;
    }
    return handoff;
  }

  reviewerCookieValue() {
    const token = this.env.SUBTEXTLE_REVIEW_TOKEN;
    if (!token) return null;
    const expires = this.now() + REVIEW_TTL_MS;
    const content = 'v1.' + expires;
    return content + '.' + crypto.createHmac('sha256', token).update('subtextle-google-play-review:' + content).digest('base64url');
  }

  isReviewerToken(token) {
    return !!this.env.SUBTEXTLE_REVIEW_TOKEN && safeEqual(token, this.env.SUBTEXTLE_REVIEW_TOKEN);
  }

  hasReviewerAccess(cookieHeader) {
    const token = this.env.SUBTEXTLE_REVIEW_TOKEN;
    const value = parseCookies(cookieHeader).subtextle_review;
    if (!token || typeof value !== 'string' || value.length > 128) return false;
    const parts = value.split('.');
    const expires = Number(parts[1]);
    if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d{13}$/.test(parts[1]) ||
        expires <= this.now() || expires > this.now() + REVIEW_TTL_MS) return false;
    const expected = crypto.createHmac('sha256', token).update('subtextle-google-play-review:' + parts.slice(0, 2).join('.')).digest('base64url');
    return safeEqual(parts[2], expected);
  }

  async _getAccessToken() {
    if (this.accessToken && this.accessTokenExpiresAt - 60_000 > this.now()) return this.accessToken;
    const serviceAccount = loadServiceAccount(this.env);
    if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error('Google Play service account is not configured');
    }
    const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token';
    if (tokenUri !== 'https://oauth2.googleapis.com/token') throw new Error('Unexpected Google OAuth endpoint');
    const issuedAt = Math.floor(this.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64url(JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }));
    const unsigned = `${header}.${claim}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key).toString('base64url');
    const response = await this.fetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Google OAuth failed (${response.status})`);
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 8192 ||
        !Number.isFinite(Number(data.expires_in || 3600)) || Number(data.expires_in || 3600) <= 0) throw new Error('Invalid Google OAuth response');
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = this.now() + (Number(data.expires_in || 3600) * 1000);
    return this.accessToken;
  }

  async verifyPurchaseToken(purchaseToken) {
    const token = await this._getAccessToken();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const response = await this.fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Google Play verification failed (${response.status})`);
    const payload = await response.json();
    return { payload, ...subscriptionStatus(payload, this.productId, this.now()) };
  }

  async _withToken(purchaseToken, action) {
    if (this.locks.has(purchaseToken) || this.locks.size >= MAX_OPERATIONS) throw new Error('Purchase verification busy; retry');
    const marker = {};
    this.locks.set(purchaseToken, marker);
    try { return await action(); }
    finally { if (this.locks.get(purchaseToken) === marker) this.locks.delete(purchaseToken); }
  }

  async _acknowledge(purchaseToken) {
    const token = await this._getAccessToken();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.packageName)}/purchases/subscriptions/${encodeURIComponent(this.productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
    const response = await this.fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}', redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Google Play acknowledgment temporarily unavailable');
  }

  async _retryAcknowledgment(id, expected) {
    if (this.storageUncertain) return;
    if (!expected?.acknowledgmentPending || this.entitlements.get(id) !== expected) return;
    const verified = await this.verifyPurchaseToken(expected.purchaseToken);
    if (this.entitlements.get(id) !== expected) return;
    if (!verified.active) {
      const denied = Object.freeze({ ...expected, state: verified.state, replaced: !!verified.replaced, expiryTime: verified.expiryTime,
        lastCheckedAt: new Date(this.now()).toISOString(), acknowledgmentPending: false });
      const next = new Map(this.entitlements); next.set(id, denied);
      try { this._save(next); } catch { this.entitlements.set(id, denied); throw new Error('Entitlement denial pending persistence'); }
      return;
    }
    if (verified.payload?.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') await this._acknowledge(expected.purchaseToken);
    if (this.entitlements.get(id) !== expected) return;
    const next = new Map(this.entitlements);
    next.set(id, Object.freeze({ ...expected, acknowledgmentPending: false }));
    this._save(next);
  }

  startBackgroundTasks() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.retryAcknowledgments().catch(() => {}); }, 60000);
    this.timer.unref();
  }

  async retryAcknowledgments() {
    if (this.acknowledging) return;
    this.acknowledging = true;
    try {
      const all = [...this.entitlements].filter(([, value]) => value.acknowledgmentPending);
      const start = all.length ? (this.ackCursor || 0) % all.length : 0;
      const pending = [...all.slice(start), ...all.slice(0, start)].slice(0, 25);
      this.ackCursor = start + pending.length;
      for (const [id, expected] of pending) {
        try { await this._withToken(expected.purchaseToken, () => this._retryAcknowledgment(id, expected)); }
        catch { console.warn('[PlayBilling] acknowledgment pending; retry scheduled'); }
      }
    } finally { this.acknowledging = false; }
  }

  async verifyAndGrant({ handoffId, purchaseToken, productId }) {
    if (this.storageUncertain) throw new Error('Entitlement storage requires recovery');
    const handoff = this._consumeHandoff(handoffId);
    if (!handoff) return { ok: false, status: 410, error: 'Purchase session expired. Return to Subtextle and try again.' };
    if (productId !== this.productId || typeof purchaseToken !== 'string' || !purchaseToken || purchaseToken.length > 4096) {
      return { ok: false, status: 400, error: 'Invalid subscription purchase.' };
    }

    if (handoff.claimed) return { ok: false, status: 409, error: 'Purchase verification in progress. Please retry.' };
    handoff.claimed = true;
    try { return await this._withToken(purchaseToken, async () => {
    const result = await this.verifyPurchaseToken(purchaseToken);
    if (this.handoffs.get(handoffId) !== handoff || handoff.expiresAt <= this.now()) return { ok: false, status: 410, error: 'Purchase session expired. Please return to Subtextle.' };
    if (!result.active) {
      return { ok: false, status: 402, error: 'Google Play did not report an active subscription.', state: result.state };
    }

    const entitlement = {
      productId: this.productId,
      purchaseToken: String(purchaseToken),
      state: result.state,
      expiryTime: result.expiryTime,
      lastCheckedAt: new Date(this.now()).toISOString(),
      acknowledgmentPending: result.payload?.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
      acknowledgmentFirstPendingAt: result.payload?.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' ? new Date(this.now()).toISOString() : null,
    };
    // A Google Play purchase belongs to one app account at a time. Moving the
    // same token on restore prevents one Play subscription being shared across
    // multiple Word Tycoon identities.
    const next = new Map(this.entitlements);
    const replaced = result.payload?.linkedPurchaseToken;
    for (const [accountId, existing] of next) {
      if (accountId !== handoff.accountId && (existing.purchaseToken === purchaseToken ||
          (typeof replaced === 'string' && existing.purchaseToken === replaced))) {
        next.delete(accountId);
      }
    }
    const saved = Object.freeze(entitlement);
    next.set(handoff.accountId, saved);
    this._save(next);
    this.handoffs.delete(String(handoffId));
    if (saved.acknowledgmentPending) {
      try { await this._retryAcknowledgment(handoff.accountId, saved); }
      catch { console.warn('[PlayBilling] acknowledgment pending; retry scheduled'); }
    }
    return { ok: true, status: 200, active: true, expiryTime: entitlement.expiryTime };
    }); } finally { handoff.claimed = false; }
  }

  async hasActiveEntitlement(accountId) {
    if (this.storageUncertain) return false;
    const id = String(accountId || '');
    const entitlement = this.entitlements.get(id);
    if (!entitlement) return false;

    const expiryMs = Date.parse(entitlement.expiryTime || '');
    const checkedMs = Date.parse(entitlement.lastCheckedAt || '');
    const age = this.now() - checkedMs;
    const allowed = ALLOWED_STATES.has(entitlement.state) && !entitlement.replaced;
    const unexpired = Number.isFinite(expiryMs) && expiryMs > this.now();
    const fresh = Number.isFinite(checkedMs) && age >= 0 && age < ENTITLEMENT_REFRESH_MS;
    if (fresh) return allowed && unexpired;
    if (this.refreshes.has(id)) return this.refreshes.get(id);

    const refreshing = this._withToken(entitlement.purchaseToken, async () => { try {
      const result = await this.verifyPurchaseToken(entitlement.purchaseToken);
      if (this.entitlements.get(id) !== entitlement) return false;
      const updated = Object.freeze({ ...entitlement, state: result.state, replaced: !!result.replaced, expiryTime: result.expiryTime,
        lastCheckedAt: new Date(this.now()).toISOString(),
        acknowledgmentPending: result.payload?.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
        acknowledgmentFirstPendingAt: result.payload?.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING'
          ? (entitlement.acknowledgmentFirstPendingAt || (entitlement.acknowledgmentPending ? entitlement.lastCheckedAt : new Date(this.now()).toISOString())) : null });
      const next = new Map(this.entitlements); next.set(id, updated);
      try { this._save(next); }
      catch {
        // A provider-confirmed denial also takes effect in memory if the disk
        // is unavailable. A failed save can never reinstate a revoked grant.
        if (!result.active) this.entitlements.set(id, updated);
        return false;
      }
      return result.active;
    } catch (error) {
      console.warn('[PlayBilling] refresh temporarily unavailable');
      const currentAge = this.now() - checkedMs;
      return this.entitlements.get(id) === entitlement && allowed && expiryMs > this.now() && Number.isFinite(checkedMs) && currentAge >= 0 && currentAge < OUTAGE_GRACE_MS;
    }}).catch(() => false);
    this.refreshes.set(id, refreshing);
    try { return await refreshing; }
    finally { if (this.refreshes.get(id) === refreshing) this.refreshes.delete(id); }
  }
}

module.exports = {
  PlayBilling,
  DEFAULT_PACKAGE_NAME,
  DEFAULT_PRODUCT_ID,
  subscriptionStatus,
};
