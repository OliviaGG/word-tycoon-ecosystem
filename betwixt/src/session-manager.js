// ===== Session Manager (Betwixt) =====
// Per-streamer private alphabetical-bounding rounds. Each session has its
// own secret, boundary state, guesses. Disk-persisted.

const fs = require('fs');
const path = require('path');

let durabilityHooks = null;
function setDurabilityHooks(hooks) { durabilityHooks = hooks; }
const sessions = new Map();
const _creating = new Map();

const IDLE_TTL_MS = 4 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

const SAVE_PATH = path.join(__dirname, '..', 'data', 'sessions.json');
const SAVE_TMP_PATH = SAVE_PATH + '.tmp';
const SAVE_DEBOUNCE_MS = 2000;
let _saveTimer = null;
let _saving = false;

function _replacer(key, value) {
  if (key === '_durabilityRestored') return undefined;
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
    const raw = fs.readFileSync(SAVE_PATH, 'utf8');
    const data = JSON.parse(raw, _reviver);
    let count = 0;
    for (const [key, obj] of Object.entries(data)) {
      try {
        obj.autoRestartTimer = null;
        obj._durabilityRestored = false;
        sessions.set(key, obj);
        count++;
      } catch (_) {}
    }
    if (count) console.log(`[Session] Loaded ${count} session(s) from disk`);
  } catch (err) {
    console.warn('[Session] Failed to load sessions.json:', err.message);
  }
}

function _doSaveAsync() {
  if (_saving) return;
  _saving = true;
  const data = {};
  for (const [key, s] of sessions) data[key] = s;
  let json;
  try { json = JSON.stringify(data, _replacer); }
  catch (err) { console.error('[Session] serialize failed:', err.message); _saving = false; return; }
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
    game: null,
    gameStartTime: 0,
    lastActivityAt: Date.now(),
    isComplete: false,
    autoRestartTimer: null,
  };
}

// Pick a random secret from the provided pool (server passes the live targets/dictionary).
function _restoreDurable(s) {
  if (!s || !durabilityHooks || s._durabilityRestored) return;
  const durable = durabilityHooks.restore(s);
  if (durable) Object.assign(s, durable);
  else if (s.game) durabilityHooks.saveNew(s);
  s._durabilityRestored = true;
}
function _initSessionGame(s, opts) {
  const before = { game: s.game, gameStartTime: s.gameStartTime, lastActivityAt: s.lastActivityAt, isComplete: s.isComplete, _durabilityRestored: s._durabilityRestored };
  const len = opts.wordLength || 5;
  const pool = (opts.targetsByLength && opts.targetsByLength[len]) || (opts.wordsByLength && opts.wordsByLength[len]) || [];
  if (!pool.length) {
    console.warn(`[Session] "${s.handle}" no words for length ${len}`);
    return false;
  }
  const secret = pool[Math.floor(Math.random() * pool.length)];
  const lowerEdge = 'a'.repeat(len);
  const upperEdge = 'z'.repeat(len) + 'z';
  s.game = {
    secret,
    wordLength: len,
    originalLower: lowerEdge,
    originalUpper: upperEdge,
    currentLower: lowerEdge,
    currentUpper: upperEdge,
    displayLower: null,
    displayUpper: null,
    guesses: [],
    isWon: false,
    isDaily: false,
    isSession: true,
    sessionHandle: s.handle,
    winner: null,
    lowerBoundaryUser: null,
    upperBoundaryUser: null,
    confirmedLetters: new Array(len).fill(null),
    startTime: new Date().toISOString(),
  };
  s.gameStartTime = Date.now();
  s.lastActivityAt = Date.now();
  s.isComplete = false;
  try { durabilityHooks?.saveNew(s); s._durabilityRestored = true; }
  catch (error) { Object.assign(s, before); throw error; }
  if (s.autoRestartTimer) { clearTimeout(s.autoRestartTimer); s.autoRestartTimer = null; }
  return true;
}

async function getOrCreateSession({ handle, sessionId, opts = {} }) {
  if (!handle) return null;
  const key = String(handle).toLowerCase();
  let existing = sessions.get(key);
  if (!existing && durabilityHooks) {
    const candidate = _newSession(key, sessionId || null), durable = durabilityHooks.restore(candidate);
    if (durable) { Object.assign(candidate, durable); candidate._durabilityRestored = true; sessions.set(key, candidate); existing = candidate; }
  }
  _restoreDurable(existing);
  if (existing && existing.autoRestartTimer) {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  if (existing && existing.game && !existing.game.isWon) {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  if (_creating.has(key)) return _creating.get(key);
  const promise = (async () => {
    const s = existing || _newSession(key, sessionId || null);
    if (sessionId) s.sessionId = sessionId;
    sessions.set(key, s);
    if (!_initSessionGame(s, opts)) {
      sessions.delete(key);
      return null;
    }
    console.log(`[Session] "${key}" started: ${s.game.wordLength}-letter `);
    scheduleSave();
    return s;
  })();
  _creating.set(key, promise);
  try { return await promise; } finally { _creating.delete(key); }
}

function _sweepIdleSessions() {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (s && (now - (s.lastActivityAt || s.gameStartTime || 0)) > IDLE_TTL_MS) {
      console.log(`[Session] sweeping idle session "${key}"`);
      try { endSession(key); } catch { console.error('[Session] idle retirement storage failed; retaining session for retry'); }
    }
  }
}
setInterval(_sweepIdleSessions, SWEEP_INTERVAL_MS).unref();

function getSession(handle) {
  if (!handle) return null;
  const session = sessions.get(String(handle).toLowerCase()) || null;
  _restoreDurable(session); return session;
}
function endSession(handle) {
  if (!handle) return false;
  const key = String(handle).toLowerCase();
  const s = sessions.get(key);
  if (s) durabilityHooks?.end(s);
  if (s && s.autoRestartTimer) clearTimeout(s.autoRestartTimer);
  const had = sessions.has(key);
  sessions.delete(key);
  if (had) { console.log(`[Session] "${key}" ended`); scheduleSave(); }
  return had;
}
function listSessions() {
  return [...sessions.values()].map(s => ({
    handle: s.handle, sessionId: s.sessionId,
    gameStartTime: s.gameStartTime,
    isComplete: s.isComplete,
    secret: s.game?.secret,
    wordLength: s.game?.wordLength,
    guessCount: s.game?.guesses?.length || 0,
  }));
}

function buildSessionState(s, calcPotFn, jackpotEnabled) {
  if (!s || !s.game) return null;
  const g = s.game;
  const mask = 'x'.repeat(g.wordLength);
  return {
    wordLength: g.wordLength,
    currentLower: g.displayLower || mask,
    currentUpper: g.displayUpper || mask,
    guesses: g.guesses,
    isWon: g.isWon,
    winner: g.winner,
    guessCount: g.guesses.length,
    lowerBoundaryUser: g.lowerBoundaryUser,
    upperBoundaryUser: g.upperBoundaryUser,
    confirmedLetters: g.confirmedLetters || [],
    startTime: g.startTime,
    hintStartTime: g.hintStartTime || g.startTime,
    jackpot: calcPotFn ? calcPotFn(s) : 0,
    isDaily: false,
    isSession: true,
    sessionHandle: s.handle,
    frenzy: { multiplier: 1, activeTappers: 0 },
    lowerCloseness: null,
    upperCloseness: null,
  };
}

function restartSession(s, opts) {
  if (!s) return false;
  return _initSessionGame(s, opts);
}

module.exports = {
  setDurabilityHooks,
  getOrCreateSession,
  getSession,
  endSession,
  listSessions,
  buildSessionState,
  restartSession,
  scheduleSave,
};
