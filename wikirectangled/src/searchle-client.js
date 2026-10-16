// searchle-client.js - Thin HTTP client for the Searchle companion-rank API.
//
// WikiSearchle consumes this same endpoint. We send a target word + a batch of
// guessed words; Searchle returns integer ranks (1 = closest) plus canonical
// (singular / American) forms so we can collapse morphological variants.
//
// rankTop(target, n) is the dual-purpose endpoint added for the per-round
// semantic trie — instead of asking "rank these given words", it asks
// "give me the N closest words to this target". Used by semantic-trie.js
// to build the topic word pool from the title rather than the article body.

const SEARCHLE_URL = process.env.SEARCHLE_URL || 'http://localhost:3015';
const API_SECRET = process.env.GAME_API_SECRET || '';
const LOCAL_FALLBACK = /^(1|true|yes)$/i.test(process.env.SEARCHLE_LOCAL_FALLBACK || '');
const LOCAL_RANKER_PATH = process.env.SEARCHLE_LOCAL_RANKER_PATH || '/opt/searchle/server/local-ranker.js';

const FALLBACK_TOTAL_RANKED = 200000;

// Concurrency limit for Searchle calls. rankBatch/rankTop are called in
// parallel during round build (title-word validation, rankTarget probes) and
// can spike to dozens of requests. Searchle is in-memory and fast, but a cold
// cache + burst can still overwhelm it and cause AbortController timeouts.
function envInt(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback; // allows explicit 0
}

// Two independent lanes so live guess ranking never queues behind background
// work (round preloads fire dozens of title/target probes + rankTop calls at
// once). Previously everything shared one 4-slot queue and a slow Searchle
// could hold a player's guess for ~16s (5s timeout x 3 attempts + backoff).
const MAX_CONCURRENT_SEARCHLE = envInt('WIKIREC_SEARCHLE_CONCURRENCY', 4);           // background lane
const MAX_CONCURRENT_GUESS = envInt('WIKIREC_SEARCHLE_GUESS_CONCURRENCY', 8);         // guess lane
const SEARCHLE_RETRIES = envInt('WIKIREC_SEARCHLE_RETRIES', 2);                       // background
const GUESS_RETRIES = envInt('WIKIREC_SEARCHLE_GUESS_RETRIES', 0);                    // guesses: fail fast
const GUESS_TIMEOUT_MS = envInt('WIKIREC_SEARCHLE_GUESS_TIMEOUT_MS', 2500);
const lanes = {
  background: { active: 0, queue: [], max: Math.max(1, MAX_CONCURRENT_SEARCHLE) },
  guess: { active: 0, queue: [], max: Math.max(1, MAX_CONCURRENT_GUESS) },
};
const inflight = new Map();
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
  const result = await lr.rankBatch(target, words);
  return {
    target: result.target,
    totalRankedWords: result.totalRankedWords,
    ranks: result.ranks,
    canonicals: result.canonicals,
  };
}

async function fallbackRankTop(target, n) {
  const lr = await getLocalRanker();
  if (!lr) throw new Error('Local ranker fallback not available');
  const result = await lr.rankTop(target, n);
  return {
    target: result.target,
    n: result.n,
    totalRankedWords: result.totalRankedWords,
    topRanked: result.topRanked,
  };
}

function withSearchleConcurrency(fn, laneName = 'background') {
  const lane = lanes[laneName] || lanes.background;
  return new Promise((resolve, reject) => {
    lane.queue.push({ fn, resolve, reject });
    processSearchleQueue(lane);
  });
}
function processSearchleQueue(lane) {
  while (lane.active < lane.max && lane.queue.length > 0) {
    const { fn, resolve, reject } = lane.queue.shift();
    lane.active++;
    Promise.resolve()
      .then(() => fn())
      .then(resolve, reject)
      .finally(() => {
        lane.active--;
        processSearchleQueue(lane);
      });
  }
}

async function fetchWithRetries(url, options, timeoutMs, retries = SEARCHLE_RETRIES) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: ctl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const retryable = err.name === 'AbortError' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT';
      if (!retryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// In-memory LRU cache for Searchle rank calls. These are expensive network
// round-trips and the same target+word pairs are guessed repeatedly across
// players in a round. Caching here removes the network hot spot.
const CACHE_MAX = 2000;
const rankCache = new Map(); // key -> { value, expiresAt }
function cacheKey(prefix, target, extra) {
  return `${prefix}:${target.toLowerCase()}:${extra}`;
}
function getCached(key) {
  const entry = rankCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    rankCache.delete(key);
    return undefined;
  }
  return entry.value;
}
function setCached(key, value, ttlMs) {
  if (rankCache.size >= CACHE_MAX) {
    const first = rankCache.keys().next().value;
    rankCache.delete(first);
  }
  rankCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function rankBatch(target, words) {
  const normalizedTarget = String(target || '').toLowerCase();
  const normalizedWords = Array.isArray(words) ? words.map((w) => String(w || '').toLowerCase()) : [];
  const key = cacheKey('batch', normalizedTarget, normalizedWords.slice().sort().join('\x00'));
  const cached = getCached(key);
  if (cached) return cached;
  if (inflight.has(key)) return inflight.get(key);

  // Calls that rank actual guessed words are player-facing; empty-word probes
  // (title/target validity checks during round building) are background.
  const isGuess = normalizedWords.length > 0;

  const promise = withSearchleConcurrency(async () => {
    try {
      const res = await fetchWithRetries(`${SEARCHLE_URL}/api/rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_SECRET },
        body: JSON.stringify({ target: normalizedTarget, words: normalizedWords }),
      }, isGuess ? GUESS_TIMEOUT_MS : 5000, isGuess ? GUESS_RETRIES : SEARCHLE_RETRIES);
      const data = await res.json();
      if (!data || !data.ok) {
        throw new Error((data && data.error) || `rank http ${res.status}`);
      }
      const result = {
        target: data.target,
        totalRankedWords: data.totalRankedWords || FALLBACK_TOTAL_RANKED,
        ranks: data.ranks || {},
        canonicals: data.canonicals || {},
      };
      setCached(key, result, 60000); // 1 minute for guess ranks
      return result;
    } catch (err) {
      if (LOCAL_FALLBACK && isConnectionError(err)) {
        const result = await fallbackRankBatch(normalizedTarget, normalizedWords);
        setCached(key, result, 60000);
        console.warn('[SearchleClient] Used local ranker fallback for batch', normalizedTarget);
        return result;
      }
      throw err;
    }
  }, isGuess ? 'guess' : 'background').finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

async function rankTop(target, n = 500) {
  const normalizedTarget = String(target || '').toLowerCase();
  const key = cacheKey('top', normalizedTarget, String(n));
  const cached = getCached(key);
  if (cached) return cached;
  if (inflight.has(key)) return inflight.get(key);

  const promise = withSearchleConcurrency(async () => {
    try {
      // 8s timeout — sorting a 200K-entry ranking map is fast but per-target
      // first-hit can be slower than rankBatch since rankBatch's caller-provided
      // word list is usually small. Cache hits return in <5ms regardless.
      const res = await fetchWithRetries(`${SEARCHLE_URL}/api/rank/top`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_SECRET },
        body: JSON.stringify({ target: normalizedTarget, n }),
      }, 8000);
      const data = await res.json();
      if (!data || !data.ok) {
        throw new Error((data && data.error) || `rank/top http ${res.status}`);
      }
      const result = {
        target: data.target,
        n: data.n,
        totalRankedWords: data.totalRankedWords || FALLBACK_TOTAL_RANKED,
        topRanked: Array.isArray(data.topRanked) ? data.topRanked : [],
      };
      setCached(key, result, 300000); // 5 minutes for topic pools
      return result;
    } catch (err) {
      if (LOCAL_FALLBACK && isConnectionError(err)) {
        const result = await fallbackRankTop(normalizedTarget, n);
        setCached(key, result, 300000);
        console.warn('[SearchleClient] Used local ranker fallback for top', normalizedTarget);
        return result;
      }
      throw err;
    }
  }).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

module.exports = { rankBatch, rankTop, FALLBACK_TOTAL_RANKED };
