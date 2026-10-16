// ===== Local Subtextle Ranker (fallback) =====
// Loads Searchle's own ranking-engine + embedding models and provides the
// same /api/rank, /api/rank/top, and /api/similarity logic without an HTTP
// round-trip. Designed to be imported by WikiSearchle, WiKirecTangled, and
// Chat Relay's Synapse as a fallback when the Searchle service is unreachable.
//
// Usage:
//   const localRanker = require('/opt/searchle/server/local-ranker.js');
//   const result = await localRanker.rankBatch('apple', ['fruit', 'car']);
//
// The module lazy-initializes on first call so processes that never need the
// fallback don't pay the ~1 GB model load cost.

const path = require('path');
const rankingEngine = require('./ranking-engine');
const { toSingular, toAmerican } = require('./guess-processor');
const config = require('./config');

let initialized = false;
let initPromise = null;
let initError = null;

function doInit() {
  if (initialized) return Promise.resolve();
  if (initError) return Promise.reject(initError);
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    try {
      const cfg = {
        ...config,
        modelsDir: path.resolve(__dirname, '..', config.modelsDir || 'data/models'),
      };
      if (cfg.gate) {
        cfg.gate = { ...cfg.gate };
        // Resolve gate paths relative to Searchle if they aren't absolute.
        ['frequencyPath', 'keepAlwaysCoveragePath', 'keepAlwaysTargetsPath', 'keepAlwaysBankDictPath']
          .forEach((k) => {
            if (cfg.gate[k] && !path.isAbsolute(cfg.gate[k])) {
              cfg.gate[k] = path.resolve(__dirname, '..', cfg.gate[k]);
            }
          });
      }
      rankingEngine.init(cfg);
      initialized = true;
      console.log('[LocalRanker] Models loaded, ready for fallback ranking');
      resolve();
    } catch (err) {
      initError = err;
      console.error('[LocalRanker] Init failed:', err.message);
      reject(err);
    }
  });

  return initPromise;
}

function ensureInit() {
  return doInit();
}

function isValidTarget(word) {
  if (!initialized) return false;
  return rankingEngine.isValidTarget(String(word || '').toLowerCase());
}

function resolveRank(rankings, key) {
  let rank = rankings.get(key);
  let canonical = key;
  if (typeof rank !== 'number') {
    const am = toAmerican(key);
    if (am !== key) {
      const r2 = rankings.get(am);
      if (typeof r2 === 'number') { rank = r2; canonical = am; }
    }
    if (typeof rank !== 'number') {
      const base = am !== key ? am : key;
      const sg = toSingular(base);
      if (sg !== key && sg !== am) {
        const r3 = rankings.get(sg);
        if (typeof r3 === 'number') { rank = r3; canonical = sg; }
      }
    }
  }
  return { rank, canonical };
}

async function rankBatch(target, words) {
  await ensureInit();
  const targetNorm = String(target || '').trim().toLowerCase();
  if (!targetNorm || !rankingEngine.isValidTarget(targetNorm)) {
    throw new Error('Invalid or unknown target');
  }
  const wordsIn = Array.isArray(words) ? words : [];
  const rankings = await rankingEngine.computeRankings(targetNorm, config);
  const totalRankedWords = rankings.size;
  const ranks = {};
  const canonicals = {};
  for (const w of wordsIn) {
    const key = String(w || '').trim().toLowerCase();
    if (!key) continue;
    const { rank, canonical } = resolveRank(rankings, key);
    if (typeof rank === 'number') {
      ranks[key] = rank;
      canonicals[key] = canonical;
    }
  }
  return { ok: true, target: targetNorm, totalRankedWords, ranks, canonicals };
}

async function rankTop(target, n = 500) {
  await ensureInit();
  const targetNorm = String(target || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(5000, Number(n) || 500));
  if (!targetNorm || !rankingEngine.isValidTarget(targetNorm)) {
    throw new Error('Invalid or unknown target');
  }
  const rankings = await rankingEngine.computeRankings(targetNorm, config);
  const totalRankedWords = rankings.size;
  const topRanked = [...rankings.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([word, rank]) => ({ word, rank }));
  return { ok: true, target: targetNorm, n: topRanked.length, totalRankedWords, topRanked };
}

function similarity(pairs) {
  if (!initialized) {
    // Synchronous path: lazy init must complete first. Callers should await
    // ensureInit() if they want true offline fallback.
    throw new Error('LocalRanker not initialized; call ensureInit() first');
  }
  const pairsIn = Array.isArray(pairs) ? pairs : [];
  const canonicalCache = new Map();
  const resolveWord = (raw) => {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) return null;
    if (canonicalCache.has(key)) return canonicalCache.get(key);
    let canonical = null;
    if (rankingEngine.hasVector(key)) {
      canonical = key;
    } else {
      const am = toAmerican(key);
      if (am !== key && rankingEngine.hasVector(am)) {
        canonical = am;
      } else {
        const sg = toSingular(am !== key ? am : key);
        if (sg !== key && rankingEngine.hasVector(sg)) canonical = sg;
      }
    }
    canonicalCache.set(key, canonical);
    return canonical;
  };

  const results = pairsIn.map((pair) => {
    const a = String((Array.isArray(pair) ? pair[0] : '') || '').trim().toLowerCase();
    const b = String((Array.isArray(pair) ? pair[1] : '') || '').trim().toLowerCase();
    const canonicalA = resolveWord(a);
    const canonicalB = resolveWord(b);
    if (!canonicalA || !canonicalB) {
      const unknown = [];
      if (!canonicalA) unknown.push(a);
      if (!canonicalB) unknown.push(b);
      return { a, b, score: null, unknown };
    }
    const sim = rankingEngine.pairwiseSimilarity(canonicalA, canonicalB);
    if (!sim) return { a, b, score: null, unknown: [] };
    return { a, b, canonicalA, canonicalB, score: sim.score, perModel: sim.perModel };
  });
  return { ok: true, results };
}

async function similarityAsync(pairs) {
  await ensureInit();
  return similarity(pairs);
}

module.exports = {
  ensureInit,
  isValidTarget,
  rankBatch,
  rankTop,
  similarity: similarityAsync,
};
