/**
 * Centralized ELO + Cheater Detection Service
 *
 * All games report round results here. Word Tycoon computes per-game ELO,
 * global ELO, and suspicion scores. Exposes leaderboards and admin panels.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../paths');
const { canonicalGameId } = require('../game-ids');

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

const ELO_PATH = path.join(DATA_DIR, 'elo-ratings.json');
const SUSPICION_PATH = path.join(DATA_DIR, 'suspicion-scores.json');

let eloData = { games: {}, global: {} };
let suspicionData = {};

function load() {
  try {
    const raw = fs.readFileSync(ELO_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') eloData = obj;
  } catch (e) { if (e.code !== 'ENOENT') console.log(`[ELO] load failed: ${e.message}`); }
  try {
    const raw = fs.readFileSync(SUSPICION_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') suspicionData = obj;
  } catch (e) { if (e.code !== 'ENOENT') console.log(`[ELO] suspicion load failed: ${e.message}`); }
}
function saveElo() {
  try {
    const tmp = ELO_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(eloData));
    fs.renameSync(tmp, ELO_PATH);
  } catch (e) { console.log(`[ELO] save failed: ${e.message}`); }
}
function saveSuspicion() {
  try {
    const tmp = SUSPICION_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(suspicionData));
    fs.renameSync(tmp, SUSPICION_PATH);
  } catch (e) { console.log(`[ELO] suspicion save failed: ${e.message}`); }
}

load();
function resolveStorageKey(identityKey, db) {
  if (!identityKey || typeof identityKey !== 'string') return identityKey;
  // Already a discord: key — it IS the canonical group key
  if (identityKey.startsWith('discord:')) return identityKey;

  const colonIdx = identityKey.indexOf(':');
  if (colonIdx < 0) return identityKey;
  const platform = identityKey.slice(0, colonIdx);
  const platformUserId = identityKey.slice(colonIdx + 1);

  // Snowflake heuristic: every login in this app is Discord, so a 'web' user
  // with a 17–20-digit numeric platformUserId IS a Discord user even when the
  // linked_accounts row was never written. Mirrors the same check chat-relay's
  // getWinnerIdentityKey and database.js getOrCreatePlayer use, so all three
  // sites agree on the canonical storage key.
  if (platform === 'web' && /^\d{17,20}$/.test(platformUserId)) {
    return 'discord:' + platformUserId;
  }

  try {
    const row = db.queryOne(
      'SELECT discord_user_id FROM linked_accounts WHERE platform = ? AND platform_user_id = ? LIMIT 1',
      [platform, platformUserId]
    );
    if (row && row.discord_user_id) {
      return "discord:" + row.discord_user_id;
    }
  } catch (e) {
    // DB not available or query failed — fall through to identity key
  }
  return identityKey;
}


const MULTIPLAYER_GAMES = ['subtextle', 'rectangled', 'erectangled', 'wikicontexto'];

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeSuspicion(window) {
  if (!window || window.length < 50) return { score: 0, flags: [] };
  const w = window.slice(-50);
  let score = 0;
  const flags = [];

  const totalGuesses = w.reduce((s, r) => s + (r.guesses || 0), 0);
  const totalHits = w.reduce((s, r) => s + (r.hits || 0), 0);
  const totalWins = w.filter((r) => r.wonRound).length;
  const totalTargets = w.filter((r) => r.foundTarget).length;
  const totalPoints = w.reduce((s, r) => s + (r.points || 0), 0);
  const totalTargetBonuses = w.filter((r) => r.foundTarget).length * 50000;
  const sumInverseN = w.reduce((s, r) => s + (1 / Math.max(1, r.rankOutOf || 1)), 0);
  const validLatencies = w.map((r) => r.firstHitMs).filter((v) => typeof v === 'number' && v > 0);

  if (totalGuesses > 0 && totalHits / totalGuesses > 0.40) { score += 30; flags.push('guess-accuracy'); }
  if (sumInverseN > 0 && totalWins / sumInverseN > 2.5) { score += 25; flags.push('win-rate'); }
  if (validLatencies.length >= 20) {
    const med = median(validLatencies);
    if (med !== null && med < 3000) { score += 25; flags.push('first-hit-latency'); }
  }
  if (sumInverseN > 0 && totalTargets / sumInverseN > 2.5) { score += 15; flags.push('target-find-rate'); }
  const wordPoints = totalPoints - totalTargetBonuses;
  if (totalGuesses > 0 && wordPoints / totalGuesses > 2500) { score += 5; flags.push('points-per-guess'); }

  return { score, flags };
}

function updateElo(game, participants, db) {
  game = canonicalGameId(game) || game;
  const N = participants.length;
  if (N < 2) return;

  // Resolve identity keys to canonical group keys (discord: or solo identity)
  const keyMap = new Map(); // original identityKey -> storageKey
  for (const p of participants) {
    keyMap.set(p.identityKey, resolveStorageKey(p.identityKey, db));
  }

  if (!eloData.games[game]) eloData.games[game] = {};
  const gameElo = eloData.games[game];

  const effectiveEntries = participants.map((p, idx) => {
    const storageKey = keyMap.get(p.identityKey) || p.identityKey;
    const existing = gameElo[storageKey] || { elo: 1200, roundsCounted: 0, history: [] };
    return { ...p, idx, storageKey, elo: existing.elo, roundsCounted: existing.roundsCounted, existing };
  });
  const M = effectiveEntries.length;

  // Pairwise deltas
  const deltas = new Map();
  for (let i = 0; i < effectiveEntries.length; i++) {
    const A = effectiveEntries[i];
    let totalDelta = 0;
    for (let j = 0; j < effectiveEntries.length; j++) {
      if (i === j) continue;
      const B = effectiveEntries[j];
      if (A.points === B.points) continue; // tie
      const actual = A.points > B.points ? 1 : 0;
      const expected = 1 / (1 + Math.pow(10, (B.elo - A.elo) / 400));
      let K;
      if (A.roundsCounted < 10) K = 40;
      else if (A.roundsCounted < 30) K = 32;
      else if (A.roundsCounted < 100) K = 24;
      else K = 16;
      totalDelta += (K / (M - 1)) * (actual - expected);
    }
    deltas.set(A.storageKey, totalDelta);
  }

  const now = Date.now();
  for (const p of effectiveEntries) {
    const delta = Math.round(deltas.get(p.storageKey) || 0);
    const oldElo = p.elo;
    const newElo = Math.max(100, oldElo + delta);
    p.existing.elo = newElo;
    p.existing.roundsCounted = (p.existing.roundsCounted || 0) + 1;
    p.existing.history.unshift({ at: now, delta, newElo, articleTitle: p.articleTitle || '?' });
    if (p.existing.history.length > 20) p.existing.history.length = 20;
    // Store displayName for leaderboard readability
    if (p.displayName && !p.existing.displayName) {
      p.existing.displayName = p.displayName;
    }
    gameElo[p.storageKey] = p.existing;
  }

  // Update global ELO = weighted average across MULTIPLAYER games only
  for (const p of effectiveEntries) {
    let totalWeightedElo = 0;
    let totalRounds = 0;
    for (const gName of MULTIPLAYER_GAMES) {
      const gameMap = eloData.games[gName];
      if (!gameMap) continue;
      const entry = gameMap[p.storageKey];
      if (entry && entry.roundsCounted > 0) {
        totalWeightedElo += entry.elo * entry.roundsCounted;
        totalRounds += entry.roundsCounted;
      }
    }
    if (totalRounds > 0) {
      // Global ELO must use the same canonical key as per-game writes.
      // Using p.identityKey here would store a linked user's global ELO
      // under their raw platform key, separating it from the per-game
      // entries written under the discord: storage key.
      eloData.global[p.storageKey] = {
        elo: Math.round(totalWeightedElo / totalRounds),
        gamesParticipated: MULTIPLAYER_GAMES.filter(g => eloData.games[g] && eloData.games[g][p.storageKey]).length,
        totalRounds,
      };
    }
  }

  saveElo();
}

function updateSuspicion(game, participants, db) {
  game = canonicalGameId(game) || game;
  const now = Date.now();
  for (const p of participants) {
    // Canonicalize before write so a linked user's suspicion data lands in
    // one bucket regardless of which platform their game session reported
    // (was reading raw identityKey, which split history per platform).
    const key = resolveStorageKey(p.identityKey, db);
    if (!suspicionData[key]) suspicionData[key] = { byGame: {}, global: { score: 0, flags: [] } };
    if (!suspicionData[key].byGame[game]) suspicionData[key].byGame[game] = { score: 0, flags: [], window: [] };

    const entry = suspicionData[key].byGame[game];
    entry.window.unshift({
      at: now,
      points: p.points,
      rank: p.rank,
      rankOutOf: p.rankOutOf,
      guesses: p.guesses,
      hits: p.hits,
      firstHitMs: p.firstHitMs,
      wonRound: p.wonRound,
      foundTarget: p.foundTarget,
    });
    if (entry.window.length > 50) entry.window.length = 50;

    const { score, flags } = computeSuspicion(entry.window);
    entry.score = score;
    entry.flags = flags;
    entry.flagged = score >= 75 ? 'high-risk' : score >= 50 ? 'suspicious' : null;

    // Global suspicion = highest score across any game
    let maxScore = 0;
    let maxFlags = [];
    let maxFlagged = null;
    for (const g of Object.values(suspicionData[key].byGame)) {
      if (g.score > maxScore) {
        maxScore = g.score;
        maxFlags = g.flags;
        maxFlagged = g.flagged;
      }
    }
    suspicionData[key].global = { score: maxScore, flags: maxFlags, flagged: maxFlagged };
  }
  saveSuspicion();
}

function registerEloRoutes(app, { requireApiKey, db }) {

  // Games report round results
  app.post('/api/elo/update', requireApiKey, (req, res) => {
    const { game, participants } = req.body;
    if (!game || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ ok: false, message: 'Missing game or participants' });
    }
    const canonicalGame = canonicalGameId(game) || game;
    // Solo games do not participate in ELO
    if (!MULTIPLAYER_GAMES.includes(canonicalGame)) {
      return res.json({ ok: true, skipped: true, reason: 'solo game' });
    }
    try {
      // db must be passed so resolveStorageKey() can consult linked_accounts;
      // without it, every key resolution silently falls through to the raw
      // identityKey (the caller-side guard catches the TypeError) and the
      // entire linked-account canonicalization is dead code.
      updateElo(canonicalGame, participants, db);
      updateSuspicion(canonicalGame, participants, db);
      res.json({ ok: true, updated: participants.length });
    } catch (e) {
      console.log(`[ELO] update failed: ${e.message}`);
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // Public per-game leaderboard
  app.get('/api/elo/:game/leaderboard', (req, res) => {
    const game = canonicalGameId(req.params.game) || req.params.game;
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const sort = req.query.sort || 'elo';
    const gameMap = eloData.games[game] || {};
    const entries = Object.entries(gameMap)
      .filter(([, e]) => (e.roundsCounted || 0) >= 5)
      .map(([identityKey, e]) => ({
        identityKey,
        elo: e.elo,
        roundsCounted: e.roundsCounted,
        displayName: e.displayName,
      }));

    if (sort === 'rounds') entries.sort((a, b) => b.roundsCounted - a.roundsCounted);
    else entries.sort((a, b) => b.elo - a.elo);

    const players = entries.slice(0, limit).map((e, i) => ({ rank: i + 1, ...e, displayName: e.displayName || e.identityKey }));
    res.json({ game, count: players.length, players });
  });

  // Public global leaderboard
  app.get('/api/elo/global/leaderboard', (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const entries = Object.entries(eloData.global)
      .filter(([, e]) => (e.totalRounds || 0) >= 5)
      .map(([identityKey, e]) => ({
        identityKey,
        elo: e.elo,
        gamesParticipated: e.gamesParticipated,
        totalRounds: e.totalRounds,
      }))
      .sort((a, b) => b.elo - a.elo);

    const players = entries.slice(0, limit).map((e, i) => ({ rank: i + 1, ...e }));
    res.json({ count: players.length, players });
  });

  // Admin cheater panel
  app.get('/api/elo/cheaters', requireApiKey, (req, res) => {
    const minScore = Math.max(0, parseInt(req.query.minScore || '50', 10));
    const game = req.query.game || null;
    const entries = [];
    for (const [identityKey, data] of Object.entries(suspicionData)) {
      const global = data.global || {};
      if ((global.score || 0) >= minScore) {
        const byGame = {};
        for (const [g, s] of Object.entries(data.byGame || {})) {
          byGame[g] = { score: s.score, flagged: s.flagged, flags: s.flags };
        }
        entries.push({ identityKey, globalScore: global.score, globalFlagged: global.flagged, globalFlags: global.flags, byGame });
      }
    }
    if (game) {
      entries.sort((a, b) => (b.byGame[game]?.score || 0) - (a.byGame[game]?.score || 0));
    } else {
      entries.sort((a, b) => b.globalScore - a.globalScore);
    }
    res.json({ count: entries.length, cheaters: entries });
  });

  // Admin player profile
  app.get('/api/elo/player/:identityKey', requireApiKey, (req, res) => {
    const key = req.params.identityKey;
    const gameElos = {};
    for (const [g, map] of Object.entries(eloData.games)) {
      if (map[key]) gameElos[g] = map[key];
    }
    const global = eloData.global[key] || null;
    const suspicion = suspicionData[key] || null;
    res.json({ identityKey: key, gameElos, global, suspicion });
  });
}

module.exports = { registerEloRoutes, eloData, suspicionData };
