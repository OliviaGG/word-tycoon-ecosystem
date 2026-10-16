try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
// ═══════════════════════════════════════════════════════════════════════
// FIGURAL — Symbol-based word deduction game
// Decode the meaning of 3 mystery symbols to find the secret word
// ═══════════════════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live'];
const io = new Server(server, { cors: { origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected')) } });

const PORT = process.env.PORT || 3019;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';

// ── Premium web-play gate (2026-07-19) ──────────────────────────────
// Public WEB multiplayer guessing requires Donor Class / TikTok Super Fan.
// Solo/daily flows, streamer sessions and relay chat (tiktok/discord/bots)
// use different code paths and never touch this gate.
// The check itself lives in chat-relay's game-shared.js (2026-07-31) so every
// game gates identically — public rooms AND streamer player pages. It replaces
// a local snowflake-shape test that read any non-Discord id (gh_/google_/tt_)
// as logged-out and hard-blocked it, even when that account's subscription was
// linked to a Discord one.
async function passesPremiumWebGate(candidateIds, socket, context = 'mp') {
  return gameShared.passesPremiumWebGate(candidateIds, socket, context);
}
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });
const sessionManager = require('./src/session-manager');

// ─── Streamer whitelist + redirect targets (declared above any closure) ──
let _validStreamerHandles = new Set();
let _streamerSettings = new Map();
const _streamerRedirectTargets = new Map();
async function _refreshStreamerHandles() {
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-handles`);
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.handles)) {
      _validStreamerHandles = new Set(data.handles.map(h => String(h).toLowerCase()));
    }
    if (data && Array.isArray(data.settings)) {
      const m = new Map();
      for (const s of data.settings) {
        const h = String((s && s.handle) || '').toLowerCase();
        if (!h) continue;
        const bset = new Set();
        if (Array.isArray(s.blockedPlayers)) {
          for (const b of s.blockedPlayers) {
            const p = String((b && b.platform) || '').toLowerCase();
            const id = String((b && b.id) || '');
            if (p && id) bset.add(p + ':' + id);
          }
        }
        m.set(h, { disablePlayerPage: !!s.disablePlayerPage, blockedSet: bset });
      }
      _streamerSettings = m;
    }
  } catch (_) {}
}
setTimeout(_refreshStreamerHandles, 2000);
setInterval(_refreshStreamerHandles, 5 * 60 * 1000).unref();
function _isPagePlayDisabled(handle) {
  const s = _streamerSettings.get(String(handle || '').toLowerCase());
  return !!(s && s.disablePlayerPage);
}
function _isStreamerBlocking(handle, platform, platformUserId) {
  const s = _streamerSettings.get(String(handle || '').toLowerCase());
  if (!s || !s.blockedSet || !s.blockedSet.size) return false;
  const p = String(platform || '').toLowerCase();
  const id = String(platformUserId || '');
  if (!p || !id) return false;
  return s.blockedSet.has(p + ':' + id);
}
function _sessionRoom(handle) { return `figural:session:${String(handle || '').toLowerCase()}`; }

app.use(express.json());

// Session URL routes (BEFORE static)
const SESSION_RESERVED_HANDLES = new Set([
  'admin', 'admin.html', 'api', 'overlay', 'overlay.html',
  'index.html', 'mp.html', 'sp.html',
  'favicon.ico', 'robots.txt', 'manifest.webmanifest', 'sw.js',
  'public', 'js', 'css', 'socket.io',
]);
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/')[2].toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get(/^\/[a-z0-9_-]{1,32}$/, (req, res, next) => {
  const handle = req.path.slice(1).toLowerCase();
  if (SESSION_RESERVED_HANDLES.has(handle)) return next();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  if (_isPagePlayDisabled(handle) && req.query.disabled !== '1') {
    return res.redirect(302, '/' + encodeURIComponent(handle) + '?disabled=1');
  }
  res.sendFile(path.join(__dirname, 'public', 'mp.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Admin auth middleware
const ADMIN_SECRET = process.env.GAME_API_SECRET;
function requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.adminKey;
  if (key === ADMIN_SECRET) return next();
  res.status(403).json({ error: 'Unauthorized' });
}

// Resolve a browser request to the WT account id by asking Chat Relay to
// verify its signed portal session or remember cookie. Returns null for guests.
async function resolveUserFromCookie(req) {
  const cookie = req.headers.cookie || '';
  if (typeof cookie !== 'string' || cookie.length > 16384 || !/(?:^|;)\s*(?:wt_remember|connect\.sid)=[^;]+/.test(cookie)) return null;
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/internal/whoami`, {
      method: 'GET',
      headers: {
        'x-api-key': process.env.GAME_API_SECRET,
        'x-forwarded-cookie': cookie,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.user) {
      return data.user.anchorId || data.user.id || null;
    }
  } catch (e) {
    console.error('[Figural] whoami failed:', e.message);
  }
  return null;
}

// ─── Symbol System ──────────────────────────────────────────────────

// Pool of visually distinct symbols
const SYMBOL_POOL = ['\u25C6', '\u25B2', '\u25CF', '\u25A0', '\u2605', '\u2716'];
// ◆ ▲ ● ■ ★ ✖

const SYMBOL_COLORS = ['cyan', 'magenta', 'lime'];
const MEANINGS = ['not_present', 'correct', 'wrong_position'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, n) {
  return shuffle(arr).slice(0, n);
}

// Report a finished round's participants to Word Tycoon for ELO / rounds-played.
//
// `state` defaults to the public round, but private streamer sessions pass their
// own session state so stream rounds count toward /goat exactly like public ones
// (2026-07-21). Bots and guests are filtered out - they play in sessions but must
// never earn a rating.
async function reportRoundToWordTycoon(state = game) {
  if (!state || !state.guesses || state.guesses.length === 0) return;

  function getIdentity(player) {
    if (!player) return null;
    if (player.linkedDiscord) return `discord:${player.linkedDiscord}`;
    return `${player.platform || 'mobile'}:${player.id || 'unknown'}`;
  }

  const seen = new Set();
  const participants = [];

  for (const guess of state.guesses) {
    const key = getIdentity(guess.player);
    if (!key || seen.has(key)) continue;
    if (!gameShared.isStatsEligible(key)) continue;
    seen.add(key);

    const isWinner = state.winner && getIdentity(state.winner) === key;
    const guesses = state.guesses.filter(g => getIdentity(g.player) === key).length;

    participants.push({
      identity: key,
      points: isWinner ? 100 : 0,
      rank: isWinner ? 1 : 2,
      wonRound: !!isWinner,
      foundTarget: !!isWinner,
      rankOutOf: 0,
      guesses,
      hits: isWinner ? 1 : 0,
      firstHitMs: null,
      articleTitle: state.word || '?'
    });
  }

  if (participants.length < 2) return;

  participants.forEach(p => p.rankOutOf = participants.length);

  try {
    const res = await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ game: 'figural', participants })
    });
    if (!res.ok) {
      console.error(`[Figural] ELO report failed/error: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[Figural] ELO report failed/error: ${err.message}`);
  }
}

// ─── Word Bank ──────────────────────────────────────────────────────

let targetsByLength = {};
let dictionaryByLength = {};
let dictSetByLength = {};   // Set versions for O(1) lookup
let targetSetByLength = {};
let wordBankLoaded = false;
let wordBankRetryTimer = null;

// Every length Figural can be played at. Declared here (not down with the rest
// of the word-length helpers) because loadWordBank below reads it — a const
// declared after its first reader is a TDZ crash waiting to happen.
const SESSION_WORD_LENGTHS = [4, 5, 6, 7, 8];

async function loadWordBank() {
  try {
    const [targetsRes, statsRes] = await Promise.all([
      fetch(`${CHAT_RELAY_URL}/api/word-bank/targets`),
      fetch(`${CHAT_RELAY_URL}/api/word-bank/stats`)
    ]);
    if (!targetsRes.ok) throw new Error('Word bank unavailable');

    targetsByLength = await targetsRes.json();
    const stats = await statsRes.json();

    // Must cover every length the game can actually be played at — a missing
    // dictionary means guesses at that length only validate against the target
    // list, so nearly every real word gets rejected.
    for (const len of stats.lengths) {
      if (len >= SESSION_WORD_LENGTHS[0] && len <= SESSION_WORD_LENGTHS[SESSION_WORD_LENGTHS.length - 1]) {
        const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/dictionary/${len}`);
        if (res.ok) dictionaryByLength[String(len)] = await res.json();
      }
    }

    // Build Set versions for O(1) word validation lookup
    dictSetByLength = {};
    targetSetByLength = {};
    for (const len of Object.keys(dictionaryByLength)) {
      dictSetByLength[len] = new Set(dictionaryByLength[len].map(w => w.toLowerCase()));
    }
    for (const len of Object.keys(targetsByLength)) {
      targetSetByLength[len] = new Set(targetsByLength[len].map(w => w.toLowerCase()));
    }

    const totalTargets = [4, 5, 6, 7, 8].reduce((sum, l) => sum + (targetsByLength[String(l)] || []).length, 0);
    console.log(`[WordBank] Loaded ${totalTargets} targets (lengths 4-8)`);
    wordBankLoaded = true;
    if (wordBankRetryTimer) {
      clearInterval(wordBankRetryTimer);
      wordBankRetryTimer = null;
      console.log(`[WordBank] Retry succeeded — now using full word bank`);
    }
  } catch (err) {
    console.log(`[WordBank] Unavailable: ${err.message}, using fallback`);
    if (!wordBankLoaded) {
      targetsByLength = {
        '4': ['game', 'word', 'play', 'find', 'clue', 'sign', 'code', 'hide'],
        '5': ['shake', 'house', 'crane', 'thick', 'brave', 'light', 'stone', 'dream'],
        '6': ['symbol', 'figure', 'puzzle', 'decode', 'cipher', 'riddle', 'enigma', 'signal']
      };
      dictionaryByLength = { ...targetsByLength };
      // Build Sets for fallback data too
      dictSetByLength = {};
      targetSetByLength = {};
      for (const len of Object.keys(dictionaryByLength)) {
        dictSetByLength[len] = new Set(dictionaryByLength[len]);
      }
      for (const len of Object.keys(targetsByLength)) {
        targetSetByLength[len] = new Set(targetsByLength[len]);
      }
    }
    // Schedule retries if not already retrying
    if (!wordBankRetryTimer) {
      wordBankRetryTimer = setInterval(() => {
        console.log(`[WordBank] Retrying word bank connection...`);
        loadWordBank();
      }, 15000); // retry every 15 seconds
    }
  }
}

function getRandomTarget(length) {
  const targets = targetsByLength[String(length)] || [];
  if (targets.length === 0) return null;
  return targets[Math.floor(Math.random() * targets.length)].toUpperCase();
}

// ─── Per-streamer word length (Chat Relay "Word Length" dashboard card) ───
// The streamer picks 4-8 or "random" at /streamer; private sessions read it
// here. Clamped to the lengths the word bank actually stocks targets for.
// (SESSION_WORD_LENGTHS itself is declared above loadWordBank, which needs it.)
const DEFAULT_SESSION_WORD_LENGTH = 5;
const _WORD_LEN_TTL_MS = 60 * 1000;
const _wordLenCache = new Map(); // handle -> { value, fetchedAt }

async function _fetchStreamerWordLength(handle) {
  const key = String(handle || '').toLowerCase();
  if (!key) return '5';
  const cached = _wordLenCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < _WORD_LEN_TTL_MS) return cached.value;
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-public/by-handle/${encodeURIComponent(key)}/difficulty`);
    if (!res.ok) {
      _wordLenCache.set(key, { value: '5', fetchedAt: Date.now() });
      return '5';
    }
    const data = await res.json();
    const value = (data && typeof data.wordLength === 'string') ? data.wordLength : '5';
    _wordLenCache.set(key, { value, fetchedAt: Date.now() });
    return value;
  } catch (_) {
    // Network glitch — keep the last known good rather than snapping back to 5.
    return (cached && cached.value) || '5';
  }
}

function _stockedSessionLengths() {
  return SESSION_WORD_LENGTHS.filter((n) => {
    const pool = targetsByLength[String(n)];
    return Array.isArray(pool) && pool.length > 0;
  });
}

// Resolves the streamer's preference to one concrete length for one round.
// 'random' re-rolls on every call, so each new round gets a fresh length.
async function getSessionWordLength(handle) {
  const avail = _stockedSessionLengths();
  if (!avail.length) return DEFAULT_SESSION_WORD_LENGTH;
  const pref = await _fetchStreamerWordLength(handle);
  if (pref === 'random') return avail[Math.floor(Math.random() * avail.length)];
  const want = parseInt(pref, 10) || DEFAULT_SESSION_WORD_LENGTH;
  if (avail.includes(want)) return want;
  // Nearest stocked length wins; ties go shorter (avail is ascending).
  return avail.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), avail[0]);
}

function isValidWord(word) {
  const len = String(word.length);
  const w = word.toLowerCase();
  const dict = dictSetByLength[len];
  const targets = targetSetByLength[len];
  return (dict && dict.has(w)) || (targets && targets.has(w));
}

// ─── Daily Word ─────────────────────────────────────────────────────

let dailyWord = null;    // { word, date, length, gameId }
const dailyRounds = gameShared.createDailyRoundStore({ file: path.join(__dirname, 'data', 'daily-rounds.json'), getCurrentDate: gameShared.getEdmontonDate });
let dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate()); // true once the daily round has started today

async function fetchDailyWord(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Figural uses lengths 4-6; fetch daily for length 5 (most common)
      const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/figural?length=5`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const data = await res.json();
      // Check if it's a new day → reset dailyPlayed
      if (dailyWord && dailyWord.date !== data.date) {
        dailyPlayed = dailyRounds.has(data.date);
        console.log(`[Figural] New daily word available for ${data.date}`);
      }
      dailyWord = data;
      return;
    } catch (e) {
      console.warn(`[Figural] Daily word fetch failed (attempt ${attempt}/${retries}):`, e.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ─── Frenzy ─────────────────────────────────────────────────────────

let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };
let connectedPlayers = 0;

// ─── Game State ─────────────────────────────────────────────────────

const WORD_LENGTHS = [4, 5, 6, 7, 8];
const AUTO_RESTART_MS = 15000;
let jackpotSettings = {
  enabled: true,
  dailyEnabled: false,
  base: 200,
  perGuess: 10,
  perSecond: 1,
  max: 5000
};

let game = null;
let autoRestartTimer = null;
let relaySocket = null;
const mpActions = require(path.join(RELAY_DIR, 'src', 'plain-game-actions')).createPlainGameActions({
  directory: path.join(__dirname, 'data', 'mp-actions'), gameId: 'figural', sdk: gameShared,
  onError: error => console.error('[MPRecovery] ' + error.message)
});
function mpMetadata(state, scope = 'public', session = null) {
  const prior = mpActions.recordFor(state)?.meta;
  return { scope, complete: !!(state.solved || state.failed), startTime: session?.gameStartTime ?? state.startTime,
    ...(state.isDaily ? { period: prior?.period || state.rewardPeriod || dailyWord?.date || gameShared.getEdmontonDate() } : {}),
    ...(session ? { handle: session.handle, noRewards: !!session.noRewards } : { dailyPlayed, jackpotSettings }) };
}
function commitGuess(state, session = null, amount = null, rawAmount = null) {
  const meta = mpMetadata(state, session ? 'session:' + session.handle : 'public', session), intentions = []; let completion;
  if (state.solved) {
    const winner = state.winner, event = state.isDaily ? 'mp-daily-win' : 'win';
    completion = { amount, rawAmount, winner, event, ...(meta.period ? { period: meta.period } : {}) };
    const intention = !session?.noRewards ? mpActions.reward('win', winner.platform || 'mobile', winner.id, winner.username, winner.displayName, amount, event,
      { guessCount: state.guesses.length, word: state.word, ...(meta.period ? { rewardPeriod: meta.period } : {}) }) : null;
    if (intention) intentions.push(intention);
  }
  try { return mpActions.accept(state, meta, intentions, completion); }
  catch (error) { console.error('[MPRecovery] ' + error.message); return null; }
}
sessionManager.setDurabilityHooks({
  restore(session) {
    const saved = mpActions.load('session:' + session.handle); if (!saved) return null;
    if (saved.record.meta.ended) return { game: null, gameStartTime: 0, isComplete: false };
    return { game: saved.state, gameStartTime: saved.record.meta.startTime, isComplete: !!(saved.state.solved || saved.state.failed), noRewards: !!saved.record.meta.noRewards };
  },
  saveNew: session => mpActions.save(session.game, 'session:' + session.handle, mpMetadata(session.game, 'session:' + session.handle, session)),
  end(session) { const record = mpActions.journal.current('session:' + session.handle); if (record) mpActions.journal.commit(record.scope, record.roundId, record.state, { ...record.meta, ended: true }); }
});
function browserPlayer(data, socket) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.word !== 'string' || !data.word || data.word.length > 64) return null;
  const player = data.player || {};
  if (typeof player !== 'object' || Array.isArray(player)) return null;
  for (const [field, limit] of [['username',80],['displayName',80],['id',128],['linkedDiscord',128],['profilePic',2048]]) {
    if (player[field] != null && (typeof player[field] !== 'string' || player[field].length > limit)) return null;
  }
  return { username: player.username || 'Player', displayName: player.displayName || player.username || 'Player',
    profilePic: player.profilePic || null, id: player.id || null, linkedDiscord: player.linkedDiscord || null, platform: 'web' };
}


/**
 * Generate symbol feedback for a guess against the secret word.
 *
 * KEY MECHANIC: Symbols correspond to the ANSWER's letters, not the guess's letters.
 * For each position in the answer:
 *   - If that answer letter does NOT appear anywhere in the guess → "not_present" symbol
 *   - If that answer letter appears in the guess at the SAME position → "correct" symbol
 *   - If that answer letter appears in the guess but at a DIFFERENT position → "wrong_position" symbol
 */
function generateSymbolFeedback(guess, secretWord, meaningToSymbol) {
  const symbols = [];
  for (let i = 0; i < secretWord.length; i++) {
    const answerLetter = secretWord[i];
    const guessHasLetter = guess.includes(answerLetter);

    if (!guessHasLetter) {
      symbols.push(meaningToSymbol.not_present);
    } else if (guess[i] === answerLetter) {
      symbols.push(meaningToSymbol.correct);
    } else {
      symbols.push(meaningToSymbol.wrong_position);
    }
  }
  return symbols;
}

function newGame() {
  const previous = { game, dailyPlayed };
  try {
  if (autoRestartTimer) {
    clearTimeout(autoRestartTimer);
    autoRestartTimer = null;
  }

  let wordLength;
  let word;
  let isDaily = false;

  // Use daily word for the first round of the day (Edmonton timezone — matches word bank)
  const today = gameShared.getEdmontonDate();
  if (!dailyPlayed && dailyWord && dailyWord.date === today && jackpotSettings.dailyEnabled) {
    word = dailyWord.word.toUpperCase();
    wordLength = dailyWord.length || word.length;
    isDaily = true;
    dailyPlayed = true;
    console.log(`[Game] DAILY round (${wordLength} letters)`);
  } else {
    // Multiplayer rounds stay on the canonical 5-letter board.
    wordLength = 5;
    word = getRandomTarget(wordLength);
  }

  if (!word) {
    console.error(`[Game] No targets for length ${wordLength}`);
    dailyPlayed = previous.dailyPlayed; return false;
  }

  // Pick 3 random symbols from the pool
  const symbols = pickRandom(SYMBOL_POOL, 3);

  // Randomly assign each symbol a meaning
  const shuffledMeanings = shuffle(MEANINGS);
  const symbolMeanings = {};    // symbol → meaning
  const meaningToSymbol = {};   // meaning → symbol
  symbols.forEach((sym, i) => {
    symbolMeanings[sym] = shuffledMeanings[i];
    meaningToSymbol[shuffledMeanings[i]] = sym;
  });

  game = {
    word,
    wordLength,
    symbols,
    symbolColors: [...SYMBOL_COLORS],
    symbolMeanings,
    meaningToSymbol,
    guesses: [],
    solved: false,
    failed: false,
    winner: null,
    startTime: Date.now(),
    isDaily,
    hintRevealed: new Set()
  };

  console.log(`[Game] New round: ${wordLength} letters${isDaily ? ' [DAILY]' : ''}, symbols: ${symbols.join(' ')}`);

  game.rewardPeriod = game.isDaily ? dailyWord?.date || gameShared.getEdmontonDate() : undefined;
  mpActions.save(game, 'public', mpMetadata(game));
  if (game.isDaily) dailyRounds.consume(game.rewardPeriod);
  io.to('public').emit('new-game', getPublicState());
  return true;
  } catch (error) {
    let committed = false; try { committed = !!mpActions.recordFor(game); } catch {}
    if (!committed) { game = previous.game; dailyPlayed = previous.dailyPlayed; }
    throw error;
  }
}

function getPublicState() {
  if (!game) return null;
  return {
    wordLength: game.wordLength,
    symbols: game.symbols,
    symbolColors: game.symbolColors,
    guesses: game.guesses.map(g => ({
      word: g.word,
      symbols: g.symbols,
      player: g.player ? {
        username: g.player.username,
        displayName: g.player.displayName,
        profilePic: g.player.profilePic,
        cosmetics: g.player.cosmetics
      } : null
    })),
    maxGuesses: null,
    guessesLeft: null,
    solved: game.solved,
    failed: false,
    winner: game.winner ? {
      id: game.winner.id, platform: game.winner.platform,
      username: game.winner.username,
      displayName: game.winner.displayName,
      profilePic: game.winner.profilePic,
      cosmetics: game.winner.cosmetics
    } : null,
    word: (game.solved || game.failed) ? game.word : undefined,
    jackpot: publicPot(),
    jackpotEnabled: jackpotSettings.enabled,
    startTime: game.startTime,
    isDaily: game.isDaily || false,
    frenzy: currentFrenzy
  };
}

function calculateJackpot() {
  if (!game) return 0;
  const completed = game.solved ? mpActions.recordFor(game)?.completion : null;
  if (completed) return completed.rawAmount;
  if (!jackpotSettings.enabled) return 0;
  const elapsed = Math.max(0, Math.floor((Date.now() - (game.potStartTime ?? game.startTime)) / 1000));
  const raw = jackpotSettings.base + Math.max(0, game.guesses.length - (game.potGuessBaseline || 0)) * jackpotSettings.perGuess + elapsed * jackpotSettings.perSecond;
  return jackpotSettings.max > 0 ? Math.min(raw, jackpotSettings.max) : raw;
}

function publicPot() {
  if (!game) return 0;
  const completed = game.solved ? mpActions.recordFor(game)?.completion : null;
  if (completed) return completed.amount;
  return Math.floor(calculateJackpot() * (currentFrenzy.multiplier || 1.0));
}
let potBroadcastTimer = null;
function startPotBroadcast() {
  if (potBroadcastTimer) clearInterval(potBroadcastTimer);
  potBroadcastTimer = setInterval(() => {
    if (game && !game.solved && !game.failed) io.to('public').emit('jackpot-update', { jackpot: publicPot() });
    for (const row of sessionManager.listSessions()) {
      const room = _sessionRoom(row.handle);
      if (!io.sockets.adapter.rooms.has(room)) continue;
      const session = sessionManager.getSession(row.handle);
      if (session?.game && !session.game.solved && !session.game.failed) io.to(room).emit('jackpot-update', { jackpot: _calcSessionPot(session) });
    }
  }, 1000);
  potBroadcastTimer.unref();
}

function processGuess(word, player, socket) {
  if (!game || game.solved || game.failed) return null;

  if (typeof word !== 'string' || word.length > 64) return null;
  if (game.isDaily && mpActions.recordFor(game)?.meta.period !== gameShared.getEdmontonDate()) { newGame(); return { error: 'The daily round changed. Please try again.' }; }
  word = word.toUpperCase().trim();

  if (word.length !== game.wordLength) return null;
  if (!/^[A-Z]+$/.test(word)) return null;
  if (!isValidWord(word)) return { error: 'Not a valid word' };
  if (game.guesses.some(g => g.word === word)) return { error: 'Already guessed' };

  // Generate symbol feedback
  const symbols = generateSymbolFeedback(word, game.word, game.meaningToSymbol);

  try { if (!mpActions.recordFor(game)) mpActions.save(game, 'public', mpMetadata(game)); }
  catch { return { error: 'Progress storage unavailable; please retry' }; }
  const guessEntry = {
    word,
    symbols,
    player: player || { username: 'Player', displayName: 'Player' },
    timestamp: Date.now()
  };

  game.guesses.push(guessEntry);

  // Check win
  if (word === game.word) {
    game.solved = true;
    game.winner = guessEntry.player;
    const basePot = jackpotSettings.enabled ? calculateJackpot() : 0;
    const jackpot = Math.floor(basePot * (currentFrenzy.multiplier || 1.0));
    if (!commitGuess(game, null, jackpot, basePot)) return { error: 'Progress storage unavailable; please retry' };
    if (player && player.id) gameShared.reportLibraryWord(player.platform || 'mobile', player.id, word, 'figural', player.username, player.displayName, socket);

    const result = {
      guess: { word: guessEntry.word, symbols: guessEntry.symbols, player: guessEntry.player },
      guessNumber: game.guesses.length,
      solved: true,
      word: game.word,
      winner: game.winner,
      jackpot,
      isDaily: game.isDaily || false
    };

    io.to('public').emit('guess-result', result);
    io.to('public').emit('game-over', { won: true, word: game.word, winner: game.winner, jackpot, isDaily: game.isDaily || false });
    if (relaySocket && relaySocket.connected) {
      relaySocket.emit('game-win', {
        game: 'figural', gameName: 'Figural',
        word: game.word,
        winner: game.winner,
        jackpot,
        guessCount: game.guesses.length,
        isDaily: game.isDaily || false,
      });
    }

    const frenzyNote = currentFrenzy.multiplier > 1 ? ` (FRENZY ${currentFrenzy.multiplier}x)` : '';
    console.log(`[Game] Won in ${game.guesses.length} guesses! Pot: ${jackpot} coins${frenzyNote}${game.isDaily ? ' [DAILY]' : ''}`);

    if (player && player.id && player.platform) {
      const rewardEvent = game.isDaily ? 'mp-daily-win' : 'win';
      mpActions.sendLegacyReward(game, player.platform || 'mobile', player.id, player.username, player.displayName || player.username, jackpot, rewardEvent, { guessCount: game.guesses.length, word: game.word });
      // Notify Chat Relay when daily game is won (advances daily sequence)
      if (game.isDaily && relaySocket && relaySocket.connected) {
        relaySocket.emit('daily-win', { game: 'figural', winner: player.displayName || player.username, platform: player.platform });
      }
    }

    reportRoundToWordTycoon().catch(e => console.log("[Figural] ELO report failed: " + e.message));

    autoRestartTimer = setTimeout(() => newGame(), AUTO_RESTART_MS);
    return result;
  }

  if (!commitGuess(game)) return { error: 'Progress storage unavailable; please retry' };
  if (player && player.id) gameShared.reportLibraryWord(player.platform || 'mobile', player.id, word, 'figural', player.username, player.displayName, socket);
  // Normal guess (unlimited guesses in MP — no fail condition)
  const result = {
    guess: { word: guessEntry.word, symbols: guessEntry.symbols, player: guessEntry.player },
    guessNumber: game.guesses.length
  };

  io.to('public').emit('guess-result', result);
  return result;
}

// ─── REST API ───────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  res.json({ ok: true, game: getPublicState(), playerCount: connectedPlayers });
});

app.get('/api/admin-state', requireAdmin, (req, res) => {
  if (!game) return res.json({ ok: false });
  res.json({
    ok: true,
    game: {
      ...getPublicState(),
      word: game.word,
      symbolMeanings: game.symbolMeanings
    }
  });
});

app.post('/api/new-game', requireAdmin, (req, res) => {
  newGame();
  res.json({ ok: true });
});

// SP word lists endpoint (serves cached word bank data to SP client)
app.get('/api/sp/words/:length', (req, res) => {
  const len = req.params.length;
  const targets = targetsByLength[len] || [];
  const dictionary = dictionaryByLength[len] || [];
  if (!targets.length) return res.status(404).json({ error: 'No words for length ' + len });
  res.json({ targets, dictionary });
});

app.get('/api/sp/daily', async (req, res) => {
  try {
    const len = parseInt(req.query.length) || 5;
    const r = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/figural-sp?length=${len}`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(404).json({ error: 'unavailable' });
    const data = await r.json();
    res.json({ word: data.word, date: data.date, length: data.length });
  } catch (e) { console.error('[Figural] Daily endpoint error:', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/sp/daily/complete', (req, res) => {
    res.json({ ok: true });
});

app.get('/api/jackpot/settings', (req, res) => {
  res.json({
    ok: true,
    enabled: jackpotSettings.enabled,
    dailyEnabled: jackpotSettings.dailyEnabled,
    base: jackpotSettings.base,
    perGuess: jackpotSettings.perGuess,
    perSecond: jackpotSettings.perSecond,
    max: jackpotSettings.max,
    current: calculateJackpot(),
  });
});

app.post('/api/jackpot/settings', requireAdmin, (req, res) => {
  const before = { ...jackpotSettings };
  const b = req.body || {};
  if (typeof b.enabled === 'boolean') jackpotSettings.enabled = b.enabled;
  if (typeof b.dailyEnabled === 'boolean') jackpotSettings.dailyEnabled = b.dailyEnabled;
  if (Number.isFinite(b.base) && b.base >= 0 && b.base <= 1000000) jackpotSettings.base = b.base;
  if (Number.isFinite(b.perGuess) && b.perGuess >= 0 && b.perGuess <= 1000000) jackpotSettings.perGuess = b.perGuess;
  if (Number.isFinite(b.perSecond) && b.perSecond >= 0 && b.perSecond <= 1000000) jackpotSettings.perSecond = b.perSecond;
  if (Number.isFinite(b.max) && b.max >= 0 && b.max <= 1000000) jackpotSettings.max = b.max;
  try { if (game) mpActions.save(game, 'public', mpMetadata(game)); }
  catch { jackpotSettings = before; return res.status(503).json({ ok: false, error: 'Progress storage unavailable; please retry' }); }
  res.json({ ok: true, ...jackpotSettings, current: calculateJackpot() });
});

app.post('/api/jackpot/reset', requireAdmin, (req, res) => {
  if (!game || game.solved || game.failed) return res.status(409).json({ ok: false, error: 'No active round to reset' });
  const previous = { potStartTime: game.potStartTime, potGuessBaseline: game.potGuessBaseline };
  game.potStartTime = Date.now(); game.potGuessBaseline = game.guesses.length;
  try { mpActions.save(game, 'public', mpMetadata(game)); }
  catch { Object.assign(game, previous); return res.status(503).json({ ok: false, error: 'Progress storage unavailable; please retry' }); }
  res.json({ ok: true, current: calculateJackpot() });
});
// ─── Monthly hint helpers ────────────────────────────────────────────

function getHintRound(handle) {
  const state = handle === 'public' ? game : sessionManager.getSession(handle)?.game;
  if (!state || !state.startTime || !Number.isFinite(new Date(state.startTime).getTime())) return null;
  return { state: { ...state, gameOver: state.solved || state.failed }, startTime: new Date(state.startTime).toISOString() };
}


// Monthly hint allowance: how many hints remain for the authenticated user.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[Figural] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal one symbol's meaning.
app.post('/api/hints/use', require('./src/paid-hints').createTransactionalHintHandler({
  resolveUser: resolveUserFromCookie, getRound: getHintRound, secret: process.env.HINT_ROUND_ID_SECRET,
  gameId: 'figural',
  candidateBuilder: require('./src/paid-hints').candidatesForSymbols,
  async relay(endpoint, body) {
    const response = await fetch(`${CHAT_RELAY_URL}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error('Hint service unavailable');
    return response.json();
  },
}));

// ─── Session-mode helpers ────────────────────────────────────────────
function _calcSessionPot(s) {
  if (!s || !s.game) return 0;
  const completed = s.game.solved ? mpActions.recordFor(s.game)?.completion : null;
  if (completed) return completed.amount;
  if (!jackpotSettings.enabled) return 0;
  const elapsed = Math.max(0, Math.floor((Date.now() - s.gameStartTime) / 1000));
  const raw = jackpotSettings.base + s.game.guesses.length * jackpotSettings.perGuess + elapsed * jackpotSettings.perSecond;
  return jackpotSettings.max > 0 ? Math.min(raw, jackpotSettings.max) : raw;
}

function _generateSessionSymbolFeedback(guess, secretWord, meaningToSymbol) {
  const symbols = [];
  for (let i = 0; i < secretWord.length; i++) {
    const answerLetter = secretWord[i];
    const guessHasLetter = guess.includes(answerLetter);
    if (!guessHasLetter) symbols.push(meaningToSymbol.not_present);
    else if (guess[i] === answerLetter) symbols.push(meaningToSymbol.correct);
    else symbols.push(meaningToSymbol.wrong_position);
  }
  return symbols;
}

async function _processSessionGuess(session, word, player, responseSocket) {
  if (!session || !session.game) return null;
  const g = session.game;
  if (g.solved || g.failed) return null;
  word = String(word || '').toUpperCase().trim();
  if (word.length !== g.wordLength) return null;
  if (!/^[A-Z]+$/.test(word)) return null;
  if (!isValidWord(word)) return { error: 'Not a valid word' };
  if (g.guesses.some(x => x.word === word)) return { error: 'Already guessed' };

  try { if (!mpActions.recordFor(g)) mpActions.save(g, 'session:' + session.handle, mpMetadata(g, 'session:' + session.handle, session)); }
  catch { return { error: 'Progress storage unavailable; please retry' }; }
  const symbols = _generateSessionSymbolFeedback(word, g.word, g.meaningToSymbol);
  const guessEntry = {
    word, symbols,
    player: player || { username: 'Player', displayName: 'Player' },
    timestamp: Date.now(),
  };
  g.guesses.push(guessEntry);

  const room = _sessionRoom(session.handle);
  if (word === g.word) {
    g.solved = true;
    g.winner = guessEntry.player;
    const finalPot = jackpotSettings.enabled ? _calcSessionPot(session) : 0;
    if (!commitGuess(g, session, finalPot, finalPot)) return { error: 'Progress storage unavailable; please retry' };
    session.isComplete = true;
  if (!session.noRewards && player && player.id) {
    gameShared.reportLibraryWord(player.platform || 'mobile', player.id, word, 'figural', player.username, player.displayName);
  }
    const result = {
      guess: { word, symbols, player: guessEntry.player },
      guessNumber: g.guesses.length,
      solved: true, word: g.word, winner: g.winner,
      jackpot: finalPot, isDaily: false,
    };
    io.to(room).emit('guess-result', result);
    io.to(room).emit('game-over', { won: true, word: g.word, winner: g.winner, jackpot: finalPot, isDaily: false });
    const _winPayload = {
      game: 'figural', gameName: 'Figural',
      word: g.word, winner: g.winner,
      jackpot: finalPot,
      guessCount: g.guesses.length,
      isDaily: false,
      streamerHandle: session.handle,
    };
    io.to(room).emit('game-win', _winPayload);
    if (relaySocket && relaySocket.connected) {
      relaySocket.emit('game-win', _winPayload);
    }
    if (!session.noRewards && player && player.id && player.platform) {
      mpActions.sendLegacyReward(g, player.platform || 'mobile', player.id, player.username, player.displayName || player.username, finalPot, 'win', { guessCount: g.guesses.length, word: g.word });
    }
    // Stream rounds count toward /goat ELO + rounds played, same as public.
    if (!session.noRewards) reportRoundToWordTycoon(g).catch(e => console.log('[Figural] session ELO report failed: ' + e.message));
    sessionManager.scheduleSave();
    session.autoRestartTimer = setTimeout(() => {
      // Re-resolve the length each round so a dashboard change (or 'random')
      // takes effect on the very next round without ending the session.
      (async () => {
        try {
          const wordLength = await getSessionWordLength(session.handle);
          if (sessionManager.restartSession(session, { targetsByLength, wordLength })) {
            io.to(room).emit('new-game', sessionManager.buildSessionState(session, jackpotSettings, _calcSessionPot));
            console.log(`[Session] "${session.handle}" auto-restarted (${session.game.wordLength} letters)`);
          }
        } catch (err) {
          console.error(`[Session] "${session.handle}" auto-restart failed:`, err.message);
        }
      })();
    }, AUTO_RESTART_MS);
    return result;
  }

  const result = {
    guess: { word, symbols, player: guessEntry.player },
    guessNumber: g.guesses.length,
  };
  sessionManager.scheduleSave();
  io.to(room).emit('guess-result', result);
  return result;
}

async function handleSessionChat(msg) {
  const handle = String(msg.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  if (!_validStreamerHandles.has(handle)) return;
  const platform = String(msg.platform || 'mobile');
  const platformUserId = String((msg.user && (msg.user.id || msg.user.userId)) || msg.platformUserId || '');
  if (platform && platformUserId && _isStreamerBlocking(handle, platform, platformUserId)) return;

  let session;
  try {
    session = await sessionManager.getOrCreateSession({
      handle, sessionId: msg.streamSession || null,
      opts: { targetsByLength, wordLength: await getSessionWordLength(handle) },
    });
  } catch (err) {
    console.warn(`[Session] "${handle}" create failed:`, err.message);
    return;
  }
  if (!session || !session.game) return;

  const text = (msg.message || '').trim().toUpperCase();
  if (text.includes(' ') || text.length !== session.game.wordLength) return;
  if (!/^[A-Z]+$/.test(text)) return;

  const player = {
    id: platformUserId || 'unknown',
    username: msg.user?.username || 'chatter',
    displayName: msg.user?.displayName || msg.user?.username || 'Chatter',
    profilePic: msg.user?.profilePic || null,
    platform,
    linkedDiscord: msg.linkedDiscord || null,
    isFanClub: Array.isArray(msg.user?.badges) && msg.user.badges.indexOf('fan-club') !== -1,
  };
  try {
    const cosmetics = await gameShared.getPlayerCosmetics(
      player.linkedDiscord ? 'discord' : player.platform,
      player.linkedDiscord || player.id,
    );
    if (cosmetics && Object.keys(cosmetics).length) player.cosmetics = cosmetics;
  } catch (_) {}
  await _processSessionGuess(session, text, player, null);
}

// Admin session endpoints
app.post('/api/session/end', requireAdmin, (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = sessionManager.endSession(handle);
  res.json({ ok: true, had });
});
app.post('/api/session/redirect', requireAdmin, (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const targetUrl = String((req.body && req.body.targetUrl) || '').trim();
  const targetGameName = String((req.body && req.body.targetGameName) || '').trim();
  const targetGameId = String((req.body && req.body.targetGameId) || '').trim();
  if (!targetUrl) return res.status(400).json({ ok: false, error: 'targetUrl required' });
  _streamerRedirectTargets.set(handle, { targetUrl, targetGameName, targetGameId });
  io.to(_sessionRoom(handle)).emit('session-redirect', { handle, targetUrl, targetGameName, targetGameId });
  res.json({ ok: true });
});
app.post('/api/session/clear-redirect', requireAdmin, (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = _streamerRedirectTargets.delete(handle);
  res.json({ ok: true, had });
});

// ─── Socket.IO (browser solo play + overlay) ────────────────────────

io.on('connection', async (socket) => {
  // Streamer-private session viewer/overlay branch
  const sessionHandleRaw = socket.handshake?.auth?.session;
  const sessionHandle = typeof sessionHandleRaw === 'string'
    ? sessionHandleRaw.toLowerCase().trim() : null;
  if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
    if (!_validStreamerHandles.has(sessionHandle)) {
      socket.emit('game-state', { error: 'Unknown streamer', isSession: true });
      return;
    }
    const _redir = _streamerRedirectTargets.get(sessionHandle);
    if (_redir) {
      socket.emit('session-redirect', { handle: sessionHandle, ..._redir });
      return;
    }
    socket._isSession = true;
    socket._sessionHandle = sessionHandle;
    socket.join(_sessionRoom(sessionHandle));
    try {
      const session = await sessionManager.getOrCreateSession({ handle: sessionHandle, opts: { targetsByLength, wordLength: await getSessionWordLength(sessionHandle) } });
      if (session) {
        socket.emit('game-state', sessionManager.buildSessionState(session, jackpotSettings, _calcSessionPot));
      } else {
        socket.emit('game-state', { error: 'Session unavailable', isSession: true });
      }
    } catch (err) {
      console.warn(`[Session] connect for "${sessionHandle}" failed:`, err.message);
      socket.emit('game-state', { error: 'Session unavailable', isSession: true });
    }
    socket.on('guess', async (data) => {
      const session = sessionManager.getSession(sessionHandle);
      if (!session) return;
      const player = browserPlayer(data, socket); if (!player) return;
      const submittedRound = session.game;
      // Premium gate (2026-07-31): page play in a streamer room is Donor-only
      // too. TikTok/Discord chat play-along is unaffected — those guesses come
      // through the relay chat client, never this socket.
      if (!(await passesPremiumWebGate([player.linkedDiscord, player.id], socket, 'session'))) return;
      // Perk badges for this web player, resolved by the premium gate above.
      if (session.game !== submittedRound || sessionManager.getSession(sessionHandle) !== session) return;
      player.platform = 'web'; player.id = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentity; player.linkedDiscord = null;
      Object.assign(player, socket._wtPerks || {});
      gameShared.reportSocketIP(socket, player.platform || 'mobile', player.id, 'figural');
      const result = await _processSessionGuess(session, data.word, player, socket);
      if (result?.error) socket.emit('error-msg', { message: result.error });
    });
    socket.on('disconnect', () => {});
    return;
  }

  // Public socket
  socket.join('public');
  connectedPlayers++;
  socket.emit('game-state', getPublicState());

  // Admin auth via socket
  socket.on('admin-auth', (key) => {
    if (key === ADMIN_SECRET) socket.isAdmin = true;
  });

  socket.on('guess', async (data) => {
    const player = browserPlayer(data, socket); if (!player) return;
    const submittedRound = game;

    const now = Date.now();
    if (socket._lastGuess && now - socket._lastGuess < 500) {
      socket.emit('error-msg', { message: 'Too fast!' });
      return;
    }
    socket._lastGuess = now;


    // Premium gate: only public web sockets reach this handler.
    if (!(await passesPremiumWebGate([player.linkedDiscord, player.id], socket))) return;
    // Perk badges for this web player, resolved by the premium gate above.
    if (game !== submittedRound) return;
    player.platform = 'web'; player.id = socket._wtVerifiedAnchorId || socket._wtVerifiedIdentity; player.linkedDiscord = null;
    Object.assign(player, socket._wtPerks || {});
    gameShared.reportSocketIP(socket, player.platform || 'mobile', player.id, 'figural');

    const result = processGuess(data.word, player, socket);
    if (result && result.error) {
      socket.emit('error-msg', { message: result.error });
    }
  });

  socket.on('new-game', () => {
    if (!socket.isAdmin) return;
    newGame();
  });

  socket.on('disconnect', () => {
    connectedPlayers--;
  });
});

// ─── Chat Relay Connection ──────────────────────────────────────────

function connectToChatRelay() {
  relaySocket = gameShared.createRelayClient({
    id: 'figural',
    name: 'Figural',
    port: PORT,
    apiSecret: ADMIN_SECRET,
    relayUrl: CHAT_RELAY_URL,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000
  }, {
    onChat: async (msg) => {
    if (!msg || !msg.message) return;
    // Streamer-private session: route to per-streamer state if tagged.
    if (msg.streamerHandle) {
      handleSessionChat(msg).catch(() => {});
      return;
    }
    if (!game || game.solved) return;

    const text = msg.message.trim().toUpperCase();

    // Only process single-word messages that match the word length
    if (text.includes(' ') || text.length !== game.wordLength) return;
    if (!/^[A-Z]+$/.test(text)) return;

    const player = {
      id: msg.platformUserId || msg.user?.id || 'unknown',
      username: msg.user?.username || 'chatter',
      displayName: msg.user?.displayName || msg.user?.username || 'Chatter',
      profilePic: msg.user?.profilePic || null,
      platform: msg.platform || 'mobile',
      linkedDiscord: msg.linkedDiscord || null,
      isFanClub: Array.isArray(msg.user?.badges) && msg.user.badges.indexOf('fan-club') !== -1,
    };

    const submittedRound = game;
    // Fetch cosmetics
    try {
      const cosmetics = await gameShared.getPlayerCosmetics(
        player.linkedDiscord ? 'discord' : player.platform,
        player.linkedDiscord || player.id
      );
      if (cosmetics && Object.keys(cosmetics).length) player.cosmetics = cosmetics;
    } catch (e) { /* ignore */ }

    if (game !== submittedRound) return;
    processGuess(text, player);
    },
    onCosmeticsUpdated: (data) => {
    if (data && data.platform && data.platformUserId) {
      gameShared.invalidateCosmetics(data.platform, data.platformUserId, data.equipped);

      // Update in-memory game state so OBS overlay reflects changes immediately
      if (game && game.guesses) {
        let changed = false;
        const matchPlayer = (p) => p && (
          (p.platform === data.platform && p.id === data.platformUserId) ||
          (p.linkedDiscord && p.linkedDiscord === data.platformUserId)
        );
        for (const g of game.guesses) {
          if (matchPlayer(g.player)) {
            g.player.cosmetics = data.equipped || {};
            changed = true;
          }
        }
        if (matchPlayer(game.winner)) {
          game.winner.cosmetics = data.equipped || {};
          changed = true;
        }
        if (changed) {
          io.to('public').emit('game-state', getPublicState());
        }
      }
    }
    },
    onFrenzyUpdate: (data) => {
    if (data && typeof data.multiplier === 'number') {
      currentFrenzy = data;
      io.to('public').emit('frenzy-update', data);
    }
    },
    onActivateDaily: async () => {
    console.log('[Figural] activate-daily received from Chat Relay');
    await fetchDailyWord();
    dailyRounds.reset(gameShared.getEdmontonDate());
    dailyPlayed = false;
    jackpotSettings.dailyEnabled = true;
    if (game) mpActions.save(game, 'public', mpMetadata(game));
    if (!game || game.solved || game.failed) {
      if (autoRestartTimer) { clearTimeout(autoRestartTimer); autoRestartTimer = null; }
      newGame();
    } else {
      console.log('[Figural] Game in progress — daily will start after current game ends');
    }
    }
  });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────

function shutdown(signal) {
  console.log(`[Server] ${signal} received, shutting down...`);
  if (autoRestartTimer) clearTimeout(autoRestartTimer);
  if (potBroadcastTimer) clearInterval(potBroadcastTimer);
  if (relaySocket) relaySocket.disconnect();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── Start ──────────────────────────────────────────────────────────

async function start() {
  const recovered = mpActions.load('public');
  if (recovered) {
    game = recovered.state; jackpotSettings = recovered.record.meta.jackpotSettings || jackpotSettings;
    if (game.isDaily && recovered.record.meta.period === gameShared.getEdmontonDate()) dailyRounds.consume(recovered.record.meta.period);
    dailyPlayed = dailyRounds.has(gameShared.getEdmontonDate());
  }
  await loadWordBank();

  // Fetch daily word (non-fatal if Chat Relay not ready yet)
  await fetchDailyWord();
  setInterval(fetchDailyWord, 3600000); // refresh hourly

  if (!recovered || (game.isDaily && recovered.record.meta.period !== gameShared.getEdmontonDate())) newGame();
  else { mpActions.recover(); if (game.solved || game.failed) autoRestartTimer = setTimeout(() => newGame(), AUTO_RESTART_MS); }

  startPotBroadcast();
  server.listen(PORT, () => {
    console.log(`[Server] Figural running at http://localhost:${PORT}`);
    connectToChatRelay();
  });
}

start().catch(err => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
