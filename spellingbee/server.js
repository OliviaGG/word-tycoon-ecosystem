try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
const express = require('express');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const path = require('path');
const Dictionary = require('./src/dictionary');
const Game = require('./src/game');
const ChatClient = require('./src/chatClient');
const storage = require('./src/storage');
const { snapshotMetadata, restoreMetadata } = require('./src/round-metadata');
const sessionManager = require('./src/session-manager');
const { createBeeRecovery } = require('./src/mp-recovery');
const DATA_DIR = process.env.SPELLINGBEE_DATA_DIR || path.join(__dirname, 'data');
let recovery = null;
let savedGames = [];
let dailyConsumedDate = null;

const PORT = process.env.PORT || 3013;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const relayFetch = require('./src/relay-request').createRelayRequest({ baseUrl: CHAT_RELAY_URL });

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

// ─── Streamer whitelist + redirect targets (declared above any closure) ──
let _validStreamerHandles = new Set();
let _streamerSettings = new Map();
const _streamerRedirectTargets = new Map();
async function _refreshStreamerHandles() {
  try {
    const res = await relayFetch(`${CHAT_RELAY_URL}/api/streamer-handles`);
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
  } catch (_) { /* keep stale */ }
}
_refreshStreamerHandles();
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
function _sessionRoom(handle) { return `spellingbee:session:${String(handle || '').toLowerCase()}`; }
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));

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
    const res = await relayFetch(`${CHAT_RELAY_URL}/api/internal/whoami`, {
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
    console.error('[SpellingBee] whoami failed:', e.message);
  }
  return null;
}

// ── Monthly hint helpers ────────────────────────────────────────────
// SpellingBee has 7 puzzle letters rather than a single target word.
// A hint reveals one unrevealed letter from the current puzzle's letter set.
const _hintReveals = new Map(); // handle -> { puzzleKey, revealedSet }

function getGameStateForHandle(handle) {
  if (!handle || handle === 'public') return game;
  const session = sessionManager.getSession(handle);
  return session?.game || game;
}

function generateHintForHandle(handle) {
  const target = getGameStateForHandle(handle);
  const letters = target && target.letters;
  if (!letters || letters.length !== 7 || target.status !== 'active') return null;

  const puzzleKey = target.puzzleId !== undefined
    ? String(target.puzzleId)
    : letters.join('').toLowerCase();

  let rec = _hintReveals.get(handle);
  if (!rec || rec.puzzleKey !== puzzleKey) {
    rec = { puzzleKey, revealed: new Set() };
    _hintReveals.set(handle, rec);
  }

  const available = letters.filter(l => !rec.revealed.has(l.toLowerCase()));
  if (!available.length) {
    // Puzzle exhausted — reset so the user can keep getting hints.
    rec.revealed.clear();
    available.push(...letters);
  }

  const letter = available[Math.floor(Math.random() * available.length)].toUpperCase();
  rec.revealed.add(letter.toLowerCase());
  return { letter };
}

// Pre-made puzzles
const puzzlesPath = path.join(DATA_DIR, 'puzzles.json');
let puzzles = [];
let currentPuzzleIndex = 0;
let newGameTimer = null;

// Jackpot configuration (configurable via /api/jackpot/settings)
const settingsPath = path.join(DATA_DIR, 'settings.json');
let jackpotSettings = {
  enabled: true,
  dailyEnabled: true,
  base: 200,
  perGuess: 15,   // "perGuess" = per word found
  perSecond: 5,
  max: 6000
};
let jackpotBroadcastTimer = null;
let gameStartTime = Date.now();

// Weekly puzzle state
let weeklyWord = null;
let weeklyPlayed = false;
let isWeekly = false;
let weeklyFetchInterval = null;

// Daily puzzle state (MP mode)
let dailyWord = null;       // { word, date, length, gameId }
let dailyPlayed = false;    // has today's daily been played?
let isDaily = false;        // is current game the daily?
let playedPuzzleIds = new Set();  // track played pool puzzle IDs
const playedPuzzlesPath = path.join(DATA_DIR, 'played-puzzles.json');

// Frenzy state
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };
let connectedPlayers = 0;

async function fetchWeeklyWord() {
  try {
    const res = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/weekly/spellingbee?length=7&uniqueLetters=7`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const data = await res.json();
    if (weeklyWord && weeklyWord.weekStart !== data.weekStart) weeklyPlayed = false;
    weeklyWord = data;
  } catch (e) { console.warn('[SpellingBee] Weekly word fetch failed:', e.message); }
}

async function fetchDailyWord() {
  try {
    const res = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/daily/spellingbee?length=7&uniqueLetters=7`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const data = await res.json();
    // Reset dailyPlayed if date changed
    if (dailyWord && dailyWord.date !== data.date) {
      dailyPlayed = false;
    }
    dailyWord = data;
    console.log(`[SpellingBee] Daily word fetched for ${data.date} (${data.word.length} letters)`);
  } catch (e) {
    console.warn('[SpellingBee] Daily word fetch failed:', e.message);
  }
}

function loadPlayedPuzzleIds() {
  if(fs.existsSync(playedPuzzlesPath)){
    const data=JSON.parse(fs.readFileSync(playedPuzzlesPath,'utf8'));
    if(!Array.isArray(data)||data.length>10000)throw Error('Invalid legacy played puzzle IDs');
    playedPuzzleIds=new Set(data);
  }
}

function savePlayedPuzzleIds() {
  try {
    const dir = path.dirname(playedPuzzlesPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(playedPuzzlesPath, [...playedPuzzleIds]);
  } catch (e) {
    console.warn('[Puzzles] Failed to save played puzzles:', e.message);
  }
}

function validArchivePeriod(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function canonicalArchiveHive(letters, centerLetter) {
  if (!Array.isArray(letters) || letters.length !== 7 || letters.some(letter => typeof letter !== 'string' || !/^[a-z]$/i.test(letter))) return null;
  const normalized = letters.map(letter => letter.toLowerCase());
  if (new Set(normalized).size !== 7 || typeof centerLetter !== 'string' || !normalized.includes(centerLetter.toLowerCase())) return null;
  return { letters: normalized, centerLetter: centerLetter.toLowerCase() };
}

function appendArchivePuzzle(puzzle) {
  if (puzzles.some(p => p.id === puzzle.id)) return true;
  const next = [...puzzles, puzzle];
  while (next.length > 200) {
    const index = next.findIndex(p => !String(p.id).startsWith('daily-') && !String(p.id).startsWith('weekly-'));
    next.splice(index >= 0 ? index : 0, 1);
  }
  try {
    if(recovery){
      recovery.run(game,null,()=>{puzzles=next;});
      try{atomicWriteSync(puzzlesPath,next);}catch(_){console.warn('[Archive] Compatibility mirror unavailable');}
    }else{atomicWriteSync(puzzlesPath,next);puzzles=next;}
    console.log(`[Puzzles] Saved ${puzzle.id} to pool (${puzzles.length} total)`);
    return true;
  } catch (e) { console.warn('[Puzzles] Failed to save puzzles.json:', e.message); return false; }
}

function savePuzzleToPool(gameObj, puzzleDate) {
  const hive = canonicalArchiveHive(gameObj?.letters, gameObj?.centerLetter);
  if (!hive) return false;
  // SP passes the canonical bank date. MP captures it on load; legacy MP
  // rounds without that metadata use their persisted opening time in Edmonton.
  const date = puzzleDate ?? gameObj.dailyPuzzleDate ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(Number.isFinite(gameObj.startTime) ? gameObj.startTime : Date.now()));
  if (!validArchivePeriod(date)) return false;
  return appendArchivePuzzle({ id: 'daily-' + date,
    name: 'Daily: ' + (gameObj.pangram || hive.letters.join('').toUpperCase()),
    theme: 'Daily', ...hive, pangram: gameObj.pangram || null });
}

function saveWeeklyPuzzleToPool(letters, centerLetter, weekStart) {
  const hive = canonicalArchiveHive(letters, centerLetter);
  if (!hive || !validArchivePeriod(weekStart) || new Date(weekStart + 'T12:00:00Z').getUTCDay() !== 1) return false;
  return appendArchivePuzzle({ id: 'weekly-' + weekStart,
    name: 'Weekly: ' + hive.letters.join('').toUpperCase(), theme: 'Weekly', ...hive });
}

function calculateJackpot() {
  if (!jackpotSettings.enabled) return jackpotSettings.base;
  if (game.status !== 'active' && game.status !== 'paused') return jackpotSettings.base;
  const completion=recovery?.recordFor(game)?.completion;if(completion)return completion.amount;
  const wordCount = Object.keys(game.foundWords).length;
  const guessBonus = wordCount * jackpotSettings.perGuess;
  const elapsed = (Date.now() - gameStartTime) / 1000;
  const timeBonus = Math.floor(elapsed) * jackpotSettings.perSecond;
  return Math.min(jackpotSettings.base + guessBonus + timeBonus, jackpotSettings.max);
}

function startJackpotBroadcast() {
  stopJackpotBroadcast();
  jackpotBroadcastTimer = setInterval(() => {
    io.to('public').emit('jackpot-update', { jackpot: calculateJackpot() });
  }, 1000);
}

function stopJackpotBroadcast() {
  if (jackpotBroadcastTimer) {
    clearInterval(jackpotBroadcastTimer);
    jackpotBroadcastTimer = null;
  }
}

// Initialize
const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:3013', 'http://127.0.0.1:3013', 'https://wordtycoon.live', 'https://www.wordtycoon.live'];
const io = new Server(server, { cors: { origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected')) } });
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });

app.use(express.json({ limit: '64kb' }));

// ─── Session URL routes (must precede express.static catch-all) ──────────
const SESSION_RESERVED_HANDLES = new Set([
  'admin', 'admin.html', 'api', 'overlay', 'overlay.html',
  'index.html', 'mp.html', 'sp.html',
  'favicon.ico', 'robots.txt', 'manifest.webmanifest', 'sw.js',
  'public', 'js', 'css', 'socket.io',
]);
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/')[2].toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/overlay.html');
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
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

app.use(express.static(path.join(__dirname, 'public')));

// Core modules
const dictionary = new Dictionary();
const game = new Game(dictionary);
const chatClient = new ChatClient(CHAT_RELAY_URL, { id: 'spellingbee', name: 'Spelling Bee', port: PORT, apiKey: ADMIN_SECRET });

// Persistence
storage.ensureDataDir();
let playerStats = {};
let statsFinalized = false;

// Overlay settings
const overlaySettings = {
  showRecentWords: true
};

// Game history (for portal stats)
let gameHistory = [];
const historyPath = path.join(DATA_DIR, 'game-history.json');

function getPublicData() {
  return { isDaily, isWeekly, dailyPlayed, dailyConsumedDate, gameStartTime, statsFinalized,
    history: gameHistory, playerStats, savedGames, playedPuzzleIds: [...playedPuzzleIds], settings: jackpotSettings,
    puzzles, currentPuzzleIndex };
}
function setPublicData(value) {
  ({ isDaily, isWeekly, dailyPlayed, dailyConsumedDate, gameStartTime, statsFinalized, playerStats, savedGames, puzzles, currentPuzzleIndex } = value);
  gameHistory = value.history; playedPuzzleIds = new Set(value.playedPuzzleIds); jackpotSettings = value.settings;
}
function mirrorAcceptedState(heavy = false) {
  // Secondary compatibility files are never read over an owned primary record.
  try {
    saveCurrentGameState();
    if(heavy){saveGameHistory();savePlayedPuzzleIds();storage.savePlayerStats(playerStats);storage.saveSavedGames(savedGames);atomicWriteSync(settingsPath,jackpotSettings);atomicWriteSync(puzzlesPath,puzzles);}
    storage.saveRoundMetadata({ version: 1, dailyConsumedDate });
  } catch (_) { console.warn('[Recovery] Compatibility mirror unavailable'); }
}


function loadGameHistory() {
  if(fs.existsSync(historyPath)){
    gameHistory=JSON.parse(fs.readFileSync(historyPath,'utf8'));
    if(!Array.isArray(gameHistory)||gameHistory.length>200)throw Error('Invalid legacy Spelling Bee history');
  }
}

function atomicWriteSync(filePath,data) {
  const temp=filePath+'.tmp-'+require('crypto').randomUUID();let fd;
  try{
    fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(data,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,filePath);
    if(process.platform!=='win32'){const directory=fs.openSync(path.dirname(filePath),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
  }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}

// `lb` lets private streamer sessions report their own leaderboard; public
// rounds leave it null and fall back to the live public game (2026-07-21).
// Bots and guests are dropped so they never earn a rating.
async function reportRoundToWordTycoon(lb = null) {
  try {
    const leaderboard = (lb || game.getLeaderboard())
      .filter(e => gameShared.isStatsEligible(e.platform, e.platformUserId || e.username));
    const participants = leaderboard.map((entry, index) => {
      const identity = entry.linkedDiscord
        ? `discord:${entry.linkedDiscord}`
        : `${entry.platform}:${entry.platformUserId || 'unknown'}`;
      return {
        identity,
        points: entry.score || 0,
        rank: index + 1,
        rankOutOf: leaderboard.length,
        guesses: entry.words ? entry.words.length : 0,
        hits: entry.words ? entry.words.length : 0,
        firstHitMs: null,
        wonRound: index === 0,
        foundTarget: false,
        articleTitle: 'spellingbee',
      };
    });

    if (participants.length >= 2) {
      await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
        body: JSON.stringify({ game: 'spellingbee', participants }),
        redirect: 'error', signal: AbortSignal.timeout(5000),
      });
    }
  } catch (err) {
    console.error('[SpellingBee] ELO report failed/error:', err.message || err);
  }
}

function saveGameHistory() {
  try {
    atomicWriteSync(historyPath, gameHistory);
  } catch (e) {
    console.error('[History] Failed to save:', e.message);
  }
}

function recordGameHistory() {
  const state = game.getSerializableState();
  const participants = Object.values(game.players).map(p => ({
    username: p.username,
    displayName: p.displayName,
    platform: p.platform,
    platformUserId: p.platformUserId,
    linkedDiscord: p.linkedDiscord || null,
    wordsFound: p.words.length,
    score: p.score
  }));

  const entry = {
    puzzleId: game.puzzleId,
    puzzleName: game.puzzleName,
    letters: game.letters,
    centerLetter: game.centerLetter,
    totalWords: game.validWords.length,
    wordsFound: Object.keys(game.foundWords).length,
    participants,
    startedAt: game.startTime,
    endedAt: Date.now(),
    timestamp: Date.now()
  };

  gameHistory.unshift(entry);
  if (gameHistory.length > 200) gameHistory.length = 200;
  saveGameHistory();
}

// ── Persistence Helpers ─────────────────────────────────────────────

function saveCurrentGameState() {
  if (game.letters && game.letters.length === 7) {
    const snapshot = game.getSerializableState();
    snapshot.savedAt = Date.now();
    Object.assign(snapshot, snapshotMetadata({ isDaily, isWeekly, dailyPlayed, dailyWord, gameStartTime, statsFinalized }));
    storage.saveCurrentGame(snapshot);
  }
}

function archiveCurrentGame(allWordsFound = false) {
  if (!game.letters || game.letters.length !== 7) return;

  const state = game.getSerializableState();
  const savedGames = storage.loadSavedGames();

  const archive = {
    id: `game_${state.startTime || Date.now()}`,
    letters: state.letters,
    centerLetter: state.centerLetter,
    totalWords: state.validWords.length,
    totalScore: state.totalScore,
    pangrams: state.pangrams,
    foundCount: Object.keys(state.foundWords).length,
    currentScore: Object.values(state.foundWords).reduce((sum, w) => sum + w.score, 0),
    foundPangrams: Object.values(state.foundWords).filter(w => w.isPangram).length,
    playerCount: Object.keys(state.players).length,
    topPlayers: Object.values(state.players).sort((a, b) => b.score - a.score).slice(0, 5),
    status: allWordsFound ? 'completed' : state.status,
    startTime: state.startTime,
    endTime: state.endTime,
    savedAt: Date.now(),
    allWordsFound,
    validWords: state.validWords,
    foundWords: state.foundWords,
    players: state.players,
    wordHistory: state.wordHistory
  };

  // Prevent duplicate archives
  const idx = savedGames.findIndex(g => g.id === archive.id);
  if (idx >= 0) {
    savedGames[idx] = archive;
  } else {
    savedGames.unshift(archive);
  }

  // Cap at 50
  if (savedGames.length > 50) savedGames.length = 50;

  storage.saveSavedGames(savedGames);
}

function finalizeGameStats() {
  if (statsFinalized) return;
  statsFinalized = true;

  for (const [key, player] of Object.entries(game.players)) {
    // Group by linkedDiscord when available, otherwise use platform:username key
    const statsKey = player.linkedDiscord ? `discord:${player.linkedDiscord}` : key;

    if (!playerStats[statsKey]) {
      playerStats[statsKey] = {
        username: player.username,
        displayName: player.displayName,
        platform: player.linkedDiscord ? 'discord' : player.platform,
        avatar: player.avatar,
        linkedDiscord: player.linkedDiscord || null,
        totalScore: 0,
        totalWords: 0,
        totalPangrams: 0,
        gamesPlayed: 0,
        lastSeen: Date.now()
      };
    }
    playerStats[statsKey].totalScore += player.score;
    playerStats[statsKey].totalWords += player.words.length;
    playerStats[statsKey].totalPangrams += player.pangrams;
    playerStats[statsKey].gamesPlayed += 1;
    playerStats[statsKey].displayName = player.displayName;
    playerStats[statsKey].avatar = player.avatar;
    playerStats[statsKey].linkedDiscord = player.linkedDiscord || playerStats[statsKey].linkedDiscord;
    playerStats[statsKey].lastSeen = Date.now();
  }
  storage.savePlayerStats(playerStats);
}

function getSavedGameSummaries() {
  return savedGames.map(g => ({
    id: g.id,
    letters: g.letters,
    centerLetter: g.centerLetter,
    totalWords: g.totalWords,
    totalScore: g.totalScore,
    foundCount: g.foundCount,
    currentScore: g.currentScore,
    foundPangrams: g.foundPangrams,
    playerCount: g.playerCount,
    topPlayers: g.topPlayers,
    status: g.status,
    startTime: g.startTime,
    savedAt: g.savedAt,
    allWordsFound: g.allWordsFound
  }));
}

// ── MP Puzzle Cycling ───────────────────────────────────────────────

function startNextPuzzle() {
  const candidate = new Game(dictionary), next = JSON.parse(JSON.stringify(getPublicData()));
  next.isDaily = false; next.isWeekly = false; next.statsFinalized = false;
  if (jackpotSettings.dailyEnabled && !dailyPlayed && dailyWord?.date === gameShared.getEdmontonDate() && typeof dailyWord.word === 'string') {
    const letters = [...new Set(dailyWord.word.toLowerCase())];
    if (letters.length === 7 && letters.every(letter => /^[a-z]$/.test(letter))) {
      candidate.loadCustomPuzzle(letters, letters[0]); candidate.dailyPuzzleDate = dailyWord.date;
      next.isDaily = true; next.dailyPlayed = true; next.dailyConsumedDate = dailyWord.date;
    }
  }
  if (!candidate.letters.length && puzzles.length) {
    let index = puzzles.findIndex((_, offset) => !playedPuzzleIds.has(String(puzzles[(currentPuzzleIndex + offset) % puzzles.length].id ?? (currentPuzzleIndex + offset) % puzzles.length)));
    if (index < 0) { next.playedPuzzleIds = []; index = 0; }
    const selected = (currentPuzzleIndex + index) % puzzles.length;
    candidate.loadFromPuzzle(puzzles[selected]); next.currentPuzzleIndex = (selected + 1) % puzzles.length;
  }
  if (!candidate.letters.length) candidate.generateAndLoad();
  candidate.start(); next.gameStartTime = candidate.startTime;
  recovery.run(game, null, () => {
    game._beeOriginalRestore(candidate.getSerializableState(), { exact: true, silent: true });
    setPublicData(next);
  }, { newRound: true });
  if (newGameTimer) { clearTimeout(newGameTimer); newGameTimer = null; }
  startJackpotBroadcast(); mirrorAcceptedState(true);
  io.to('public').emit('new-game', getAugmentedState());
}

// ── Chat Relay Integration ──────────────────────────────────────────

chatClient.connect();

// ─── Session-mode helpers ─────────────────────────────────────────────
function _calcSessionPot(s, settings) {
  const j = settings || jackpotSettings;
  if (!s || !s.game) return j.base;
  if (!j.enabled) return j.base;
  const wordCount = Object.keys(s.game.foundWords || {}).length;
  const guessBonus = wordCount * j.perGuess;
  const elapsed = (s.gameStartTime ? (Date.now() - s.gameStartTime) / 1000 : 0);
  const timeBonus = Math.floor(elapsed) * j.perSecond;
  return Math.min(j.base + guessBonus + timeBonus, j.max);
}

function _buildGuessAttempt(word, result, playerInfo) {
  const normalized = (word || '').toString().toLowerCase().trim();
  return {
    word: normalized,
    player: playerInfo?.displayName || playerInfo?.username || 'Anonymous',
    valid: !!(result && result.valid),
    result: result?.result || (result && result.valid ? 'correct' : 'invalid'),
    score: result?.score || 0,
    isRare: !!(result && result.isRare),
    isHidden: !!(result && result.isHidden),
    isThreeLetter: !!(result && result.isThreeLetter),
    isPangram: !!(result && result.isPangram),
    t: Date.now(),
  };
}

function winPayload(completion, session = null) {
  const winner = completion.winner;
  if (!winner) return null;
  return { game: 'spellingbee', gameName: 'Spelling Bee', word: null,
    winner: { displayName: winner.displayName, profilePic: winner.avatar || null, platform: winner.platform, cosmetics: winner.cosmetics || null },
    jackpot: completion.amount, guessCount: winner.words.length, isDaily: completion.isDaily,
    frenzyMultiplier: completion.multiplier,
    topPlayers: completion.leaderboard.slice(0,10).map(p => ({displayName:p.displayName,profilePic:p.avatar||null,platform:p.platform,platformUserId:p.platformUserId||p.username,linkedDiscord:p.linkedDiscord||null,points:p.score||0,cosmetics:p.cosmetics||null})),
    ...(session ? {streamerHandle:session.handle} : {}) };
}
function scheduleAcceptedAdvance(session = null) {
  const target = session ? session.game : game, record = recovery.recordFor(target);
  if (!record?.completion) return;
  const oldTimer = session ? session.autoRestartTimer : newGameTimer;
  if (oldTimer) clearTimeout(oldTimer);
  const attempt = () => {
    const current = session ? sessionManager.getSession(session.handle) : null;
    if (session && (current !== session || session.game !== target)) return;
    const owner = recovery.recordFor(target);
    if (!owner || owner.roundId !== record.roundId || !owner.completion) return;
    try {
      if (session) {
        if (!sessionManager.restartSession(session)) throw Error('Session unavailable');
        sessionManager.scheduleSave(); io.to(_sessionRoom(session.handle)).emit('new-game',sessionManager.buildSessionState(session,jackpotSettings,_calcSessionPot));
      } else startNextPuzzle();
    } catch (_) {
      const retry = setTimeout(attempt,5000); retry.unref?.();
      if (session) session.autoRestartTimer=retry; else newGameTimer=retry;
    }
  };
  const timer=setTimeout(attempt,Math.max(0,record.completion.nextRoundAt-Date.now()));timer.unref?.();
  if(session)session.autoRestartTimer=timer;else newGameTimer=timer;
}
function publishCompletion(session = null) {
  const target=session?session.game:game,completion=recovery.recordFor(target)?.completion;
  if(!completion)return;
  const room=session?_sessionRoom(session.handle):'public',payload=winPayload(completion,session);
  if(payload){
    io.to(room).emit('jackpot-won',{winner:completion.winner.displayName,amount:completion.amount,score:completion.winner.score,wordsFound:completion.winner.words.length,isDaily:completion.isDaily,frenzyMultiplier:completion.multiplier});
    io.to(room).emit('game-win',payload);if(chatClient.isConnected())chatClient.emitToRelay('game-win',payload);
    if(completion.isDaily)chatClient.emitToRelay('daily-win',{game:'spellingbee',winner:completion.winner.displayName,platform:completion.winner.platform});
    if(!session?.noRewards)reportRoundToWordTycoon(completion.leaderboard).catch(()=>{});
  }
  const state=session?sessionManager.buildSessionState(session,jackpotSettings,_calcSessionPot):getAugmentedState();
  io.to(room).emit('all-words-found',state);io.to(room).emit('game-state',state);
  io.to(room).emit('game-over',{countdown:Math.max(0,Math.ceil((completion.nextRoundAt-Date.now())/1000)),stats:state});
  scheduleAcceptedAdvance(session);
}
async function processAcceptedGuess(target,session,word,playerInfo,wordPolicy,responseSocket) {
  let result;
  const previous=recovery.recordFor(target);
  if(!previous)throw Error('Missing durable Spelling Bee baseline');
  try {
    result=recovery.run(target,session,()=>target.submitWord(word,playerInfo),{wordPlayer:playerInfo,wordPolicy,
      prepare(){if(session)session.lastActivityAt=Date.now();}});
  } catch (_) {result={valid:false,result:'storage_unavailable',error:'Could not save this guess. Please retry.'};}
  if(responseSocket)responseSocket.emit('guess-result',result);
  const room=session?_sessionRoom(session.handle):'public';
  io.to(room).emit('guess-attempt',_buildGuessAttempt(word,result,playerInfo));
  if(!result.valid)return result;
  const accepted=recovery.recordFor(target);
  io.to(room).emit('word-found',result);io.to(room).emit('game-state',session?sessionManager.buildSessionState(session,jackpotSettings,_calcSessionPot):getAugmentedState());
  if(session){sessionManager.scheduleSave();if(!previous.completion&&accepted.completion)publishCompletion(session);}else mirrorAcceptedState();
  gameShared.reportLibraryWord(playerInfo.platform,playerInfo.platformUserId||playerInfo.username,word,'spellingbee',playerInfo.username,playerInfo.displayName,responseSocket);
  const cosmetics=await gameShared.getPlayerCosmetics(playerInfo.platform,playerInfo.platformUserId||playerInfo.username);
  if(session&&(sessionManager.getSession(session.handle)!==session||session.game!==target))return result;
  if(recovery.recordFor(target)?.roundId!==accepted.roundId)return result;
  const entry=target.foundWords[result.word],history=target.wordHistory.find(e=>e.word===result.word);
  if(entry)entry.cosmetics=cosmetics;if(history)history.cosmetics=cosmetics;
  result.cosmetics=cosmetics;io.to(room).emit('game-state',session?sessionManager.buildSessionState(session,jackpotSettings,_calcSessionPot):getAugmentedState());
  return result;
}
async function _processSessionGuess(session,word,playerInfo,responseSocket) {
  if(!session?.game)return null;
  return processAcceptedGuess(session.game,session,word,playerInfo,'chat',responseSocket);
}

async function handleSessionChat(msg) {
  const handle = String(msg.streamerHandle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  if (!_validStreamerHandles.has(handle)) return;
  const platform = String(msg.platform || 'unknown');
  const platformUserId = String(msg.platformUserId || '');
  if (platform && platformUserId && _isStreamerBlocking(handle, platform, platformUserId)) return;

  const raw = (msg.text || '').trim().toLowerCase();
  if (!raw || raw.includes(' ')) return;
  const word = raw.replace(/[^a-z]/g, '');
  if (!word || word.length < 3 || word.length > 128) return;

  let session;
  try {
    session = await sessionManager.getOrCreateSession({ handle, sessionId: msg.raw?.streamSession || null });
  } catch (err) {
    console.warn(`[Session] "${handle}" create failed:`, err.message);
    return;
  }
  if (!session || !session.game) return;
  await _processSessionGuess(session, word, {
    username: msg.username,
    displayName: msg.displayName,
    platform,
    platformUserId,
    avatar: msg.avatar,
    linkedDiscord: msg.linkedDiscord || null,
  }, null);
}

chatClient.on('message', async (msg) => {
  if (!msg || typeof msg.text !== 'string' || msg.text.length > 128) return;
  if (msg.streamerHandle) { handleSessionChat(msg).catch(()=>{}); return; }
  const raw=msg.text.trim().toLowerCase();if(!raw||raw.includes(' '))return;
  const word=raw.replace(/[^a-z]/g,'');if(word.length<3)return;
  const result=await processAcceptedGuess(game,null,word,{username:msg.username,displayName:msg.displayName,platform:msg.platform,platformUserId:msg.platformUserId||msg.username,avatar:msg.avatar,linkedDiscord:msg.linkedDiscord||null},'chat',null);
  if(result.valid && chatClient.isConnected()){
    const user={displayName:msg.displayName||msg.username,platform:msg.platform,profilePic:msg.avatar||null};
    if(!game.seenPlayers)game.seenPlayers=new Set();const key=msg.platform+':'+(msg.platformUserId||msg.username);
    if(!game.seenPlayers.has(key)){game.seenPlayers.add(key);chatClient.emitToRelay('game-event',{game:'spellingbee',eventName:'first_time_player',data:{user},priority:'low'});}
    chatClient.emitToRelay('game-event',{game:'spellingbee',eventName:result.isPangram?'hidden_word':result.isHidden?'ultra_rare_word_found':result.isRare?'rare_word_found':'common_word_found',data:{user,word,score:result.score,isPangram:!!result.isPangram,isRare:!!result.isRare,isHidden:!!result.isHidden},priority:result.isPangram||result.isHidden||result.isRare?'high':'normal'});
  }
});

chatClient.on('cosmetics-updated', ({ platform, platformUserId, equipped }) => {
  gameShared.invalidateCosmetics(platform, platformUserId, equipped);

  // Update in-memory game state
  let changed = false;

  for (const word of Object.keys(game.foundWords)) {
    const entry = game.foundWords[word];
    if (entry.platform === platform && entry.platformUserId === platformUserId) {
      entry.cosmetics = equipped;
      changed = true;
    }
  }

  for (const entry of game.wordHistory) {
    if (entry.platform === platform && entry.platformUserId === platformUserId) {
      entry.cosmetics = equipped;
      changed = true;
    }
  }

  if (changed) {
    io.to('public').emit('game-state', getAugmentedState());
  }
});

chatClient.on('status', (status) => {
  io.to('public').emit('chat-relay-status', status);
});

chatClient.on('frenzy-update', (frenzy) => {
  currentFrenzy = { multiplier: frenzy.multiplier || 1.0, activeTappers: frenzy.activeTappers || 0 };
  io.to('public').emit('frenzy-update', currentFrenzy);
});

chatClient.on('activate-daily', async () => {
  console.log('[SpellingBee] activate-daily received from Chat Relay');
  await fetchDailyWord();
  try {
    recovery.run(game,null,()=>{dailyPlayed=false;dailyConsumedDate=null;jackpotSettings={...jackpotSettings,dailyEnabled:true};});
    mirrorAcceptedState(true);
    if(game.status!=='active')startNextPuzzle();
    else console.log('[SpellingBee] Game in progress — daily will start after current game ends');
  } catch (_) { console.warn('[Recovery] Daily activation could not be saved; retry required'); }
});

// Helper: augment game state with daily/frenzy info
function getAugmentedState() {
  const state = game.getState();
  state.jackpot = recovery?.recordFor(game)?.completion?.amount ?? calculateJackpot();
  state.completion = recovery?.recordFor(game)?.completion || null;
  state.jackpotEnabled = jackpotSettings.enabled;
  state.isDaily = isDaily;
  state.isWeekly = isWeekly; // kept for backwards compat
  state.frenzy = currentFrenzy;
  return state;
}

// ── Game Events → Socket.IO ─────────────────────────────────────────

game.on('puzzle-loaded', () => {
  io.to('public').emit('game-state', getAugmentedState());
  saveCurrentGameState();
});

game.on('game-started', () => {
  io.to('public').emit('game-state', getAugmentedState());
  saveCurrentGameState();
});

game.on('game-paused', () => {
  io.to('public').emit('game-state', getAugmentedState());
  saveCurrentGameState();
});

game.on('game-resumed', () => {
  startJackpotBroadcast();
  io.to('public').emit('game-state', getAugmentedState());
  saveCurrentGameState();
});

game.on('game-ended', () => {
  stopJackpotBroadcast(); mirrorAcceptedState(true);
  io.to('public').emit('game-state',getAugmentedState());
  io.to('public').emit('saved-games',getSavedGameSummaries());io.to('public').emit('player-stats',playerStats);
});
game.on('letters-shuffled',letters=>io.to('public').emit('letters-shuffled',letters));
game.on('timer-tick',remaining=>io.to('public').emit('timer-tick',remaining));
game.on('storage-unavailable',()=>io.to('public').emit('storage-unavailable',{error:'Could not save the round. Retrying.'}));
game.on('all-words-found',()=>{stopJackpotBroadcast();mirrorAcceptedState(true);publishCompletion();});

function validGuessFrame(data) {
  return data && typeof data === 'object' && !Array.isArray(data) && typeof data.word === 'string' && data.word.length <= 128 &&
    ['platformUserId','linkedDiscord','displayName'].every(key=>data[key]===undefined||typeof data[key]==='string'&&data[key].length<=128);
}
function verifiedWebPlayer(socket,data) {
  const id=socket._wtVerifiedAnchorId;
  if(typeof id!=='string'||!id)return null;
  return {...(socket._wtPerks||{}),username:id,displayName:typeof data.displayName==='string'?data.displayName.trim().slice(0,80)||'Anonymous':'Anonymous',platform:'web',platformUserId:id,avatar:'',linkedDiscord:null};
}

// ── Socket.IO Connections ───────────────────────────────────────────

io.on('connection', async (socket) => {
  const register=socket.on.bind(socket);
  socket.on=(event,handler)=>register(event,(...args)=>{
    try { const result=handler(...args);if(result&&typeof result.catch==='function')result.catch(()=>socket.emit('guess-result',{valid:false,result:'storage_unavailable',error:'Service unavailable. Please retry.'})); }
    catch(_){socket.emit(event==='guess'?'guess-result':'error',{valid:false,result:'storage_unavailable',error:'Could not save this action. Please retry.'});}
  });

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
      const session = await sessionManager.getOrCreateSession({ handle: sessionHandle });
      if (session) {
        socket.emit('game-state', sessionManager.buildSessionState(session, jackpotSettings, _calcSessionPot));
      } else {
        socket.emit('game-state', { error: 'Session unavailable', isSession: true });
      }
    } catch (err) {
      console.warn(`[Session] connect for "${sessionHandle}" failed:`, err.message);
      socket.emit('game-state', { error: 'Session unavailable', isSession: true });
    }
    socket.emit('chat-relay-status', { connected: chatClient.isConnected() });
    socket.emit('overlay-settings', overlaySettings);
    socket.on('guess', async (data) => {
      if(!validGuessFrame(data))return socket.emit('guess-result',{valid:false,result:'bad_request',error:'Invalid guess request'});
      const session=sessionManager.getSession(sessionHandle),target=session?.game,owner=target&&recovery.recordFor(target);
      if(!target||target.status!=='active')return socket.emit('guess-result',{valid:false,result:'not_active',error:'Game is not active'});
      if(!(await passesPremiumWebGate([data.linkedDiscord,data.platformUserId],socket,'session')))return;
      const player=verifiedWebPlayer(socket,data);
      if(!player)return socket.emit('guess-result',{valid:false,result:'auth_required',error:'Sign in again'});
      if(sessionManager.getSession(sessionHandle)!==session||session.game!==target||recovery.recordFor(target)?.roundId!==owner.roundId)return socket.emit('guess-result',{valid:false,result:'round_changed',error:'The round changed. Please retry.'});
      if(_isPagePlayDisabled(sessionHandle)||_isStreamerBlocking(sessionHandle,'web',player.platformUserId))return socket.emit('guess-result',{valid:false,result:'blocked',error:'Page play unavailable'});
      gameShared.reportSocketIP(socket,'web',player.platformUserId,'spelling-bee');
      await _processSessionGuess(session,data.word,player,socket);
    });
    socket.on('disconnect', () => {});
    return;
  }

  // Public socket
  socket.join('public');
  connectedPlayers++;
  // Send current state on connect
  socket.emit('game-state', getAugmentedState());
  socket.emit('chat-relay-status', { connected: chatClient.isConnected() });
  socket.emit('overlay-settings', overlaySettings);

  // ── MP Web Client Guess ──────────────────────────────────────
  socket.on('guess', async (data) => {
    if(!validGuessFrame(data))return socket.emit('guess-result',{valid:false,result:'bad_request',error:'Invalid guess request'});
    const owner=recovery.recordFor(game);
    if(game.status!=='active')return socket.emit('guess-result',{valid:false,result:'not_active',error:'Game is not active'});
    if(!(await passesPremiumWebGate([data.linkedDiscord,data.platformUserId],socket)))return;
    const player=verifiedWebPlayer(socket,data);
    if(!player)return socket.emit('guess-result',{valid:false,result:'auth_required',error:'Sign in again'});
    if(recovery.recordFor(game)?.roundId!==owner.roundId)return socket.emit('guess-result',{valid:false,result:'round_changed',error:'The round changed. Please retry.'});
    gameShared.reportSocketIP(socket,'web',player.platformUserId,'spelling-bee');
    await processAcceptedGuess(game,null,data.word,player,'score',socket);
  });

  // Admin auth via socket
  socket.on('admin-auth', (key) => {
    if (key === ADMIN_SECRET) socket.isAdmin = true;
  });

  // Admin commands via socket
  socket.on('generate-puzzle', () => {
    if (!socket.isAdmin) return;
    try {
      isDaily = false; isWeekly = false;
      const puzzle = game.generateAndLoad();
      statsFinalized = false;
      io.to('public').emit('game-state', getAugmentedState());
      socket.emit('admin-state', game.getAdminState());
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('custom-puzzle', (data) => {
    if (!socket.isAdmin) return;
    try {
      const { letters, centerLetter } = data;
      if (!letters || letters.length !== 7 || !centerLetter) {
        return socket.emit('error', { message: 'Need exactly 7 letters and a center letter' });
      }
      isDaily = false; isWeekly = false;
      game.loadCustomPuzzle(letters, centerLetter);
      statsFinalized = false;
      io.to('public').emit('game-state', getAugmentedState());
      socket.emit('admin-state', game.getAdminState());
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  // Load a pre-made puzzle by ID
  socket.on('load-puzzle', (data) => {
    if (!socket.isAdmin) return;
    try {
      const id = data.id || data;
      const puzzle = puzzles.find(p => p.id === id);
      if (!puzzle) return socket.emit('error', { message: 'Puzzle not found' });
      isDaily = false; isWeekly = false;
      game.loadFromPuzzle(puzzle);
      game.start();
      statsFinalized = false;
      gameStartTime = game.startTime;
      startJackpotBroadcast();
      io.to('public').emit('game-state', getAugmentedState());
      socket.emit('admin-state', game.getAdminState());
      console.log(`[Game] Admin loaded puzzle #${puzzle.id}: "${puzzle.name}"`);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('start-game', (data) => {
    if (!socket.isAdmin) return;
    const timer = data?.timer || 0;
    const result = game.start(timer);
    if (result.success) {
      gameStartTime = game.startTime;
      startJackpotBroadcast();
      io.to('public').emit('game-state', getAugmentedState());
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  socket.on('pause-game', () => {
    if (!socket.isAdmin) return;
    game.pause();
    io.to('public').emit('game-state', getAugmentedState());
  });

  socket.on('resume-game', () => {
    if (!socket.isAdmin) return;
    game.resume();
    io.to('public').emit('game-state', getAugmentedState());
  });

  socket.on('end-game', () => {
    if (!socket.isAdmin) return;
    game.end();
    io.to('public').emit('game-state', getAugmentedState());
  });

  socket.on('reset-game', () => {
    if (!socket.isAdmin) return;
    isDaily = false; isWeekly = false;
    game.reset();
    storage.clearCurrentGame();
    statsFinalized = false;
    io.to('public').emit('game-state', getAugmentedState());
  });

  socket.on('shuffle-letters', () => {
    if(!socket.isAdmin)return;
    game.shuffleLetters();
    io.to('public').emit('game-state', getAugmentedState());
  });

  socket.on('get-admin-state', () => {
    if (!socket.isAdmin) return;
    socket.emit('admin-state', game.getAdminState());
  });

  // Manual word submission (for testing without chat relay)
  socket.on('manual-submit', (data) => {
    if (!socket.isAdmin) return;
    const result = recovery.run(game,null,()=>game.submitWord(data.word, {
      username: data.username || 'admin',
      displayName: data.displayName || 'Admin',
      platform: 'admin',
      avatar: ''
    }));
    if (result.valid) {
      io.to('public').emit('word-found', result);
      io.to('public').emit('game-state', getAugmentedState());
      saveCurrentGameState();
    }
    socket.emit('submit-result', result);
  });

  socket.on('reconnect-chat', () => {
    if (!socket.isAdmin) return;
    chatClient.reconnect();
  });

  socket.on('update-overlay-settings', (settings) => {
    if (!socket.isAdmin) return;
    Object.assign(overlaySettings, settings);
    io.to('public').emit('overlay-settings', overlaySettings);
  });

  // ── Saved Games ──────────────────────────────────────────────

  socket.on('get-saved-games', () => {
    socket.emit('saved-games', getSavedGameSummaries());
  });

  socket.on('load-saved-game', (data) => {
    if (!socket.isAdmin) return;
    const saved = savedGames.find(g => g.id === data.id);
    if (!saved) {
      return socket.emit('error', { message: 'Saved game not found' });
    }
    isDaily = false; isWeekly = false;
    statsFinalized = false;
    gameStartTime = Date.now();
    game.restoreState({...saved,status:saved.status==='completed'?'ended':saved.status});
    saveCurrentGameState();
    io.to('public').emit('game-state', getAugmentedState());
    socket.emit('admin-state', game.getAdminState());
  });

  socket.on('delete-saved-game', (data) => {
    if (!socket.isAdmin) return;
    recovery.run(game,null,()=>{savedGames=savedGames.filter(g=>g.id!==data.id);});
    storage.saveSavedGames(savedGames);
    socket.emit('saved-games', getSavedGameSummaries());
  });

  // ── Player Stats ─────────────────────────────────────────────

  socket.on('get-player-stats', () => {
    socket.emit('player-stats', playerStats);
  });

  socket.on('disconnect', () => {
    connectedPlayers--;
  });
});

// ── REST API ────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  const state = game.getState();
  state.jackpot = recovery?.recordFor(game)?.completion?.amount ?? calculateJackpot();
  state.completion = recovery?.recordFor(game)?.completion || null;
  state.jackpotEnabled = jackpotSettings.enabled;
  state.isDaily = isDaily;
  state.isWeekly = isWeekly; // kept for backwards compat
  state.frenzy = currentFrenzy;
  state.playerCount = connectedPlayers;
  res.json(state);
});

// Monthly hint allowance: how many hints remain for the authenticated user.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[SpellingBee] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal one puzzle letter.
app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.status(401).json({ ok: false, error: 'auth_required' });

  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  const hint = generateHintForHandle(handle);
  if (!hint) {
    return res.json({ ok: false, reason: 'nothing_to_reveal', remaining: null });
  }

  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ discordId, game: 'spellingbee', label: 'Spelling Bee web hint' }),
    });
    const spendData = await r.json();
    if (!spendData.ok) return res.json(spendData);
    res.json({ ok: true, ...spendData, hint });
  } catch (e) {
    console.error('[SpellingBee] hints use failed:', e.message);
    res.status(500).json({ ok: false, error: 'spend_failed' });
  }
});

app.get('/api/admin-state', requireAdmin, (req, res) => {
  res.json(game.getAdminState());
});

app.get('/api/chat-status', (req, res) => {
  res.json({ connected: chatClient.isConnected() });
});

app.get('/api/saved-games', (req, res) => {
  res.json(getSavedGameSummaries());
});

app.get('/api/player-stats', (req, res) => {
  res.json(playerStats);
});

// ── Jackpot Endpoints ────────────────────────────────────────────────

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

app.post('/api/jackpot/settings', requireAdmin, (req,res) => {
  const body=req.body || {},next={...jackpotSettings};
  for(const key of ['enabled','dailyEnabled'])if(body[key]!==undefined){if(typeof body[key]!=='boolean')return res.status(400).json({ok:false,error:'Invalid setting'});next[key]=body[key];}
  for(const key of ['base','perGuess','perSecond','max'])if(body[key]!==undefined){if(!Number.isSafeInteger(body[key])||body[key]<0||body[key]>1000000)return res.status(400).json({ok:false,error:'Invalid setting'});next[key]=body[key];}
  try{recovery.run(game,null,()=>{jackpotSettings=next;});mirrorAcceptedState();return res.json({ok:true,...jackpotSettings,current:calculateJackpot()});}
  catch(_){return res.status(503).json({ok:false,error:'Settings could not be saved'});}
});
app.post('/api/jackpot/reset', requireAdmin, (req,res) => {
  try{recovery.run(game,null,()=>{gameStartTime=Date.now();});mirrorAcceptedState();return res.json({ok:true,current:calculateJackpot()});}
  catch(_){return res.status(503).json({ok:false,error:'Timer could not be saved'});}
});

// ── SP Endpoints ────────────────────────────────────────────────────

// SP dictionary endpoint - returns all words for single-player mode
app.get('/api/sp/dictionary', (req, res) => {
  const words = dictionary.getAllWords();
  res.json(words);
});

// SP targets endpoint - returns array of all target words
app.get('/api/sp/targets', (req, res) => {
  res.json(dictionary.getTargetWords());
});

// SP frequency endpoint - returns { word: zipfScore } for client-side classification
app.get('/api/sp/frequency', (req, res) => {
  const freqMap = dictionary.getFrequencyMap();
  const obj = {};
  for (const [w, z] of freqMap) obj[w] = z;
  res.json(obj);
});

// SP daily endpoint — returns today's daily puzzle letters
app.get('/api/sp/daily', async (req, res) => {
  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/daily/spellingbee-sp?length=7&uniqueLetters=7`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(404).json({ error: 'unavailable' });
    const data = await r.json();
    const letters = [...new Set(data.word.toLowerCase().split(''))];
    if (letters.length !== 7) return res.status(404).json({ error: 'invalid daily word' });
    res.json({ letters, centerLetter: letters[0], date: data.date });
  } catch (e) {
    console.error('[SpellingBee] Daily SP endpoint error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/sp/weekly', async (req, res) => {
  try {
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/weekly/spellingbee-sp?length=7&uniqueLetters=7`, { headers: { 'x-api-key': process.env.GAME_API_SECRET }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(404).json({ error: 'unavailable' });
    const data = await r.json();
    // Validate we have exactly 7 unique letters
    const letters = [...new Set(data.word.toLowerCase().split(''))];
    if (letters.length !== 7) return res.status(404).json({ error: 'invalid weekly word' });
    res.json({ letters, centerLetter: letters[0], weekStart: data.weekStart });
  } catch (e) { console.error('[SpellingBee] Weekly endpoint error:', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// Archive only the current canonical hive; payload letters never define a puzzle.
async function archiveCanonicalSpPuzzle(req, res, weekly) {
  try {
    const period = weekly ? 'weekly' : 'daily';
    const r = await relayFetch(`${CHAT_RELAY_URL}/api/word-bank/${period}/spellingbee-sp?length=7&uniqueLetters=7`,
      { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return res.status(503).json({ error: 'Canonical puzzle unavailable' });
    const data = await r.json();
    const key = weekly ? 'weekStart' : 'date';
    if (!validArchivePeriod(data[key]) || req.body?.[key] !== data[key]) return res.status(409).json({ error: 'Puzzle period changed' });
    if (typeof data.word !== 'string' || !/^[a-z]+$/i.test(data.word)) return res.status(503).json({ error: 'Canonical puzzle unavailable' });
    const letters = [...new Set(data.word.toLowerCase())];
    if (letters.length !== 7) return res.status(503).json({ error: 'Canonical puzzle unavailable' });
    const saved = weekly ? saveWeeklyPuzzleToPool(letters, letters[0], data.weekStart)
      : savePuzzleToPool({ letters, centerLetter: letters[0] }, data.date);
    if (saved === false) return res.status(503).json({ error: 'Archive unavailable' });
    return res.json({ ok: true });
  } catch (_) { return res.status(503).json({ error: 'Canonical puzzle unavailable' }); }
}
app.post('/api/sp/weekly/complete', (req, res) => archiveCanonicalSpPuzzle(req, res, true));
app.post('/api/sp/daily/complete', (req, res) => archiveCanonicalSpPuzzle(req, res, false));

// ── Puzzle Endpoints ────────────────────────────────────────────────

// Puzzles list endpoint - returns puzzle metadata
app.get('/api/puzzles', (req, res) => {
  res.json(puzzles.map(p => ({ id: p.id, name: p.name, theme: p.theme })));
});

// Random SP puzzle endpoint - keeps solo playable even when the saved pool is empty.
app.get('/api/sp/random', (req, res) => {
  try {
    const generated = dictionary.generatePuzzle();
    res.json({
      ...generated,
      id: `random_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Random Puzzle',
      theme: 'Practice',
    });
  } catch (err) {
    console.warn('[SP] Failed to generate random puzzle:', err.message);
    res.status(503).json({ error: 'Could not generate puzzle' });
  }
});

// Single puzzle endpoint - returns full puzzle data
app.get('/api/puzzles/:id', (req, res) => {
  const rawId = String(req.params.id);
  const numericId = Number(rawId);
  const puzzle = puzzles.find(p =>
    String(p.id) === rawId ||
    (Number.isFinite(numericId) && p.id === numericId)
  );
  if (!puzzle) return res.status(404).json({ error: 'Puzzle not found' });
  res.json(puzzle);
});

// ── Game History (for portal stats) ─────────────────────────────────

app.get('/api/game/history', (req, res) => {
  res.json(gameHistory);
});

// ── Startup ─────────────────────────────────────────────────────────

async function startup() {
  console.log('========================================');
  console.log('  Spelling Bee - Starting Up');
  console.log('========================================');

  // Initialize dictionary (async — Word Bank with fallback)
  await dictionary.init();
  console.log(`[Dictionary] ${dictionary.words.length} words loaded, ${dictionary.targetSet.size} targets`);

  // Wire dictionary into session-manager so any restored session-Game
  // instances and freshly-spawned ones can build puzzles.
  sessionManager.setDictionary(dictionary);

  recovery = createBeeRecovery({createJournal:require(path.join(RELAY_DIR,'src','game-action-journal')).createGameActionJournal,directory:path.join(DATA_DIR,'mp-actions'),sdk:gameShared,Game,getPublicData,setPublicData,getSettings:()=>jackpotSettings,getFrenzy:()=>currentFrenzy.multiplier,onError:()=>console.warn('[Recovery] Reward handoff pending')});
  const owned = recovery.load('public');
  if (owned) setPublicData(owned.meta.publicData);
  else {
    playerStats=storage.loadPlayerStats();

  if(fs.existsSync(settingsPath)){
    const settings=JSON.parse(fs.readFileSync(settingsPath,'utf8'));Object.assign(jackpotSettings,settings);
  }
  if(fs.existsSync(puzzlesPath)){
    puzzles=JSON.parse(fs.readFileSync(puzzlesPath,'utf8'));
    if(!Array.isArray(puzzles)||puzzles.length>200)throw Error('Invalid legacy Spelling Bee puzzle pool');
  }

  // Load played puzzle tracking
  loadPlayedPuzzleIds();

  }

  // Fetch weekly + daily words
  await fetchWeeklyWord();

  await fetchDailyWord();
  weeklyFetchInterval = setInterval(fetchWeeklyWord, 3600000); // Refresh hourly
  setInterval(fetchDailyWord, 3600000); // Refresh hourly

  // Load game history
  if(!owned)loadGameHistory();
  console.log(`[History] ${gameHistory.length} games in history`);

  // Restore game state from disk or start first puzzle
  const persistedRoundMetadata = owned ? {dailyConsumedDate} : storage.loadRoundMetadata();
  dailyPlayed = !!dailyWord?.date && persistedRoundMetadata?.dailyConsumedDate === dailyWord.date;
  if(!owned)savedGames=storage.loadSavedGames(); dailyConsumedDate=persistedRoundMetadata?.dailyConsumedDate||null;
  recovery.attach(game,'public');
  sessionManager.setRecovery(recovery);
  const savedState = owned ? null : storage.loadCurrentGame();
  if (owned) {
    recovery.adopt(game,owned);
    dailyPlayed = dailyConsumedDate === dailyWord?.date;
    if(owned.completion)scheduleAcceptedAdvance();else if(game.status==='active')startJackpotBroadcast();
  } else
  if (savedState && savedState.letters && savedState.letters.length === 7) {
    console.log('Restoring saved game state...');
    const consumedToday = dailyPlayed;
    ({ isDaily, isWeekly, dailyPlayed, gameStartTime, statsFinalized } = restoreMetadata(savedState, dailyWord?.date));
    dailyPlayed = dailyPlayed || consumedToday;
    if (dailyPlayed) storage.saveRoundMetadata({ version: 1, dailyConsumedDate: dailyWord.date });
    game._beeOriginalRestore(savedState,{exact:true,silent:true});
    recovery.baseline(game,'public');
    console.log('[Recovery] Public board restored');
    if(recovery.recordFor(game).completion)scheduleAcceptedAdvance();
    else if (game.status === 'active') {
      startJackpotBroadcast();
    }
  } else {
    // No saved state — start with daily or first puzzle
    startNextPuzzle();
  }

  for(const session of sessionManager.allSessions())if(session.completion)scheduleAcceptedAdvance(session);
  recovery.recover();

  server.listen(PORT, () => {
    console.log(`\n  Spelling Bee server running on http://localhost:${PORT}`);
    console.log(`  OBS Overlay:      http://localhost:${PORT}/overlay.html`);
    console.log(`  Admin Panel:      http://localhost:${PORT}/admin.html`);
    console.log(`  SP Page:          http://localhost:${PORT}/sp.html`);
    console.log(`  MP Page:          http://localhost:${PORT}/mp.html`);
    console.log(`  Chat Relay:       ${CHAT_RELAY_URL}\n`);
    console.log('========================================');
  });
}

// Graceful shutdown
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[SpellingBee] Shutting down...');
  stopJackpotBroadcast();
  if (newGameTimer) {
    clearTimeout(newGameTimer);
    newGameTimer = null;
  }
  if (weeklyFetchInterval) {
    clearInterval(weeklyFetchInterval);
    weeklyFetchInterval = null;
  }
  saveCurrentGameState();
  storage.savePlayerStats(playerStats);
  console.log('[SpellingBee] Game state saved');
  chatClient.disconnect();
  server.close();
  console.log('[SpellingBee] Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startup().catch(err => {
  console.error('[SpellingBee] Startup failed:', err);
  process.exit(1);
});
