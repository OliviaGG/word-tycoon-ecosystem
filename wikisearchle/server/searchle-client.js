// WikiSearchle → Subtextle ranking client with caching, request coalescing,
// concurrency limiting, and retries. This reduces load on Searchle and lets
// WikiSearchle keep serving rounds even when Searchle is briefly slow.

const SEARCHLE_URL = process.env.SEARCHLE_URL || 'http://localhost:3015';
const API_SECRET = process.env.GAME_API_SECRET;
const TIMEOUT_MS = Number(process.env.SEARCHLE_TIMEOUT_MS || 8000);
const RETRIES = Number(process.env.SEARCHLE_RETRIES || 2);
const CONCURRENCY = Number(process.env.SEARCHLE_CONCURRENCY || 4);
const CACHE_SIZE = Number(process.env.SEARCHLE_RANK_CACHE_SIZE || 512);
const CACHE_TTL_MS = Number(process.env.SEARCHLE_RANK_CACHE_TTL_MS || 10 * 60 * 1000);
const LOCAL_FALLBACK = /^(1|true|yes)$/i.test(process.env.SEARCHLE_LOCAL_FALLBACK || '');
const LOCAL_RANKER_PATH = process.env.SEARCHLE_LOCAL_RANKER_PATH || '/opt/searchle/server/local-ranker.js';

class LRUMap extends Map {
  constructor(capacity) {
    super();
    this.capacity = Math.max(1, capacity | 0);
  }
  get(key) {
    if (!super.has(key)) return undefined;
    const value = super.get(key);
    super.delete(key);
    super.set(key, value);
    return value;
  }
  set(key, value) {
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    while (super.size > this.capacity) {
      const oldestKey = super.keys().next().value;
      super.delete(oldestKey);
    }
    return this;
  }
}

const rankCache = new LRUMap(CACHE_SIZE);
const rankCacheMeta = new Map(); // key -> { createdAt }
const inflight = new Map();
let activeRequests = 0;
const queue = [];
let localRanker = null;
let localRankerReady = null;

function isConnectionError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const code = err.code || err.cause?.code || err.cause?.cause?.code;
  return ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(code);
}

async function getLocalRanker() {
  if (!LOCAL_FALLBACK) return null;
  if (localRanker) return localRanker;
  if (localRankerReady) return localRankerReady;
  localRankerReady = (async () => {
    try {
      const mod = require(LOCAL_RANKER_PATH);
      await mod.ensureInit();
      localRanker = mod;
      console.log('[SearchleClient] Local ranker fallback initialized');
      return mod;
    } catch (e) {
      console.error('[SearchleClient] Local ranker fallback failed to initialize:', e.message);
      return null;
    }
  })();
  return localRankerReady;
}

async function fallbackRankBatch(target, words) {
  const lr = await getLocalRanker();
  if (!lr) throw new Error('Local ranker fallback not available');
  return lr.rankBatch(target, words);
}

function pruneExpiredCache() {
  const now = Date.now();
  for (const [key, meta] of rankCacheMeta) {
    if (now - meta.createdAt > CACHE_TTL_MS) {
      rankCache.delete(key);
      rankCacheMeta.delete(key);
    }
  }
}

function cacheKey(target, words) {
  // Normalise: lowercase target, sorted unique words. The API is commutative
  // over the words array for ranking, so sorting makes the key stable.
  const sorted = Array.from(new Set((words || []).map((w) => String(w).toLowerCase()))).sort();
  return `${String(target).toLowerCase()}|${sorted.join(',')}`;
}

function scheduleNext() {
  if (activeRequests >= CONCURRENCY || queue.length === 0) return;
  const next = queue.shift();
  activeRequests++;
  next().finally(() => {
    activeRequests--;
    scheduleNext();
  });
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    scheduleNext();
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function rankBatch(target, words, options = {}) {
  const key = cacheKey(target, words);
  pruneExpiredCache();

  const cached = rankCache.get(key);
  if (cached) return cached;

  if (inflight.has(key)) return inflight.get(key);

  const url = options.searchleUrl || SEARCHLE_URL;
  const secret = options.apiSecret || API_SECRET;
  const timeout = options.timeoutMs || TIMEOUT_MS;
  const retries = options.retries ?? RETRIES;

  const body = JSON.stringify({ target, words });

  const attempt = async (left) => {
    const res = await fetchWithTimeout(`${url}/api/rank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-api-key': secret } : {}),
      },
      body,
    }, timeout);

    const data = await res.json();
    if (!data || !data.ok) {
      const msg = (data && data.error) || `rank http ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  };

  const promise = enqueue(async () => {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await attempt(retries - i);
        rankCache.set(key, result);
        rankCacheMeta.set(key, { createdAt: Date.now() });
        return result;
      } catch (err) {
        lastErr = err;
        const retryable = !err.status || err.status >= 500 || err.status === 429 || err.name === 'AbortError' || isConnectionError(err);
        if (!retryable || i === retries) break;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    // If Searchle is unreachable, compute locally if configured.
    if (LOCAL_FALLBACK && isConnectionError(lastErr)) {
      try {
        const result = await fallbackRankBatch(target, words);
        rankCache.set(key, result);
        rankCacheMeta.set(key, { createdAt: Date.now() });
        console.warn('[SearchleClient] Used local ranker fallback for', target);
        return result;
      } catch (fbErr) {
        console.error('[SearchleClient] Local fallback also failed:', fbErr.message);
      }
    }
    throw lastErr;
  }).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

function getCacheStats() {
  pruneExpiredCache();
  return {
    size: rankCache.size,
    capacity: rankCache.capacity,
    ttlMs: CACHE_TTL_MS,
    concurrency: CONCURRENCY,
    activeRequests,
    queued: queue.length,
  };
}

module.exports = { rankBatch, getCacheStats };
