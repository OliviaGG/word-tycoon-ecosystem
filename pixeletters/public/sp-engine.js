// ===== PixeLetters SP Engine =====
// Fully local single-player PixeLetters — no server connection needed for gameplay.
// Fetches word lists once, then all game logic runs client-side.
// Letters shown as 5x7 pixel grids, progressively revealed with each guess.

(function () {
  'use strict';
  // Cached older HTML can fetch this updated script before it has the helper tag.
  if (!window.WordTycoonSoloAccount) {
    var engineURL = document.currentScript && document.currentScript.src;
    var helperScript = document.createElement('script');
    helperScript.src = new URL('solo-account.js?v=20261003-owner', engineURL || window.location.href).href;
    helperScript.onload = function () {
      var engineScript = document.createElement('script');
      engineScript.src = engineURL || new URL('sp-engine.js?v=20261003-owner', window.location.href).href;
      document.head.appendChild(engineScript);
    };
    helperScript.onerror = function () {
      var notice = document.createElement('p'); notice.setAttribute('role', 'status');
      notice.textContent = 'Account protection could not load. Refresh to retry.';
      (document.getElementById('app') || document.body).appendChild(notice);
    };
    document.head.appendChild(helperScript);
    return;
  }

  var soloAccount = window.WordTycoonSoloAccount.create({ game: 'pixeletters-sp', authBase: getAuthBaseURL() });
  var localStorage = soloAccount.storage;
  var XMLHttpRequest = soloAccount.XMLHttpRequest;


  // ─── Constants ──────────────────────────────────────────────────────

  var STATS_KEY = 'pixeletters_sp_stats';
  var MODE_KEY = 'pixeletters_sp_mode';
  var BANNER_DISMISSED_KEY = 'pixeletters_banner_dismissed';
  var GAME_STATE_KEY = 'pixeletters_sp_game';
  var DAILY_STATE_KEY = 'pixeletters_sp_daily_game';
  var WORD_LENGTHS = [4, 5, 6, 7, 8];
  var DAILY_LENGTH = 5; // Daily puzzle only exists for this word length
  var MAX_GUESSES = 5;
  var AUTO_RESTART_SECONDS = 8;
  var KB_ROWS = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['\u232B', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'ENTER']
  ];

  var DIRECTIONS = ['down', 'up', 'left', 'right'];
  var ARROW_CHARS = { down: '\u2193', up: '\u2191', left: '\u2190', right: '\u2192' };

  // ─── 5x7 Pixel Font (A-Z) ────────────────────────────────────────

  var PIXEL_FONT = {
    A: [
      [0,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,1,1,1,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1]
    ],
    B: [
      [1,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,1,1,1,0]
    ],
    C: [
      [0,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,0,0,0,1],
      [0,1,1,1,0]
    ],
    D: [
      [1,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,1,1,1,0]
    ],
    E: [
      [1,1,1,1,1],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,1,1,1,0],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,1,1,1,1]
    ],
    F: [
      [1,1,1,1,1],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,1,1,1,0],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,0,0,0,0]
    ],
    G: [
      [0,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,0],
      [1,0,1,1,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [0,1,1,1,0]
    ],
    H: [
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,1,1,1,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1]
    ],
    I: [
      [1,1,1,1,1],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [1,1,1,1,1]
    ],
    J: [
      [0,0,1,1,1],
      [0,0,0,1,0],
      [0,0,0,1,0],
      [0,0,0,1,0],
      [0,0,0,1,0],
      [1,0,0,1,0],
      [0,1,1,0,0]
    ],
    K: [
      [1,0,0,0,1],
      [1,0,0,1,0],
      [1,0,1,0,0],
      [1,1,0,0,0],
      [1,0,1,0,0],
      [1,0,0,1,0],
      [1,0,0,0,1]
    ],
    L: [
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,1,1,1,1]
    ],
    M: [
      [1,0,0,0,1],
      [1,1,0,1,1],
      [1,0,1,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1]
    ],
    N: [
      [1,0,0,0,1],
      [1,1,0,0,1],
      [1,0,1,0,1],
      [1,0,0,1,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1]
    ],
    O: [
      [0,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [0,1,1,1,0]
    ],
    P: [
      [1,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,1,1,1,0],
      [1,0,0,0,0],
      [1,0,0,0,0],
      [1,0,0,0,0]
    ],
    Q: [
      [0,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,1,0,1],
      [1,0,0,1,0],
      [0,1,1,0,1]
    ],
    R: [
      [1,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,1,1,1,0],
      [1,0,1,0,0],
      [1,0,0,1,0],
      [1,0,0,0,1]
    ],
    S: [
      [0,1,1,1,0],
      [1,0,0,0,1],
      [1,0,0,0,0],
      [0,1,1,1,0],
      [0,0,0,0,1],
      [1,0,0,0,1],
      [0,1,1,1,0]
    ],
    T: [
      [1,1,1,1,1],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0]
    ],
    U: [
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [0,1,1,1,0]
    ],
    V: [
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [0,1,0,1,0],
      [0,1,0,1,0],
      [0,0,1,0,0]
    ],
    W: [
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,0,0,1],
      [1,0,1,0,1],
      [1,1,0,1,1],
      [1,0,0,0,1]
    ],
    X: [
      [1,0,0,0,1],
      [0,1,0,1,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,1,0,1,0],
      [1,0,0,0,1]
    ],
    Y: [
      [1,0,0,0,1],
      [0,1,0,1,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0],
      [0,0,1,0,0]
    ],
    Z: [
      [1,1,1,1,1],
      [0,0,0,0,1],
      [0,0,0,1,0],
      [0,0,1,0,0],
      [0,1,0,0,0],
      [1,0,0,0,0],
      [1,1,1,1,1]
    ]
  };

  // ─── State ──────────────────────────────────────────────────────────

  var wordCache = {};      // { "5": { targets: [...], dictionary: Set } }
  var game = null;         // { secret, wordLength, guesses, directions, mode, isWon, isLost, keyStates }
  var currentInput = '';
  var currentWordLength = 5;
  var currentMode = 'standard';
  var statsOpen = false;
  var userSession = null;
  var submitCooldown = false;
  var countdownInterval = null;
  var errorTimeout = null;
  var loading = false;
  var dailyData = null;      // { word, date, length } from /api/sp/daily
  var dailyPlayed = false;   // whether today's daily has been played
  var currentGameIsDaily = false; // whether the current game uses the daily word
  var launchMode = new URLSearchParams(window.location.search).get('mode');
  var stateSyncTimer = null;
  var serverCompletedDates = {};

  // Restore persisted mode
  try {
    var savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode && (savedMode === 'standard' || savedMode === 'plus' || savedMode === 'pro')) {
      currentMode = savedMode;
    }
  } catch (e) {}

  // ─── DOM Refs ───────────────────────────────────────────────────────

  var gridEl = document.getElementById('pixel-grid');
  var keyboardEl = document.getElementById('keyboard');
  var errorToast = document.getElementById('error-toast');
  var winOverlay = document.getElementById('win-overlay');
  var winModal = document.getElementById('win-modal');
  var winPic = document.getElementById('win-pic');
  var winName = document.getElementById('win-name');
  var winWord = document.getElementById('win-word');
  var winInfo = document.getElementById('win-info');
  var winCountdown = document.getElementById('win-countdown');
  var wordSizeToggle = document.getElementById('word-size-toggle');
  var guessCounterEl = document.getElementById('guess-counter');
  var modeSelector = document.getElementById('mode-selector');

  var toggleBtn = document.getElementById('stats-toggle');
  var dropdown = document.getElementById('stats-dropdown');
  var closeStatsBtn = document.getElementById('stats-close');

  var banner = document.getElementById('login-banner');
  var bannerClose = document.getElementById('banner-close');

  function getGameBaseURL() {
    var origin = window.location.protocol + '//' + window.location.host;
    var path = window.location.pathname || '/';
    var proxied = path.match(/^\/game\/[^/]+/);
    if (proxied) return origin + proxied[0];
    var legacy = path.match(/^\/(pixeletters)(?=\/|$)/);
    if (legacy && (window.location.hostname === 'wordtycoon.live' || window.location.hostname === 'www.wordtycoon.live')) {
      return origin + legacy[0];
    }
    return origin;
  }

  // Auth + daily-completion routes belong to the RELAY, which serves them at
  // the ORIGIN root — never under the /game/<id> prefix getGameBaseURL()
  // returns. Sending them through the game base made
  // /game/pixeletters/api/me/session 404 with an HTML body, so r.json() threw
  // and the page silently stayed logged out: no cosmetics, perks, wins chip
  // or server-side daily sync.
  function getAuthBaseURL() {
    var host = window.location.hostname;
    if (host === 'wordtycoon.live' || host === 'www.wordtycoon.live' || host === 'localhost' || host === '127.0.0.1') {
      return window.location.protocol + '//' + window.location.host;
    }
    return 'https://wordtycoon.live';
  }

  // ─── Word Loading ───────────────────────────────────────────────────

  function fetchWords(len, cb) {
    if (wordCache[len]) return cb(null, wordCache[len]);

    fetch(getGameBaseURL() + '/api/sp/words/' + len)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        wordCache[len] = {
          targets: data.targets || [],
          dictionary: new Set(data.dictionary || [])
        };
        cb(null, wordCache[len]);
      })
      .catch(function (err) { cb(err); });
  }

  // ─── Direction helpers ─────────────────────────────────────────────

  function pickDirection() {
    return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
  }

  // Simple seeded PRNG (mulberry32)
  function seededRng(seed) {
    var t = seed | 0;
    return function() {
      t = (t + 0x6D2B79F5) | 0;
      var x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
  }

  function buildDirections(len, dailyDate) {
    var dirs = [];
    if (dailyDate) {
      // Seeded directions so all daily players get the same reveal pattern
      var rng = seededRng(hashString('pixeletters-daily-' + dailyDate));
      for (var i = 0; i < len; i++) {
        dirs.push(DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]);
      }
    } else {
      for (var i = 0; i < len; i++) {
        dirs.push(pickDirection());
      }
    }
    return dirs;
  }

  // ─── Pixel Reveal Logic ────────────────────────────────────────────

  /**
   * Determine if a pixel at (row, col) is revealed.
   * Standard: rows from top.
   * Plus: per-letter direction, cumulative.
   * Pro: only the LATEST row/col (not cumulative).
   */
  function isPixelRevealed(row, col, direction, revealCount, mode) {
    if (mode === 'standard') {
      return row < revealCount;
    }

    switch (direction) {
      case 'down':
        if (mode === 'pro') return row === revealCount - 1;
        return row < revealCount;
      case 'up':
        if (mode === 'pro') return (6 - row) === revealCount - 1;
        return (6 - row) < revealCount;
      case 'right':
        if (mode === 'pro') return col === revealCount - 1;
        return col < revealCount;
      case 'left':
        if (mode === 'pro') return (4 - col) === revealCount - 1;
        return (4 - col) < revealCount;
      default:
        return row < revealCount;
    }
  }

  /**
   * Build pixel feedback for a single guess.
   * Returns array of { correct, grid (7x5 of color strings), direction }
   */
  function buildPixelFeedback(guess, answer, guessIndex, directions, mode) {
    var revealCount = guessIndex + 1;
    var feedback = [];

    for (var pos = 0; pos < guess.length; pos++) {
      var guessChar = guess[pos];
      var answerChar = answer[pos];
      var guessGrid = PIXEL_FONT[guessChar] || PIXEL_FONT['A'];
      var answerGrid = PIXEL_FONT[answerChar] || PIXEL_FONT['A'];
      var direction = directions[pos];

      if (guessChar === answerChar) {
        // Correct letter - all ON pixels are blue
        var grid = [];
        for (var r = 0; r < 7; r++) {
          var rowData = [];
          for (var c = 0; c < 5; c++) {
            rowData.push(guessGrid[r][c] === 1 ? 'blue' : 'off');
          }
          grid.push(rowData);
        }
        feedback.push({ correct: true, grid: grid, direction: direction });
      } else {
        // Wrong letter
        var grid2 = [];
        for (var r2 = 0; r2 < 7; r2++) {
          var rowData2 = [];
          for (var c2 = 0; c2 < 5; c2++) {
            var revealed = isPixelRevealed(r2, c2, direction, revealCount, mode);

            if (guessGrid[r2][c2] === 1) {
              if (revealed) {
                rowData2.push(answerGrid[r2][c2] === 1 ? 'green' : 'red');
              } else {
                rowData2.push('gray');
              }
            } else {
              rowData2.push('off');
            }
          }
          grid2.push(rowData2);
        }
        feedback.push({ correct: false, grid: grid2, direction: direction });
      }
    }

    return feedback;
  }

  function fetchDaily(len, cb) {
    // Daily puzzle only exists for the canonical daily length. Other lengths
    // are practice mode — skip the fetch and leave dailyData null so the
    // daily-branch conditions in newGame() all evaluate false.
    if (len !== DAILY_LENGTH) {
      dailyData = null;
      dailyPlayed = false;
      if (cb) cb();
      return;
    }
    var x = new XMLHttpRequest();
    x.open('GET', getGameBaseURL() + '/api/sp/daily?length=' + len, true);
    x.onload = function() {
      if (x.status === 200) {
        try {
          dailyData = JSON.parse(x.responseText);
          // Check if already played today
          var key = 'pixeletters_sp_daily_date';
          var played = localStorage.getItem(key);
          dailyPlayed = (played === dailyData.date) || !!serverCompletedDates[dailyData.date];
          console.log('[SP] Daily fetched:', dailyData.word ? '(available)' : 'none', 'played:', dailyPlayed);
        } catch(e) { dailyData = null; }
      }
      if (cb) cb();
    };
    x.onerror = function() { dailyData = null; if (cb) cb(); };
    x.send();
  }

  // ─── Server Completion Sync ──────────────────────────────────────

  function fetchServerCompletions(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', getAuthBaseURL() + '/api/sp-daily/status/pixeletters-sp', true);
    x.withCredentials = true;
    x.onload = function() {
      if (x.status === 200) {
        try {
          var data = JSON.parse(x.responseText);
          if (data.ok && data.completedDates) {
            for (var i = 0; i < data.completedDates.length; i++) {
              serverCompletedDates[data.completedDates[i]] = true;
            }
            // Early sync deferred to fetchDaily() where dailyData.date is available
            // (dates are Edmonton timezone from server, not UTC)
          }
        } catch(e) {}
      }
      if (cb) cb();
    };
    x.onerror = function() { if (cb) cb(); };
    x.send();
  }

  function saveServerCompletion(date) {
    var evidence = { length: game.wordLength, guesses: game.guesses.map(function (g) { return g.word; }) };
    if (!userSession) {
      console.log('[SP] saveServerCompletion skipped — no session');
      return;
    }
    soloAccount.complete({ date: date, evidence: evidence });
  }


  // ─── Game Logic ────────────────────────────────────────────────────

  function newGame(len) {
    if (loading) return;
    len = len || currentWordLength;

    // Save daily game state before switching away
    if (currentGameIsDaily && game && !game.isWon && !game.isLost) {
      saveDailyGameState();
    }

    currentWordLength = len;
    loading = true;

    fetchWords(len, function (err, words) {
      loading = false;
      if (err || !words || words.targets.length === 0) {
        showError('Could not load words. Try refreshing.');
        return;
      }

      // Check for a saved daily game at this length
      var savedDaily = loadDailyGameState();
      if (savedDaily && savedDaily.wordLength === len && len === DAILY_LENGTH && savedDaily.guesses && savedDaily.guesses.length > 0) {
        game = {
          secret: savedDaily.secret,
          wordLength: savedDaily.wordLength,
          guesses: savedDaily.guesses || [],
          directions: savedDaily.directions || [],
          mode: savedDaily.mode || 'standard',
          isWon: false,
          isLost: false,
          keyStates: savedDaily.keyStates || {}
        };
        currentGameIsDaily = true;
        currentInput = '';
        var badge = document.getElementById('daily-badge');
        if (badge) badge.classList.remove('hidden');
        clearGameState();
        hideWin();
        renderGrid();
        buildKeyboard();
        updateGuessCounter();
        updateWordSizeToggle();
        console.log('[SP] Restored DAILY game in progress');
        return;
      }

      var secret;
      // Use daily word if available and not yet played
      if (dailyData && !dailyPlayed && dailyData.date && dailyData.length === len && len === DAILY_LENGTH) {
        secret = dailyData.word.toUpperCase();
        dailyPlayed = true;
        currentGameIsDaily = true;
        var badge = document.getElementById('daily-badge');
        if (badge) badge.classList.remove('hidden');
        console.log('[SP] Starting DAILY game');
      } else {
        secret = words.targets[Math.floor(Math.random() * words.targets.length)].toUpperCase();
        currentGameIsDaily = false;
        var badge = document.getElementById('daily-badge');
        if (badge) badge.classList.add('hidden');
      }

      game = {
        secret: secret,
        wordLength: len,
        guesses: [],
        directions: buildDirections(len, currentGameIsDaily && dailyData ? dailyData.date : null),
        mode: currentMode,
        isWon: false,
        isLost: false,
        keyStates: {}
      };
      clearGameState();

      currentInput = '';
      hideWin();
      renderGrid();
      buildKeyboard();
      updateGuessCounter();
      updateWordSizeToggle();
    });
  }

  function processGuess(word) {
    if (!game || game.isWon || game.isLost) return { error: 'No active game' };

    word = word.toUpperCase();
    var len = game.wordLength;

    if (word.length !== len) return { error: 'Word must be ' + len + ' letters' };
    if (!/^[A-Z]+$/.test(word)) return { error: 'Only letters allowed' };

    var words = wordCache[len];
    if (!words || !words.dictionary.has(word)) return { error: 'Not a valid word' };

    if (game.guesses.some(function (g) { return g.word === word; })) {
      return { error: 'Already guessed' };
    }

    var guessIndex = game.guesses.length;
    var feedback = buildPixelFeedback(word, game.secret, guessIndex, game.directions, game.mode);

    // Update keyboard states
    for (var i = 0; i < word.length; i++) {
      var letter = word[i];
      var pf = feedback[i];

      if (pf.correct) {
        game.keyStates[letter] = { status: 'correct', grid: pf.grid };
      } else if (!game.keyStates[letter] || game.keyStates[letter].status !== 'correct') {
        game.keyStates[letter] = { status: 'wrong', grid: pf.grid };
      }
    }

    game.guesses.push({ word: word, feedback: feedback });
    reportLibraryWord(word, 'pixeletters-sp');
    saveGameState();

    if (word === game.secret) {
      game.isWon = true;
      recordGameResult(true, game.secret, game.guesses.length);
      clearGameState();
      if (currentGameIsDaily) clearDailyGameState();
      return { ok: true, isCorrect: true };
    }

    if (game.guesses.length >= MAX_GUESSES) {
      game.isLost = true;
      recordGameResult(false, game.secret, game.guesses.length);
      clearGameState();
      if (currentGameIsDaily) clearDailyGameState();
      return { ok: true, isCorrect: false, isLost: true };
    }

    if (currentGameIsDaily) saveDailyGameState();

    return { ok: true, isCorrect: false };
  }

  // ─── Game State Persistence ─────────────────────────────────────

  function saveGameState() {
    if (!game) return;
    try {
      localStorage.setItem(GAME_STATE_KEY, JSON.stringify({
        secret: game.secret,
        wordLength: game.wordLength,
        guesses: game.guesses,
        directions: game.directions,
        mode: game.mode,
        keyStates: game.keyStates,
        isWon: game.isWon,
        isLost: game.isLost,
        isDaily: currentGameIsDaily
      }));
    } catch (e) {}
  }

  function loadGameState() {
    try {
      var raw = localStorage.getItem(GAME_STATE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s.secret || !s.wordLength || !s.guesses) return null;
      return s;
    } catch (e) { return null; }
  }

  function clearGameState() {
    try { localStorage.removeItem(GAME_STATE_KEY); } catch (e) {}
  }

  function saveDailyGameState() {
    if (!currentGameIsDaily || !game) return;
    if (game.isWon || game.isLost) return;
    try {
      localStorage.setItem(DAILY_STATE_KEY, JSON.stringify({
        secret: game.secret,
        wordLength: game.wordLength,
        guesses: game.guesses,
        directions: game.directions,
        mode: game.mode,
        keyStates: game.keyStates,
        dailyDate: dailyData ? dailyData.date : null
      }));
    } catch (e) {}
    debouncedSaveToServer();
  }

  function loadDailyGameState() {
    try {
      var raw = localStorage.getItem(DAILY_STATE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s.secret || !s.wordLength || !s.dailyDate) return null;
      if (dailyData && s.dailyDate !== dailyData.date) { clearDailyGameState(); return null; }
      return s;
    } catch (e) { return null; }
  }

  function clearDailyGameState() {
    try { localStorage.removeItem(DAILY_STATE_KEY); } catch (e) {}
    clearGameStateFromServer();
  }

  // ─── Server Game State Sync ────────────────────────────────────────

  function saveGameStateToServer() {
    if (!userSession || !currentGameIsDaily) return;
    var stateRaw = localStorage.getItem(DAILY_STATE_KEY);
    if (!stateRaw) return;
    var x = new XMLHttpRequest();
    x.open('POST', '/api/sp-state/pixeletters-sp', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ state: JSON.parse(stateRaw) }));
  }

  function clearGameStateFromServer() {
    if (!userSession) return;
    var x = new XMLHttpRequest();
    x.open('DELETE', '/api/sp-state/pixeletters-sp', true);
    x.send();
  }

  function loadGameStateFromServer(callback) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/sp-state/pixeletters-sp', true);
    x.onload = function() {
      if (x.status === 200) {
        try {
          var data = JSON.parse(x.responseText);
          callback(data.ok && data.state ? data.state : null);
        } catch(e) { callback(null); }
      } else { callback(null); }
    };
    x.onerror = function() { callback(null); };
    x.send();
  }

  function debouncedSaveToServer() {
    if (stateSyncTimer) clearTimeout(stateSyncTimer);
    stateSyncTimer = setTimeout(saveGameStateToServer, 2000);
  }

  // ─── Rendering: Pixel Grid ────────────────────────────────────────

  function renderGrid() {
    if (!game) return;
    gridEl.innerHTML = '';

    for (var row = 0; row < MAX_GUESSES; row++) {
      if (row < game.guesses.length) {
        // Filled guess row
        var guess = game.guesses[row];
        var rowEl = createGuessRow(guess.word, guess.feedback);
        gridEl.appendChild(rowEl);
      } else if (row === game.guesses.length && !game.isWon && !game.isLost) {
        // Current input row
        var inputRow = createInputRow();
        gridEl.appendChild(inputRow);
      } else {
        // Empty future row
        var emptyRow = createEmptyRow();
        gridEl.appendChild(emptyRow);
      }
    }
  }

  function createGuessRow(word, feedback) {
    var row = document.createElement('div');
    row.className = 'guess-row';

    for (var i = 0; i < word.length; i++) {
      var pf = feedback[i];
      var tile = document.createElement('div');
      tile.className = 'letter-tile';

      // Arrow in plus/pro modes
      if (game.mode !== 'standard') {
        var arrow = document.createElement('div');
        arrow.className = 'arrow';
        arrow.textContent = ARROW_CHARS[pf.direction] || '';
        tile.appendChild(arrow);
      }

      // Pixel box
      var box = document.createElement('div');
      box.className = 'pixel-box' + (pf.correct ? ' correct-box' : '');

      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 5; c++) {
          var px = document.createElement('div');
          px.className = 'px ' + pf.grid[r][c];
          box.appendChild(px);
        }
      }

      tile.appendChild(box);
      row.appendChild(tile);
    }

    return row;
  }

  function createInputRow() {
    var row = document.createElement('div');
    row.className = 'guess-row current-row';

    for (var i = 0; i < game.wordLength; i++) {
      var tile = document.createElement('div');
      tile.className = 'letter-tile';

      // Arrow placeholder in plus/pro modes
      if (game.mode !== 'standard') {
        var arrow = document.createElement('div');
        arrow.className = 'arrow';
        arrow.textContent = ARROW_CHARS[game.directions[i]] || '';
        tile.appendChild(arrow);
      }

      var box = document.createElement('div');
      box.className = 'pixel-box current-box';

      if (i < currentInput.length) {
        // Show typed letter with neutral coloring
        var letterGrid = PIXEL_FONT[currentInput[i]] || PIXEL_FONT['A'];
        for (var r = 0; r < 7; r++) {
          for (var c = 0; c < 5; c++) {
            var px = document.createElement('div');
            px.className = 'px ' + (letterGrid[r][c] === 1 ? 'neutral' : 'off');
            box.appendChild(px);
          }
        }
      } else {
        // Empty slot
        for (var r2 = 0; r2 < 7; r2++) {
          for (var c2 = 0; c2 < 5; c2++) {
            var px2 = document.createElement('div');
            px2.className = 'px empty';
            box.appendChild(px2);
          }
        }
      }

      tile.appendChild(box);
      row.appendChild(tile);
    }

    return row;
  }

  function createEmptyRow() {
    var row = document.createElement('div');
    row.className = 'guess-row empty-row';

    for (var i = 0; i < game.wordLength; i++) {
      var tile = document.createElement('div');
      tile.className = 'letter-tile';

      // Arrow placeholder in plus/pro modes
      if (game.mode !== 'standard') {
        var arrow = document.createElement('div');
        arrow.className = 'arrow';
        arrow.textContent = '';
        tile.appendChild(arrow);
      }

      var box = document.createElement('div');
      box.className = 'pixel-box empty-box';

      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 5; c++) {
          var px = document.createElement('div');
          px.className = 'px empty';
          box.appendChild(px);
        }
      }

      tile.appendChild(box);
      row.appendChild(tile);
    }

    return row;
  }

  // ─── QWERTY Keyboard with Mini Pixel Grids ────────────────────────

  function buildKeyboard() {
    keyboardEl.innerHTML = '';

    KB_ROWS.forEach(function (row) {
      var rowEl = document.createElement('div');
      rowEl.className = 'kb-row';

      row.forEach(function (key) {
        var btn = document.createElement('button');
        btn.className = 'kb-key';
        btn.setAttribute('type', 'button');

        if (key === 'ENTER') {
          btn.classList.add('wide', 'enter');
          btn.textContent = 'GO';
          btn.setAttribute('data-key', 'ENTER');
          btn.addEventListener('click', function () { handleKeyPress('ENTER'); });
        } else if (key === '\u232B') {
          btn.classList.add('wide', 'backspace');
          btn.textContent = '\u232B';
          btn.setAttribute('data-key', 'BACK');
          btn.addEventListener('click', function () { handleKeyPress('BACK'); });
        } else {
          btn.setAttribute('data-key', key);

          // Mini pixel grid for the letter
          var fontData = PIXEL_FONT[key];
          var keyState = game ? game.keyStates[key] : null;

          if (keyState && keyState.status === 'correct') {
            btn.classList.add('correct');
          }

          var pixels = document.createElement('div');
          pixels.className = 'key-pixels';

          if (keyState && fontData) {
            // Show letter shape: all ON pixels green (wrong) or blue (correct)
            var kbColor = keyState.status === 'correct' ? 'blue' : 'green';
            for (var r = 0; r < 7; r++) {
              for (var c = 0; c < 5; c++) {
                var kpx = document.createElement('div');
                kpx.className = 'kpx ' + (fontData[r][c] === 1 ? kbColor : 'off');
                pixels.appendChild(kpx);
              }
            }
          } else if (fontData) {
            // Show unguessed letter shape in green (default)
            for (var r2 = 0; r2 < 7; r2++) {
              for (var c2 = 0; c2 < 5; c2++) {
                var kpx2 = document.createElement('div');
                kpx2.className = 'kpx ' + (fontData[r2][c2] === 1 ? 'green' : 'off');
                pixels.appendChild(kpx2);
              }
            }
          }

          btn.appendChild(pixels);

          var label = document.createElement('div');
          label.className = 'key-label';
          label.textContent = key;
          btn.appendChild(label);

          btn.addEventListener('click', (function (k) {
            return function () { handleKeyPress(k); };
          })(key));
        }

        rowEl.appendChild(btn);
      });

      keyboardEl.appendChild(rowEl);
    });
  }

  function updateKeyboard() {
    if (!game) return;

    var keys = keyboardEl.querySelectorAll('.kb-key[data-key]');
    keys.forEach(function (btn) {
      var key = btn.getAttribute('data-key');
      if (!key || key === 'ENTER' || key === 'BACK') return;

      var keyState = game.keyStates[key];
      btn.classList.remove('correct', 'wrong', 'absent');

      if (keyState) {
        // Only highlight correct (blue) — all others stay green (default)
        if (keyState.status === 'correct') btn.classList.add('correct');

        // Update pixel grid inside key - show letter shape in green or blue
        var pixelsEl = btn.querySelector('.key-pixels');
        if (pixelsEl) {
          var fontData = PIXEL_FONT[key];
          if (fontData) {
            var kbColor = keyState.status === 'correct' ? 'blue' : 'green';
            pixelsEl.innerHTML = '';
            for (var r = 0; r < 7; r++) {
              for (var c = 0; c < 5; c++) {
                var kpx = document.createElement('div');
                kpx.className = 'kpx ' + (fontData[r][c] === 1 ? kbColor : 'off');
                pixelsEl.appendChild(kpx);
              }
            }
          }
        }
      }
    });
  }

  // ─── Input Handling ────────────────────────────────────────────────

  function handleKeyPress(key) {
    if (game && (game.isWon || game.isLost)) return;

    if (key === 'ENTER') {
      submitGuess();
    } else if (key === 'BACK') {
      if (currentInput.length > 0) {
        currentInput = currentInput.slice(0, -1);
        renderGrid();
      }
    } else if (/^[A-Z]$/.test(key)) {
      if (currentInput.length < currentWordLength) {
        currentInput += key;
        renderGrid();
      }
    }
  }

  // Physical keyboard
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Enter') { e.preventDefault(); handleKeyPress('ENTER'); }
    else if (e.key === 'Backspace') { e.preventDefault(); handleKeyPress('BACK'); }
    else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); handleKeyPress(e.key.toUpperCase()); }
  });

  // ─── Guess Submission ─────────────────────────────────────────────

  function submitGuess() {
    if (submitCooldown || loading) return;
    var word = currentInput.trim();
    if (!word || word.length !== currentWordLength) return;

    var result = processGuess(word);
    currentInput = '';

    if (result.error) {
      showError(result.error);
      renderGrid();
    } else {
      renderGrid();
      updateKeyboard();
      updateGuessCounter();
      if (result.isCorrect) {
        showWin(game.secret, game.guesses.length, true);
      } else if (result.isLost) {
        showWin(game.secret, game.guesses.length, false);
      }
    }

    submitCooldown = true;
    setTimeout(function () { submitCooldown = false; }, 300);
  }

  // ─── Word Size Toggle ─────────────────────────────────────────────

  function buildWordSizeToggle() {
    if (!wordSizeToggle) return;
    wordSizeToggle.innerHTML = '';
    var btn = document.createElement('button');
    btn.className = 'ws-btn active';
    btn.textContent = currentWordLength;
    btn.setAttribute('type', 'button');
    btn.setAttribute('title', 'Click to change word length');
    btn.addEventListener('click', function () {
      var idx = WORD_LENGTHS.indexOf(currentWordLength);
      var nextIdx = (idx + 1) % WORD_LENGTHS.length;
      fetchDaily(WORD_LENGTHS[nextIdx], function() { newGame(WORD_LENGTHS[nextIdx]); });
    });
    wordSizeToggle.appendChild(btn);
  }

  function updateWordSizeToggle() {
    if (!wordSizeToggle) return;
    var btn = wordSizeToggle.querySelector('.ws-btn');
    if (btn) btn.textContent = currentWordLength;
  }

  function updateGuessCounter() {
    if (guessCounterEl && game) {
      guessCounterEl.textContent = game.guesses.length + '/' + MAX_GUESSES;
    }
  }

  // ─── Mode Selector ────────────────────────────────────────────────

  function initModeSelector() {
    if (!modeSelector) return;

    var btns = modeSelector.querySelectorAll('.mode-btn');
    btns.forEach(function (btn) {
      var mode = btn.getAttribute('data-mode');
      btn.classList.toggle('active', mode === currentMode);

      btn.addEventListener('click', function () {
        if (mode === currentMode) return;
        currentMode = mode;

        try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}

        btns.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-mode') === mode);
        });

        // Start a new game with the new mode
        newGame(currentWordLength);
      });
    });
  }

  // ─── Error Toast ──────────────────────────────────────────────────

  function showError(msg) {
    if (errorTimeout) clearTimeout(errorTimeout);
    errorToast.textContent = msg;
    errorToast.className = 'error-toast shake';
    errorTimeout = setTimeout(function () {
      errorToast.classList.add('hidden');
      errorToast.classList.remove('shake');
    }, 2500);
  }

  // ─── Daily Completed Overlay ─────────────────────────────────────

  function showDailyCompleted() {
    var overlay = document.getElementById('win-overlay') || document.querySelector('.win-overlay');
    if (overlay) {
      overlay.innerHTML = '<div style="text-align:center;padding:40px 20px;"><div style="font-size:3rem;margin-bottom:12px;">\u2705</div><div style="font-size:1.3rem;font-weight:700;margin-bottom:8px;">Daily Completed!</div><div style="color:#aaa;margin-bottom:16px;">You\'ve already finished today\'s daily challenge.</div><a href="/me" style="display:inline-block;padding:10px 24px;background:#ff6b9d;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">\u2190 Back to Portal</a></div>';
      overlay.classList.remove('hidden');
      overlay.style.display = '';
    }
  }

  // ─── Win/Loss Overlay ─────────────────────────────────────────────

  // ─── Daily share ─────────────────────────────────────────────────────────
  var shareText = '';
  function doDailyShare() {
    if (!shareText) return;
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).catch(function () {
        try { window.prompt('Copy your result:', shareText); } catch (e) {}
      });
    } else {
      try { window.prompt('Copy your result:', shareText); } catch (e) {}
    }
  }

  function showWin(word, guessCount, won) {
    // Win → shared WinCard component (loss keeps the existing modal below).
    if (won && window.WinCard) {
      shareText = '👾 PixeLetters Daily' + (currentGameIsDaily && dailyData && dailyData.date ? ' ' + dailyData.date : '') +
        ' — solved in ' + guessCount + ' guess' + (guessCount === 1 ? '' : 'es') + '\nhttps://wordtycoon.live/pixeletters/solo/';
      var actions = [];
      if (currentGameIsDaily) actions.push({ label: 'Share', primary: true, onClick: doDailyShare });
      // Platform is 'web' — a hub website session, which is what the MP server
      // canonicalises the same player to. WT resolves cosmetics for 'discord'
      // only through linked_accounts, so a web-only account came back empty
      // there; 'web' hits the player row directly.
      var winner = userSession
        ? {
            displayName: userSession.globalName || userSession.username,
            platform: 'web',
            platformUserId: userSession.id,
            linkedDiscord: (userSession.provider || 'discord') === 'discord' ? userSession.id : null,
            profilePic: userSession.avatar || null
          }
        : { displayName: 'You', platform: 'web' };
      // recordGameResult() already ran, so loadStats().wins counts this win.
      WinCard.showSolo({
        game: 'pixeletters',
        gameName: 'PixeLetters',
        word: word,
        guessCount: guessCount,
        totalWins: loadStats().wins,
        winner: winner,
        actions: actions,
        autoHideMs: AUTO_RESTART_SECONDS * 1000,
        onHide: function () { newGame(); }
      });
      return;
    }

    if (winModal) {
      winModal.classList.toggle('loss', !won);
    }

    if (winPic) {
      winPic.innerHTML = won
        ? '<span style="font-size:2.5rem">&#127881;</span>'
        : '<span style="font-size:2.5rem">&#128546;</span>';
    }

    if (winName) {
      winName.textContent = won ? 'You got it!' : 'Better luck next time!';
      winName.className = 'win-name' + (won ? '' : ' loss-text');
    }

    if (winWord) {
      winWord.textContent = word.toUpperCase();
      winWord.className = 'win-word' + (won ? '' : ' loss-word');
    }

    if (winInfo) {
      winInfo.innerHTML = won
        ? 'Found in <strong>' + guessCount + '</strong> guess' + (guessCount !== 1 ? 'es' : '')
        : 'The word was <strong>' + word.toUpperCase() + '</strong>';
    }

    // No Share button here \u2014 the daily share moved to the WinCard's Share
    // action, and this branch only runs on a loss (or if WinCard failed to load).
    winOverlay.classList.remove('hidden');
    startCountdown();
  }

  function hideWin() {
    if (window.WinCard) WinCard.hide();
    winOverlay.classList.add('hidden');
    stopCountdown();
  }

  function startCountdown() {
    stopCountdown();
    var remaining = AUTO_RESTART_SECONDS;
    if (winCountdown) winCountdown.textContent = 'Next word in ' + remaining + 's';

    countdownInterval = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        stopCountdown();
        if (winCountdown) winCountdown.textContent = 'Starting...';
        newGame();
      } else {
        if (winCountdown) winCountdown.textContent = 'Next word in ' + remaining + 's';
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    if (winCountdown) winCountdown.textContent = '';
  }

  // ─── Local Stats ──────────────────────────────────────────────────

  function loadStats() {
    try {
      var raw = localStorage.getItem(STATS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { wins: 0, gamesPlayed: 0, totalGuesses: 0, winStreak: 0, bestStreak: 0, history: [] };
  }

  function saveStats(stats) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  // --- Library word reporting ---
  function reportLibraryWord(word, gameId) {
    if (!userSession || !word) return;
    var x = new XMLHttpRequest();
    x.open('POST', '/api/library/word', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function() {
      try {
        var data = JSON.parse(x.responseText);
        if (data.ok && data.isNew) showLibraryToast(word);
      } catch(e) {}
    };
    x.send(JSON.stringify({ word: word.toLowerCase(), game: gameId }));
  }

  function showLibraryToast(word) {
    if (!document.getElementById('library-toast-style')) {
      var style = document.createElement('style');
      style.id = 'library-toast-style';
      style.textContent = '.library-toast{position:fixed;top:16px;right:16px;display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#1a0f00,#2d1f0a);border:2px solid #8b6914;border-radius:13px;padding:11px 19px 11px 6px;z-index:10000;opacity:0;transform:translateX(50px);transition:opacity .4s,transform .4s;pointer-events:none;box-shadow:0 5px 24px rgba(139,105,20,.4);overflow:visible;font-family:Inter,Segoe UI,sans-serif}.library-toast.show{opacity:1;transform:translateX(0)}.library-toast .lt-logo{width:51px;height:51px;border-radius:50%;flex-shrink:0;filter:drop-shadow(0 3px 10px rgba(0,0,0,.5))}.library-toast .lt-text{display:flex;flex-direction:column}.library-toast .lt-header{font-size:11px;font-weight:700;color:#f5deb3;line-height:1.2}.library-toast .lt-word{font-size:18px;font-weight:800;color:#ffd700;letter-spacing:0;line-height:1.2}[data-theme="light"] .library-toast{background:linear-gradient(135deg,#fff8e1,#fff3cd);border-color:#d4a017;box-shadow:0 5px 24px rgba(212,160,23,.3)}[data-theme="light"] .library-toast .lt-header{color:#5d4200}[data-theme="light"] .library-toast .lt-word{color:#b8860b}';
      document.head.appendChild(style);
    }
    var toast = document.createElement('div');
    toast.className = 'library-toast';
    toast.innerHTML = '<img class="lt-logo" src="/portal/img/logo.png" alt="">' +
      '<div class="lt-text"><div class="lt-header">Word Found!</div>' +
      '<div class="lt-word">' + word.toUpperCase() + '</div></div>';
    document.body.appendChild(toast);
    setTimeout(function() { toast.classList.add('show'); }, 10);
    setTimeout(function() {
      toast.classList.remove('show');
      setTimeout(function() { toast.remove(); }, 400);
    }, 4000);
  }

  function recordGameResult(won, word, guessCount) {
    // Mark daily as completed now that game is finished (win or loss)
    if (currentGameIsDaily && dailyData && dailyData.date) {
      localStorage.setItem('pixeletters_sp_daily_date', dailyData.date);
      saveServerCompletion(dailyData.date);
    }

    var stats = loadStats();
    stats.gamesPlayed++;
    if (won) {
      stats.wins++;
      stats.totalGuesses += guessCount;
      stats.winStreak++;
      if (stats.winStreak > stats.bestStreak) stats.bestStreak = stats.winStreak;
    } else {
      stats.winStreak = 0;
    }
    stats.history.unshift({
      word: word,
      won: won,
      guessCount: guessCount,
      mode: currentMode,
      timestamp: new Date().toISOString()
    });
    if (stats.history.length > 100) stats.history.length = 100;
    saveStats(stats);
    renderStats();
  }

  // ─── Stats UI ─────────────────────────────────────────────────────

  function renderStats() {
    var stats = loadStats();
    var winsEl = document.getElementById('stat-wins');
    var gamesEl = document.getElementById('stat-games');
    var avgEl = document.getElementById('stat-avg');
    var streakEl = document.getElementById('stat-streak');
    var historyEl = document.getElementById('stats-history');

    if (winsEl) winsEl.textContent = stats.wins;
    if (gamesEl) gamesEl.textContent = stats.gamesPlayed;
    if (avgEl) avgEl.textContent = stats.wins > 0
      ? (stats.totalGuesses / stats.wins).toFixed(1) : '-';
    if (streakEl) streakEl.textContent = stats.winStreak;

    if (historyEl) {
      var recent = (stats.history || []).slice(0, 10);
      if (recent.length === 0) {
        historyEl.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:0.7rem;padding:8px 0">No games yet</div>';
      } else {
        historyEl.innerHTML = recent.map(function (h) {
          var modeTag = h.mode && h.mode !== 'standard'
            ? ' <span style="color:' + (h.mode === 'plus' ? 'var(--green)' : 'var(--red)') + ';font-size:0.6rem;font-weight:700">' + h.mode.toUpperCase() + '</span>'
            : '';
          return '<div class="stats-h-entry">' +
            '<div><span class="stats-h-word">' + (h.word || '???').toUpperCase() + '</span>' +
            modeTag +
            '<span class="stats-h-guesses">' + (h.won ? h.guessCount + ' guesses' : 'lost') + '</span></div>' +
            '<span class="stats-h-result ' + (h.won ? 'win' : 'loss') + '">' + (h.won ? 'WIN' : 'LOSS') + '</span>' +
            '</div>';
        }).join('');
      }
    }
  }

  // ─── Stats Toggle ─────────────────────────────────────────────────

  if (toggleBtn && dropdown) {
    toggleBtn.addEventListener('click', function () {
      statsOpen = !statsOpen;
      if (statsOpen) {
        dropdown.classList.remove('hidden');
        toggleBtn.classList.add('active');
        renderStats();
      } else {
        dropdown.classList.add('hidden');
        toggleBtn.classList.remove('active');
      }
    });
  }

  if (closeStatsBtn) {
    closeStatsBtn.addEventListener('click', function () {
      statsOpen = false;
      if (dropdown) dropdown.classList.add('hidden');
      if (toggleBtn) toggleBtn.classList.remove('active');
    });
  }

  document.addEventListener('click', function (e) {
    if (statsOpen && dropdown && toggleBtn &&
        !dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
      statsOpen = false;
      dropdown.classList.add('hidden');
      toggleBtn.classList.remove('active');
    }
  });

  // ─── Login Banner ─────────────────────────────────────────────────

  var completionsReady = false;
  var dailyReady = false;
  var initStarted = false;

  function tryStartInit() {
    if (initStarted || !completionsReady || !dailyReady) return;
    if (dailyData) dailyPlayed = localStorage.getItem('pixeletters_sp_daily_date') === dailyData.date || !!serverCompletedDates[dailyData.date];
    initStarted = true;
    startGame();
  }

  fetch(getAuthBaseURL() + '/api/me/session', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.ok) {
      soloAccount.bind(data.user);
      userSession = data.user;
      renderStats();
      if (banner) banner.classList.add('hidden');
      fetchServerCompletions(function() {
        completionsReady = true;
        tryStartInit();
      });
    } else {
      soloAccount.bind(null);
      renderStats();
      if (banner && !localStorage.getItem(BANNER_DISMISSED_KEY)) {
        banner.classList.remove('hidden');
      }
      completionsReady = true;
      tryStartInit();
    }
  }).catch(function () {
    soloAccount.bind(null);
    renderStats();
    completionsReady = true;
    tryStartInit();
  });

  if (bannerClose && banner) {
    bannerClose.addEventListener('click', function () {
      banner.classList.add('hidden');
      try { localStorage.setItem(BANNER_DISMISSED_KEY, '1'); } catch (e) {}
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────

  initModeSelector();
  buildWordSizeToggle();
  renderStats();
  function restoreFromState(saved) {
    currentWordLength = saved.wordLength;
    currentMode = saved.mode || 'standard';
    currentGameIsDaily = saved.isDaily || false;
    game = {
      secret: saved.secret,
      wordLength: saved.wordLength,
      guesses: saved.guesses || [],
      directions: saved.directions || [],
      mode: saved.mode || 'standard',
      isWon: false,
      isLost: false,
      keyStates: saved.keyStates || {}
    };
    currentInput = '';
    var badge = document.getElementById('daily-badge');
    if (badge) {
      if (currentGameIsDaily) badge.classList.remove('hidden');
      else badge.classList.add('hidden');
    }
    renderGrid();
    buildKeyboard();
    updateGuessCounter();
    updateWordSizeToggle();
  }

  function startGame() {
    // Try to restore a saved game
    var saved = loadGameState();
    // If daily mode but saved game is non-daily, discard it
    if (launchMode === 'daily' && saved && saved.isDaily === false) {
      clearGameState();
      saved = null;
    }
    if (saved && !saved.isWon && !saved.isLost) {
      fetchWords(saved.wordLength, function () {
        restoreFromState(saved);
      });
    } else {
      if (saved) clearGameState();
      // For daily mode with no local state, try loading from server
      var dailySaved = loadDailyGameState();
      if (launchMode === 'daily' && !dailySaved) {
        loadGameStateFromServer(function(serverState) {
          if (serverState && serverState.secret && serverState.guesses && serverState.guesses.length > 0) {
            // Save server state locally and restore
            try { localStorage.setItem(DAILY_STATE_KEY, JSON.stringify(serverState)); } catch(e) {}
            dailyData = { word: serverState.secret, date: serverState.dailyDate, length: serverState.wordLength };
            fetchWords(serverState.wordLength, function () {
              restoreFromState({
                secret: serverState.secret,
                wordLength: serverState.wordLength,
                guesses: serverState.guesses,
                directions: serverState.directions,
                mode: serverState.mode,
                keyStates: serverState.keyStates,
                isDaily: true
              });
            });
          } else {
            newGame(5);
          }
        });
      } else {
        newGame(5);
      }
    }
  }

  // Wait for both fetchDaily and fetchServerCompletions before starting
  // so dailyData and serverCompletedDates are available when newGame() checks them
  fetchDaily(5, function() {
    dailyReady = true;
    tryStartInit();
  });

})();
