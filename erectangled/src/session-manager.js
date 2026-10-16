// ===== Session Manager (erecTangled / Sproutle) =====
// Per-streamer private game sessions. Independent grid + ring expansion +
// scoring per streamer handle. Mirrors the pattern used in RecTangled and
// Searchle. Round state is persisted to data/sessions.json (debounced 2s)
// so PM2 restarts / deploys don't wipe an in-progress session.

const fs = require('fs');
const path = require('path');
const { Game } = require('./game');
const wordlist = require('./wordlist');
const boardPool = require('./board-pool');

let durabilityHooks = null;
function setDurabilityHooks(hooks) { durabilityHooks = hooks; }
const sessions = new Map(); // handle (lowercase) -> sessionState
const _creating = new Map();

// Pause-and-resume: when a streamer switches games mid-round, the old
// game's session lingers in memory so they can switch back and continue
// where they left off. To prevent unbounded memory growth from truly
// abandoned sessions, sweep handles idle longer than IDLE_TTL_MS.
// "Activity" = chat coming in or a viewer (re)connecting (both flow
// through getOrCreateSession). State polls do NOT count.
const IDLE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // every 30 min

// ─── Persistence ────────────────────────────────────────────────────────────
// Generic Map/Set replacer/reviver plus a Game-instance branch that
// serializes via game.saveState() and restores via game.restoreFrom().
// Game restore is deferred to first session access (via _restoreGame)
// because wordlist may not be initialized at session-manager require time.
const SAVE_PATH = path.join(__dirname, '..', 'data', 'sessions.json');
const SAVE_TMP_PATH = SAVE_PATH + '.tmp';
const SAVE_DEBOUNCE_MS = 2000;
let _saveTimer = null;
let _saving = false;

function _replacer(_key, value) {
  if (_key === '_durabilityRestored') return undefined;
  if (value instanceof Game) return { __type: 'Game', value: value.saveState({ exact: true }) };
  if (value instanceof Map) return { __type: 'Map', value: [...value.entries()] };
  if (value instanceof Set) return { __type: 'Set', value: [...value] };
  return value;
}
function _reviver(_key, value) {
  if (value && typeof value === 'object') {
    if (value.__type === 'Map') return new Map(value.value);
    if (value.__type === 'Set') return new Set(value.value);
    if (value.__type === 'Game') return { __pendingGame: value.value };
  }
  return value;
}

// Lazily restore a Game instance from its saved snapshot. Called on first
// access after boot; safe to call repeatedly (no-op if game already real).
function _restoreGame(s) {
  if (s && durabilityHooks && !s._durabilityRestored) {
    const durable = durabilityHooks.restore(s);
    if (durable) Object.assign(s, durable);
    else if (s.game && !s.game.__pendingGame) durabilityHooks.saveNew(s);
    s._durabilityRestored = true;
  }
  if (!s || !s.game || !s.game.__pendingGame) return;
  const snapshot = s.game.__pendingGame;
  try {
    const g = new Game();
    g.restoreFrom(snapshot, wordlist.getTrie(), wordlist.getTargetSet(), wordlist.getFrequencyMap(), { trusted: snapshot.exactState === 1 });
    s.game = g;
    s.isComplete = !!g.getState().isComplete;
    durabilityHooks?.saveNew(s);
    if (snapshot.startTime) {
      const t = typeof snapshot.startTime === 'number' ? snapshot.startTime : Date.parse(snapshot.startTime);
      if (Number.isFinite(t)) s.startTime = t;
    }
    console.log(`[Session] "${s.handle}" restored from disk: ${g.rows}x${g.cols}`);
  } catch (err) {
    console.warn(`[Session] "${s.handle}" restore failed:`, err.message);
    if (durabilityHooks) throw err;
    s.game = null;
  }
}

function _loadSessions() {
  try {
    if (!fs.existsSync(SAVE_PATH)) return;
    const raw = fs.readFileSync(SAVE_PATH, 'utf8');
    const data = JSON.parse(raw, _reviver);
    let count = 0;
    for (const [key, obj] of Object.entries(data)) {
      try {
        // Drop the in-memory autoRestartTimer — it's a setTimeout handle that
        // doesn't survive serialization and shouldn't be re-armed on load.
        obj.autoRestartTimer = null;
        obj._durabilityRestored = false;
        sessions.set(key, obj);
        count++;
      } catch (err) {
        console.warn(`[Session] Failed to deserialize "${key}":`, err.message);
      }
    }
    if (count) console.log(`[Session] Loaded ${count} session(s) from disk (Game instances will restore on first access)`);
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

// Boot: pull persisted sessions back into memory. Game restoration happens
// lazily on first getOrCreateSession call (wordlist must be init'd by then).
_loadSessions();

function _newSession(handle, sessionId) {
  return {
    handle,
    sessionId: sessionId || null,
    game: null,
    startTime: 0,
    lastActivityAt: Date.now(),
    isComplete: false,
    autoRestartTimer: null,
  };
}

async function getOrCreateSession({ handle, sessionId, wordlist, settings = {} }) {
  if (!handle) return null;
  const key = String(handle).toLowerCase();

  let existing = sessions.get(key);
  if (!existing && durabilityHooks) {
    const candidate = _newSession(key, sessionId || null), durable = durabilityHooks.restore(candidate);
    if (durable) { Object.assign(candidate, durable); candidate._durabilityRestored = true; sessions.set(key, candidate); existing = candidate; }
  }
  if (existing) _restoreGame(existing); // promote disk-pending Game to a real instance
  if (existing && existing.game && !existing.isComplete) {
    existing.lastActivityAt = Date.now();
    return existing;
  }

  if (_creating.has(key)) return _creating.get(key);

  const promise = (async () => {
    const s = existing || _newSession(key, sessionId || null);
    if (sessionId) s.sessionId = sessionId;
    sessions.set(key, s);
    _initSessionGame(s, wordlist, settings);
    console.log(`[Session] "${key}" started: ${s.game.rows}x${s.game.cols}, ${s.game.commonWords.size} common + ${s.game.rareWords.size} rare`);
    scheduleSave();
    return s;
  })();

  _creating.set(key, promise);
  try {
    return await promise;
  } finally {
    _creating.delete(key);
  }
}

function _initSessionGame(s, wordlist, settings = {}) {
  const previous = { game: s.game, startTime: s.startTime, lastActivityAt: s.lastActivityAt, isComplete: s.isComplete, _durabilityRestored: s._durabilityRestored };
  // Sessions always use the random-grid path (matches public default).
  // No daily/pool/weekly logic — those are public-only.
  const rows = settings.rows || 9;
  const cols = settings.cols || 7;
  const minWordLength = settings.minWordLength || 3;
  // Pre-generated when possible — building inline blocks the whole process,
  // which would stall the public game and every other session too.
  s.game = boardPool.takeOrBuild(wordlist, rows, cols, minWordLength);
  s.startTime = Date.now();
  s.game.startTime = s.startTime;
  s.lastActivityAt = Date.now();
  s.isComplete = false;
  try { durabilityHooks?.saveNew(s); s._durabilityRestored = true; }
  catch (error) { Object.assign(s, previous); throw error; }
  if (s.autoRestartTimer) { clearTimeout(s.autoRestartTimer); s.autoRestartTimer = null; }
}

function _sweepIdleSessions() {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (s && (now - (s.lastActivityAt || s.startTime || 0)) > IDLE_TTL_MS) {
      console.log(`[Session] sweeping idle session "${key}" (${Math.round((now - s.lastActivityAt) / 60000)}m idle)`);
      try { endSession(key); }
      catch (error) { console.error('[Session] idle retirement storage failed; retaining session for retry'); }
    }
  }
}
setInterval(_sweepIdleSessions, SWEEP_INTERVAL_MS).unref();

function getSession(handle) {
  if (!handle) return null;
  const s = sessions.get(String(handle).toLowerCase()) || null;
  if (s) _restoreGame(s);
  return s;
}

function endSession(handle) {
  if (!handle) return false;
  const key = String(handle).toLowerCase();
  const s = sessions.get(key);
  if (s && s.autoRestartTimer) clearTimeout(s.autoRestartTimer);
  const had = sessions.has(key);
  if (had) durabilityHooks?.end?.(s);
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
    startTime: s.startTime,
    isComplete: s.isComplete,
    rows: s.game?.rows,
    cols: s.game?.cols,
  }));
}

function buildSessionState(s, jackpotSettings) {
  if (!s) return null;
  _restoreGame(s);
  if (!s.game) return null;
  return {
    ...s.game.getState(),
    jackpot: _calcSessionJackpot(s, jackpotSettings),
    jackpotEnabled: true,
    isDaily: false,
    isSession: true,
    sessionHandle: s.handle,
    frenzy: { multiplier: 1, activeTappers: 0 },
  };
}

// Mirrors the public erecTangled jackpot formula but uses session-local
// found-word count + start time so each streamer pool grows independently.
function _calcSessionJackpot(s, jackpotSettings) {
  if (!s || !s.game) return 0;
  const settings = jackpotSettings || { enabled: true, base: 3000, perGuess: 10, perSecond: 17, max: 10_000_000 };
  if (!settings.enabled) return settings.base || 0;
  const wordCount = s.game.foundCommon ? s.game.foundCommon.size : 0;
  const elapsed = (Date.now() - s.startTime) / 1000;
  const guessBonus = wordCount * (settings.perGuess || 10);
  const timeBonus = Math.floor(elapsed) * (settings.perSecond || 17);
  return Math.min((settings.base || 3000) + guessBonus + timeBonus, settings.max || 10_000_000);
}

function calculateSessionJackpot(handle, jackpotSettings) {
  return _calcSessionJackpot(getSession(handle), jackpotSettings);
}

function restartSession(s, wordlist, settings = {}) {
  if (!s) return;
  _initSessionGame(s, wordlist, settings);
  scheduleSave();
}

module.exports = {
  setDurabilityHooks,
  getOrCreateSession,
  getSession,
  endSession,
  listSessions,
  buildSessionState,
  calculateSessionJackpot,
  restartSession,
  scheduleSave,
};
