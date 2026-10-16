// ===== SP Game Controller =====
// Manages the entire single-player game lifecycle on the client.
// Downloads pool files via HTTP, parses JSON in browser, scores guesses locally.
// Server only picks filenames — zero CPU per guess.

import { processGuess } from './guess-processor-client.js';

export class SPGameController {
  constructor(socket) {
    this.socket = socket;
    this.language = this._readLanguage();
    this.difficulty = this._readDifficulty();
    this._serverRanked = this.language !== 'en';

    // Base path for fetch — strip filename to get directory (e.g. /game/searchle/sp.html → /game/searchle/)
    const pathname = location.pathname.replace(/[^/]*$/, '');
    this._poolBase = pathname + 'sp-pool/';

    // Game state
    this.rankings = null;       // plain object { word: rank }
    this.vocabSet = null;       // Set of all valid words (for 100000+ vs 9999999)
    this.targetWord = null;
    this.totalRankedWords = 0;
    this.wordNumber = null;     // sequential pool number (#1, #2, ...)
    this.dailyNumber = null;    // Daily #N
    this.dailyDate = null;      // Edmonton YYYY-MM-DD
    this.weeklyNumber = null;   // Weekly #N (separate numbering)
    this.isDaily = false;        // true if current game is today's daily
    this.isWeekly = false;       // true if current game is the weekly word
    this.guesses = [];
    this.guessedWords = new Set();
    this.isWon = false;
    this.startTime = null;
    this.winHistory = [];
    this.isLoading = true;

    // Preload state
    this._preloadedFile = null;
    this._preloadedText = null;    // raw response text
    this._preloadedParsed = null;  // parsed { targetWord, rankings, totalRankedWords }
    this._poolListCache = null;

    // Callbacks — set by main.js
    this.onGameReady = null;      // (gameState) => void
    this.onGuessResult = null;    // (guess) => void
    this.onWin = null;            // (data) => void
    this.onDuplicateGuess = null; // (word) => void
    this.onLoading = null;        // (isLoading) => void
    this.onWeeklyCompleted = null; // () => void — weekly already played, no game to show
    this.onPoolList = null;        // (data) => void — { games: [{word, wordNumber}], weeklyWord }

    // User ID for localStorage save key
    this._userId = this._readUserId();
    this._userCosmetics = null; // set via setCosmetics() after fetch

    // Vocab loads in background; promise is awaited in _loadPoolFile before
    // the game becomes interactive. Without this gate, a guess submitted
    // while vocab is still loading falls through to rank=9999999 ("invalid")
    // because the vocabSet.has() check skips on null vocabSet — even for
    // perfectly real words. The same word guessed later (after vocab loads)
    // then correctly resolves to 100001 ("100,000+"), producing the
    // "invalid first, valid second" bug.
    this._vocabPromise = this._serverRanked ? Promise.resolve() : this._loadVocab();
    this._setupSocketEvents();
  }

  // ---------------------------------------------------------------------------
  // User ID Helper
  // ---------------------------------------------------------------------------
  _readUserId() {
    try {
      const u = JSON.parse(localStorage.getItem('searchle_user'));
      return u && u.id ? u.id : null;
    } catch { return null; }
  }

  _readLanguage() {
    try {
      const q = new URLSearchParams(window.location.search);
      const raw = q.get('lang') || localStorage.getItem('searchle_sp_language') || 'en';
      return raw === 'pt-br' || raw === 'pt_br' || raw === 'pt' ? 'pt-br' : 'en';
    } catch {
      return 'en';
    }
  }

  _readDifficulty() {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('mode') === 'weekly') return 'normal';
      const value = String(q.get('difficulty') || localStorage.getItem('searchle_sp_difficulty') || 'normal').toLowerCase().trim();
      const aliases = { 'very-easy': 'very-common', easy: 'common', hard: 'rare', 'very-hard': 'very-rare' };
      const normalized = aliases[value] || value;
      return ['very-common', 'common', 'normal', 'rare', 'very-rare'].includes(normalized) ? normalized : 'normal';
    } catch {
      return 'normal';
    }
  }

  /** Store equipped cosmetics for guess entry rendering */
  setCosmetics(equipped) {
    this._userCosmetics = equipped;
  }

  // ---------------------------------------------------------------------------
  // Vocab Loading — shared file, downloaded once, cached forever
  // ---------------------------------------------------------------------------
  async _loadVocab() {
    try {
      const t0 = performance.now();
      const res = await fetch(this._poolBase + 'vocab.txt');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      this.vocabSet = new Set(text.split('\n'));
      console.log(`[SP] Vocab loaded: ${this.vocabSet.size.toLocaleString()} words in ${(performance.now() - t0).toFixed(0)}ms`);
    } catch (err) {
      console.warn('[SP] Failed to load vocab file:', err.message);
      this.vocabSet = null; // fall back to rankings-only check
    }
  }

  // ---------------------------------------------------------------------------
  // Socket Events
  // ---------------------------------------------------------------------------
  _setupSocketEvents() {
    this.socket.on('connect', () => {
      this.socket.emit('sp-get-pool-list');
    });

    // Server sends initial pool filename + win history + wordNumber + isWeekly
    this.socket.on('sp-init', (data) => {
      this.winHistory = data.winHistory || [];
      if (data.difficulty) this.difficulty = data.difficulty;
      this.dailyNumber = data.dailyNumber || null;
      this.dailyDate = data.dailyDate || null;
      this.isDaily = !!data.isDaily;

      if (data.serverRanked) {
        this._applyServerGameState(data);
        return;
      }

      // Weekly mode: server says weekly already completed — no game to load
      if (data.weeklyCompleted) {
        console.log('[SP] Weekly already completed — no game to load');
        this.isLoading = false;
        if (this.onLoading) this.onLoading(false);
        if (this.onWeeklyCompleted) this.onWeeklyCompleted();
        return;
      }

      // Check for saved game — resume if available
      const saved = this._loadSavedGame();
      const savedMatchesLaunch = saved &&
        !(data.isWeekly && !saved.isWeekly) &&
        !(data.isDaily && (!saved.isDaily || saved.dailyDate !== data.dailyDate)) &&
        (!(data.isDaily || data.isWeekly) || saved.filename === data.filename);
      if (savedMatchesLaunch) {
        // Resume only when a pinned daily/weekly matches the mode requested by
        // the server. A stale weekly must never replace today's daily.
        console.log(`[SP] Found saved game: ${saved.filename} (${saved.guesses.length} guesses)`);
        this._loadPoolFile(saved.filename, saved, saved.wordNumber || null, saved.isWeekly || false, saved.weeklyNumber || null);
      } else {
        this._loadPoolFile(data.filename, null, data.wordNumber, !!data.isWeekly, data.weeklyNumber || null);
      }
    });

    // Server sends new game filename + wordNumber + isWeekly + weeklyNumber
    this.socket.on('sp-new-game', (data) => {
      if (data.difficulty) this.difficulty = data.difficulty;
      this.dailyNumber = data.dailyNumber || null;
      this.dailyDate = data.dailyDate || null;
      this.isDaily = !!data.isDaily;
      if (data.serverRanked) {
        this._applyServerGameState(data);
        return;
      }
      this._loadPoolFile(data.filename, null, data.wordNumber, !!data.isWeekly, data.weeklyNumber || null);
    });

    this.socket.on('sp-guess-result', (data) => {
      if (!this._serverRanked || !data || !data.guess) return;
      this.guesses.push(data.guess);
      if (data.guess.word) this.guessedWords.add(data.guess.word);
      this.totalRankedWords = data.totalRankedWords || this.totalRankedWords;
      if (this.onGuessResult) this.onGuessResult(data.guess);
      this.saveGame();
    });

    this.socket.on('sp-duplicate', (data) => {
      if (!this._serverRanked || !data || !data.word) return;
      const idx = this.guesses.findIndex(g => g.word === data.word);
      if (idx !== -1) {
        const bumped = this.guesses.splice(idx, 1)[0];
        if (data.bumper) bumped.lastBumper = data.bumper;
        this.guesses.push(bumped);
      }
      if (this.onDuplicateGuess) this.onDuplicateGuess(data.word);
    });

    this.socket.on('sp-win', (data) => {
      if (!this._serverRanked || !data) return;
      this.isWon = true;
      this.targetWord = data.targetWord || this.targetWord;
      if (this.onWin) {
        this.onWin({...data,
          targetWord: data.targetWord,
          user: data.user,
          guessCount: data.guessCount,
          wordNumber: data.wordNumber || null,
          dailyNumber: data.dailyNumber || null,
          dailyDate: data.dailyDate || null,
          isDaily: !!data.isDaily,
          weeklyNumber: data.weeklyNumber || null,
          isWeekly: !!data.isWeekly,
          pot: 0,
        });
      }
    });

    // Server sends preload hint (next filename + wordNumber)
    this.socket.on('sp-next-file', (data) => {
      if (data.filename) {
        this._preloadFile(data.filename, data.wordNumber);
      }
    });

    // Server confirms win recorded + updated history
    this.socket.on('sp-win-recorded', (data) => {
      if (data.winHistory) {
        this.winHistory = data.winHistory;
      }
    });

    // Server responds with word number lookup
    this.socket.on('sp-word-number', (data) => {
      if (data.wordNumber && data.word === this.targetWord) {
        this.wordNumber = data.wordNumber;
        this.saveGame(); // persist so we don't ask again
        if (this.onWordNumber) this.onWordNumber(data.wordNumber);
      }
    });

    // Server returns pool listing for game browser
    this.socket.on('sp-pool-list', (data) => {
      this._poolListCache = data || null;
      if (this.onPoolList) this.onPoolList(data);
    });
  }

  // ---------------------------------------------------------------------------
  // Pool File Loading
  // ---------------------------------------------------------------------------
  async _loadPoolFile(filename, savedGame, wordNumber, isWeekly, weeklyNumber) {
    this.isLoading = true;
    if (this.onLoading) this.onLoading(true);

    try {
      let data;

      // Check preload cache first
      if (this._preloadedFile === filename && this._preloadedParsed) {
        data = this._preloadedParsed;
        console.log(`[SP] Using preloaded game: "${data.targetWord}"`);
      } else if (this._preloadedFile === filename && this._preloadedText) {
        // Fetched but not yet parsed
        data = JSON.parse(this._preloadedText);
        console.log(`[SP] Parsed preloaded game: "${data.targetWord}"`);
      } else {
        // Fresh fetch
        const t0 = performance.now();
        const res = await fetch(this._poolBase + filename);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const t1 = performance.now();
        data = JSON.parse(text);
        console.log(`[SP] Loaded pool file in ${(t1 - t0).toFixed(0)}ms download + ${(performance.now() - t1).toFixed(0)}ms parse: "${data.targetWord}" (${(data.totalRankedWords || Object.keys(data.rankings).length).toLocaleString()} words)`);
      }

      // Clear preload cache
      this._preloadedFile = null;
      this._preloadedText = null;
      this._preloadedParsed = null;

      // Apply game state
      this.rankings = data.rankings;
      this.targetWord = data.targetWord;
      this.totalRankedWords = data.totalRankedWords || Object.keys(data.rankings).length;
      this.wordNumber = wordNumber || null;
      this.weeklyNumber = weeklyNumber || null;
      this.isWeekly = !!isWeekly;
      this._currentFilename = filename;

      // If no wordNumber yet, ask the server for it
      if (!this.wordNumber && this.targetWord) {
        this.socket.emit('sp-get-word-number', { word: this.targetWord });
      }

      // Restore saved game or start fresh
      if (savedGame && savedGame.filename === filename) {
        this.guesses = savedGame.guesses || [];
        this.guessedWords = new Set(savedGame.guessedWords || []);
        this.isWon = savedGame.isWon || false;
        this.startTime = savedGame.startTime || new Date().toISOString();
        console.log(`[SP] Restored saved game: "${data.targetWord}" with ${this.guesses.length} guesses`);
        // Inject cosmetics into restored guesses (cosmetics may have loaded before pool file)
        if (this._userCosmetics) {
          for (const g of this.guesses) {
            if (g.user) g.user.cosmetics = this._userCosmetics;
          }
        }
      } else {
        this.guesses = [];
        this.guessedWords = new Set();
        this.isWon = false;
        this.startTime = new Date().toISOString();
      }

      // Wait for vocab before clearing isLoading — see constructor note.
      // _loadVocab catches its own errors and resolves regardless, so a
      // failed vocab fetch won't block the game; it just degrades to the
      // pre-fix behavior (unknown words may resolve as 9999999).
      await this._vocabPromise;

      this.isLoading = false;

      if (this.onLoading) this.onLoading(false);
      if (this.onGameReady) {
        this.onGameReady(this._getGameState());
      }

      // Request preload for the next game
      this._requestNextFile();

    } catch (err) {
      console.error('[SP] Failed to load pool file:', err.message);
      this.isLoading = false;
      if (this.onLoading) this.onLoading(false);
    }
  }

  _applyServerGameState(data) {
  this._serverRanked = true;
  this._gameId = data.gameId;
  this.language = data.language || this.language || 'en';
  this.difficulty = data.difficulty || this.difficulty || 'normal';
  this.rankings = null;
  this.targetWord = data.isWon ? data.targetWord : null;
  this.totalRankedWords = data.totalRankedWords || 0;
  this.wordNumber = data.wordNumber || null;
  this.dailyNumber = data.dailyNumber || null;
  this.dailyDate = data.dailyDate || null;
  this.weeklyNumber = data.weeklyNumber || null;
  this.isDaily = !!data.isDaily;
  this.isWeekly = !!data.isWeekly;
  this._currentFilename = null;
  this.guesses = Array.isArray(data.guesses) ? data.guesses : [];
  this.guessedWords = new Set(this.guesses.map(g => g.word).filter(Boolean));
  this.isWon = !!data.isWon;
  this.startTime = data.startTime || new Date().toISOString();
  this.isLoading = false;
  if (this.onLoading) this.onLoading(false);
  if (this.onGameReady) this.onGameReady({ ...this._getGameState(), completedAt: data.completedAt });
  const receipt = data.completionId || data.gameId;
  if (data.isWon && this.targetWord && this._restoredReceipt !== receipt) {
    this._restoredReceipt = receipt;
    if (this.onWin) this.onWin({ ...data, user: data.winner || this.guesses.at(-1)?.user || {},
      guessCount: data.completedGuessCount || this.guesses.length, pot: 0 });
  }
}

  // ---------------------------------------------------------------------------
  // Preloading
  // ---------------------------------------------------------------------------
  _requestNextFile() {
    const playedWords = this._getPlayedWords();
    // Also exclude the current word
    if (this.targetWord && !playedWords.includes(this.targetWord)) {
      playedWords.push(this.targetWord);
    }
    this.socket.emit('sp-request-next-file', { playedWords });
  }

  async _preloadFile(filename, wordNumber) {
    if (this._preloadedFile === filename) return; // already preloading/preloaded
    this._preloadedFile = filename;
    this._preloadedWordNumber = wordNumber || null;
    this._preloadedText = null;
    this._preloadedParsed = null;

    try {
      const res = await fetch(this._poolBase + filename);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      // Check we haven't been superseded
      if (this._preloadedFile !== filename) return;
      this._preloadedText = text;
      console.log(`[SP] Preloaded file: ${filename} (${(text.length / 1024 / 1024).toFixed(1)}MB)`);

      // Parse during idle time
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          if (this._preloadedFile !== filename || this._preloadedParsed) return;
          try {
            this._preloadedParsed = JSON.parse(this._preloadedText);
            console.log(`[SP] Pre-parsed: "${this._preloadedParsed.targetWord}"`);
          } catch {}
        });
      } else {
        // Fallback: parse after short delay
        setTimeout(() => {
          if (this._preloadedFile !== filename || this._preloadedParsed) return;
          try {
            this._preloadedParsed = JSON.parse(this._preloadedText);
            console.log(`[SP] Pre-parsed: "${this._preloadedParsed.targetWord}"`);
          } catch {}
        }, 500);
      }
    } catch (err) {
      console.error('[SP] Preload failed:', err.message);
      if (this._preloadedFile === filename) {
        this._preloadedFile = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Guess Submission
  // ---------------------------------------------------------------------------
  submitGuess(input, user) {
  if (this.isWon || this.isLoading) return null;
  const gameId = this._gameId;
  const operationId = globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random();
  const failed = () => {
    if (this._gameId !== gameId || this.isWon) return;
    setTimeout(() => {
      const box = document.getElementById('guess-input');
      if (box && !box.value) { box.value = input; box.focus(); }
      let status = document.getElementById('sp-acceptance-status');
      if (!status) { status = document.createElement('div'); status.id = 'sp-acceptance-status'; status.setAttribute('role', 'status');
        status.style.cssText = 'position:fixed;bottom:15%;left:50%;transform:translateX(-50%);z-index:20000;max-width:80%;padding:12px;border-radius:10px;background:#231332;color:#fff;font:16px sans-serif'; document.body.appendChild(status); }
      status.textContent = 'Guess not saved — please retry.';
    }, 0);
  };
  const transport = this.socket.socket || this.socket;
  if (transport.connected === false) { failed(); return { pending: false, retryable: true }; }
  transport.timeout(5000).emit('sp-submit-guess', { input, user, gameId, operationId }, (error, result) => {
    if (error || !result || !result.valid && result.retryable) return failed();
    const status = document.getElementById('sp-acceptance-status'); if (status) status.remove();
  });
  return { pending: true };
}

  // ---------------------------------------------------------------------------
  // New Game Request
  // ---------------------------------------------------------------------------
  requestNewGame() {
    this.clearSave(); // starting fresh — discard saved progress
    this.difficulty = this._readDifficulty();
    this.socket.emit('new-game-request', {
      playedWords: this._getPlayedWords(),
      difficulty: this.difficulty
    });
  }

  // ---------------------------------------------------------------------------
  // State Helpers
  // ---------------------------------------------------------------------------
  _getGameState() {
    return {
      guesses: this.guesses,
      totalRankedWords: this.totalRankedWords,
      startTime: this.startTime,
      isWon: this.isWon,
      winner: null,
      targetWord: null,
      lastWinner: null,
      winHistory: this.winHistory,
      jackpotEnabled: false,
      wordNumber: this.wordNumber,
      dailyNumber: this.dailyNumber,
      dailyDate: this.dailyDate,
      weeklyNumber: this.weeklyNumber,
      isDaily: this.isDaily,
      isWeekly: this.isWeekly,
      language: this.language,
      difficulty: this.difficulty,
    };
  }

  _getPlayedWords() {
    try {
      return JSON.parse(localStorage.getItem('searchle_sp_played') || '[]');
    } catch {
      return [];
    }
  }

  getGameState() {
    return this._getGameState();
  }

  // ---------------------------------------------------------------------------
  // Game Save / Resume (localStorage per user)
  // ---------------------------------------------------------------------------
  _saveKey() {
    return this._userId ? `searchle_sp_save_${this._userId}` : null;
  }

  /** Persist current game state to localStorage */
  saveGame() {
    const key = this._saveKey();
    if (!key || !this._currentFilename) return;
    try {
      const data = {
        filename: this._currentFilename,
        guesses: this.guesses,
        guessedWords: Array.from(this.guessedWords),
        isWon: this.isWon,
        startTime: this.startTime,
        wordNumber: this.wordNumber,
        dailyNumber: this.dailyNumber,
        dailyDate: this.dailyDate,
        weeklyNumber: this.weeklyNumber,
        isDaily: this.isDaily,
        isWeekly: this.isWeekly,
        difficulty: this.difficulty,
      };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.warn('[SP] Failed to save game:', err.message);
    }
  }

  /** Load saved game from localStorage. Returns saved data or null. */
  _loadSavedGame() {
    const key = this._saveKey();
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Only restore if not already won
      if (data && data.filename && !data.isWon && data.guesses && data.guesses.length > 0) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Clear saved game from localStorage */
  clearSave() {
    const key = this._saveKey();
    if (key) {
      try { localStorage.removeItem(key); } catch {}
    }
  }

  /** Request the full pool listing from the server */
  requestPoolList() {
    if (this._poolListCache && this.onPoolList) {
      this.onPoolList(this._poolListCache);
    }
    this.socket.emit('sp-get-pool-list');
  }

  /** Play a specific game by target word (from pool browser) */
  playSpecificGame(gameId) {
    if (!gameId) return;
    this.clearSave();
    this.socket.emit('sp-play-specific', { gameId });
  }
}
