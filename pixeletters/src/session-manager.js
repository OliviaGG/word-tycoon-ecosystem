// ===== Session Manager (PixeLetters) =====
// Per-streamer private rounds with their own word, guesses, directions, and
// keyboard state. Mirrors public game.js logic but operates on a per-handle
// state object (not the singleton). Persisted to data/sessions.json.

const fs = require('fs');
const path = require('path');
const { PIXEL_FONT } = require('./pixelfont');
const { getRandomWord } = require('./wordlist');

let durabilityHooks = null;
function setDurabilityHooks(hooks) { durabilityHooks = hooks; }
const sessions = new Map();
const _creating = new Map();

const IDLE_TTL_MS = 4 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

const DIRECTIONS = ['down', 'up', 'left', 'right'];
function pickDirection() { return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]; }
function buildDirections(wordLength) {
  const d = [];
  for (let i = 0; i < wordLength; i++) d.push(pickDirection());
  return d;
}

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
    currentGame: null,
    gameStartTime: 0,
    lastActivityAt: Date.now(),
    isComplete: false,
    autoRestartTimer: null,
  };
}

function _restoreDurable(s) {
  if (!s || !durabilityHooks || s._durabilityRestored) return;
  const durable = durabilityHooks.restore(s);
  if (durable) Object.assign(s, durable);
  else if (s.currentGame) durabilityHooks.saveNew(s);
  s._durabilityRestored = true;
}
function _initSessionGame(s, settings = {}) {
  const before = { currentGame:s.currentGame,gameStartTime:s.gameStartTime,lastActivityAt:s.lastActivityAt,isComplete:s.isComplete,_durabilityRestored:s._durabilityRestored };
  const len = settings.wordLength || 5;
  const maxGuesses = settings.maxGuesses != null ? settings.maxGuesses : 5;
  const word = getRandomWord(len);
  if (!word) {
    console.warn(`[Session] "${s.handle}" no words for length ${len}`);
    return false;
  }
  s.currentGame = {
    word: word.toUpperCase(),
    wordLength: len,
    maxGuesses,
    guesses: [],
    directions: buildDirections(len),
    status: 'active',
    isDaily: false,
    startedAt: new Date().toISOString(),
  };
  s.gameStartTime = Date.now();
  s.lastActivityAt = Date.now();
  s.isComplete = false;
  try { durabilityHooks?.saveNew(s); s._durabilityRestored = true; }
  catch (error) { Object.assign(s,before); throw error; }
  if (s.autoRestartTimer) { clearTimeout(s.autoRestartTimer); s.autoRestartTimer = null; }
  return true;
}

async function getOrCreateSession({ handle, sessionId, settings = {} }) {
  if (!handle) return null;
  const key = String(handle).toLowerCase();
  let existing = sessions.get(key);
  if (!existing && durabilityHooks) {
    const candidate = _newSession(key,sessionId || null), durable = durabilityHooks.restore(candidate);
    if (durable) { Object.assign(candidate,durable); candidate._durabilityRestored=true; sessions.set(key,candidate); existing=candidate; }
  }
  _restoreDurable(existing);
  if (existing && existing.autoRestartTimer) {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  if (existing && existing.currentGame && existing.currentGame.status === 'active') {
    existing.lastActivityAt = Date.now();
    return existing;
  }
  if (_creating.has(key)) return _creating.get(key);
  const promise = (async () => {
    const s = existing || _newSession(key, sessionId || null);
    if (sessionId) s.sessionId = sessionId;
    sessions.set(key, s);
    if (!_initSessionGame(s, settings)) {
      sessions.delete(key);
      return null;
    }
    console.log(`[Session] "${key}" started: (${s.currentGame.wordLength}-letter)`);
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
      try { endSession(key); } catch { console.error('[Session] Idle retirement failed; retaining session'); }
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
    word: s.currentGame?.word,
    guessCount: s.currentGame?.guesses?.length || 0,
    status: s.currentGame?.status,
  }));
}

// ── Pixel feedback (pure-function clone of game.js's buildPixelFeedback) ──
function isPixelRevealed(row, col, direction, revealCount, mode) {
  if (mode === 'standard') return row < revealCount;
  switch (direction) {
    case 'down': return mode === 'pro' ? row === revealCount - 1 : row < revealCount;
    case 'up': return mode === 'pro' ? (6 - row) === revealCount - 1 : (6 - row) < revealCount;
    case 'right': return mode === 'pro' ? col === revealCount - 1 : col < revealCount;
    case 'left': return mode === 'pro' ? (4 - col) === revealCount - 1 : (4 - col) < revealCount;
    default: return row < revealCount;
  }
}

function buildPixelFeedback(currentGame, guess, guessIndex, mode) {
  const answer = currentGame.word;
  const revealCount = guessIndex + 1;
  const feedback = [];
  for (let pos = 0; pos < guess.length; pos++) {
    const guessChar = guess[pos];
    const answerChar = answer[pos];
    const guessGrid = PIXEL_FONT[guessChar] || PIXEL_FONT['A'];
    const answerGrid = PIXEL_FONT[answerChar] || PIXEL_FONT['A'];
    const direction = currentGame.directions[pos];
    if (guessChar === answerChar) {
      const grid = [];
      for (let row = 0; row < 7; row++) {
        const rowData = [];
        for (let col = 0; col < 5; col++) {
          rowData.push(guessGrid[row][col] === 1 ? 'blue' : 'off');
        }
        grid.push(rowData);
      }
      feedback.push({ correct: true, grid, direction });
    } else {
      const grid = [];
      for (let row = 0; row < 7; row++) {
        const rowData = [];
        for (let col = 0; col < 5; col++) {
          const isRev = isPixelRevealed(row, col, direction, revealCount, mode);
          if (guessGrid[row][col] === 1) {
            if (isRev) rowData.push(answerGrid[row][col] === 1 ? 'green' : 'red');
            else rowData.push('gray');
          } else {
            rowData.push('off');
          }
        }
        grid.push(rowData);
      }
      feedback.push({ correct: false, grid, direction });
    }
  }
  return feedback;
}

function buildKeyboardState(currentGame) {
  const keyboard = {};
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const font = PIXEL_FONT[letter];
    const grid = font.map(row => row.map(px => px === 1 ? 'green' : 'off'));
    keyboard[letter] = { status: 'unused', grid };
  }
  if (!currentGame) return keyboard;
  for (const guess of currentGame.guesses) {
    for (let i = 0; i < guess.word.length; i++) {
      const letter = guess.word[i];
      const pf = guess.pixelFeedback[i];
      const font = PIXEL_FONT[letter];
      if (pf.correct) {
        keyboard[letter] = { status: 'correct', grid: font.map(row => row.map(px => px === 1 ? 'blue' : 'off')) };
      } else if (keyboard[letter].status !== 'correct') {
        keyboard[letter] = { status: 'wrong', grid: font.map(row => row.map(px => px === 1 ? 'green' : 'off')) };
      }
    }
  }
  return keyboard;
}

function processSessionGuess(session, word, playerInfo, mode = 'standard') {
  if (!session || !session.currentGame || session.currentGame.status !== 'active') {
    return { error: 'No active game' };
  }
  const cg = session.currentGame;
  if (typeof word !== 'string' || word.length > 64) return { error:'Invalid guess' };
  const guess = word.toUpperCase().trim();
  if (guess.length !== cg.wordLength) return { error: `Guess must be ${cg.wordLength} letters` };
  if (!/^[A-Z]+$/.test(guess)) return { error: 'Letters only' };
  if (cg.guesses.some(g => g.word === guess)) return { error: 'Already guessed' };

  try { durabilityHooks?.ensure(session); } catch { return { error:'Progress storage unavailable; please retry' }; }
  const before = { ...cg,guesses:[...cg.guesses] }, previousComplete=session.isComplete, previousActivity=session.lastActivityAt;
  mode = cg.mode || mode;
  const pixelFeedback = buildPixelFeedback(cg, guess, cg.guesses.length, mode);
  const guessEntry = {
    word: guess,
    username: playerInfo.username,
    displayName: playerInfo.displayName || playerInfo.username,
    platform: playerInfo.platform,
    platformUserId: playerInfo.platformUserId,
    profilePic: playerInfo.profilePic || null,
    linkedDiscord: playerInfo.linkedDiscord || null,
    pixelFeedback,
    timestamp: new Date().toISOString(),
  };
  cg.guesses.push(guessEntry);
  session.lastActivityAt = Date.now();

  let result = { guess: guessEntry, gameOver: false };
  if (guess === cg.word) {
    cg.status = 'won';
    result.gameOver = true;
    result.won = true;
    result.word = cg.word;
    result.winner = { ...playerInfo };
    session.isComplete = true;
  } else if (cg.maxGuesses > 0 && cg.guesses.length >= cg.maxGuesses) {
    cg.status = 'lost';
    result.gameOver = true;
    result.won = false;
    result.word = cg.word;
    session.isComplete = true;
  }
  try { durabilityHooks?.accept(session,result); }
  catch {
    for (const key of Object.keys(cg)) delete cg[key]; Object.assign(cg,before);
    session.isComplete=previousComplete;session.lastActivityAt=previousActivity;
    return { error:'Progress storage unavailable; please retry' };
  }
  scheduleSave();
  return result;
}

function buildSessionState(s, settings = {}, calcPotFn) {
  if (!s || !s.currentGame) return null;
  const cg = s.currentGame;
  const mode = cg.mode || settings.mode || 'standard';
  return {
    wordLength: cg.wordLength,
    maxGuesses: cg.maxGuesses,
    guessCount: cg.guesses.length,
    directions: cg.directions,
    mode,
    guesses: cg.guesses.map(g => ({
      word: g.word, username: g.username, displayName: g.displayName,
      platform: g.platform, platformUserId: g.platformUserId,
      profilePic: g.profilePic || null, linkedDiscord: g.linkedDiscord || null,
      pixelFeedback: g.pixelFeedback, timestamp: g.timestamp,
    })),
    keyboard: buildKeyboardState(cg),
    hintStartTime: cg.startedAt,
    isDaily: false,
    isSession: true,
    sessionHandle: s.handle,
    status: cg.status,
    word: cg.status !== 'active' ? cg.word : undefined,
    winner: cg.status === 'won' ? cg.guesses[cg.guesses.length - 1] : undefined,
    requireSlash: false,
    jackpot: calcPotFn ? calcPotFn(s) : 0,
    jackpotEnabled: !!(settings.jackpotEnabled),
    frenzy: { multiplier: 1, activeTappers: 0 },
  };
}

function restartSession(s, settings = {}) {
  if (!s) return false;
  return _initSessionGame(s, settings);
}

module.exports = {
  setDurabilityHooks,
  getOrCreateSession,
  getSession,
  endSession,
  listSessions,
  buildSessionState,
  processSessionGuess,
  restartSession,
  scheduleSave,
};
