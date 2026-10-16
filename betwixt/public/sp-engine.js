// ===== Betwixt SP Engine =====
// Fully local single-player game — no server connection needed for gameplay.
// Fetches word lists once, then all game logic runs client-side.
// Includes: game engine, word length toggle, stats tracking, login banner.

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

  var soloAccount = window.WordTycoonSoloAccount.create({ game: 'betwixt-sp', authBase: getAuthBaseURL() });
  var localStorage = soloAccount.storage;
  var XMLHttpRequest = soloAccount.XMLHttpRequest;


  // ─── Constants ──────────────────────────────────────────────────────

  var STATS_KEY = 'betwixt_sp_stats';
  var GAME_STATE_KEY = 'betwixt_sp_game';
  var DAILY_STATE_KEY = 'betwixt_sp_daily_game';
  var BANNER_DISMISSED_KEY = 'betwixt_banner_dismissed';
  var WORD_LENGTHS = [4, 5, 6, 7, 8];
  var DAILY_LENGTH = 5; // Daily puzzle only exists for this word length
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  var AUTO_RESTART_SECONDS = 8;
  var KB_ROWS = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['\u232B', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'ENTER']
  ];

  // ─── State ──────────────────────────────────────────────────────────

  var wordCache = {};      // { "5": { targets: [...], dictionary: Set } }
  var game = null;
  var currentInput = '';
  var currentWordLength = 5;
  var statsOpen = false;
  var userSession = null;
  var submitCooldown = false;
  var errorTimeout = null;
  var loading = false;
  var dailyData = null;      // { word, date, length } from /api/sp/daily
  var dailyPlayed = false;   // whether today's daily has been played
  var currentGameIsDaily = false; // whether the current game uses the daily word
  var launchMode = new URLSearchParams(window.location.search).get('mode');
  var stateSyncTimer = null;
  var serverCompletedDates = {};

  // ─── DOM Refs ───────────────────────────────────────────────────────

  var lowerTiles = document.getElementById('lower-tiles');
  var upperTiles = document.getElementById('upper-tiles');
  var lowerPfp = document.getElementById('lower-pfp');
  var upperPfp = document.getElementById('upper-pfp');
  var lowerBoundary = document.getElementById('lower-boundary');
  var upperBoundary = document.getElementById('upper-boundary');
  var lowerDistEl = document.getElementById('lower-distance');
  var upperDistEl = document.getElementById('upper-distance');
  var confirmedRow = document.getElementById('confirmed-row');
  var alphaRow1 = document.getElementById('alpha-row-1');
  var alphaRow2 = document.getElementById('alpha-row-2');
  var keyboardEl = document.getElementById('keyboard');
  var errorToast = document.getElementById('error-toast');
  var wordSizeToggle = document.getElementById('word-size-toggle');
  var guessCounterEl = document.getElementById('guess-counter');

  // Stats DOM
  var toggleBtn = document.getElementById('stats-toggle');
  var dropdown = document.getElementById('stats-dropdown');
  var closeStatsBtn = document.getElementById('stats-close');

  // Banner DOM
  var banner = document.getElementById('login-banner');
  var bannerClose = document.getElementById('banner-close');

  // ─── Utility ────────────────────────────────────────────────────────

  function repeat(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }

  function getGameBaseURL() {
    var origin = window.location.protocol + '//' + window.location.host;
    var path = window.location.pathname || '/';
    var proxied = path.match(/^\/game\/[^/]+/);
    if (proxied) return origin + proxied[0];
    var legacy = path.match(/^\/(betwixt)(?=\/|$)/);
    if (legacy && (window.location.hostname === 'wordtycoon.live' || window.location.hostname === 'www.wordtycoon.live')) {
      return origin + legacy[0];
    }
    return origin;
  }

  // Auth + daily-completion routes belong to the RELAY, which serves them at
  // the ORIGIN root — never under the /game/<id> prefix getGameBaseURL()
  // returns. The game server proxies /api/me/session, but NOT
  // /api/sp-daily/*, so daily completions 404'd and never reached the hub.
  function getAuthBaseURL() {
    var host = window.location.hostname;
    if (host === 'wordtycoon.live' || host === 'www.wordtycoon.live' || host === 'localhost' || host === '127.0.0.1') {
      return window.location.protocol + '//' + window.location.host;
    }
    return 'https://wordtycoon.live';
  }

  // ─── Closeness Calculation ────────────────────────────────────────
  // Converts a word to a 0-1 score based on position in alphabetical space.
  // Used to show how close each boundary is to the secret word.

  function wordToScore(word, len) {
    var score = 0;
    for (var i = 0; i < len; i++) {
      var ch = (word.charCodeAt(i) || 97) - 97; // 0-25, default 'a'
      score += ch / Math.pow(26, i + 1);
    }
    return score;
  }

  function closeness(boundaryWord, secret, len) {
    var bScore = wordToScore(boundaryWord.toLowerCase(), len);
    var sScore = wordToScore(secret.toLowerCase(), len);
    var distance = Math.abs(bScore - sScore);
    var scaled = distance * 100;
    var rounded = Math.round(scaled * 10) / 10;
    return Math.max(0.1, rounded);
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

  function fetchServerCompletions(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', getAuthBaseURL() + '/api/sp-daily/status/betwixt-sp', true);
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
          var key = 'betwixt_sp_daily_date';
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

  // ─── Game Logic (fully local) ───────────────────────────────────────

  function newGame(len) {
    if (loading) return;
    len = len || currentWordLength;

    // Save daily game state before switching away
    if (currentGameIsDaily && game && !game.isWon) {
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
          currentLower: savedDaily.currentLower,
          currentUpper: savedDaily.currentUpper,
          displayLower: savedDaily.displayLower,
          displayUpper: savedDaily.displayUpper,
          guesses: savedDaily.guesses || [],
          isWon: false,
          confirmedLetters: savedDaily.confirmedLetters || new Array(savedDaily.wordLength).fill(null),
          lowerBoundaryUser: savedDaily.displayLower ? { displayName: 'You' } : null,
          upperBoundaryUser: savedDaily.displayUpper ? { displayName: 'You' } : null
        };
        currentGameIsDaily = true;
        currentInput = '';
        var badge = document.getElementById('daily-badge');
        if (badge) {
          badge.classList.remove('hidden');
          badge.style.display = '';
        }
        clearGameState();
        hideWin();
        render();
        updateWordSizeToggle();
        console.log('[SP] Restored DAILY game in progress');
        return;
      }

      var secret;
      // Use daily word if available and not yet played
      if (dailyData && !dailyPlayed && dailyData.date && dailyData.length === len && len === DAILY_LENGTH) {
        secret = dailyData.word.toLowerCase();
        dailyPlayed = true;
        currentGameIsDaily = true;
        var badge = document.getElementById('daily-badge');
        if (badge) {
          badge.classList.remove('hidden');
          badge.style.display = '';
        }
        console.log('[SP] Starting DAILY game');
      } else {
        secret = words.targets[Math.floor(Math.random() * words.targets.length)];
        currentGameIsDaily = false;
        var badge = document.getElementById('daily-badge');
        if (badge) {
          badge.classList.add('hidden');
          badge.style.display = 'none';
        }
      }

      game = {
        secret: secret,
        wordLength: len,
        currentLower: repeat('a', len),
        currentUpper: repeat('z', len) + 'z',
        displayLower: null,
        displayUpper: null,
        guesses: [],
        isWon: false,
        confirmedLetters: new Array(len).fill(null),
        lowerBoundaryUser: null,
        upperBoundaryUser: null
      };
      clearGameState();

      currentInput = '';
      hideWin();
      render();
      updateWordSizeToggle();
    });
  }

  function processGuess(word) {
    if (!game || game.isWon) return { error: 'No active game' };

    word = word.toLowerCase().trim();
    var len = game.wordLength;

    if (word.length !== len) return { error: 'Word must be ' + len + ' letters' };
    if (!/^[a-z]+$/.test(word)) return { error: 'Only letters allowed' };

    var words = wordCache[len];
    if (!words || !words.dictionary.has(word)) return { error: 'Not a valid word' };

    if (word <= game.currentLower || word >= game.currentUpper) {
      var mask = repeat('X', len);
      var showLower = game.displayLower ? game.displayLower.toUpperCase() : mask;
      var showUpper = game.displayUpper ? game.displayUpper.toUpperCase() : mask;
      return { error: 'Must be between "' + showLower + '" and "' + showUpper + '"' };
    }

    if (game.guesses.some(function (g) { return g.word === word; })) {
      return { error: 'Already guessed' };
    }

    var isCorrect = (word === game.secret);

    if (!isCorrect) {
      if (word < game.secret) {
        if (word > game.currentLower) {
          game.currentLower = word;
          game.displayLower = word;
          game.lowerBoundaryUser = { displayName: 'You' };
        }
      } else {
        if (word < game.currentUpper) {
          game.currentUpper = word;
          game.displayUpper = word;
          game.upperBoundaryUser = { displayName: 'You' };
        }
      }
      updateConfirmedLetters();
    }

    game.guesses.push({ word: word, isCorrect: isCorrect });
    reportLibraryWord(word, 'betwixt-sp');

    if (isCorrect) {
      game.isWon = true;
      recordGameResult(true, game.secret, game.guesses.length);
      clearGameState();
      if (currentGameIsDaily) clearDailyGameState();
      return { ok: true, isCorrect: isCorrect };
    }

    saveGameState();
    if (currentGameIsDaily) saveDailyGameState();
    return { ok: true, isCorrect: isCorrect };
  }

  function updateConfirmedLetters() {
    if (!game || !game.displayLower || !game.displayUpper) return;
    var lower = game.currentLower;
    var upper = game.currentUpper;
    if (lower.length !== game.wordLength || upper.length !== game.wordLength) return;

    for (var i = 0; i < game.wordLength; i++) {
      if (game.confirmedLetters[i]) continue;
      if (lower[i] === upper[i] && lower[i] === game.secret[i]) {
        game.confirmedLetters[i] = game.secret[i].toUpperCase();
      }
    }
  }

  // ─── Game State Persistence ────────────────────────────────────────

  function saveGameState() {
    if (!game) return;
    try {
      localStorage.setItem(GAME_STATE_KEY, JSON.stringify({
        secret: game.secret,
        wordLength: game.wordLength,
        currentLower: game.currentLower,
        currentUpper: game.currentUpper,
        displayLower: game.displayLower,
        displayUpper: game.displayUpper,
        guesses: game.guesses,
        confirmedLetters: game.confirmedLetters,
        isWon: game.isWon,
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
    if (game.isWon) return;
    try {
      localStorage.setItem(DAILY_STATE_KEY, JSON.stringify({
        secret: game.secret,
        wordLength: game.wordLength,
        currentLower: game.currentLower,
        currentUpper: game.currentUpper,
        displayLower: game.displayLower,
        displayUpper: game.displayUpper,
        guesses: game.guesses,
        confirmedLetters: game.confirmedLetters,
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

  // ─── Server Game State Sync ───────────────────────────────────────

  function saveGameStateToServer() {
    if (!userSession || !currentGameIsDaily) return;
    var stateRaw = localStorage.getItem(DAILY_STATE_KEY);
    if (!stateRaw) return;
    var x = new XMLHttpRequest();
    x.open('POST', '/api/sp-state/betwixt-sp', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ state: JSON.parse(stateRaw) }));
  }

  function clearGameStateFromServer() {
    if (!userSession) return;
    var x = new XMLHttpRequest();
    x.open('DELETE', '/api/sp-state/betwixt-sp', true);
    x.send();
  }

  function loadGameStateFromServer(callback) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/sp-state/betwixt-sp', true);
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

  function render() {
    if (!game) return;
    updateBoundaries();
    updateConfirmedRow();
    updateAlphabet();
    updateGuessCounter();
  }

  function updateBoundaries() {
    if (!game) return;
    var lower = game.displayLower || repeat('x', game.wordLength);
    var upper = game.displayUpper || repeat('x', game.wordLength);
    var isMaskLower = /^x+$/i.test(lower);
    var isMaskUpper = /^x+$/i.test(upper);

    createBoundaryTiles(lowerTiles, lower, isMaskLower);
    createBoundaryTiles(upperTiles, upper, isMaskUpper);

    renderPfp(lowerPfp, game.lowerBoundaryUser);
    renderPfp(upperPfp, game.upperBoundaryUser);

    // Closeness numbers
    if (game.displayLower && lowerDistEl) {
      lowerDistEl.textContent = closeness(game.displayLower, game.secret, game.wordLength);
    } else if (lowerDistEl) {
      lowerDistEl.textContent = '';
    }

    if (game.displayUpper && upperDistEl) {
      upperDistEl.textContent = closeness(game.displayUpper, game.secret, game.wordLength);
    } else if (upperDistEl) {
      upperDistEl.textContent = '';
    }

    lowerBoundary.classList.add('pop');
    upperBoundary.classList.add('pop');
    setTimeout(function () {
      lowerBoundary.classList.remove('pop');
      upperBoundary.classList.remove('pop');
    }, 300);
  }

  function createBoundaryTiles(container, word, isMask) {
    container.innerHTML = '';
    word.toUpperCase().split('').forEach(function (ch) {
      var tile = document.createElement('div');
      tile.className = 'bnd-tile' + (isMask ? ' masked' : '');
      tile.textContent = isMask ? '-' : ch;
      container.appendChild(tile);
    });
  }

  function renderPfp(container, user) {
    container.innerHTML = '';
    if (!user) { container.classList.add('empty'); return; }
    container.classList.remove('empty');
    var letter = ((user.displayName || '?')[0]).toUpperCase();
    container.innerHTML = '<span class="pfp-letter">' + letter + '</span>';
  }

  function updateConfirmedRow() {
    if (currentInput.length > 0) { updateConfirmedRowWithTyping(); return; }
    if (!game) return;
    confirmedRow.innerHTML = '';
    var len = game.wordLength;
    var confirmed = game.confirmedLetters || [];
    for (var i = 0; i < len; i++) {
      var tile = document.createElement('div');
      tile.className = 'confirmed-tile';
      if (confirmed[i]) {
        tile.classList.add('confirmed');
        tile.textContent = confirmed[i];
      }
      confirmedRow.appendChild(tile);
    }
  }

  function updateConfirmedRowWithTyping() {
    if (!game) return;
    confirmedRow.innerHTML = '';
    var len = game.wordLength;
    var confirmed = game.confirmedLetters || [];
    for (var i = 0; i < len; i++) {
      var tile = document.createElement('div');
      if (i < currentInput.length) {
        tile.className = 'typing-tile active';
        tile.textContent = currentInput[i];
      } else if (confirmed[i]) {
        tile.className = 'confirmed-tile confirmed';
        tile.textContent = confirmed[i];
        tile.style.opacity = '0.4';
      } else {
        tile.className = 'typing-tile empty';
      }
      confirmedRow.appendChild(tile);
    }
  }

  function updateAlphabet() {
    if (!game) return;
    var lower = (game.displayLower || repeat('x', game.wordLength)).toLowerCase();
    var upper = (game.displayUpper || repeat('x', game.wordLength)).toLowerCase();
    var isMaskLower = /^x+$/.test(lower);
    var isMaskUpper = /^x+$/.test(upper);

    // Find the first position where bounds differ
    var pos = 0;
    if (!isMaskLower && !isMaskUpper) {
      while (pos < lower.length && pos < upper.length && lower[pos] === upper[pos]) {
        pos++;
      }
      if (pos >= lower.length || pos >= upper.length) pos = 0;
    }

    var lowerChar = isMaskLower ? 'a' : lower[pos] || 'a';
    var upperChar = isMaskUpper ? 'z' : upper[pos] || 'z';

    // Update position label
    var alphaEl = document.getElementById('alphabet');
    var label = document.getElementById('alpha-pos-label');
    if (pos > 0 && !isMaskLower && !isMaskUpper) {
      if (!label) {
        label = document.createElement('div');
        label.id = 'alpha-pos-label';
        label.className = 'alpha-pos-label';
        alphaEl.insertBefore(label, alphaEl.firstChild);
      }
      label.textContent = 'LETTER ' + (pos + 1);
    } else if (label) {
      label.remove();
    }

    LETTERS.forEach(function (letter) {
      var tile = document.getElementById('alpha-' + letter);
      if (!tile) return;
      var l = letter.toLowerCase();
      var status;
      if (isMaskLower && isMaskUpper) status = 'possible';
      else if (l < lowerChar) status = 'eliminated';
      else if (l > upperChar) status = 'eliminated';
      else if (l === lowerChar && !isMaskLower) status = 'edge';
      else if (l === upperChar && !isMaskUpper) status = 'edge';
      else status = 'possible';
      tile.className = 'alpha-tile ' + status;
    });
  }

  function updateGuessCounter() {
    if (guessCounterEl && game) {
      guessCounterEl.textContent = game.guesses.length;
    }
  }

  // ─── Build Alphabet (A-M, N-Z) ─────────────────────────────────────

  function buildAlphabet() {
    alphaRow1.innerHTML = '';
    alphaRow2.innerHTML = '';
    LETTERS.forEach(function (letter, i) {
      var tile = document.createElement('div');
      tile.className = 'alpha-tile possible';
      tile.id = 'alpha-' + letter;
      tile.textContent = letter;
      if (i < 13) alphaRow1.appendChild(tile);
      else alphaRow2.appendChild(tile);
    });
  }

  // ─── Word Size Toggle (local only) ─────────────────────────────────

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
          btn.addEventListener('click', function () { handleKeyPress('ENTER'); });
        } else if (key === '\u232B') {
          btn.classList.add('wide', 'backspace');
          btn.textContent = '\u232B';
          btn.addEventListener('click', function () { handleKeyPress('BACK'); });
        } else {
          btn.textContent = key;
          btn.addEventListener('click', function () { handleKeyPress(key); });
        }
        rowEl.appendChild(btn);
      });
      keyboardEl.appendChild(rowEl);
    });
  }

  function handleKeyPress(key) {
    if (game && game.isWon) {
      return;
    }
    if (key === 'ENTER') {
      submitGuess();
    } else if (key === 'BACK') {
      if (currentInput.length > 0) {
        currentInput = currentInput.slice(0, -1);
        updateConfirmedRowWithTyping();
      }
    } else if (/^[A-Z]$/.test(key)) {
      if (currentInput.length < currentWordLength) {
        currentInput += key;
        updateConfirmedRowWithTyping();
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

  // ─── Guess Submission ───────────────────────────────────────────────

  function submitGuess() {
    if (submitCooldown || loading) return;
    var word = currentInput.trim().toLowerCase();
    if (!word || word.length !== currentWordLength) return;

    var result = processGuess(word);
    currentInput = '';

    if (result.error) {
      showError(result.error);
      if (game) updateConfirmedRow();
    } else {
      render();
      if (result.isCorrect) {
        showWin(game.secret, game.guesses.length);
      }
    }

    submitCooldown = true;
    setTimeout(function () { submitCooldown = false; }, 300);
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

  // ─── Win Card (shared WinCard component) ───────────────────────────

  function buildSoloWinner() {
    if (userSession) {
      // 'web' — what the MP server canonicalises a hub login to, and the only
      // platform WT resolves cosmetics for without a linked_accounts row.
      return {
        displayName: userSession.globalName || userSession.username || 'You',
        platform: 'web',
        platformUserId: userSession.id,
        linkedDiscord: (userSession.provider || 'discord') === 'discord' ? userSession.id : null,
        profilePic: userSession.avatar || null
      };
    }
    return { displayName: 'You' };
  }

  // Share text for the daily result \u2014 built at win time, read by the card's
  // Share action.
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

  function showWin(word, guessCount) {
    shareText = '\uD83D\uDD00 Betwixt Daily' + (currentGameIsDaily && dailyData && dailyData.date ? ' ' + dailyData.date : '') +
      ' \u2014 solved in ' + guessCount + ' guess' + (guessCount === 1 ? '' : 'es') + '\nhttps://wordtycoon.live/betwixt/solo/';

    // No card (script blocked / offline) \u2014 the auto-restart still has to run,
    // otherwise the board sits on a solved puzzle forever.
    if (!window.WinCard) {
      setTimeout(newGame, AUTO_RESTART_SECONDS * 1000);
      return;
    }

    var actions = [];
    if (currentGameIsDaily) actions.push({ label: 'Share', primary: true, onClick: shareDailyResult });

    // recordGameResult() already ran in processGuess(), so loadStats().wins
    // includes the win being shown.
    WinCard.showSolo({
      game: 'betwixt',
      gameName: 'Betwixt',
      word: word,
      guessCount: guessCount,
      totalWins: loadStats().wins,
      winner: buildSoloWinner(),
      actions: actions,
      autoHideMs: AUTO_RESTART_SECONDS * 1000,
      onHide: function () { newGame(); }
    });
  }

  function hideWin() {
    if (window.WinCard) WinCard.hide();
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
    }, 4000);
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
    // Mark daily as completed now that game is finished
    if (currentGameIsDaily && dailyData && dailyData.date) {
      localStorage.setItem('betwixt_sp_daily_date', dailyData.date);
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
    if (dailyData) dailyPlayed = localStorage.getItem('betwixt_sp_daily_date') === dailyData.date || !!serverCompletedDates[dailyData.date];
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

  buildAlphabet();
  buildWordSizeToggle();
  buildKeyboard();
  renderStats();

  function restoreFromState(saved) {
    currentWordLength = saved.wordLength;
    currentGameIsDaily = saved.isDaily || false;
    game = {
      secret: saved.secret,
      wordLength: saved.wordLength,
      currentLower: saved.currentLower,
      currentUpper: saved.currentUpper,
      displayLower: saved.displayLower,
      displayUpper: saved.displayUpper,
      guesses: saved.guesses || [],
      isWon: false,
      confirmedLetters: saved.confirmedLetters || new Array(saved.wordLength).fill(null),
      lowerBoundaryUser: saved.displayLower ? { displayName: 'You' } : null,
      upperBoundaryUser: saved.displayUpper ? { displayName: 'You' } : null
    };
    currentInput = '';
    var badge = document.getElementById('daily-badge');
    if (badge) {
      if (currentGameIsDaily) {
        badge.classList.remove('hidden');
        badge.style.display = '';
      } else {
        badge.classList.add('hidden');
        badge.style.display = 'none';
      }
    }
    render();
    updateWordSizeToggle();
  }

  function startGame() {
    // Try to restore a saved game
    var saved = loadGameState();

    // Daily mode guard: discard stale non-daily save
    if (launchMode === 'daily' && saved && saved.isDaily === false) {
      clearGameState();
      saved = null;
    }

    if (saved && !saved.isWon) {
      fetchWords(saved.wordLength, function () {
        restoreFromState(saved);
      });
    } else {
      if (saved) clearGameState();
      // If daily mode and no local daily state, try server
      var dailySaved = loadDailyGameState();
      if (launchMode === 'daily' && !dailySaved) {
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
