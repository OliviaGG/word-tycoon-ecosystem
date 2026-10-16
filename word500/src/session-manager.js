// ===== Session Manager (Word500) =====
// Per-streamer private Wordle-style rounds. Each session has its own word,
// guesses, letterStates, winner, and gameStartTime. Independent of public
// game (no daily, no jackpot.dailyEnabled gating, no played-words pool).
// Persisted to data/sessions.json (debounced 2s) so PM2 restarts don't
// wipe an in-progress session.

const fs = require('fs');
const path = require('path');

const sessions = new Map(); // handle (lowercase) -> sessionState
const _creating = new Map();

const IDLE_TTL_MS = 4 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

// ─── Persistence ────────────────────────────────────────────────────────────
const SAVE_PATH = path.join(process.env.WORD500_DATA_DIR || path.join(__dirname, '..', 'data'), 'sessions.json');
let _recovery = null;
const MAX_SESSIONS = 499;
const SAVE_TMP_PATH = SAVE_PATH + '.tmp';
const SAVE_DEBOUNCE_MS = 2000;
let _saveTimer = null;
let _saving = false;

function _replacer(key, value) {
  if (key === 'autoRestartTimer') return undefined;
  if (value instanceof Map) return { __type: 'Map', value: [...value.entries()] };
  if (value instanceof Set) return { __type: 'Set', value: [...value] };
  return value;
}
function _reviver(_key, value) {
  if (value && typeof value === 'object') {
    if (value.__type === 'Map') return new Map(value.value);
    if (value.__type === 'Set') return new Set(value.value);
  }
  return value;
}

function _loadSessions() {
  try {
    if (!fs.existsSync(SAVE_PATH)) return;
    const data = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'), _reviver);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > MAX_SESSIONS) throw Error('Invalid private session store');
    for (const [key, obj] of Object.entries(data)) {
      if (!/^[a-z0-9_-]{1,32}$/.test(key) || !obj || obj.handle !== key || !obj.gameState
          || !/^[A-Z]{4,8}$/.test(obj.gameState.word || '') || !Array.isArray(obj.gameState.guesses)
          || obj.gameState.guesses.length > 200 || !Number.isFinite(obj.gameStartTime)) throw Error('Invalid private session');
      obj.autoRestartTimer = null; sessions.set(key, obj);
    }
    if (sessions.size) console.log(`[Session] Loaded ${sessions.size} session(s) from disk`);
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
}
function configureRecovery(hooks) {
  _recovery = hooks;
  for (const [key, session] of sessions) {
    const saved = hooks.restore(session);
    if (saved?.ended) { sessions.delete(key); continue; }
    if (saved) Object.assign(session, saved);
    else hooks.saveNew(session);
    Object.defineProperty(session, '_durableRestored', { value: true, configurable: true });
  }
}

function _doSaveAsync() {
  if (_saving) return;
  _saving = true;
  const data = {};
  for (const [key, s] of sessions) data[key] = s;
  let json;
  try { json = JSON.stringify(data, _replacer); }
  catch (err) {
    console.error('[Session] serialize failed:', err.message);
    _saving = false;
    return;
  }
  fs.writeFile(SAVE_TMP_PATH, json, (err) => {
    if (err) { console.error('[Session] save tmp failed:', err.message); _saving = false; return; }
    fs.rename(SAVE_TMP_PATH, SAVE_PATH, (err2) => {
      if (err2) console.error('[Session] save rename failed:', err2.message);
      _saving = false;
    });
  });
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; _doSaveAsync(); }, SAVE_DEBOUNCE_MS);
}

_loadSessions();

function _newSession(handle, sessionId) {
  return {
    handle,
    sessionId: sessionId || null,
    gameState: null,        // { word, guesses, gameOver, winner, letterStates, wordLength }
    gameStartTime: 0,
    lastActivityAt: Date.now(),
    isComplete: false,
    autoRestartTimer: null,
  };
}

function _initSessionGame(s, words, settings = {}) {
  const len = settings.wordLength || 5, word = words.getRandomTarget(len, []);
  if (!word) return false;
  const opening = Date.now(), next = { ...s, gameState: {
    word: word.toUpperCase(), guesses: [], gameOver: false, winner: null,
    letterStates: {}, wordLength: len, isDaily: false, isSession: true, sessionHandle: s.handle,
    startedAt: opening, potStartedAt: opening,
  }, gameStartTime: opening, lastActivityAt: opening, isComplete: false, autoRestartTimer: null };
  _recovery?.saveNew(next);
  if (s.autoRestartTimer) clearTimeout(s.autoRestartTimer);
  Object.assign(s, next); return true;
}

async function getOrCreateSession({ handle, sessionId, words, settings = {} }) {
  const key = String(handle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(key)) return null;
  const existing = sessions.get(key);
  if (existing?.gameState) { existing.lastActivityAt = Date.now(); return existing; }
  if (_creating.has(key)) return _creating.get(key);
  if (sessions.size >= MAX_SESSIONS) throw Error('Private session capacity reached');
  const promise = (async () => {
    const s = _newSession(key, sessionId || null), saved = _recovery?.restore(s);
    if (saved && !saved.ended) Object.assign(s, saved);
    else if (!_initSessionGame(s, words, settings)) return null;
    sessions.set(key, s); scheduleSave(); return s;
  })();
  _creating.set(key, promise);
  try { return await promise; } finally { _creating.delete(key); }
}

function _sweepIdleSessions() {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (s && (now - (s.lastActivityAt || s.gameStartTime || 0)) > IDLE_TTL_MS) {
      console.log(`[Session] sweeping idle session "${key}"`);
      try { endSession(key); } catch (_) { console.error('[Session] Idle retirement requires storage recovery'); }
    }
  }
}
setInterval(_sweepIdleSessions, SWEEP_INTERVAL_MS).unref();

function getSession(handle) {
  if (!handle) return null;
  return sessions.get(String(handle).toLowerCase()) || null;
}

function endSession(handle) {
  if (!handle) return false;
  const key = String(handle).toLowerCase();
  const s = sessions.get(key);
  if (s) _recovery?.end(s);
  if (s && s.autoRestartTimer) clearTimeout(s.autoRestartTimer);
  const had = sessions.has(key);
  sessions.delete(key);
  if (had) {
    console.log(`[Session] "${key}" ended`);
    scheduleSave();
  }
  return had;
}

function listSessions() {
  return [...sessions.values()].map(s => ({
    handle: s.handle,
    sessionId: s.sessionId,
    gameStartTime: s.gameStartTime,
    isComplete: s.isComplete,
    word: s.gameState?.word,
    wordLength: s.gameState?.wordLength,
    guessCount: s.gameState?.guesses?.length || 0,
  }));
}

// Public state shape (no secret word) for session viewers/overlays.
function buildSessionState(s, jackpotSettings, calcPotFn) {
  if (!s || !s.gameState) return null;
  const g = s.gameState;
  return {
    guesses: g.guesses,
    guessCount: g.guesses.length,
    gameOver: g.gameOver,
    winner: g.winner ? {
      displayName: g.winner.displayName,
      platform: g.winner.platform,
      profilePic: g.winner.profilePic,
      cosmetics: g.winner.cosmetics,
    } : null,
    letterStates: g.letterStates,
    gameStartTime: s.gameStartTime,
    roundStartedAt: g.startedAt,
    word: g.gameOver ? g.word : null,
    jackpotAwarded: g.jackpotAwarded,
    totalWins: 0,
    startTime: new Date(s.gameStartTime).toISOString(),
    jackpot: calcPotFn ? calcPotFn(s, jackpotSettings) : 0,
    jackpotEnabled: !!(jackpotSettings && jackpotSettings.enabled),
    wordLength: g.wordLength,
    isDaily: false,
    isSession: true,
    sessionHandle: s.handle,
    frenzy: { multiplier: 1, activeTappers: 0 },
  };
}

function restartSession(s, words, settings = {}) {
  if (!s) return false;
  return _initSessionGame(s, words, settings);
}

module.exports = {
  configureRecovery,
  getOrCreateSession,
  getSession,
  endSession,
  listSessions,
  buildSessionState,
  restartSession,
  scheduleSave,
};
