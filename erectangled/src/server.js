// server.js - Sproutle game server — Express + Socket.IO + Chat Relay integration

const express = require('express');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const path = require('path');

const db = require('./src/database');
const wordlist = require('./src/wordlist');
const { SproutleGame } = require('./src/game');

const PORT = process.env.PORT || 3023;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://wordtycoon.live', 'https://www.wordtycoon.live'];
const io = new Server(server, {
    cors: {
        origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected'))
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: process.env.GAME_API_SECRET, io });

// ─── Admin Auth ──────────────────────────────────────────────────────────────
const ADMIN_SECRET = process.env.GAME_API_SECRET;
function requireAdmin(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.adminKey;
    if (key === ADMIN_SECRET) return next();
    res.status(403).json({ error: 'Unauthorized' });
}

// ─── Game State ───────────────────────────────────────────────────────────────
let game = null;
let relaySocket = null;
let newGameTimer = null;
let isReady = false; // wordlist loaded?

let jackpotSettings = {
    enabled: true,
    dailyEnabled: false,
    base: 200,
    perWord: 50,
    max: 15000
};

// Daily state
let dailyWord = null;     // { word, date, length, gameId }
let dailyPlayed = false;
let currentFrenzy = { multiplier: 1.0, activeTappers: 0 };

// ─── Daily Word Fetch ─────────────────────────────────────────────────────────
async function fetchDailyWord() {
    try {
        const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/daily/erectangled?length=4`);
        if (!res.ok) return;
        const data = await res.json();
        if (dailyWord && dailyWord.date !== data.date) dailyPlayed = false;
        dailyWord = data;
        console.log(`[Sproutle] Daily word: "${data.word}" for ${data.date}`);
    } catch (e) {
        console.warn('[Sproutle] Daily word fetch failed:', e.message);
    }
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
async function startNewGame(options = {}) {
    if (newGameTimer) { clearTimeout(newGameTimer); newGameTimer = null; }
    if (!isReady) { console.warn('[Sproutle] Word list not ready, deferring game start'); return; }

    game = new SproutleGame();

    let seedWord = null;

    if (options.daily && jackpotSettings.dailyEnabled && !dailyPlayed && dailyWord) {
        seedWord = dailyWord.word;
        game.isDaily = true;
        game.dailyDate = dailyWord.date;
    }

    game.initialize(wordlist.getTrie(), wordlist.getFrequencyMap(), seedWord);

    io.emit('new-game', game.getState());
    broadcastGameState();

    console.log(`[Sproutle] Game started — ${game.rows}x${game.cols}, ` +
        `${game.commonWords.size} common words, daily=${game.isDaily}`);
}

function broadcastGameState() {
    if (!game) return;
    io.emit('game-state', game.getState());
}

function handleComplete(winner) {
    if (!game) return;

    const jackpot = game.jackpot;
    const isDaily = game.isDaily;
    const dailyDate = game.dailyDate;

    if (winner && isDaily && !dailyPlayed) {
        dailyPlayed = true;
        gameShared.rewardPlayer({
            platform: winner.platform,
            platformUserId: winner.platformUserId,
            username: winner.username,
            displayName: winner.displayName,
            profileImage: winner.profileImage || '',
            coins: jackpot,
            event: 'daily-win',
            game: 'erectangled'
        });
        if (relaySocket && relaySocket.connected) {
            relaySocket.emit('daily-win', {
                game: 'erectangled',
                winner: winner.displayName,
                platform: winner.platform
            });
        }
    } else if (winner) {
        gameShared.rewardPlayer({
            platform: winner.platform,
            platformUserId: winner.platformUserId,
            username: winner.username,
            displayName: winner.displayName,
            profileImage: winner.profileImage || '',
            coins: jackpot,
            event: 'jackpot-win',
            game: 'erectangled'
        });
    }

    io.emit('game-complete', {
        winner: winner ? winner.displayName : null,
        jackpot,
        isDaily,
        state: game.getState()
    });

    // Save history
    db.saveGameHistory({
        grid: game.grid,
        rows: game.rows,
        cols: game.cols,
        seedWord: game.seedWord,
        totalWords: game.allWords.size,
        commonWords: game.commonWords.size,
        wordsFound: game.foundWords.size,
        commonFound: game.foundCommonWords.size,
        participants: [...game.participants.values()],
        startedAt: game.startTime,
        endedAt: Date.now()
    });

    console.log(`[Sproutle] Complete! Winner: ${winner?.displayName}, jackpot: ${jackpot}`);

    // New game after 10 seconds
    newGameTimer = setTimeout(() => startNewGame({}), 10000);
}

// ─── Word Reward ──────────────────────────────────────────────────────────────
function rewardWord(guessResult) {
    const { word, isCommon, isRare, isHidden, finder } = guessResult;
    if (!finder || !finder.platformUserId) return;

    let coins = 0;
    if (isCommon) coins = 100;
    else if (isRare) coins = 250;
    else coins = 500; // hidden

    const frenzyCoins = Math.round(coins * (currentFrenzy.multiplier || 1));

    gameShared.rewardPlayer({
        platform: finder.platform,
        platformUserId: finder.platformUserId,
        username: finder.username,
        displayName: finder.displayName,
        profileImage: finder.profileImage || '',
        coins: frenzyCoins,
        event: 'word',
        game: 'erectangled'
    });

    if (!isHidden) {
        gameShared.reportLibraryWord(
            finder.platform, finder.platformUserId, word, 'erectangled',
            finder.username, finder.displayName
        );
    }
}

// ─── Chat Relay Connection ────────────────────────────────────────────────────
function connectToChatRelay() {
    relaySocket = ioClient(CHAT_RELAY_URL, {
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionDelayMax: 15000
    });

    relaySocket.on('connect', () => {
        console.log('[ChatRelay] Connected');
        relaySocket.emit('app-register', {
            id: 'erectangled',
            name: 'erecTangled',
            port: PORT,
            apiKey: ADMIN_SECRET
        });
    });

    relaySocket.on('disconnect', () => console.log('[ChatRelay] Disconnected'));
    relaySocket.on('connect_error', err => console.log(`[ChatRelay] Error: ${err.message}`));

    relaySocket.on('chat-message', (msg) => {
        if (!msg || !msg.user || !msg.message) return;
        if (!game || game.gameOver) return;

        const word = msg.message.trim().toLowerCase();
        if (!word || word.includes(' ') || !/^[a-z]+$/.test(word)) return;

        const result = game.guess(
            word,
            msg.platform || 'unknown',
            msg.user.id || msg.user.username || 'unknown',
            msg.user.username || 'unknown',
            msg.user.customNick || msg.user.displayName || msg.user.username || 'unknown',
            msg.user.profilePic || ''
        );

        if (result.result !== 'correct') return;

        rewardWord(result);

        io.emit('word-found', {
            word: result.word,
            cells: result.cells,
            isCommon: result.isCommon,
            isRare: result.isRare,
            isHidden: result.isHidden,
            newRevealedCell: result.newRevealedCell,
            autoExtraReveals: result.autoExtraReveals,
            jackpot: result.jackpot,
            finder: result.finder
        });

        if (result.newRevealedCell) {
            io.emit('cell-revealed', result.newRevealedCell);
        }
        for (const extra of (result.autoExtraReveals || [])) {
            io.emit('cell-revealed', extra);
        }

        broadcastGameState();

        if (result.isComplete) {
            handleComplete(result.finder);
        }
    });

    relaySocket.on('cosmetics-updated', (data) => {
        io.emit('cosmetics-updated', data);
    });

    relaySocket.on('frenzy-update', (data) => {
        currentFrenzy = data;
        io.emit('frenzy-update', data);
    });

    relaySocket.on('activate-daily', async () => {
        console.log('[Sproutle] Daily sequence activated');
        await fetchDailyWord();
        dailyPlayed = false;
        jackpotSettings.dailyEnabled = true;
        if (!game || game.gameOver) {
            if (newGameTimer) { clearTimeout(newGameTimer); newGameTimer = null; }
            startNewGame({ daily: true });
        }
    });
}

// ─── Socket.IO (Browser Clients) ──────────────────────────────────────────────
io.on('connection', (socket) => {
    // Send current state on connect
    if (game) socket.emit('game-state', game.getState());

    socket.on('admin-auth', (key) => {
        if (key === ADMIN_SECRET) socket.isAdmin = true;
    });

    socket.on('admin-new-game', () => {
        if (!socket.isAdmin) return;
        startNewGame({});
    });

    socket.on('admin-daily-game', () => {
        if (!socket.isAdmin) return;
        startNewGame({ daily: true });
    });
});

// ─── API Endpoints ────────────────────────────────────────────────────────────
app.get('/api/game', (req, res) => {
    if (!game) return res.json({ active: false });
    res.json({ active: true, ...game.getState() });
});

app.post('/api/new-game', requireAdmin, (req, res) => {
    startNewGame(req.body || {});
    res.json({ ok: true });
});

app.get('/api/history', requireAdmin, (req, res) => {
    res.json(db.getRecentHistory(50));
});

app.get('/api/jackpot/settings', requireAdmin, (req, res) => {
    res.json(jackpotSettings);
});

app.post('/api/jackpot/settings', requireAdmin, (req, res) => {
    const { enabled, dailyEnabled, base, perWord, max } = req.body;
    if (enabled !== undefined) jackpotSettings.enabled = enabled;
    if (dailyEnabled !== undefined) jackpotSettings.dailyEnabled = dailyEnabled;
    if (base !== undefined) jackpotSettings.base = base;
    if (perWord !== undefined) jackpotSettings.perWord = perWord;
    if (max !== undefined) jackpotSettings.max = max;
    res.json({ ok: true, settings: jackpotSettings });
});

// Public state endpoint (for Chat Relay /api/games/live aggregation)
app.get('/api/state', (req, res) => {
    if (!game) return res.json({ status: 'idle', gameOver: false, jackpot: 0 });
    const s = game.getState();
    res.json({
        status: s.gameOver ? 'won' : 'active',
        gameOver: s.gameOver,
        jackpot: s.jackpot,
        startTime: s.startTime,
        isDaily: s.isDaily,
        wordsFound: s.wordsFound,
        foundCommonCount: s.foundCommonCount,
        commonCount: s.commonWordCount,
        totalCells: s.totalCells,
        revealedCells: s.revealedIndices?.length || 0,
        gridSize: `${s.rows}x${s.cols}`,
        playerCount: s.topPlayers?.length || 0
    });
});

// SP dictionary/frequency for single-player mode
app.get('/api/sp/frequency', (req, res) => {
    const freqMap = wordlist.getFrequencyMap();
    const obj = {};
    for (const [word, score] of freqMap) obj[word] = score;
    res.json(obj);
});

// SP random game — generate a fresh Sproutle grid for single-player
let spGameCache = null; // cache one SP game (regenerated on each request for variety)

app.get('/api/sp/game', (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'Not ready' });
    try {
        const g = new SproutleGame();
        g.initialize(wordlist.getTrie(), wordlist.getFrequencyMap(), null);
        res.json(spGameStateForClient(g, false));
    } catch (e) {
        console.error('[SP] Game generation error:', e.message);
        res.status(500).json({ error: 'Failed to generate game' });
    }
});

// SP daily — same grid as MP daily (cached per day)
let spDailyCache = null;

app.get('/api/sp/daily', async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'Not ready' });
    const today = new Date().toISOString().slice(0, 10);
    if (spDailyCache && spDailyCache.dailyDate === today) {
        return res.json(spDailyCache);
    }
    try {
        await fetchDailyWord();
        if (!dailyWord || !dailyWord.word) {
            return res.status(404).json({ error: 'No daily word available' });
        }
        const g = new SproutleGame();
        g.initialize(wordlist.getTrie(), wordlist.getFrequencyMap(), dailyWord.word);
        g.isDaily = true;
        g.dailyDate = today;
        spDailyCache = spGameStateForClient(g, true);
        res.json(spDailyCache);
    } catch (e) {
        console.error('[SP Daily] Error:', e.message);
        res.status(500).json({ error: 'Failed to generate daily game' });
    }
});

function spGameStateForClient(g, isDaily) {
    return {
        grid: g.grid,
        rows: g.rows,
        cols: g.cols,
        centerCells: g.centerCells,
        revealedIndices: [...g.revealedIndices],  // includes auto-revealed cells
        revealQueue: g.revealQueue,
        allWords: [...g.allWords.keys()],
        commonWords: [...g.commonWords],
        rareWords: [...g.rareWords],
        isDaily,
        dailyDate: g.dailyDate
    };
}

// SP: manually reveal next cell (used by client when no words are available)
app.post('/api/sp/reveal', (req, res) => {
    const { state } = req.body;
    if (!state || !state.grid) return res.status(400).json({ error: 'Invalid state' });

    // Reconstruct a lightweight game object to call revealNextCell
    const g = new SproutleGame();
    g.grid = state.grid;
    g.rows = state.rows;
    g.cols = state.cols;
    g.revealedIndices = new Set(state.revealedIndices || []);
    g.revealQueue = state.revealQueue || [];
    g._trie = wordlist.getTrie();
    g._frequencyMap = wordlist.getFrequencyMap();
    g.allWords = new Map(); // not needed for reveal
    g.activeWords = new Map();
    g.foundWords = new Set();
    g.commonWords = new Set(state.commonWords || []);
    g.rareWords = new Set(state.rareWords || []);
    g.foundCommonWords = new Set();

    const revealed = g.revealNextCell();
    if (!revealed) return res.json({ revealed: null, queueEmpty: true });

    res.json({
        revealed,
        revealedIndices: [...g.revealedIndices],
        revealQueue: g.revealQueue
    });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
    console.log('[Sproutle] Starting...');

    await db.init();
    console.log('[Sproutle] Database ready');

    await wordlist.init();
    isReady = true;
    console.log('[Sproutle] Word list ready');

    await fetchDailyWord();

    // Try to restore game from DB
    const savedState = db.loadGameState();
    if (savedState && !savedState.gameOver) {
        try {
            game = new SproutleGame();
            game.restoreFromState(savedState, wordlist.getTrie(), wordlist.getFrequencyMap());
            console.log('[Sproutle] Restored previous game from DB');
        } catch (e) {
            console.warn('[Sproutle] Failed to restore game:', e.message);
            game = null;
        }
    }

    if (!game) {
        await startNewGame({});
    }

    connectToChatRelay();

    server.listen(PORT, () => {
        console.log(`[Sproutle] Listening on port ${PORT}`);
    });
}

start().catch(err => {
    console.error('[Sproutle] Fatal startup error:', err);
    process.exit(1);
});
