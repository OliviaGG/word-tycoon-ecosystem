require('dotenv').config({ override: true });
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start. '
                + 'Populate .env or pm2 env before starting this service.');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const initSqlJs = require('sql.js');

const daily = require('./src/daily');
const gameState = require('./src/game-state');
const { TriangleGrid } = require('./src/grid');
const discordNotify = require('./src/discord-notify');
const sassie = require('./src/sassie');

const PORT = process.env.PORT || 3024;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const CHAT_RELAY_DIR = process.env.CHAT_RELAY_DIR || '/opt/chat-relay';
const GAME_API_SECRET = process.env.GAME_API_SECRET;
const TRIANGLED_SESSION_SECRET = process.env.TRIANGLED_SESSION_SECRET;
const TRIANGLED_ADMIN_SECRET = process.env.TRIANGLED_ADMIN_SECRET;
if (![TRIANGLED_SESSION_SECRET, TRIANGLED_ADMIN_SECRET].every(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)))
  throw new Error('Triangled purpose credentials are unavailable');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || '';

// ── CORS ──────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:3024', 'http://127.0.0.1:3024',
  'https://wordtycoon.live', 'https://www.wordtycoon.live',
  'https://triangled.io', 'https://www.triangled.io',
  'https://triangled.live', 'https://www.triangled.live'
];

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] }
});

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/daily/images/:file', require('./src/public-image').createPublicImageRoute({
  directory: path.join(__dirname, 'data', 'puzzles'), getPuzzle: daily.getPuzzleForDate,
  today: () => daily.dateKey(),
}));

// ── Admin auth middleware ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== TRIANGLED_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Resolve a browser request to the WT account id by asking Chat Relay to
// verify the wt_remember cookie. Returns null for unauthenticated guests.
async function resolveUserFromCookie(req, fullIdentity = false) {
  const cookie = req.headers.cookie || '';
  if (!cookie.includes('wt_remember')) return null;
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/internal/whoami`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
      headers: {
        'x-api-key': GAME_API_SECRET,
        'x-forwarded-cookie': cookie,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.user) {
      if (fullIdentity) return { platform: data.user.provider || 'discord', userId: String(data.user.id), accountId: String(data.user.anchorId || data.user.id), username: String(data.user.username || data.user.id) };
      return data.user.anchorId || data.user.id || null;
    }
  } catch (e) {
    console.error('[Triangled] whoami failed:', e.message);
  }
  return null;
}

// Bind daily progress and writes to a verified account. Cross-domain portal
// sessions use a short-lived Relay-signed token; direct visits use cookies.
const { verifyGameSession } = require(path.join(CHAT_RELAY_DIR, 'src', 'game-http-identity'));
app.use(['/api/daily/progress', '/api/daily/submit', '/api/daily/submit-word', '/api/daily/hint'], async (req, res, next) => {
  try {
    const token = req.headers['x-game-session'];
    let verified = token ? verifyGameSession(TRIANGLED_SESSION_SECRET, 'triangled', token) : null;
    if (token && !verified) return res.status(401).json({ error: 'auth_required' });
    if (!verified) {
      verified = await resolveUserFromCookie(req, true);
    }
    if (verified) req.dailyPlayer = verified;
    else {
      const claimed = String((req.method === 'GET' ? req.query : req.body)?.userId || '');
      // Keep legacy guest progress keys, but never report their library words
      // or completions to the persistent account economy.
      if (!/^(web_[a-z0-9]{1,32}|guest_triangled_[a-z0-9_-]{1,64})$/.test(claimed))
        return res.status(401).json({ error: 'auth_required' });
      req.dailyPlayer = { platform: 'web', userId: claimed, username: 'Guest', guest: true };
    }
    next();
  } catch (error) {
    console.error('[Triangled] Daily identity failed:', error.message);
    return res.status(503).json({ error: 'identity_unavailable' });
  }
});

// Generate a monthly-perk hint for the current daily puzzle.
// Reveals the first letter of a random unfound theme word.
function generateMonthlyHint(discordId) {
  const puzzleRecord = daily.getTodayPuzzleFull();
  if (!puzzleRecord || puzzleRecord.status !== 'approved') return null;

  const puzzle = puzzleRecord.puzzle;
  const allThemeWords = [puzzle.spangram, ...puzzle.words];

  const today = daily.dateKey();
  const progress = gameState.getProgress(today, 'discord', discordId);
  const foundWords = progress ? progress.found_words : [];
  const unfound = allThemeWords.filter(w => !foundWords.includes(w));

  if (unfound.length === 0) return null;

  const word = unfound[Math.floor(Math.random() * unfound.length)];
  const path = puzzle.wordPaths[word];
  if (!path || !path.length) return null;

  const [r, c] = path[0];
  const idx = (r * (r + 1)) / 2 + c;
  const letter = puzzle.gridString[idx];

  return {
    word,
    letter: letter ? letter.toUpperCase() : '',
    cells: [[r, c]],
    wordLength: word.length,
    isSpangram: word === puzzle.spangram,
  };
}

// ── Rate limiting ─────────────────────────────────────────────────────
const rateLimits = new Map(); // userId -> { count, resetAt }
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const RATE_LIMIT_MAX = 15;       // max 15 submissions per window

function checkRateLimit(userId) {
  const now = Date.now();
  let entry = rateLimits.get(userId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimits.set(userId, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Cleanup stale rate limit entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 60000);

// ── Game Shared (rewards + cosmetics) ─────────────────────────────────

let gameShared;
try {
  gameShared = require(path.join(CHAT_RELAY_DIR, 'src', 'game-shared.js'));
  gameShared.init({
    wordEmpiresUrl: WORD_EMPIRES_URL,
    apiSecret: GAME_API_SECRET,
    io
  });
  console.log('Game shared module loaded');
} catch (err) {
  console.warn('Could not load game-shared module:', err.message);
  gameShared = null;
}

// ── Initialize DB ─────────────────────────────────────────────────────

let dbReady = false;

gameState.initDB(initSqlJs).then(() => {
  dbReady = true;
  console.log('Database initialized');
}).catch(err => {
  console.error('DB init failed:', err);
});

// ── Reward Calculation ────────────────────────────────────────────────

const { createCompletionRewards } = require('./src/completion-rewards');
const completionRewards = createCompletionRewards(gameShared);

const BASE_REWARD = 500;
const HINT_PENALTY = 75; // per hint used
const MIN_REWARD = 100;

function calculateReward(hintsUsed) {
  return Math.max(MIN_REWARD, BASE_REWARD - (hintsUsed * HINT_PENALTY));
}

/**
 * Handle puzzle completion — award coins, emit game-win to relay, trigger Sassie.
 */
function handleCompletion(platform, userId, username, hintsUsed, puzzleTheme, date, identity = { platform, userId }) {
  const coins = calculateReward(hintsUsed);
  if (platform === 'web' && /^(web_|guest_triangled_)/.test(userId)) return coins;

  // Award coins via Word Tycoon
  if (gameShared) {
    completionRewards.deliver(identity, date).catch(err => console.error('Reward delivery pending:', err.message));
  }

  // Emit game-win to Chat Relay (win overlay + Sassie forwarder)
  if (relayClient && relayClient.connected) {
    relayClient.emit('game-win', {
      game: 'triangled',
      gameName: 'Triangled',
      word: puzzleTheme,
      winner: {
        displayName: username,
        platform
      },
      jackpot: coins,
      isDaily: true
    });
  }

  // Trigger Sassie reaction
  sassie.triggerReaction(
    `${username} completed today's Triangled puzzle "${puzzleTheme}" and earned ${coins} coins!`,
    { emotion: 'proud', motion: 'clap', intensity: 0.9, priority: 'high' }
  );

  return coins;
}

// ── API Routes ────────────────────────────────────────────────────────

// Get today's puzzle (client-safe, no answers)
app.get('/api/daily', (req, res) => {
  const puzzle = daily.getTodayPuzzle();
  if (!puzzle) {
    return res.json({ available: false, message: 'No puzzle available today' });
  }
  res.json({ available: true, ...puzzle });
});

// Get player progress (includes answer paths for found words so the client can render them)
app.get('/api/daily/progress', (req, res) => {
  const { platform, userId } = req.dailyPlayer;
  if (!platform || !userId) return res.status(400).json({ error: 'Missing platform/userId' });

  const today = daily.dateKey();
  const progress = gameState.getProgress(today, platform, userId);
  if (!progress) return res.json({ started: false });

  // Include answer paths for found words so the grid can re-render them
  const puzzleRecord = daily.getTodayPuzzleFull();
  const foundWordPaths = {};
  const foundWordTypes = {};
  if (puzzleRecord && puzzleRecord.puzzle) {
    const pd = puzzleRecord.puzzle;
    for (const word of progress.found_words) {
      if (pd.wordPaths[word]) {
        foundWordPaths[word] = pd.wordPaths[word];
        foundWordTypes[word] = word === pd.spangram ? 'spangram' : 'theme';
      }
    }
  }

  res.json({
    started: true,
    foundWords: progress.found_words,
    foundWordPaths,
    foundWordTypes,
    hintProgress: progress.hint_progress,
    hintsUsed: progress.hints_used,
    completed: !!progress.completed,
    ...(completionRewards.status(req.dailyPlayer, today) || {})
  });
});

// Submit a word trace
app.post('/api/daily/submit', (req, res) => {
  const { platform, userId, username } = req.dailyPlayer;
  const { path: tracedPath } = req.body;
  if (!platform || !userId || !tracedPath) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!checkRateLimit(userId)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const today = daily.dateKey();
  const puzzleRecord = daily.getTodayPuzzleFull();
  if (!puzzleRecord || puzzleRecord.status !== 'approved') {
    return res.status(404).json({ error: 'No puzzle available' });
  }

  const result = gameState.submitWord(
    today, platform, userId, username || '', tracedPath, puzzleRecord.puzzle,
    { beforeComplete: ({ hintsUsed }) => completionRewards.prepare(req.dailyPlayer, today, hintsUsed) }
  );

  // Report found word to library
  if (!req.dailyPlayer.guest && result.valid && (result.type === 'theme' || result.type === 'spangram') && !result.alreadyFound && gameShared) {
    gameShared.reportLibraryWord(
      platform, userId, result.word, 'triangled', username, username
    ).catch(() => {});
  }

  // If just completed, handle rewards + relay + Sassie
  if (result.completed) {
    const progress = gameState.getProgress(today, platform, userId);
    const puzzleTheme = puzzleRecord.puzzle.theme || 'Triangled';
    result.coinsAwarded = handleCompletion(platform, userId, username || '', progress.hints_used, puzzleTheme, today, req.dailyPlayer);
    Object.assign(result, completionRewards.status(req.dailyPlayer, today) || {});
  }

  res.json(result);
});

// Submit a typed word (no path needed — server finds the answer path)
app.post('/api/daily/submit-word', (req, res) => {
  const { platform, userId, username } = req.dailyPlayer;
  const { word } = req.body;
  if (!platform || !userId || !word) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!checkRateLimit(userId)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const today = daily.dateKey();
  const puzzleRecord = daily.getTodayPuzzleFull();
  if (!puzzleRecord || puzzleRecord.status !== 'approved') {
    return res.status(404).json({ error: 'No puzzle available' });
  }

  const puzzleData = puzzleRecord.puzzle;
  const cleanWord = word.toLowerCase().replace(/[^a-z]/g, '');

  // Check if it's a themed word
  const allThemeWords = [puzzleData.spangram, ...puzzleData.words];
  if (!allThemeWords.includes(cleanWord)) {
    return res.json({ valid: false, reason: 'not_a_theme_word', word: cleanWord });
  }

  // Use the canonical path for this word
  const answerPath = puzzleData.wordPaths[cleanWord];
  if (!answerPath) {
    return res.json({ valid: false, reason: 'word_not_found' });
  }

  // Submit using the answer path
  const result = gameState.submitWord(
    today, platform, userId, username || '', answerPath, puzzleData,
    { beforeComplete: ({ hintsUsed }) => completionRewards.prepare(req.dailyPlayer, today, hintsUsed) }
  );

  // Report found word to library
  if (!req.dailyPlayer.guest && result.valid && (result.type === 'theme' || result.type === 'spangram') && !result.alreadyFound && gameShared) {
    gameShared.reportLibraryWord(
      platform, userId, cleanWord, 'triangled', username, username
    ).catch(() => {});
  }

  if (result.completed) {
    const progress = gameState.getProgress(today, platform, userId);
    const puzzleTheme = puzzleData.theme || 'Triangled';
    result.coinsAwarded = handleCompletion(platform, userId, username || '', progress.hints_used, puzzleTheme, today, req.dailyPlayer);
    Object.assign(result, completionRewards.status(req.dailyPlayer, today) || {});
  }

  res.json(result);
});

// Use a hint
app.post('/api/daily/hint', (req, res) => {
  const { platform, userId } = req.dailyPlayer;
  if (!platform || !userId) return res.status(400).json({ error: 'Missing fields' });

  const today = daily.dateKey();
  const puzzleRecord = daily.getTodayPuzzleFull();
  if (!puzzleRecord || puzzleRecord.status !== 'approved') {
    return res.status(404).json({ error: 'No puzzle available' });
  }

  const result = gameState.useHint(today, platform, userId, puzzleRecord.puzzle);
  res.json(result);
});

// Daily stats
app.get('/api/daily/stats', (req, res) => {
  const today = daily.dateKey();
  const stats = gameState.getDailyStats(today);
  res.json(stats);
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
    console.error('[Triangled] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

// Spend a monthly hint and reveal the first letter of an unfound theme word.
app.post('/api/hints/use', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.status(401).json({ ok: false, error: 'auth_required' });

  const hint = generateMonthlyHint(discordId);
  if (!hint) {
    return res.json({ ok: false, reason: 'nothing_to_reveal', remaining: null });
  }

  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/hints/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': GAME_API_SECRET },
      body: JSON.stringify({ discordId, game: 'triangled', label: 'Triangled web hint' }),
    });
    const spendData = await r.json();
    if (!spendData.ok) return res.json(spendData);
    res.json({ ok: true, ...spendData, hint });
  } catch (e) {
    console.error('[Triangled] hints use failed:', e.message);
    res.status(500).json({ ok: false, error: 'spend_failed' });
  }
});

// Player stats (for portal /api/me/triangled proxy)
app.get('/api/me/stats', (req, res) => {
  const { platform, userId } = req.query;
  if (!platform || !userId) return res.status(400).json({ error: 'Missing platform/userId' });

  // Get all completions for this player from the DB
  if (!gameState.db) return res.json({ gamesPlayed: 0, gamesWon: 0, history: [] });

  try {
    const rows = gameState.db.exec(
      `SELECT date, hints_used, completed, completed_at, created_at
       FROM daily_progress WHERE platform = ? AND user_id = ?
       ORDER BY date DESC LIMIT 30`,
      [platform, userId]
    );

    if (!rows.length || !rows[0].values.length) {
      return res.json({ gamesPlayed: 0, gamesWon: 0, history: [] });
    }

    const history = rows[0].values.map(r => ({
      date: r[0], hintsUsed: r[1], completed: !!r[2], completedAt: r[3], startedAt: r[4]
    }));

    res.json({
      gamesPlayed: history.length,
      gamesWon: history.filter(h => h.completed).length,
      history
    });
  } catch (err) {
    res.json({ gamesPlayed: 0, gamesWon: 0, history: [], error: err.message });
  }
});

// Daily puzzle archive (for future subscriber library)
app.get('/api/archive', (req, res) => {
  const puzzles = daily.listPuzzles();
  const approved = puzzles.filter(p => p.status === 'approved');
  res.json({
    total: approved.length,
    puzzles: approved.map(p => ({ date: p.date, theme: p.theme }))
  });
});

// ── Admin Routes ──────────────────────────────────────────────────────

// Generate one day or a batch of daily puzzles.
app.post('/api/admin/generate', requireAdmin, async (req, res) => {
  const { date, days, skipReview, reviewEach, overwriteExisting } = req.body;
  const parsedDays = parseInt(days, 10);
  const batchDays = Number.isFinite(parsedDays) && parsedDays > 1 ? parsedDays : 1;
  try {
    if (batchDays > 1) {
      const startDate = date || daily.dateKey();
      const summary = await daily.generatePuzzleBatch(startDate, OPENROUTER_API_KEY, {
        days: batchDays,
        puzzleCount: 1,
        overwriteExisting: !!overwriteExisting
      });

      if (reviewEach && !skipReview) {
        for (const result of summary.results) {
          if (result.status === 'generated') {
            discordNotify.sendForReview(result.date);
          }
        }
      }

      return res.json({
        success: true,
        mode: 'batch',
        startDate,
        days: batchDays,
        results: summary.results
      });
    }

    const targetDate = date || daily.dateKey(new Date(Date.now() + 86400000)); // tomorrow
    const record = await daily.generateDailyPuzzle(targetDate, OPENROUTER_API_KEY, {
      puzzleCount: 1,
      overwriteExisting: !!overwriteExisting
    });

    if (!skipReview) {
      discordNotify.sendForReview(targetDate);
    }

    res.json({
      success: true,
      mode: 'single',
      date: targetDate,
      theme: record.puzzle?.theme || record.puzzleOptions?.[0]?.theme,
      status: record.status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve puzzle
app.post('/api/admin/approve', requireAdmin, (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Missing date' });
  const record = daily.approvePuzzle(date);
  if (!record) return res.status(404).json({ error: 'No puzzle for that date' });
  res.json({ success: true, date, theme: record.puzzle?.theme });
});

// Reject puzzle
app.post('/api/admin/reject', requireAdmin, (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Missing date' });
  const record = daily.rejectPuzzle(date);
  if (!record) return res.status(404).json({ error: 'No puzzle for that date' });
  res.json({ success: true, date });
});

// Select puzzle + image (full admin choice)
app.post('/api/admin/select', requireAdmin, (req, res) => {
  const { date, puzzleChoice, imageChoice } = req.body;
  if (!date || !puzzleChoice) return res.status(400).json({ error: 'Missing date/puzzleChoice' });

  const record = daily.selectPuzzleAndImage(date, parseInt(puzzleChoice), parseInt(imageChoice) || 1);
  if (!record) return res.status(404).json({ error: 'Puzzle options not found' });
  res.json({ success: true, date, puzzle: puzzleChoice, image: imageChoice, theme: record.puzzle?.theme });
});

// Select an image option (legacy)
app.post('/api/admin/select-image', requireAdmin, (req, res) => {
  const { date, option } = req.body;
  if (!date || !option) return res.status(400).json({ error: 'Missing date/option' });

  const { selectImage } = require('./src/puzzle-generator');
  const success = selectImage(date, parseInt(option));
  if (!success) return res.status(404).json({ error: 'Image option not found' });

  // Update puzzle record with selected image
  const record = daily.loadPuzzle(date);
  if (record) {
    record.puzzle.imageFile = `${date}.jpg`;
    const fs = require('fs');
    const path = require('path');
    fs.writeFileSync(
      path.join(__dirname, 'data', 'puzzles', `${date}.json`),
      JSON.stringify(record, null, 2)
    );
  }

  res.json({ success: true, date, selectedOption: option });
});

// Get puzzle details (admin)
app.get('/api/admin/puzzle/:date', requireAdmin, (req, res) => {
  const record = daily.getPuzzleForDate(req.params.date);
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(record);
});

// List all puzzles
app.get('/api/admin/puzzles', requireAdmin, (req, res) => {
  res.json(daily.listPuzzles());
});

// ── Socket.IO ─────────────────────────────────────────────────────────

const { installSocketSecurity } = require('./src/socket-security');
installSocketSecurity(io, { secret: TRIANGLED_SESSION_SECRET, adminSecret: TRIANGLED_ADMIN_SECRET, verifyGameSession, resolveUserFromCookie });
console.log('[Triangled] Durable daily claims and socket identity enabled');

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('get-daily', () => {
    const puzzle = daily.getTodayPuzzle();
    socket.emit('daily-puzzle', puzzle || { available: false });
  });

  socket.on('submit-word', (data) => {
    try {
      const identity = data.dailyPlayer;
      if (!identity) return socket.emit('submit-result', { error: 'auth_required' });
      if (!dbReady) return socket.emit('submit-result', { error: 'database_unavailable' });
      if (!checkRateLimit(identity.userId)) return socket.emit('submit-result', { error: 'Too many requests' });
      const today = daily.dateKey(), puzzleRecord = daily.getTodayPuzzleFull();
      if (!puzzleRecord || puzzleRecord.status !== 'approved') return socket.emit('submit-result', { error: 'No puzzle available' });
      const result = gameState.submitWord(today, identity.platform, identity.userId, identity.username || '',
        data.path, puzzleRecord.puzzle,
        { beforeComplete: ({ hintsUsed }) => completionRewards.prepare(identity, today, hintsUsed) });
      if (result.valid && !identity.guest && gameShared) gameShared.reportSocketIP(socket, identity.platform, identity.userId, 'triangled');
      if (result.completed) {
        const progress = gameState.getProgress(today, identity.platform, identity.userId);
        result.coinsAwarded = handleCompletion(identity.platform, identity.userId, identity.username || '',
          progress.hints_used, puzzleRecord.puzzle.theme || 'Triangled', today, identity);
        Object.assign(result, completionRewards.status(identity, today) || {});
      }
      socket.emit('submit-result', result);
    } catch (error) {
      console.error('[Triangled] Socket submission failed:', error.message);
      socket.emit('submit-result', { error: 'submission_unavailable' });
    }
  });

  // Handle puzzle review decisions from Discord bot
  socket.on('triangled-puzzle-decision', (data) => {
    const { date, approved } = data;
    if (typeof approved !== 'boolean') return; // selection is handled by discord-notify
    console.log(`Puzzle decision for ${date}: ${approved ? 'APPROVED' : 'REJECTED'}`);
    if (approved) {
      daily.approvePuzzle(date);
    } else {
      daily.rejectPuzzle(date);
    }
  });

  socket.on('disconnect', () => {
    // cleanup
  });
});

// Initialize discord notification module with io server
discordNotify.init(io);

// ── Relay Client ──────────────────────────────────────────────────────

let relayClient;
try {
  const { createRelayClient } = require(path.join(CHAT_RELAY_DIR, 'src', 'game-shared.js'));
  relayClient = createRelayClient({
    id: 'triangled',
    name: 'Triangled',
    port: PORT,
    relayUrl: CHAT_RELAY_URL
  }, {
    onChat: () => {},
    onCosmeticsUpdated: () => {},
    onFrenzyUpdate: () => {},
    onActivateDaily: () => {
      console.log('Daily activation signal received');
    }
  });
  console.log('Relay client initialized');
} catch (err) {
  console.warn('Could not init relay client:', err.message);
}

// ── Puzzle Generation ────────────────────────────────────────────────
// Auto-generation is DISABLED. Puzzles are generated manually via:
//   POST /api/admin/generate { date: "YYYY-MM-DD", days?: 30 }
// Admin reviews options in Discord and selects via reaction.
// To re-enable auto-generation, uncomment the schedule below.
//
// async function autoGenerateTomorrow() { ... }
// setTimeout(autoGenerateTomorrow, 10000);
// scheduleNextGeneration();

// ── Start ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Triangled server running on port ${PORT}`);
  sassie.init();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  gameState.saveDB();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  gameState.saveDB();
  process.exit(0);
});

module.exports = { app, server, io };
