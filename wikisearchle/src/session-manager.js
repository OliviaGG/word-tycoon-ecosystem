// ===== Session Manager (WikiSearchle) =====
// Per-streamer private rounds. Round-build machinery lives in server.js
// (heavily entangled with Wikipedia + Searchle API helpers); this module
// owns the in-memory map + lifecycle + idle sweep + on-disk persistence.
//
// Lifetime:
//   - Lazy-created on first viewer connect or first chat tagged with the
//     session's streamerHandle.
//   - Auto-restart on win: same session keeps going with a freshly built round.
//   - Idle-swept after IDLE_TTL_MS of no chat/viewer activity (pause-and-
//     resume across game switches; reaped when truly abandoned).
//   - Persisted to data/sessions.json after every mutation (debounced); reloaded
//     on process boot so deploys/restarts don't wipe an in-progress round.

const fs = require('fs');
const path = require('path');

const sessions = new Map(); // handle (lowercase) -> round

const IDLE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // every 30 min

// ─── Persistence ────────────────────────────────────────────────────────────
const SAVE_PATH = process.env.WIKISEARCHLE_SESSION_PATH || path.join(__dirname, '..', 'data', 'sessions.json');
const { writeAtomic } = require('../lib/hint-journal');
const SAVE_TMP_PATH = SAVE_PATH + '.tmp';
const SAVE_DEBOUNCE_MS = 2000;
let _saveTimer = null;
let _saving = false;

// Map/Set-aware JSON encoder. Wraps each Map/Set in a tagged wrapper object
// so the matching reviver can rehydrate them. Plain objects/arrays/scalars
// pass through. Generic so the round shape can grow new Map/Set fields
// without touching this serializer.
function _replacer(key, value) {
  // wordIndex is a Map<norm, token[]> whose values share token-object
  // references with titleTokens + paragraphs. JSON serialization breaks
  // that reference identity (each occurrence becomes a separate copy on
  // load), which silently desyncs the title-row reveal from body reveals.
  // Skip persisting wordIndex; it's rebuilt on load from titleTokens +
  // paragraphs with the shared references restored.
  if (key === 'wordIndex') return undefined;
  if (value instanceof Map) return { __type: 'Map', value: [...value.entries()] };
  if (value instanceof Set) return { __type: 'Set', value: [...value] };
  return value;
}
function _reviver(_key, value) {
  if (value && typeof value === 'object' && value.__type === 'Map') return new Map(value.value);
  if (value && typeof value === 'object' && value.__type === 'Set') return new Set(value.value);
  return value;
}

// Rebuild wordIndex from a deserialized round so its values reference
// the SAME token objects that live in titleTokens + paragraphs. Without
// this step, processGuess's loop over wordIndex.get(norm) would mutate
// duplicate copies and the title row at top would stop reflecting
// reveals after the first one.
function _rebuildWordIndex(round) {
  if (!round) return;
  const wordIndex = new Map();
  const add = (t) => {
    if (!t || t.type !== 'word' || !t.norm) return;
    if (!wordIndex.has(t.norm)) wordIndex.set(t.norm, []);
    wordIndex.get(t.norm).push(t);
  };
  if (Array.isArray(round.paragraphs)) {
    for (const p of round.paragraphs) {
      if (!Array.isArray(p)) continue;
      for (const t of p) add(t);
    }
  }
  if (Array.isArray(round.titleTokens)) {
    for (const t of round.titleTokens) add(t);
  }
  round.wordIndex = wordIndex;
}

function _loadSessions() {
  try {
    if (!fs.existsSync(SAVE_PATH)) return;
    const raw = fs.readFileSync(SAVE_PATH, 'utf8');
    const data = JSON.parse(raw, _reviver);
    let count = 0;
    for (const [key, obj] of Object.entries(data)) {
      try {
        _rebuildWordIndex(obj);
        sessions.set(key, obj);
        count++;
      } catch (err) {
        console.warn(`[Session] Failed to deserialize "${key}":`, err.message);
      }
    }
    if (count) console.log(`[Session] Loaded ${count} session(s) from disk`);
  } catch (err) {
    console.warn('[Session] Failed to load sessions.json:', err.message);
  }
}

function saveImmediate(strict = false) {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    const data = {};
    for (const [key, state] of sessions) data[key] = state;
    // One synchronous writer prevents an older async rename from overwriting
    // a newer acknowledged hint snapshot. Preserve the Map/Set serializer.
    writeAtomic(SAVE_PATH, JSON.parse(JSON.stringify(data, _replacer)));
    return true;
  } catch (err) {
    if (strict) throw err;
    console.error('[Session] snapshot save failed:', err.message);
    return false;
  }
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; saveImmediate(); }, SAVE_DEBOUNCE_MS);
}

function setSession(handle, round) {
  if (!handle || !round) return;
  const key = String(handle).toLowerCase();
  round.sessionHandle = key;
  round.lastActivityAt = Date.now();
  sessions.set(key, round);
  scheduleSave();
}

// Per-handle build lock so concurrent calls (e.g. a viewer connecting
// while a chat message also tries to lazy-create) coalesce into one
// buildSessionRound execution. Without this, both branches would each
// build a different article (different rankings, different reveal
// state); whichever finished last replaced the other in the in-memory
// map, leaving viewers seeing article A while chat is being processed
// against article B. Symptom: a guess scores in the top-5 cards but
// never reveals in the article body. Caller passes a builder function
// that returns a Promise<round>.
const _building = new Map(); // handle -> Promise<round>
async function getOrBuildSession(handle, builder, onCommitted) {
  if (!handle) return null;
  const key = String(handle).toLowerCase();
  const existing = sessions.get(key);
  if (existing && !existing.won) return existing;
  if (_building.has(key)) return _building.get(key);
  // Defensive: register the lock BEFORE starting the IIFE so a synchronous
  // throw in builder() can't slip its finally's delete in before the set,
  // which would leave a rejected Promise stuck as the lock value.
  let _resolve, _reject;
  const ready = new Promise((res, rej) => { _resolve = res; _reject = rej; });
  _building.set(key, ready);
  (async () => {
    try {
      const round = await builder();
      if (round) {
        setSession(key, round);
        // Notify only after installation, once under the per-handle build
        // lock. Chat, viewer connects and the restart timer can all rotate
        // a won round; each must reset every viewer in the session room.
        if (onCommitted) onCommitted(round);
      }
      _resolve(round || sessions.get(key) || null);
    } catch (err) { _reject(err); }
    finally { _building.delete(key); }
  })();
  return ready;
}

function getSession(handle) {
  if (!handle) return null;
  return sessions.get(String(handle).toLowerCase()) || null;
}

function endSession(handle) {
  if (!handle) return false;
  const key = String(handle).toLowerCase();
  const had = sessions.has(key);
  sessions.delete(key);
  if (had) {
    console.log(`[Session] "${key}" ended`);
    scheduleSave();
  }
  return had;
}

function listSessions() {
  return [...sessions.entries()].map(([handle, r]) => ({
    handle,
    targetWord: r?.targetWord || null,
    articleTitle: r?.articleTitle || null,
    won: !!r?.won,
    startTime: r?.startTime || null,
  }));
}

function sessionRoom(handle) {
  return `wikisearchle:session:${String(handle || '').toLowerCase()}`;
}

function _sweepIdleSessions() {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (s && (now - (s.lastActivityAt || 0)) > IDLE_TTL_MS) {
      console.log(`[Session] sweeping idle session "${key}" (${Math.round((now - (s.lastActivityAt || 0)) / 60000)}m idle)`);
      endSession(key);
    }
  }
}
setInterval(_sweepIdleSessions, SWEEP_INTERVAL_MS).unref();

// Boot: pull persisted sessions back into memory.
_loadSessions();

module.exports = {
  setSession,
  getSession,
  endSession,
  listSessions,
  sessionRoom,
  scheduleSave,
  saveImmediate,
  getOrBuildSession,
};
