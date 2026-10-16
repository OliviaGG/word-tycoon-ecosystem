try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}
/**
 * Word Mine — Server
 * Express + Socket.IO + Chat Relay connection.
 * Serves SP mine pool, daily/weekly mines, and MP game state.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const mineEngine = require('./src/mine-engine');
const ChatClient = require('./src/chatClient');
const storage = require('./src/storage');

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT) || 3022;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const ADMIN_SECRET = process.env.GAME_API_SECRET;
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');

// MP target word limits per mine type — higher targets produce ~15-letter mines
const MINE_WORD_LIMITS = { daily: 100, weekly: 300, random: 100, pool: 100 };

// ─── Game Shared Module ──────────────────────────────────────────────────────

let gameShared;
try {
  gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
} catch (e) {
  console.warn('[Server] game-shared.js not found, rewards disabled');
  gameShared = {
    init() {},
    async rewardPlayer() { return null; },
    reportLibraryWord() {},
    async getPlayerCosmetics() { return {}; },
    invalidateCosmetics() {},
  };
}

// ─── Express + Socket.IO ─────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'] || req.headers['x-admin-key'] || req.query.adminKey;
  if (key === ADMIN_SECRET) return next();
  res.status(403).json({ error: 'Unauthorized' });
}

// Resolve a browser request to the WT account id by asking Chat Relay to
// verify the wt_remember cookie. Returns null for unauthenticated guests.
async function resolveUserFromCookie(req) {
  const cookie = req.headers.cookie || '';
  if (!cookie.includes('wt_remember')) return null;
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
    console.error('[WordMine] whoami failed:', e.message);
  }
  return null;
}

// ─── Word Data ───────────────────────────────────────────────────────────────

let dictionaryArr = [];
let dictionarySet = new Set();
let frequency = {};
let wordDataLoaded = false;

async function loadWordData() {
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Server] Loading word data from ${CHAT_RELAY_URL} (attempt ${attempt})...`);

      // Fetch dictionary (lengths 4-15)
      const dictPromises = [];
      for (let len = 4; len <= 15; len++) {
        dictPromises.push(
          fetch(`${CHAT_RELAY_URL}/api/word-bank/dictionary/${len}`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        );
      }
      const dictResults = await Promise.all(dictPromises);
      dictionaryArr = [];
      dictionarySet = new Set();
      for (const words of dictResults) {
        for (const w of words) {
          const lw = w.toLowerCase();
          if (/^[a-z]+$/.test(lw) && !dictionarySet.has(lw)) {
            dictionaryArr.push(lw);
            dictionarySet.add(lw);
          }
        }
      }
      console.log(`[Server] Dictionary: ${dictionaryArr.length} words`);

      // Guard: if dictionary is empty, Chat Relay probably wasn't ready — retry
      if (dictionaryArr.length === 0) {
        throw new Error('Dictionary returned 0 words (Chat Relay may still be starting)');
      }

      // Fetch frequency data from word bank API
      try {
        const freqRes = await fetch(`${CHAT_RELAY_URL}/api/word-bank/frequency`);
        if (freqRes.ok) {
          const raw = await freqRes.json();
          frequency = {};
          for (const [w, z] of Object.entries(raw)) {
            frequency[w.toLowerCase()] = z;
          }
          console.log(`[Server] Frequency: ${Object.keys(frequency).length} words`);
        } else {
          console.log(`[Server] Frequency fetch returned ${freqRes.status} (all words without freq will be hidden)`);
        }
      } catch (freqErr) {
        console.log(`[Server] Frequency fetch failed: ${freqErr.message} (classification will use word length fallback)`);
      }

      wordDataLoaded = true;
      return;
    } catch (e) {
      console.warn(`[Server] Word data load failed (attempt ${attempt}):`, e.message);
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.error('[Server] Failed to load word data after all retries');
}

// ─── Mine Pool ───────────────────────────────────────────────────────────────

const minesPath = path.join(__dirname, 'data', 'mines.json');
let mines = [];
let playedMineIds = new Set();

function loadMinePool() {
  try {
    if (fs.existsSync(minesPath)) {
      mines = JSON.parse(fs.readFileSync(minesPath, 'utf-8'));
      console.log(`[Server] Loaded ${mines.length} mines from pool`);
    }
  } catch (e) {
    console.warn('[Server] Failed to load mines.json:', e.message);
    mines = [];
  }
  playedMineIds = storage.loadPlayedMines();
}

const PROTECTED_PREFIXES = ['daily-', 'weekly-', 'sp-daily-', 'sp-weekly-'];
function isProtectedMine(m) {
  const id = String(m.id);
  return PROTECTED_PREFIXES.some(pfx => id.startsWith(pfx));
}

function capMinePool() {
  while (mines.length > 200) {
    const idx = mines.findIndex(m => !isProtectedMine(m));
    if (idx >= 0) mines.splice(idx, 1);
    else mines.shift();
  }
}

function saveMinePoolToDisk() {
  try {
    storage.atomicWriteSync(minesPath, mines);
  } catch (e) {
    console.warn('[Server] Failed to save mines.json:', e.message);
  }
}

function archiveSpDailyToPool(cache) {
  if (!cache || !cache.letters || !cache.date) return;
  const id = 'sp-daily-' + cache.date;
  if (mines.some(m => m.id === id)) return;
  mines.push({
    id, name: 'Daily - ' + cache.date, theme: 'Daily',
    letters: cache.letters, initialIndices: cache.initialIndices,
    bonusOrder: cache.bonusOrder, date: cache.date,
  });
  capMinePool();
  saveMinePoolToDisk();
  console.log(`[Server] Archived SP daily ${id} to pool (${mines.length} total)`);
}

function archiveSpWeeklyToPool(cache) {
  if (!cache || !cache.letters || !cache.weekStart) return;
  const id = 'sp-weekly-' + cache.weekStart;
  if (mines.some(m => m.id === id)) return;
  mines.push({
    id, name: 'Weekly - ' + cache.weekStart, theme: 'Weekly',
    letters: cache.letters, initialIndices: cache.initialIndices,
    bonusOrder: cache.bonusOrder, date: cache.weekStart,
  });
  capMinePool();
  saveMinePoolToDisk();
  console.log(`[Server] Archived SP weekly ${id} to pool (${mines.length} total)`);
}

// ─── SP Daily Mine ───────────────────────────────────────────────────────────

let spDailyCache = null;

async function generateDailyMine() {
  const today = new Date().toISOString().slice(0, 10);

  if (spDailyCache && spDailyCache.date === today) return spDailyCache;

  // Archive old daily
  if (spDailyCache && spDailyCache.date && spDailyCache.date !== today) {
    archiveSpDailyToPool(spDailyCache);
  }

  try {
    // Fetch seed word from word bank
    const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/wordmine?length=8`);
    if (!res.ok) throw new Error('Word bank returned ' + res.status);
    const { word } = await res.json();

    // Generate scaled mine — letter count auto-tuned to hit ~50 words
    const rng = mineEngine.seededRandom('wm-daily-' + today + '-' + word);
    const scaled = mineEngine.generateScaledMine(word, MINE_WORD_LIMITS.daily, dictionaryArr, frequency, { rng });
    const wordsByTier = scaled.allWords;

    spDailyCache = {
      letters: scaled.letters,
      initialIndices: scaled.initialIndices,
      bonusOrder: scaled.bonusOrder,
      wordsByTier,
      date: today,
      name: 'Daily Mine',
      theme: 'Daily',
    };

    console.log(`[Server] Daily mine generated for ${today}: ${wordsByTier.totals.total} words from ${scaled.letters.length} letters`);
    return spDailyCache;
  } catch (e) {
    console.error('[Server] Daily mine generation failed:', e.message);
    return null;
  }
}

// ─── SP Weekly Mine ──────────────────────────────────────────────────────────

let spWeeklyCache = null;

function getWeekStart() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  now.setUTCDate(now.getUTCDate() - diff);
  return now.toISOString().slice(0, 10);
}

async function generateWeeklyMine() {
  const weekStart = getWeekStart();

  if (spWeeklyCache && spWeeklyCache.weekStart === weekStart) return spWeeklyCache;

  // Archive old weekly
  if (spWeeklyCache && spWeeklyCache.weekStart && spWeeklyCache.weekStart !== weekStart) {
    archiveSpWeeklyToPool(spWeeklyCache);
  }

  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/weekly/wordmine?length=10`);
    if (!res.ok) throw new Error('Word bank returned ' + res.status);
    const { word } = await res.json();

    // Generate scaled mine — letter count auto-tuned to hit ~150 words
    const rng = mineEngine.seededRandom('wm-weekly-' + weekStart + '-' + word);
    const scaled = mineEngine.generateScaledMine(word, MINE_WORD_LIMITS.weekly, dictionaryArr, frequency, { rng });
    const wordsByTier = scaled.allWords;

    spWeeklyCache = {
      letters: scaled.letters,
      initialIndices: scaled.initialIndices,
      bonusOrder: scaled.bonusOrder,
      wordsByTier,
      weekStart,
      name: 'Weekly Mine',
      theme: 'Weekly',
    };

    console.log(`[Server] Weekly mine generated for ${weekStart}: ${wordsByTier.totals.total} words from ${scaled.letters.length} letters`);
    return spWeeklyCache;
  } catch (e) {
    console.error('[Server] Weekly mine generation failed:', e.message);
    return null;
  }
}

// ─── API: SP Mine Endpoints ──────────────────────────────────────────────────

// Mine pool list (metadata only — no word lists, no full letter details)
app.get('/api/mines', (req, res) => {
  res.json(mines.map(m => ({
    id: m.id,
    name: m.name,
    theme: m.theme,
    letterCount: (m.letters || []).length,
    date: m.date || null,
  })));
});

// Single mine (full data with pre-solved words for SP)
app.get('/api/mines/:id', (req, res) => {
  if (!wordDataLoaded) return res.status(503).json({ error: 'Word data not loaded yet' });

  const rawId = req.params.id;
  const numId = parseInt(rawId);
  const mine = mines.find(m => m.id === rawId || m.id === numId);
  if (!mine) return res.status(404).json({ error: 'Mine not found' });

  // Generate fresh 15-letter mine from the mine's name/seed (same as MP)
  const rng = mineEngine.seededRandom('wm-sp-' + mine.id);
  const scaled = mineEngine.generateScaledMine(mine.name, MINE_WORD_LIMITS.pool, dictionaryArr, frequency, { rng });
  const wordsByTier = scaled.allWords;

  res.json({
    id: mine.id,
    name: mine.name,
    theme: mine.theme,
    letters: scaled.letters,
    initialIndices: scaled.initialIndices,
    bonusOrder: scaled.bonusOrder,
    wordsByTier,
    date: mine.date || null,
  });
});

// SP Daily mine
app.get('/api/sp/daily', async (req, res) => {
  if (!wordDataLoaded) return res.status(503).json({ error: 'Word data not loaded yet' });
  const daily = await generateDailyMine();
  if (!daily) return res.status(500).json({ error: 'Failed to generate daily mine' });

  res.json({
    letters: daily.letters,
    initialIndices: daily.initialIndices,
    bonusOrder: daily.bonusOrder,
    wordsByTier: daily.wordsByTier,
    date: daily.date,
    name: daily.name,
    theme: daily.theme,
  });
});

// SP Daily completion
app.post('/api/sp/daily/complete', (req, res) => {
  if (spDailyCache) archiveSpDailyToPool(spDailyCache);
  res.json({ ok: true });
});

// SP Weekly mine
app.get('/api/sp/weekly', async (req, res) => {
  if (!wordDataLoaded) return res.status(503).json({ error: 'Word data not loaded yet' });
  const weekly = await generateWeeklyMine();
  if (!weekly) return res.status(500).json({ error: 'Failed to generate weekly mine' });

  res.json({
    letters: weekly.letters,
    initialIndices: weekly.initialIndices,
    bonusOrder: weekly.bonusOrder,
    wordsByTier: weekly.wordsByTier,
    weekStart: weekly.weekStart,
    name: weekly.name,
    theme: weekly.theme,
  });
});

// SP Weekly completion
app.post('/api/sp/weekly/complete', (req, res) => {
  if (spWeeklyCache) archiveSpWeeklyToPool(spWeeklyCache);
  res.json({ ok: true });
});

// SP Dictionary (for client-side validation fallback)
app.get('/api/sp/dictionary', (req, res) => {
  res.json(dictionaryArr);
});

// SP Frequency data (for client-side depth classification)
app.get('/api/sp/frequency', (req, res) => {
  res.json(frequency);
});

// ─── MP Game Engine ──────────────────────────────────────────────────────────

const Game = require('./src/game');
const game = new Game();

// Forward game events to all connected Socket.IO clients
game.on('mine-loaded', (s)  => io.emit('game-state', s));
game.on('game-started', (s) => io.emit('game-started', s));
game.on('game-paused', (s)  => io.emit('game-paused', s));
game.on('game-resumed', (s) => io.emit('game-resumed', s));
game.on('game-ended', (s)   => io.emit('game-ended', s));
game.on('timer-tick', (r)   => io.emit('timer-tick', r));
game.on('word-found', (e)   => io.emit('word-found', e));
game.on('depth-unlocked', (d) => io.emit('depth-unlocked', d));
game.on('mine-completed', (s) => {
  io.emit('mine-completed', s);

  // Emit game-win to Chat Relay for the shared /win-overlay
  if (chatClient.connected && chatClient.socket && s.players) {
    // Find top player by XP
    let topPlayer = null;
    let topXP = 0;
    for (const [key, p] of Object.entries(s.players)) {
      if (p.totalXP > topXP) {
        topXP = p.totalXP;
        topPlayer = { ...p, playerKey: key };
      }
    }
    if (topPlayer) {
      chatClient.socket.emit('game-win', {
        game: 'wordmine',
        gameName: 'Word Mine',
        word: null,
        winner: {
          displayName: topPlayer.displayName || 'Player',
          profilePic: null,
          platform: topPlayer.platform || 'unknown',
          cosmetics: topPlayer.cosmetics || null,
        },
        jackpot: 0,
        guessCount: topPlayer.wordsFound || 0,
        isDaily: s.isDaily || false,
      });
    }
  }
});
game.on('all-words-found', (s) => io.emit('all-words-found', s));

// Save/restore game state across restarts
game.on('word-found', () => storage.saveCurrentGame(game.getSerializableState()));
game.on('depth-unlocked', () => storage.saveCurrentGame(game.getSerializableState()));
game.on('game-started', () => storage.saveCurrentGame(game.getSerializableState()));
game.on('game-ended', () => storage.clearCurrentGame());

// Reward + library reporting on word found
game.on('word-found', async (entry) => {
  try {
    const playerKey = entry.playerKey || '';
    const parts = playerKey.split(':');
    const platform = parts[0] || 'local';
    const userId = parts.slice(1).join(':') || '';
    if (platform !== 'local' && userId) {
      await gameShared.rewardPlayer(platform, userId, entry.player, entry.player, entry.xp, 'wordmine', 'word');
      gameShared.reportLibraryWord(platform, userId, entry.word, 'wordmine', entry.player, entry.player);
    }
  } catch (e) {
    console.warn('[Game] Reward/library error:', e.message);
  }
});

// ─── Hint helpers ────────────────────────────────────────────────────────────

function getGameStateForHandle(handle) {
  // Word Mine currently runs a single public MP mine; handles are reserved
  // for future streamer-session support. Always use the active game state.
  return game.getState();
}

function generateHintForHandle(handle) {
  const state = getGameStateForHandle(handle);
  const letters = state.letters || [];
  if (!letters.length || state.status !== 'active') return null;

  // Prefer a bonus letter that has not been revealed yet, otherwise any
  // letter from the mine's target set.
  const bonusOrder = game.bonusOrder || [];
  const revealed = state.revealedBonusCount || 0;
  const unrevealed = [];
  for (let i = revealed; i < bonusOrder.length; i++) {
    unrevealed.push(bonusOrder[i]);
  }

  let pool;
  if (unrevealed.length) {
    pool = unrevealed;
  } else {
    pool = letters.map((_, i) => i);
  }

  const position = pool[Math.floor(Math.random() * pool.length)];
  return {
    letter: letters[position].toUpperCase(),
    position,
  };
}

// ─── API: MP State ───────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  res.json(game.getState());
});

app.get('/api/admin-state', requireAdmin, (req, res) => {
  res.json(game.getAdminState());
});

// Monthly hint allowance: how many hints remain for the authenticated user.
app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[WordMine] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal one target letter from the mine.
app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.status(401).json({ ok: false, error: 'auth_required' });

  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  const hint = generateHintForHandle(handle);
  if (!hint) {
    return res.json({ ok: false, reason: 'nothing_to_reveal', remaining: null });
  }

  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.GAME_API_SECRET },
      body: JSON.stringify({ discordId, game: 'wordmine', label: 'Word Mine web hint' }),
    });
    const spendData = await r.json();
    if (!spendData.ok) return res.json(spendData);
    res.json({ ok: true, ...spendData, hint });
  } catch (e) {
    console.error('[WordMine] hints use failed:', e.message);
    res.status(500).json({ ok: false, error: 'spend_failed' });
  }
});

// ─── Chat Relay Connection ───────────────────────────────────────────────────

const chatClient = new ChatClient(CHAT_RELAY_URL, {
  id: 'wordmine',
  name: 'Word Mine',
  port: PORT,
  apiKey: ADMIN_SECRET,
});

chatClient.on('message', async (msg) => {
  if (game.status !== 'active') return;
  if (!msg || !msg.user) return;

  const text = (msg.message || '').trim().toLowerCase();
  if (text.length < 4 || !/^[a-z]+$/.test(text)) return;

  // Build player info from normalized relay message
  // Canonical identity: if linked Discord exists, use it as the canonical user ID
  // (same pattern as erecTangled — prevents split identity across platforms)
  const rawUserId = msg.user.id || msg.user.username || '';
  const linkedDiscord = msg.linkedDiscord || null;
  const platform = linkedDiscord ? 'web' : (msg.platform || 'unknown');
  const userId = linkedDiscord || rawUserId;
  const username = msg.user.username || '';
  const displayName = msg.user.customNick || msg.user.displayName || msg.user.username || 'Player';

  let cosmetics = {};
  try {
    cosmetics = await gameShared.getPlayerCosmetics(platform, userId);
  } catch (e) {}

  game.submitWord(text, { platform, userId, username, displayName, cosmetics });
});

chatClient.on('cosmetics-updated', (data) => {
  if (data && data.platform && data.platformUserId) {
    gameShared.invalidateCosmetics(data.platform, data.platformUserId, data.equipped);
    // Also invalidate under canonical 'web' platform for linked Discord users
    // (in-game, linked users are stored as web:<discordId> but broadcast arrives as discord:<discordId>)
    if (data.platform === 'discord') {
      gameShared.invalidateCosmetics('web', data.platformUserId, data.equipped);
    }

    // Update in-memory game state (foundWords, players, wordHistory)
    // Try both raw key and web: variant (linked users stored under web:<discordId>)
    const rawKey = data.platform + ':' + data.platformUserId;
    const webKey = data.platform === 'discord' ? 'web:' + data.platformUserId : null;
    let changed = false;

    // Update players map
    for (const key of [rawKey, webKey]) {
      if (key && game.players && game.players[key]) {
        game.players[key].cosmetics = data.equipped || {};
        changed = true;
      }
    }

    // Update wordHistory entries
    if (game.wordHistory) {
      for (const entry of game.wordHistory) {
        if (entry.playerKey === rawKey || (webKey && entry.playerKey === webKey)) {
          entry.cosmetics = data.equipped || {};
          changed = true;
        }
      }
    }

    if (changed) {
      io.emit('game-state', game.getState());
    }
  }
});

// ─── Socket.IO (Game Clients) ────────────────────────────────────────────────

io.on('connection', (socket) => {
  // Send current state on connect
  socket.emit('game-state', game.getState());

  // Admin auth (supports ack callback for client feedback)
  socket.on('admin-auth', (key, ack) => {
    if (key === ADMIN_SECRET) {
      socket.isAdmin = true;
      if (typeof ack === 'function') ack({ ok: true });
    } else {
      if (typeof ack === 'function') ack({ ok: false });
    }
  });

  // Admin: load mine
  socket.on('admin-load-mine', async (data) => {
    if (!socket.isAdmin) return;
    if (!wordDataLoaded) return;

    try {
      let mineData, wordsByTier;

      if (data.type === 'daily') {
        const daily = await generateDailyMine();
        if (!daily) return;
        mineData = { letters: daily.letters, initialIndices: daily.initialIndices, bonusOrder: daily.bonusOrder, name: daily.name, theme: daily.theme, id: 'daily-' + daily.date, isDaily: true };
        // Scaled mines already have the right word count — use all words as targets
        wordsByTier = daily.wordsByTier;
      } else if (data.type === 'weekly') {
        const weekly = await generateWeeklyMine();
        if (!weekly) return;
        mineData = { letters: weekly.letters, initialIndices: weekly.initialIndices, bonusOrder: weekly.bonusOrder, name: weekly.name, theme: weekly.theme, id: 'weekly-' + weekly.weekStart };
        // Scaled mines already have the right word count — use all words as targets
        wordsByTier = weekly.wordsByTier;
      } else if (data.type === 'random') {
        const pool = mines.filter(m => !String(m.id).startsWith('sp-daily-') && !String(m.id).startsWith('sp-weekly-'));
        if (pool.length === 0) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        const rng = mineEngine.seededRandom('wm-pool-' + pick.id);
        const scaled = mineEngine.generateScaledMine(pick.name, MINE_WORD_LIMITS.random, dictionaryArr, frequency, { rng });
        wordsByTier = scaled.allWords;
        mineData = { letters: scaled.letters, initialIndices: scaled.initialIndices, bonusOrder: scaled.bonusOrder, name: pick.name, theme: pick.theme, id: pick.id };
      } else if (data.type === 'pool' && data.id) {
        const numId = parseInt(data.id);
        const mine = mines.find(m => m.id === data.id || m.id === numId);
        if (!mine) return;
        const rng = mineEngine.seededRandom('wm-pool-' + mine.id);
        const scaled = mineEngine.generateScaledMine(mine.name, MINE_WORD_LIMITS.pool, dictionaryArr, frequency, { rng });
        wordsByTier = scaled.allWords;
        mineData = { letters: scaled.letters, initialIndices: scaled.initialIndices, bonusOrder: scaled.bonusOrder, name: mine.name, theme: mine.theme, id: mine.id };
      } else {
        return;
      }

      game.loadMine(mineData, wordsByTier, dictionarySet, frequency);
      console.log(`[Admin] Loaded mine: ${mineData.name} (${wordsByTier.totals.total} words)`);
    } catch (e) {
      console.error('[Admin] Load mine error:', e.message);
    }
  });

  // Admin: game controls
  socket.on('admin-start', (data) => {
    if (!socket.isAdmin) return;
    game.start((data && data.timerSeconds) || 0);
    console.log('[Admin] Game started');
  });
  socket.on('admin-pause', () => {
    if (!socket.isAdmin) return;
    game.pause();
    console.log('[Admin] Game paused');
  });
  socket.on('admin-resume', () => {
    if (!socket.isAdmin) return;
    game.resume();
    console.log('[Admin] Game resumed');
  });
  socket.on('admin-end', () => {
    if (!socket.isAdmin) return;
    game.end();
    console.log('[Admin] Game ended');
  });

  // Browser-based word submission (MP page)
  socket.on('submit-word', (data) => {
    if (game.status !== 'active') return;
    // Accept string (legacy) or { word, name } object
    let word, name;
    if (typeof data === 'string') {
      word = data;
      name = 'Miner';
    } else {
      word = (data && data.word) || '';
      name = ((data && data.name) || '').trim().slice(0, 20) || 'Miner';
    }
    word = word.toLowerCase().trim();
    if (word.length < 4 || !/^[a-z]+$/.test(word)) return;
    game.submitWord(word, {
      platform: 'local',
      userId: socket.id,
      username: name,
      displayName: name,
    });
  });
});

// ─── Auto-Start ─────────────────────────────────────────────────────────────

async function autoStartGame() {
  try {
    // Pick a random mine from the pool
    const pool = mines.filter(m => !String(m.id).startsWith('sp-daily-') && !String(m.id).startsWith('sp-weekly-'));
    if (pool.length === 0) {
      console.warn('[AutoStart] No mines in pool');
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const rng = mineEngine.seededRandom('wm-auto-' + pick.id + '-' + Date.now());
    const scaled = mineEngine.generateScaledMine(pick.name, MINE_WORD_LIMITS.random, dictionaryArr, frequency, { rng });
    const mineData = {
      letters: scaled.letters, initialIndices: scaled.initialIndices,
      bonusOrder: scaled.bonusOrder, name: pick.name, theme: pick.theme, id: pick.id,
    };
    game.loadMine(mineData, scaled.allWords, dictionarySet, frequency);
    game.start(0);
    console.log(`[AutoStart] Started mine: ${pick.name} (${scaled.allWords.totals.total} words)`);
  } catch (e) {
    console.error('[AutoStart] Failed:', e.message);
  }
}

// Auto-restart when a game ends
game.on('game-ended', () => {
  setTimeout(() => autoStartGame(), 5000); // 5s cooldown before next mine
});

// ─── Startup ─────────────────────────────────────────────────────────────────

async function startup() {
  console.log('========================================');
  console.log('  Word Mine — Dig Deeper, Find Rarer');
  console.log('========================================');

  // Init game-shared
  gameShared.init({
    wordEmpiresUrl: WORD_EMPIRES_URL,
    apiSecret: ADMIN_SECRET,
    io,
  });

  // Load mine pool
  loadMinePool();

  // Load word data (retry with backoff)
  await loadWordData();

  // Restore MP game state if server restarted mid-game
  const savedGame = storage.loadCurrentGame();
  if (savedGame && savedGame.status === 'active' && savedGame.letters && savedGame.letters.length) {
    try {
      // All mines are now scaled — use all words as targets (saved thresholds handle progression)
      const allWords = mineEngine.solveMine(savedGame.letters, dictionaryArr, frequency);
      if (!allWords.thresholds) {
        allWords.thresholds = {};
        for (const tier of ['surface', 'shallow', 'medium', 'deep']) {
          allWords.thresholds[tier] = (allWords[tier] || []).length;
        }
      }
      game.restoreState(savedGame, allWords, dictionarySet, frequency);
      console.log(`[Server] Restored MP game: ${savedGame.mineName} (${Object.keys(savedGame.foundWords || {}).length} words found)`);
    } catch (e) {
      console.warn('[Server] Failed to restore game:', e.message);
      storage.clearCurrentGame();
    }
  }

  // Connect to Chat Relay
  chatClient.connect();

  // Auto-start: load a daily mine and start if no game was restored
  if (game.status !== 'active') {
    await autoStartGame();
  }

  // Start server
  server.listen(PORT, () => {
    console.log(`[Server] Word Mine running on port ${PORT}`);
    console.log(`[Server] SP page: http://localhost:${PORT}/sp.html`);
    console.log(`[Server] MP page: http://localhost:${PORT}/mp.html`);
    console.log(`[Server] Admin: http://localhost:${PORT}/admin.html`);
    console.log('========================================');
  });
}

startup().catch(err => {
  console.error('[Server] Startup failed:', err);
  process.exit(1);
});
