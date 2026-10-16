// ===== Session Manager (SpellingBee) =====
// Per-streamer private hex-puzzle rounds. Each session owns its own Game
// instance + gameStartTime. Persisted to data/sessions.json (debounced 2s)
// so PM2 restarts don't wipe an in-progress session.

const fs = require('fs');
const path = require('path');
const Game = require('./game');

const sessions = new Map(); // handle (lowercase) -> sessionState
const _creating = new Map();

const IDLE_TTL_MS = 4 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

const SAVE_PATH = path.join(process.env.SPELLINGBEE_DATA_DIR || path.join(__dirname, '..', 'data'), 'sessions.json');
const SAVE_TMP_PATH = SAVE_PATH + '.tmp';
const SAVE_DEBOUNCE_MS = 2000;
let _saveTimer = null;
let _saving = false;

function _replacer(key, value) {
  if (key === 'autoRestartTimer') return undefined;
  if (value instanceof Map) return { __type: 'Map', value: [...value.entries()] };
  if (value instanceof Set) return { __type: 'Set', value: [...value] };
  if (value instanceof Game) return { __type: 'Game', value: value.getSerializableState() };
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

let _dictionary = null;
let recovery = null;
function setDictionary(d) { _dictionary = d; }

function _restoreGame(s) {
  if (!s || !s.game?.__pendingGame || !_dictionary) return;
  const g = new Game(_dictionary);
  g.restoreState(s.game.__pendingGame, { exact: true, silent: true });
  s.game = g;
}

function _loadSessions() {
  if (!fs.existsSync(SAVE_PATH)) return;
  const stat = fs.lstatSync(SAVE_PATH);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 12 * 1024 * 1024) throw Error('Unsafe legacy Spelling Bee sessions');
  const data = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'), _reviver);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 499) throw Error('Invalid legacy Spelling Bee sessions');
  for (const [key, s] of Object.entries(data)) {
    if (!/^[a-z0-9_-]{1,32}$/.test(key) || !s || s.handle !== key) throw Error('Invalid legacy Spelling Bee session');
    s.autoRestartTimer = null; _restoreGame(s);
    if (!s.game) throw Error('Missing legacy Spelling Bee board');
    s.isComplete = !!s.isComplete || s.game.completionEmitted;
    recovery.baseline(s.game, 'session:' + key, s);
    sessions.set(key, s);
  }
}

function setRecovery(value) {
  recovery = value;
  const scopes = recovery.journal.scopes();
  if (!scopes.some(scope => scope.startsWith('session:'))) _loadSessions();
  for (const scope of scopes) {
    if (!scope.startsWith('session:')) continue;
    const key = scope.slice(8), record = recovery.load(scope);
    if (!/^[a-z0-9_-]{1,32}$/.test(key) || record.meta.handle !== key) throw Error('Invalid owned Spelling Bee session');
    if (record.meta.ended) continue;
    const s = _newSession(key, record.meta.sessionId);
    s.game = new Game(_dictionary); recovery.adopt(s.game, record, s);
    sessions.set(key, s);
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

function _initSessionGame(s) {
  if (!_dictionary || !recovery) return false;
  const g = new Game(_dictionary); g.generateAndLoad(); g.start();
  const candidate = { ...s, game: g, gameStartTime: g.startTime, lastActivityAt: Date.now(), isComplete: false, completion: null, autoRestartTimer: null };
  const old = { ...s };
  Object.assign(s, candidate);
  try { recovery.baseline(g, 'session:' + s.handle, s); } catch (error) { Object.assign(s, old); throw error; }
  Object.assign(s, old);
  if (s.autoRestartTimer) clearTimeout(s.autoRestartTimer);
  if (s.game?.timerInterval) clearInterval(s.game.timerInterval);
  Object.assign(s, candidate);
  // The closures must own the published session, not the temporary candidate.
  recovery.attach(g, 'session:' + s.handle, s);
  return true;
}

async function getOrCreateSession({ handle, sessionId }) {
  if (typeof handle !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(handle)) return null;
  const key = String(handle).toLowerCase();
  const existing = sessions.get(key);
  if (existing) _restoreGame(existing);
  if (existing) {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  if (sessions.size >= 499) throw Error('Spelling Bee private session capacity reached');
  if (_creating.has(key)) return _creating.get(key);
  const promise = (async () => {
    const s = existing || _newSession(key, sessionId || null);
    if (sessionId) s.sessionId = sessionId;
    if (!_initSessionGame(s)) {
      return null;
    }
    sessions.set(key, s);
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
      try { endSession(key); } catch (_) { /* retain and retry the next sweep */ }
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
  if (s) recovery.retire('session:' + key);
  if (s && s.autoRestartTimer) clearTimeout(s.autoRestartTimer);
  if (s?.game?.timerInterval) clearInterval(s.game.timerInterval);
  const had = sessions.delete(key);
  if (had) scheduleSave();
  return had;
}

function listSessions() {
  return [...sessions.values()].map(s => ({
    handle: s.handle,
    sessionId: s.sessionId,
    gameStartTime: s.gameStartTime,
    isComplete: s.isComplete,
    letters: s.game?.letters?.join(''),
    centerLetter: s.game?.centerLetter,
    foundCount: s.game ? Object.keys(s.game.foundWords || {}).length : 0,
  }));
}

function buildSessionState(s, jackpotSettings, calcPotFn) {
  if (!s) return null;
  _restoreGame(s);
  if (!s.game) return null;
  const state = s.game.getState();
  state.jackpot = s.completion ? s.completion.amount : calcPotFn ? calcPotFn(s, jackpotSettings) : 0;
  state.completion = s.completion || null;
  state.jackpotEnabled = !!(jackpotSettings && jackpotSettings.enabled);
  state.isDaily = false;
  state.isWeekly = false;
  state.isSession = true;
  state.sessionHandle = s.handle;
  state.frenzy = { multiplier: 1, activeTappers: 0 };
  return state;
}

function restartSession(s) {
  if (!s) return false;
  return _initSessionGame(s);
}

module.exports = {
  setDictionary,
  setRecovery,
  allSessions: () => [...sessions.values()],
  getOrCreateSession,
  getSession,
  endSession,
  listSessions,
  buildSessionState,
  restartSession,
  scheduleSave,
};
