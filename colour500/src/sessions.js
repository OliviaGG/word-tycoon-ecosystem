'use strict';
// ─── Color 500 — private streamer sessions ────────────────────────────────
// One independent round per streamer, so a co-host's chat never touches the
// public board (or anyone else's). Mirrors the lifecycle the other ten
// session-capable games implement — see memory/project_private_sessions.md:
//
//   player page   https://color500.com/<handle>
//   OBS overlay   https://color500.com/overlay/<handle>
//   chat          messages stamped with streamerHandle route here
//   admin         /api/session/{end,redirect,clear-redirect}
//
// Sessions are lazily created for WHITELISTED handles only and persisted to
// data/sessions.json so a restart doesn't wipe a live stream's round.

const fs = require('fs');
const path = require('path');
const mm = require('./mastermind');

const MAX_BOARD_GUESSES = 200;

let _dataDir = null;
let _saveTimer = null;
let _recovery = null;
const MAX_SESSIONS = 499;

/** handle -> session */
const sessions = new Map();

function init(dataDir) {
  _dataDir = dataDir;
  load();
}

function statePath() {
  return path.join(_dataDir || '.', 'sessions.json');
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    for (const [handle, s] of Object.entries(raw || {})) {
      if (!isValidHandle(handle)) continue;
      if (!s || !s.gameState || !Array.isArray(s.gameState.code)) continue;
      sessions.set(handle, s);
    }
    console.log(`[Colour500] Sessions restored: ${sessions.size}`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function scheduleSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const out = Object.create(null);
      for (const [handle, s] of sessions) out[handle] = s;
      const tmp = statePath() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, statePath());
    } catch (err) {
      console.error('[Colour500] Session save failed:', err.message);
    }
  }, 2000);
  if (_saveTimer.unref) _saveTimer.unref();
}

function isValidHandle(handle) {
  return typeof handle === 'string' && /^[a-z0-9_-]{1,32}$/.test(handle);
}

function roomFor(handle) {
  return 'colour500:session:' + String(handle || '').toLowerCase();
}

function newRound(cfg) {
  return {
    code: mm.generateCode(cfg.codeLength, cfg.paletteSize, cfg.allowDuplicates),
    codeLength: cfg.codeLength,
    paletteSize: cfg.paletteSize,
    guesses: [],
    gameOver: false,
    winner: null,
  };
}

/**
 * Fetch a streamer's session, creating it on demand.
 * Callers MUST have already checked the handle against the whitelist.
 * @param {string} handle
 * @param {object} cfg the live game config — sessions follow the same board
 *                     shape as the public game
 */
function getOrCreate(handle, cfg) {
  const key = String(handle).toLowerCase();
  let s = sessions.get(key);
  if (!s) {
    if (!isValidHandle(key) || sessions.size >= MAX_SESSIONS) throw Error('Session capacity reached');
    s = {
      handle: key,
      gameState: newRound(cfg),
      gameStartTime: Date.now(),
      createdAt: Date.now(),
      noRewards: false,
    };
    const restored = _recovery?.restore(s);
    if (restored?.gameState) Object.assign(s, restored); else _recovery?.saveNew(s);
    Object.defineProperty(s, '_durableRestored', { value: true, configurable: true });
    sessions.set(key, s);
    scheduleSave();

  }
  if (_recovery && !s._durableRestored) {
    const restored = _recovery.restore(s);
    if (restored?.gameState === null) { sessions.delete(key); return getOrCreate(key, cfg); }
    if (restored) Object.assign(s, restored); else _recovery.saveNew(s);
    Object.defineProperty(s, '_durableRestored', { value: true, configurable: true });
  }
  return s;
}

function get(handle) {
  return sessions.get(String(handle || '').toLowerCase()) || null;
}

/** Start the next round inside an existing session. */
function startNextRound(session, cfg) {
  const next = { ...session, gameState: newRound(cfg), gameStartTime: Date.now() };
  _recovery?.saveNew(next);
  session.gameState = next.gameState; session.gameStartTime = next.gameStartTime;
  scheduleSave();
  return session;
}

/** Tear a session down — called when the streamer switches game or goes off. */
function end(handle) {
  const key = String(handle || '').toLowerCase();
  const current = sessions.get(key);
  if (current) _recovery?.end(current);
  const existed = sessions.delete(key);
  if (existed) {
    scheduleSave();
    console.log(`[Colour500] Session ended for "${key}"`);
  }
  return existed;
}

function all() {
  return Array.from(sessions.values());
}

/**
 * The session's public state. Same shape as the public game's so the player
 * page and overlay can share every renderer.
 */
function publicState(session, cfg, pot) {
  const g = session.gameState;
  return {
    gameId: 'colour500',
    isSession: true,
    streamerHandle: session.handle,
    codeLength: g.codeLength,
    paletteSize: g.paletteSize,
    palette: mm.getPalette(g.paletteSize),
    allowDuplicates: g.allowDuplicates ?? cfg.allowDuplicates,
    requireLetterPrefix: cfg.requireLetterPrefix,
    guesses: g.guesses,
    gameOver: g.gameOver,
    winner: g.winner,
    code: g.gameOver ? g.code : null,
    pot: pot,
    jackpotEnabled: cfg.jackpot.enabled,
    roundStartedAt: session.gameStartTime,
  };
}

function configureRecovery(hooks) {
  _recovery = hooks;
  if (sessions.size > MAX_SESSIONS) throw Error('Session capacity reached');
  for (const [handle, session] of sessions) {
    const saved = hooks.restore(session);
    if (saved?.gameState === null) { sessions.delete(handle); continue; }
    if (saved) Object.assign(session, saved); else hooks.saveNew(session);
    Object.defineProperty(session, '_durableRestored', { value: true, configurable: true });
  }
}

module.exports = {
  configureRecovery,
  MAX_BOARD_GUESSES,
  init,
  isValidHandle,
  roomFor,
  getOrCreate,
  get,
  startNextRound,
  end,
  all,
  publicState,
  scheduleSave,
  _sessions: sessions,
};
