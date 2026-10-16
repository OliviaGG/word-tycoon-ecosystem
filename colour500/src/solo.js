'use strict';
// ─── Color 500 — solo mode ────────────────────────────────────────────────
// Two modes share this module:
//
//   daily     one code per calendar day, identical for every player, one
//             attempt each. Completing it pays the standard SP daily reward.
//   practice  unlimited random codes, no rewards.
//
// The secret is held HERE and never sent to the browser until the round is
// over — the multiplayer board can afford to be honest about nothing, but a
// solo daily that pays coins has to be cheat-proof.
//
// Board shape is fixed and deliberately independent of the multiplayer config
// (src/config.js): a streamer retuning the stream board mid-day must not
// reshape a daily puzzle that players have already started.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mm = require('./mastermind');
const { createPrivateStore } = require('./private-store');

const SOLO_CODE_LENGTH = 4;
const SOLO_PALETTE_SIZE = 6;
const SOLO_ALLOW_DUPLICATES = true;
const MAX_GUESSES = 10;              // the physical board game's row count

// Sessions are keyed by a client-generated token (localStorage). Losing it
// just means a fresh practice round; daily completion for a signed-in player
// is tracked by Chat Relay against their account, not this token.
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

const sessions = new Map(); // token -> { daily: game|null, practice: game|null, seen }

let _dataDir = null;
let store = null, sdk = null, completionEvent = null, retryTimer = null, cursor = 0;
let pending = Object.create(null);
const MAX_SESSIONS = 5000, MAX_PENDING = 10000;
const clone = value => JSON.parse(JSON.stringify(value));

/** @param {string} dataDir where solo-sessions.json lives */
function init(dataDir, options = {}) {
  _dataDir = dataDir; sessions.clear();
  store = createPrivateStore(path.join(dataDir, 'solo-actions'), options);
  const saved = store.read();
  let raw;
  if (saved) {
    if (saved.version !== 1 || !saved.sessions || !saved.pending || Array.isArray(saved.sessions) || Array.isArray(saved.pending)) throw Error('Invalid solo store');
    raw = saved.sessions; pending = saved.pending;
  } else {
    pending = Object.create(null);
    try { raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'solo-sessions.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; raw = {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > MAX_SESSIONS
      || Object.keys(pending).length > MAX_PENDING) throw Error('Solo store capacity reached');
  for (const [token, entry] of Object.entries(raw)) {
    if (!isValidToken(token) || !entry || !Number.isFinite(entry.seen)) throw Error('Invalid solo session');
    for (const mode of ['daily','practice']) {
      const game = entry[mode]; if (!game) continue;
      if (game.mode !== mode || !Array.isArray(game.code) || game.code.length !== SOLO_CODE_LENGTH
          || game.code.some(n => !Number.isInteger(n) || n < 0 || n >= SOLO_PALETTE_SIZE)
          || !Array.isArray(game.guesses) || game.guesses.length > MAX_GUESSES || !Number.isFinite(game.startedAt)
          || typeof game.gameOver !== 'boolean' || typeof game.won !== 'boolean'
          || mode === 'daily' && !/^\d{4}-\d{2}-\d{2}$/.test(game.date || '')) throw Error('Invalid solo game');
      for (const row of game.guesses) if (!Array.isArray(row.code) || row.code.length !== SOLO_CODE_LENGTH
          || row.code.some(n => !Number.isInteger(n) || n < 0 || n >= SOLO_PALETTE_SIZE)) throw Error('Invalid solo row');
      if (game.owner !== undefined && (typeof game.owner !== 'string' || !game.owner || game.owner.length > 128)) throw Error('Invalid solo owner');
    }
    sessions.set(token, entry);
  }
  for (const [id, record] of Object.entries(pending)) if (!/^sp-daily:[a-f0-9]{64}$/.test(id)
      || record.payload?.eventId !== id || record.payload.game !== 'colour500' || record.payload.event !== 'daily-win'
      || record.payload.coins !== 1 || record.payload.platform !== 'discord' || typeof record.payload.userId !== 'string'
      || !record.payload.userId || record.payload.userId.length > 128 || !/^\d{4}-\d{2}-\d{2}$/.test(record.payload.rewardPeriod || '')
      || !Number.isFinite(record.createdAt)) throw Error('Invalid solo completion intention');
  prune(); if (!saved) save();
}
function snapshot() { return { version: 1, sessions: Object.fromEntries(sessions), pending }; }
function save() { if (!store) return; store.write(snapshot()); }
function prune() {
  const now = Date.now();
  for (const [token, entry] of sessions) if (now - entry.seen > SESSION_TTL_MS) sessions.delete(token);
}
function configureRewards(shared, stableCompletionEvent) {
  sdk = shared; completionEvent = stableCompletionEvent;
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(() => { try { recoverRewards(); } catch (_) {} }, 1000); retryTimer.unref?.();
  recoverRewards();
}
function recoverRewards(limit = 64) {
  if (!sdk) return 0;
  const entries = Object.entries(pending); if (!entries.length) return 0;
  const selected = Array.from({ length: Math.min(limit, entries.length) }, (_, i) => entries[(cursor + i) % entries.length]);
  cursor = (cursor + selected.length) % entries.length;
  let handedOff = 0;
  for (const [id, record] of selected) {
    try {
      const p = record.payload;
      const reserved = sdk.reservePlayerReward(p.platform, p.userId, p.username, p.displayName, p.coins, p.game, p.event, p);
      if (reserved?.payload?.eventId !== id) throw Error('Completion outbox unavailable');
      delete pending[id];
      try { save(); } catch (error) { pending[id] = record; throw error; }
      handedOff++; Promise.resolve(sdk.deliverPlayerReward(id)).catch(() => {});
    } catch (_) { /* Independent intentions continue; the durable record remains. */ }
  }
  return handedOff;
}
function stop() { if (retryTimer) clearInterval(retryTimer); retryTimer = null; }

// ─── Codes ────────────────────────────────────────────────────────────────

/**
 * The daily code, derived deterministically from the date so every player
 * worldwide gets the same puzzle without storing anything.
 * @param {string} dateStr YYYY-MM-DD (Edmonton, matching the rest of the stack)
 * @returns {number[]}
 */
function dailyCode(dateStr) {
  const h = crypto.createHash('sha256').update('colour500-daily:' + dateStr).digest();
  const code = [];
  for (let i = 0; i < SOLO_CODE_LENGTH; i++) {
    // 4 bytes per slot — modulo bias here is ~6/2^32, i.e. irrelevant.
    code.push(h.readUInt32BE(i * 4) % SOLO_PALETTE_SIZE);
  }
  return code;
}

function newGame(mode, dateStr) {
  return {
    mode,
    date: mode === 'daily' ? dateStr : null,
    code: mode === 'daily'
      ? dailyCode(dateStr)
      : mm.generateCode(SOLO_CODE_LENGTH, SOLO_PALETTE_SIZE, SOLO_ALLOW_DUPLICATES),
    guesses: [],
    gameOver: false,
    won: false,
    startedAt: Date.now(),
    rewarded: false,
  };
}

// ─── Sessions ─────────────────────────────────────────────────────────────

// `__proto__` and friends match the character class but must never be used as
// keys: the on-disk snapshot is a plain object, where assigning `__proto__`
// sets the prototype instead of adding a property. Chat Relay guards its own
// SP game-id whitelist the same way.
const RESERVED_TOKENS = new Set(['__proto__', 'constructor', 'prototype']);

function isValidToken(token) {
  return typeof token === 'string'
    && TOKEN_RE.test(token)
    && !RESERVED_TOKENS.has(token);
}

function entryFor(token) {
  if (!isValidToken(token)) throw Error('Invalid solo token');
  let entry = sessions.get(token);
  if (!entry) {
    prune(); if (sessions.size >= MAX_SESSIONS) throw Error('Solo session capacity reached');
    entry = { daily: null, practice: null, seen: Date.now() };
    sessions.set(token, entry);
  }
  entry.seen = Date.now();
  return entry;
}

/**
 * Fetch (creating if needed) the player's game for a mode.
 * A daily from a previous date is replaced by today's.
 */
function getGame(token, mode, dateStr, owner = null) {
  if (owner && mode === 'daily') {
    for (const entry of sessions.values()) if (entry.daily?.owner === owner && entry.daily.date === dateStr) {
      entry.seen = Date.now(); return entry.daily;
    }
  }
  const existed = sessions.has(token), entry = entryFor(token), prior = entry[mode];
  if (mode !== 'daily' && mode !== 'practice') throw Error('Invalid solo mode');
  if (!prior || mode === 'daily' && prior.date !== dateStr) {
    entry[mode] = newGame(mode, dateStr);
    try { save(); } catch (error) { entry[mode] = prior; if (!existed) sessions.delete(token); throw error; }
  }
  return entry[mode];
}
function newPractice(token, dateStr) {
  const existed = sessions.has(token), entry = entryFor(token), prior = entry.practice;
  entry.practice = newGame('practice', dateStr);
  try { save(); } catch (error) { entry.practice = prior; if (!existed) sessions.delete(token); throw error; }
  return entry.practice;
}

// ─── Play ─────────────────────────────────────────────────────────────────

/**
 * Score a guess.
 * @returns {{ok:true, game, row, justWon:boolean}|{ok:false, reason:string}}
 */
function submitGuess(game, text, userId = null) {
  if (typeof text !== 'string' || text.length > 96) return { ok: false, reason: 'invalid-guess' };
  if (game.owner && userId !== game.owner) return { ok: false, reason: 'account-changed' };
  if (userId !== null && (typeof userId !== 'string' || !userId || userId.length > 128)) return { ok: false, reason: 'invalid-account' };
  if (game.gameOver) return { ok: false, reason: 'round-over' };

  const parsed = mm.parseGuess(text, {
    codeLength: SOLO_CODE_LENGTH,
    paletteSize: SOLO_PALETTE_SIZE,
    // Solo input comes from the on-screen palette, so a bare letter code is
    // always intentional here — no chat to collide with.
    requireLetterPrefix: false,
  });
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  if (game.guesses.some(g => mm.codeKey(g.code) === mm.codeKey(parsed.code))) {
    return { ok: false, reason: 'duplicate' };
  }

  const { exact, misplaced } = mm.scoreGuess(parsed.code, game.code);
  const row = {
    code: parsed.code,
    exact,
    misplaced,
    absent: SOLO_CODE_LENGTH - exact - misplaced,
  };
  const before = clone(game);
  if (userId) game.owner = userId;
  game.guesses.push(row);

  let justWon = false;
  if (exact === SOLO_CODE_LENGTH) {
    game.gameOver = true;
    game.won = true;
    justWon = true;
  } else if (game.guesses.length >= MAX_GUESSES) {
    game.gameOver = true;
    game.won = false;
  }

  let intentionId, priorIntention;
  try {
    if (justWon && game.mode === 'daily' && game.owner && sdk && completionEvent) {
      intentionId = completionEvent('daily', 'colour500-sp', game.owner, game.date);
      const payload = { platform: 'discord', userId: game.owner, username: game.owner, displayName: game.owner,
        coins: 1, game: 'colour500', event: 'daily-win', eventId: intentionId, rewardPeriod: game.date };
      if (Object.keys(pending).length >= MAX_PENDING && !pending[intentionId]) throw Error('Completion capacity reached');
      if (pending[intentionId] && JSON.stringify(pending[intentionId].payload) !== JSON.stringify(payload)) throw Error('Completion intention changed');
      priorIntention = pending[intentionId];
      pending[intentionId] ||= { createdAt: Date.now(), payload };
      game.rewardEventId = intentionId;
    }
    save();
  } catch (error) {
    if (intentionId) { if (priorIntention) pending[intentionId] = priorIntention; else delete pending[intentionId]; }
    for (const key of Object.keys(game)) delete game[key]; Object.assign(game, before); throw error;
  }
  recoverRewards();
  return { ok: true, game, row, justWon };
}

/** What the browser is allowed to see. Hides the code until the round ends. */
function publicState(game) {
  return {
    mode: game.mode,
    date: game.date,
    codeLength: SOLO_CODE_LENGTH,
    paletteSize: SOLO_PALETTE_SIZE,
    palette: mm.getPalette(SOLO_PALETTE_SIZE),
    maxGuesses: MAX_GUESSES,
    guessesUsed: game.guesses.length,
    guessesLeft: Math.max(0, MAX_GUESSES - game.guesses.length),
    guesses: game.guesses,
    gameOver: game.gameOver,
    won: game.won,
    code: game.gameOver ? game.code : null,
  };
}

module.exports = {
  SOLO_CODE_LENGTH,
  SOLO_PALETTE_SIZE,
  MAX_GUESSES,
  init,
  configureRewards, recoverRewards, stop,
  isValidToken,
  getGame,
  newPractice,
  submitGuess,
  publicState,
  dailyCode,
  _sessions: sessions,
};
