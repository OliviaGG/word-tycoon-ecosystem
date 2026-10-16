// ===== Wordle SP Engine =====
// Fully local single-player Wordle — no server connection needed for gameplay.
// Fetches word lists once, then all game logic runs client-side.
// Traditional Wordle: 6-row grid, green/yellow/gray, keyboard states.

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

  var soloAccount = window.WordTycoonSoloAccount.create({ game: 'wordle-sp', authBase: getAuthBaseURL() });
  var localStorage = soloAccount.storage;
  var XMLHttpRequest = soloAccount.XMLHttpRequest;


  // ─── Constants ──────────────────────────────────────────────────────

  var STATS_KEY = 'wordle_sp_stats';
  var GAME_STATE_KEY = 'wordle_sp_game';
  var DAILY_STATE_KEY = 'wordle_sp_daily_game';
  var BANNER_DISMISSED_KEY = 'wordle_banner_dismissed';
  var WORD_LENGTHS = [4, 5, 6, 7, 8];
  var DAILY_LENGTH = 5; // Daily puzzle only exists for this word length
  var MAX_GUESSES = 6;
  var AUTO_RESTART_SECONDS = 8;
  var KB_ROWS = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['\u232B', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'ENTER']
  ];

  // ─── State ──────────────────────────────────────────────────────────

  var wordCache = {};      // { "5": { targets: [...], dictionary: Set } }
  var game = null;         // { secret, wordLength, guesses: [{word, result}], isWon, isLost, keyStates }
  var currentInput = '';
  var currentWordLength = 5;
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

  // ─── DOM Refs ───────────────────────────────────────────────────────

  var gridEl = document.getElementById('wordle-grid');
  var keyboardEl = document.getElementById('keyboard');
  var errorToast = document.getElementById('error-toast');
  var winOverlay = document.getElementById('win-overlay');
  var winPic = document.getElementById('win-pic');
  var winName = document.getElementById('win-name');
  var winWord = document.getElementById('win-word');
  var winCount = document.getElementById('win-count');
  var winCountdown = document.getElementById('win-countdown');
  var wordSizeToggle = document.getElementById('word-size-toggle');
  var guessCounterEl = document.getElementById('guess-counter');

  // Stats DOM
  var toggleBtn = document.getElementById('stats-toggle');
  var dropdown = document.getElementById('stats-dropdown');
  var closeStatsBtn = document.getElementById('stats-close');

  // Banner DOM
  var banner = document.getElementById('login-banner');
  var bannerClose = document.getElementById('banner-close');

  function getGameBaseURL() {
    var origin = window.location.protocol + '//' + window.location.host;
    var path = window.location.pathname || '/';
    var proxied = path.match(/^\/game\/[^/]+/);
    if (proxied) return origin + proxied[0];
    var legacy = path.match(/^\/(wordle)(?=\/|$)/);
    if (legacy && (window.location.hostname === 'wordtycoon.live' || window.location.hostname === 'www.wordtycoon.live')) {
      return origin + legacy[0];
    }
    return origin;
  }

  // Auth + daily-completion routes belong to the RELAY, which serves them at
  // the ORIGIN root — never under the /game/<id> prefix getGameBaseURL()
  // returns. Sending them through the game base made
  // /game/wordle/api/me/session 404 with an HTML body, so r.json() threw and
  // the page silently stayed logged out: no cosmetics, perks, wins chip or
  // server-side daily sync. mp-init.js has always used the bare root path.
  function getAuthBaseURL() {
    var host = window.location.hostname;
    if (host === 'wordtycoon.live' || host === 'www.wordtycoon.live' || host === 'localhost' || host === '127.0.0.1') {
      return window.location.protocol + '//' + window.location.host;
    }
    return 'https://wordtycoon.live';
  }

  // ─── Word Loading (fetches directly from word bank, like Word 500) ──

  function fetchWords(len, cb) {
    if (wordCache[len]) return cb(null, wordCache[len]);

    var base = window.location.protocol + '//' + window.location.host;
    var targetsUrl = base + '/api/word-bank/targets/' + len;
    var dictUrl = base + '/api/word-bank/dictionary/' + len;

    Promise.all([
      fetch(targetsUrl).then(function (r) { return r.ok ? r.json() : []; }),
      fetch(dictUrl).then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (results) {
      var targets = results[0] || [];
      var dictWords = results[1] || [];
      // Build dictionary set and ensure all targets are valid guesses
      var dict = new Set(dictWords);
      for (var i = 0; i < targets.length; i++) dict.add(targets[i]);
      wordCache[len] = { targets: targets, dictionary: dict };
      cb(null, wordCache[len]);
    }).catch(function (err) { cb(err); });
  }

  function fetchServerCompletions(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', getAuthBaseURL() + '/api/sp-daily/status/wordle-sp', true);
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
          var key = 'wordle_sp_daily_date';
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

  // ─── Wordle Game Logic ──────────────────────────────────────────────

  function checkGuess(guess, target) {
    var result = [];
    var guessArr = guess.split('');
    var targetArr = target.split('');
    var used = new Array(target.length).fill(false);

    // Pass 1: exact matches (correct/green)
    for (var i = 0; i < guessArr.length; i++) {
      if (guessArr[i] === targetArr[i]) {
        result[i] = 'correct';
        used[i] = true;
      } else {
        result[i] = 'absent';
      }
    }

    // Pass 2: present letters (yellow)
    for (var i = 0; i < guessArr.length; i++) {
      if (result[i] === 'correct') continue;
      for (var j = 0; j < targetArr.length; j++) {
        if (!used[j] && guessArr[i] === targetArr[j]) {
          result[i] = 'present';
          used[j] = true;
          break;
        }
      }
    }

    return result;
  }

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
          guesses: savedDaily.guesses,
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
        var rows = gridEl.querySelectorAll('.wordle-row.guessed');
        for (var ri = 0; ri < rows.length; ri++) { rows[ri].classList.add('settled'); }
        updateKeyboard();
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
        isWon: false,
        isLost: false,
        keyStates: {}
      };
      clearGameState();

      currentInput = '';
      hideWin();
      renderGrid();
      updateKeyboard();
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
    if (!words || !words.dictionary.has(word.toLowerCase())) return { error: 'Not a valid word' };

    if (game.guesses.some(function (g) { return g.word === word; })) {
      return { error: 'Already guessed' };
    }

    var result = checkGuess(word, game.secret);

    // Update key states (never downgrade: correct > present > absent)
    for (var i = 0; i < word.length; i++) {
      var letter = word[i];
      var state = result[i];
      var current = game.keyStates[letter];
      if (state === 'correct') {
        game.keyStates[letter] = 'correct';
      } else if (state === 'present' && current !== 'correct') {
        game.keyStates[letter] = 'present';
      } else if (state === 'absent' && !current) {
        game.keyStates[letter] = 'absent';
      }
    }

    game.guesses.push({ word: word, result: result });
    reportLibraryWord(word, 'wordle-sp');
    saveGameState();

    var isCorrect = result.every(function (r) { return r === 'correct'; });

    if (isCorrect) {
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

  function saveGameState() {
    if (!game) return;
    try {
      localStorage.setItem(GAME_STATE_KEY, JSON.stringify({
        secret: game.secret,
        wordLength: game.wordLength,
        guesses: game.guesses,
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
        keyStates: game.keyStates,
        dailyDate: dailyData ? dailyData.date : null
      }));
      debouncedSaveToServer();
    } catch (e) {}
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

  function saveGameStateToServer() {
    if (!userSession || !currentGameIsDaily) return;
    var stateRaw = localStorage.getItem(DAILY_STATE_KEY);
    if (!stateRaw) return;
    var x = new XMLHttpRequest();
    x.open('POST', '/api/sp-state/wordle-sp', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ state: JSON.parse(stateRaw) }));
  }

  function clearGameStateFromServer() {
    if (!userSession) return;
    var x = new XMLHttpRequest();
    x.open('DELETE', '/api/sp-state/wordle-sp', true);
    x.send();
  }

  function loadGameStateFromServer(callback) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/sp-state/wordle-sp', true);
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

  // ─── Rendering ──────────────────────────────────────────────────────

  function renderGrid() {
    if (!game) return;

    var len = game.wordLength;
    var guessCount = game.guesses.length;
    var currentRow = guessCount;

    // Set grid columns
    gridEl.style.setProperty('--cols', len);

    // Check if we need a full rebuild (new game or word length changed)
    var existingRows = gridEl.querySelectorAll('.wordle-row');
    var needFullRebuild = existingRows.length !== MAX_GUESSES ||
                          (existingRows[0] && existingRows[0].querySelectorAll('.wordle-tile').length !== len);

    if (needFullRebuild) {
      gridEl.innerHTML = '';
      for (var row = 0; row < MAX_GUESSES; row++) {
        var rowEl = document.createElement('div');
        rowEl.className = 'wordle-row';
        for (var col = 0; col < len; col++) {
          var tile = document.createElement('div');
          tile.className = 'wordle-tile empty';
          rowEl.appendChild(tile);
        }
        gridEl.appendChild(rowEl);
      }
    }

    var rows = gridEl.querySelectorAll('.wordle-row');

    for (var row = 0; row < MAX_GUESSES; row++) {
      var rowEl = rows[row];
      var tiles = rowEl.querySelectorAll('.wordle-tile');

      if (row < guessCount) {
        // Already guessed row — only update if not already settled
        if (!rowEl.classList.contains('settled')) {
          var guess = game.guesses[row];
          rowEl.className = 'wordle-row guessed';
          for (var col = 0; col < len; col++) {
            tiles[col].className = 'wordle-tile filled ' + guess.result[col];
            tiles[col].textContent = guess.word[col];
            tiles[col].style.setProperty('--i', col);
          }
          // Mark as settled after animation completes so it won't re-animate
          (function(r) {
            setTimeout(function() { r.classList.add('settled'); }, 600 + len * 150);
          })(rowEl);
        }
      } else if (row === currentRow && !game.isWon && !game.isLost) {
        // Current input row — update tiles in place
        rowEl.className = 'wordle-row current';
        for (var col = 0; col < len; col++) {
          if (col < currentInput.length) {
            var wasTyping = tiles[col].classList.contains('typing');
            var hadSameLetter = tiles[col].textContent === currentInput[col];
            tiles[col].textContent = currentInput[col];
            if (!wasTyping || !hadSameLetter) {
              tiles[col].className = 'wordle-tile typing';
            }
          } else {
            tiles[col].className = 'wordle-tile empty';
            tiles[col].textContent = '';
          }
        }
      } else {
        // Empty future row
        rowEl.className = 'wordle-row';
        for (var col = 0; col < len; col++) {
          tiles[col].className = 'wordle-tile empty';
          tiles[col].textContent = '';
        }
      }
    }
  }

  function updateKeyboard() {
    if (!game) return;
    var keys = keyboardEl.querySelectorAll('.kb-key');
    keys.forEach(function (btn) {
      var letter = btn.getAttribute('data-key');
      if (!letter || letter === 'ENTER' || letter === 'BACK') return;
      var state = game.keyStates[letter] || '';
      btn.classList.remove('correct', 'present', 'absent');
      if (state) btn.classList.add(state);
    });
  }

  function updateGuessCounter() {
    if (guessCounterEl && game) {
      guessCounterEl.textContent = game.guesses.length + '/' + MAX_GUESSES;
    }
  }

  // ─── QWERTY Keyboard ───────────────────────────────────────────────

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
          btn.textContent = key;
          btn.setAttribute('data-key', key);
          btn.addEventListener('click', function () { handleKeyPress(key); });
        }
        rowEl.appendChild(btn);
      });
      keyboardEl.appendChild(rowEl);
    });
  }

  function updateInputPreview() {
  }

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
    updateInputPreview();
  }

  // Physical keyboard
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Enter') { e.preventDefault(); handleKeyPress('ENTER'); }
    else if (e.key === 'Backspace') { e.preventDefault(); handleKeyPress('BACK'); }
    else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); handleKeyPress(e.key.toUpperCase()); }
  });

  // ─── Guess Submission ───────────────────────────────────────────────

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

  // ─── Word Size Toggle ──────────────────────────────────────────────

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

  // ─── Error Toast ────────────────────────────────────────────────────

  function showError(msg) {
    if (errorTimeout) clearTimeout(errorTimeout);
    errorToast.textContent = msg;
    errorToast.className = 'error-toast shake';
    errorTimeout = setTimeout(function () {
      errorToast.classList.add('hidden');
      errorToast.classList.remove('shake');
    }, 2500);
  }

  // ─── Win/Loss Overlay ──────────────────────────────────────────────

  // ─── Daily share ─────────────────────────────────────────────────────────
  var shareText = '';
  function shareDailyResult() {
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
      shareText = '🟩 Wordle Daily' + (currentGameIsDaily && dailyData && dailyData.date ? ' ' + dailyData.date : '') +
        ' — solved in ' + guessCount + '/6 guesses\nhttps://wordtycoon.live/wordle/solo/';
      var actions = [];
      if (currentGameIsDaily) actions.push({ label: 'Share', primary: true, onClick: shareDailyResult });
      // Platform is 'web' — a hub website session, which is exactly what the
      // MP server canonicalises the same player to. WT resolves cosmetics for
      // 'discord' only through linked_accounts, so a web-only account came
      // back empty there; 'web' hits the player row directly. linkedDiscord
      // still drives the 🏆 wins chip when the login really is Discord.
      var winner = userSession
        ? {
            displayName: userSession.globalName || userSession.username,
            platform: 'web',
            platformUserId: userSession.id,
            linkedDiscord: (userSession.provider || 'discord') === 'discord' ? userSession.id : null,
            profilePic: userSession.avatar || null
          }
        : { displayName: 'You', platform: 'web' };
      WinCard.showSolo({
        game: 'wordle',
        gameName: 'Wordle',
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
    if (winPic) {
      winPic.innerHTML = won
        ? '<span style="font-size:2.5rem">&#127881;</span>'
        : '<span style="font-size:2.5rem">&#128546;</span>';
    }
    if (winName) {
      winName.textContent = won ? 'You got it!' : 'Better luck next time!';
      winName.style.cssText = '';
    }
    if (winWord) {
      winWord.textContent = word.toUpperCase();
      winWord.style.cssText = '';
    }
    if (winCount) winCount.textContent = guessCount;

    // Update win-info text
    var winInfo = winOverlay.querySelector('.win-info');
    if (winInfo) {
      winInfo.innerHTML = won
        ? 'Found in <strong id="win-count">' + guessCount + '</strong> guesses'
        : 'The word was <strong>' + word.toUpperCase() + '</strong>';
    }

    // No Share button here \u2014 the daily share moved to the WinCard's Share
    // action, and this branch only runs on a loss (or if WinCard failed to load).
    winOverlay.classList.remove('hidden');
    startCountdown();
  }

  function hideWin() {
    winOverlay.classList.add('hidden');
    stopCountdown();
  }

  function showDailyCompleted() {
    if (winOverlay) {
      winOverlay.innerHTML = '<div style="text-align:center;padding:40px 20px;"><div style="font-size:3rem;margin-bottom:12px;">\u2705</div><div style="font-size:1.3rem;font-weight:700;margin-bottom:8px;">Daily Completed!</div><div style="color:#aaa;margin-bottom:16px;">You\'ve already finished today\'s daily challenge.</div><a href="/me" style="display:inline-block;padding:10px 24px;background:#4fc34f;color:#000;border-radius:8px;text-decoration:none;font-weight:600;">\u2190 Back to Portal</a></div>';
      winOverlay.classList.remove('hidden');
    }
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

  // ─── Library word reporting ────────────────────────────────────────

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
      style.textContent = '.library-toast{position:fixed;top:16px;right:16px;display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#1a0f00,#2d1f0a);border:2px solid #8b6914;border-radius:13px;padding:11px 19px 11px 6px;z-index:10000;opacity:0;transform:translateX(50px);transition:opacity .4s,transform .4s;pointer-events:none;box-shadow:0 5px 24px rgba(139,105,20,.4);overflow:visible;font-family:Inter,Segoe UI,sans-serif}.library-toast.show{opacity:1;transform:translateX(0)}.library-toast .lt-logo{width:51px;height:51px;border-radius:50%;flex-shrink:0;filter:drop-shadow(0 3px 10px rgba(0,0,0,.5))}.library-toast .lt-text{display:flex;flex-direction:column}.library-toast .lt-header{font-size:11px;font-weight:700;color:#f5deb3;line-height:1.2}.library-toast .lt-word{font-size:18px;font-weight:800;color:#ffd700;letter-spacing:1px;line-height:1.2}[data-theme="light"] .library-toast{background:linear-gradient(135deg,#fff8e1,#fff3cd);border-color:#d4a017;box-shadow:0 5px 24px rgba(212,160,23,.3)}[data-theme="light"] .library-toast .lt-header{color:#5d4200}[data-theme="light"] .library-toast .lt-word{color:#b8860b}';
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
    }, 3000);
  }

  // ─── Local Stats ────────────────────────────────────────────────────

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

  function recordGameResult(won, word, guessCount) {
    // Mark daily as completed now that game is finished (win or loss)
    if (currentGameIsDaily && dailyData && dailyData.date) {
      localStorage.setItem('wordle_sp_daily_date', dailyData.date);
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
      timestamp: new Date().toISOString()
    });
    if (stats.history.length > 100) stats.history.length = 100;
    saveStats(stats);
    renderStats();
  }

  // ─── Stats UI ───────────────────────────────────────────────────────

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
          return '<div class="stats-h-entry">' +
            '<div><span class="stats-h-word">' + (h.word || '???').toUpperCase() + '</span>' +
            '<span class="stats-h-guesses">' + (h.won ? h.guessCount + ' guesses' : 'lost') + '</span></div>' +
            '<span class="stats-h-result ' + (h.won ? 'win' : 'loss') + '">' + (h.won ? 'WIN' : 'LOSS') + '</span>' +
            '</div>';
        }).join('');
      }
    }
  }

  // ─── Stats Toggle ──────────────────────────────────────────────────

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

  // ─── Login Banner ──────────────────────────────────────────────────

  var completionsReady = false;
  var dailyReady = false;
  var initStarted = false;

  function tryStartInit() {
    if (initStarted || !completionsReady || !dailyReady) return;
    if (dailyData) dailyPlayed = localStorage.getItem('wordle_sp_daily_date') === dailyData.date || !!serverCompletedDates[dailyData.date];
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

  // ─── Init ───────────────────────────────────────────────────────────

  buildWordSizeToggle();
  buildKeyboard();
  renderStats();

  function startGame() {
    // Try to restore a saved game
    var saved = loadGameState();
    // In daily launch mode, skip restoring a non-daily saved game
    if (launchMode === 'daily' && saved && !saved.isDaily) {
      clearGameState();
      saved = null;
    }
    if (saved && !saved.isWon && !saved.isLost) {
      fetchWords(saved.wordLength, function () {
        currentWordLength = saved.wordLength;
        currentGameIsDaily = saved.isDaily || false;
        game = {
          secret: saved.secret,
          wordLength: saved.wordLength,
          guesses: saved.guesses,
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
        // Mark all restored rows as settled immediately (no animation replay)
        var rows = gridEl.querySelectorAll('.wordle-row.guessed');
        for (var ri = 0; ri < rows.length; ri++) { rows[ri].classList.add('settled'); }
        updateKeyboard();
        updateGuessCounter();
        updateWordSizeToggle();
      });
    } else {
      if (saved) clearGameState();
      // In daily mode with no local state, try loading from server first
      if (launchMode === 'daily' && !localStorage.getItem(DAILY_STATE_KEY)) {
        loadGameStateFromServer(function(serverState) {
          if (serverState) {
            try {
              localStorage.setItem(DAILY_STATE_KEY, JSON.stringify(serverState));
            } catch(e) {}
          }
          newGame(5);
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
