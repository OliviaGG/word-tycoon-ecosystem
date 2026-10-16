// ===== Figural SP Engine =====
// Fully local single-player Figural — no server connection needed for gameplay.
// Fetches word lists once, then all game logic runs client-side.
// Symbol deduction: 3 mystery symbols with randomized meanings.

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

  var soloAccount = window.WordTycoonSoloAccount.create({ game: 'figural-sp', authBase: getAuthBaseURL() });
  var localStorage = soloAccount.storage;
  var XMLHttpRequest = soloAccount.XMLHttpRequest;


  // ─── Constants ──────────────────────────────────────────────────────

  var STATS_KEY = 'figural_sp_stats';
  var GAME_STATE_KEY = 'figural_sp_game';
  var DAILY_STATE_KEY = 'figural_sp_daily_game';
  var LENGTH_KEY = 'figural_sp_length';
  var WORD_LENGTHS = [4, 5, 6, 7, 8];
  var DAILY_LENGTH = 5; // Daily puzzle only exists for this word length
  var MAX_GUESSES = 8;
  var SYMBOL_POOL = ['\u25C6', '\u25B2', '\u25CF', '\u25A0', '\u2605', '\u2716'];
  // ◆ ▲ ● ■ ★ ✖
  var SYMBOL_COLORS = ['cyan', 'magenta', 'lime'];
  var MEANINGS = ['not_present', 'correct', 'wrong_position'];

  // ─── Viewport scaling removed for SP mode (pure flex layout) ────────

  // ─── State ──────────────────────────────────────────────────────────

  var wordCache = {};      // { "5": { targets: [...], dictionary: Set } }
  var game = null;
  var currentInput = '';
  var currentWordLength = parseInt(localStorage.getItem(LENGTH_KEY) || '5', 10);
  var statsOpen = false;
  var submitCooldown = false;
  var loading = false;
  var SYMBOL_COLOR_MAP = {};
  var dailyData = null;
  var dailyPlayed = false;
  var currentGameIsDaily = false; // whether the current game uses the daily word
  var launchMode = new URLSearchParams(window.location.search).get('mode');
  var stateSyncTimer = null;
  var serverCompletedDates = {};
  var userSession = null;

  // ─── DOM Refs ───────────────────────────────────────────────────────

  var board = document.getElementById('board');
  var guessesLeftEl = document.getElementById('guesses-left');
  var wordLengthTag = document.getElementById('word-length-tag');
  var messageEl = document.getElementById('message');
  var failOverlay = document.getElementById('fail-overlay');
  var failWord = document.getElementById('fail-word');
  var failEmoji = document.getElementById('fail-emoji');
  var failNewGameBtn = document.getElementById('fail-new-game-btn');
  var wordSizeToggle = document.getElementById('word-size-toggle');

  // Stats DOM
  var toggleBtn = document.getElementById('stats-toggle');
  var dropdown = document.getElementById('stats-dropdown');
  var closeStatsBtn = document.getElementById('stats-close');

  // ─── Utility ────────────────────────────────────────────────────────

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function pickRandom(arr, n) {
    return shuffle(arr).slice(0, n);
  }

  function getGameBaseURL() {
    var origin = window.location.protocol + '//' + window.location.host;
    var path = window.location.pathname || '/';
    var proxied = path.match(/^\/game\/[^/]+/);
    if (proxied) return origin + proxied[0];
    var legacy = path.match(/^\/(figural)(?=\/|$)/);
    if (legacy && (window.location.hostname === 'wordtycoon.live' || window.location.hostname === 'www.wordtycoon.live')) {
      return origin + legacy[0];
    }
    return origin;
  }

  // Auth + daily-completion routes belong to the RELAY, which serves them at
  // the ORIGIN root — never under the /game/<id> prefix getGameBaseURL()
  // returns. Sending them through the game base made
  // /game/figural/api/me/session 404 with an HTML body, so r.json() threw and
  // the page silently stayed logged out: no cosmetics, perks, wins chip or
  // server-side daily sync.
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
          dictionary: new Set((data.dictionary || []).concat(data.targets || []))
        };
        cb(null, wordCache[len]);
      })
      .catch(function (err) { cb(err); });
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
          var played = localStorage.getItem('figural_sp_daily_date');
          dailyPlayed = (played === dailyData.date) || !!serverCompletedDates[dailyData.date];
          console.log('[SP] Daily fetched, played:', dailyPlayed);
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
    x.open('GET', getAuthBaseURL() + '/api/sp-daily/status/figural-sp', true);
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


  // ─── Symbol Feedback (same algorithm as server) ─────────────────────

  function generateSymbolFeedback(guess, secretWord, meaningToSymbol) {
    var symbols = [];
    for (var i = 0; i < secretWord.length; i++) {
      var answerLetter = secretWord[i];
      var guessHasLetter = guess.indexOf(answerLetter) !== -1;

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

  // ─── Symbol → Color Mapping ─────────────────────────────────────────

  function buildColorMap(symbols, colors) {
    SYMBOL_COLOR_MAP = {};
    for (var i = 0; i < symbols.length; i++) {
      SYMBOL_COLOR_MAP[symbols[i]] = colors[i] || 'cyan';
    }
  }

  function glowClass(symbol) {
    return 'glow-' + (SYMBOL_COLOR_MAP[symbol] || 'cyan');
  }

  function borderClass(symbol) {
    return 'border-' + (SYMBOL_COLOR_MAP[symbol] || 'cyan');
  }

  // ─── Game Logic ─────────────────────────────────────────────────────

  function newGame(len) {
    if (loading) return;
    len = len || currentWordLength;

    // Save daily game state before switching away
    if (currentGameIsDaily && game && !game.solved && !game.failed) {
      saveDailyGameState();
    }

    currentWordLength = len;
    try { localStorage.setItem(LENGTH_KEY, String(len)); } catch (e) {}
    loading = true;

    fetchDaily(len, function() {
      fetchWords(len, function (err, words) {
        loading = false;
        if (err || !words || words.targets.length === 0) {
          showMessage('Could not load words. Try refreshing.', 'error');
          return;
        }

        // Check for a saved daily game at this length
        var savedDaily = loadDailyGameState();
        if (savedDaily && savedDaily.wordLength === len && len === DAILY_LENGTH && savedDaily.guesses && savedDaily.guesses.length > 0) {
          game = {
            word: savedDaily.word,
            wordLength: savedDaily.wordLength,
            symbols: savedDaily.symbols,
            symbolColors: savedDaily.symbolColors,
            symbolMeanings: savedDaily.symbolMeanings,
            meaningToSymbol: savedDaily.meaningToSymbol,
            guesses: savedDaily.guesses || [],
            solved: false,
            failed: false
          };
          currentGameIsDaily = true;
          currentInput = '';
          buildColorMap(game.symbols, game.symbolColors);
          var badge = document.getElementById('daily-badge');
          if (badge) badge.classList.remove('hidden');
          clearGameState();
          hideOverlays();
          renderBoard();
          renderLegend();
          updateStatus();
          updateKeyboard();
          updateWordSizeToggle();
          console.log('[SP] Restored DAILY game in progress');
          return;
        }

        var word;
        if (dailyData && !dailyPlayed && dailyData.date && dailyData.length === len && len === DAILY_LENGTH) {
          // Use daily word
          word = dailyData.word.toUpperCase();
          dailyPlayed = true;
          currentGameIsDaily = true;
          var badge = document.getElementById('daily-badge');
          if (badge) badge.classList.remove('hidden');
          console.log('[SP] Starting DAILY game');
        } else {
          // Random word
          word = words.targets[Math.floor(Math.random() * words.targets.length)].toUpperCase();
          currentGameIsDaily = false;
          var badge = document.getElementById('daily-badge');
          if (badge) badge.classList.add('hidden');
        }

        // Pick 3 random symbols and assign random meanings
        var symbols = pickRandom(SYMBOL_POOL, 3);
        var shuffledMeanings = shuffle(MEANINGS);
        var symbolMeanings = {};
        var meaningToSymbol = {};
        symbols.forEach(function (sym, i) {
          symbolMeanings[sym] = shuffledMeanings[i];
          meaningToSymbol[shuffledMeanings[i]] = sym;
        });

        game = {
          word: word,
          wordLength: len,
          symbols: symbols,
          symbolColors: SYMBOL_COLORS.slice(),
          symbolMeanings: symbolMeanings,
          meaningToSymbol: meaningToSymbol,
          guesses: [],
          solved: false,
          failed: false
        };
        clearGameState();

        currentInput = '';
        buildColorMap(game.symbols, game.symbolColors);
        hideOverlays();
        renderBoard();
        renderLegend();
        updateStatus();
        updateKeyboard();
        updateWordSizeToggle();
      });
    });
  }

  function processGuess(word) {
    if (!game || game.solved || game.failed) return { error: 'No active game' };

    word = word.toUpperCase().trim();
    if (word.length !== game.wordLength) return { error: 'Need ' + game.wordLength + ' letters' };
    if (!/^[A-Z]+$/.test(word)) return { error: 'Only letters allowed' };

    var words = wordCache[game.wordLength];
    if (!words || !words.dictionary.has(word.toLowerCase())) {
      return { error: 'Not a valid word' };
    }

    if (game.guesses.some(function (g) { return g.word === word; })) {
      return { error: 'Already guessed' };
    }

    var symbols = generateSymbolFeedback(word, game.word, game.meaningToSymbol);
    game.guesses.push({ word: word, symbols: symbols });
    reportLibraryWord(word, 'figural-sp');
    saveGameState();

    if (word === game.word) {
      game.solved = true;
      recordGameResult(true, game.word, game.guesses.length);
      clearGameState();
      if (currentGameIsDaily) clearDailyGameState();
      return { ok: true, solved: true };
    }

    if (game.guesses.length >= MAX_GUESSES) {
      game.failed = true;
      recordGameResult(false, game.word, game.guesses.length);
      clearGameState();
      if (currentGameIsDaily) clearDailyGameState();
      return { ok: true, failed: true };
    }

    if (currentGameIsDaily) saveDailyGameState();
    return { ok: true };
  }

  // ─── Game State Persistence ───────────────────────────────────────────

  function saveGameState() {
    if (!game) return;
    try {
      localStorage.setItem(GAME_STATE_KEY, JSON.stringify({
        word: game.word,
        wordLength: game.wordLength,
        symbols: game.symbols,
        symbolColors: game.symbolColors,
        symbolMeanings: game.symbolMeanings,
        meaningToSymbol: game.meaningToSymbol,
        guesses: game.guesses,
        solved: game.solved,
        failed: game.failed,
        isDaily: currentGameIsDaily
      }));
    } catch (e) {}
  }

  function loadGameState() {
    try {
      var raw = localStorage.getItem(GAME_STATE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s.word || !s.wordLength || !s.guesses || !s.symbols) return null;
      return s;
    } catch (e) { return null; }
  }

  function clearGameState() {
    try { localStorage.removeItem(GAME_STATE_KEY); } catch (e) {}
  }

  function saveDailyGameState() {
    if (!currentGameIsDaily || !game) return;
    if (game.solved || game.failed) return;
    try {
      localStorage.setItem(DAILY_STATE_KEY, JSON.stringify({
        word: game.word,
        wordLength: game.wordLength,
        symbols: game.symbols,
        symbolColors: game.symbolColors,
        symbolMeanings: game.symbolMeanings,
        meaningToSymbol: game.meaningToSymbol,
        guesses: game.guesses,
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
      if (!s.word || !s.wordLength || !s.dailyDate || !s.symbols) return null;
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
    x.open('POST', '/api/sp-state/figural-sp', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ state: JSON.parse(stateRaw) }));
  }

  function clearGameStateFromServer() {
    if (!userSession) return;
    var x = new XMLHttpRequest();
    x.open('DELETE', '/api/sp-state/figural-sp', true);
    x.send();
  }

  function loadGameStateFromServer(callback) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/sp-state/figural-sp', true);
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

  // ─── Board Rendering ────────────────────────────────────────────────

  function renderBoard() {
    if (!game) return;

    board.innerHTML = '';
    var wordLen = game.wordLength;
    var guesses = game.guesses;

    board.className = 'word-len-' + wordLen;

    // Completed guesses
    for (var g = 0; g < guesses.length; g++) {
      var row = document.createElement('div');
      row.className = 'guess-row';

      for (var i = 0; i < wordLen; i++) {
        var cell = document.createElement('div');
        cell.className = 'cell revealed ' + borderClass(guesses[g].symbols[i]);

        var letter = document.createElement('div');
        letter.className = 'cell-letter';
        letter.textContent = guesses[g].word[i];

        var sym = document.createElement('div');
        sym.className = 'cell-symbol ' + glowClass(guesses[g].symbols[i]);
        sym.textContent = guesses[g].symbols[i];

        cell.appendChild(letter);
        cell.appendChild(sym);
        row.appendChild(cell);
      }

      board.appendChild(row);
    }

    // Current input row
    if (!game.solved && !game.failed) {
      var inputRow = document.createElement('div');
      inputRow.className = 'guess-row current';
      inputRow.id = 'current-row';

      for (var i = 0; i < wordLen; i++) {
        var cell = document.createElement('div');
        cell.className = 'cell' + (i < currentInput.length ? ' filled' : '');

        var letter = document.createElement('div');
        letter.className = 'cell-letter';
        letter.textContent = i < currentInput.length ? currentInput[i] : '';
        letter.style.opacity = '1';
        letter.style.fontSize = '20px';

        cell.appendChild(letter);
        inputRow.appendChild(cell);
      }

      board.appendChild(inputRow);
    }

    // Empty rows — always show all 8 for snug layout
    var filledRows = guesses.length + (!game.solved && !game.failed ? 1 : 0);
    var emptyLimit = MAX_GUESSES;
    for (var r = filledRows; r < emptyLimit; r++) {
      var row = document.createElement('div');
      row.className = 'guess-row';
      for (var i = 0; i < wordLen; i++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        row.appendChild(cell);
      }
      board.appendChild(row);
    }

    board.scrollTop = board.scrollHeight;
  }

  function renderLegend() {
    if (!game) return;
    var symbols = game.symbols;
    for (var i = 0; i < 3; i++) {
      var item = document.getElementById('legend-' + i);
      if (!item) continue;
      var symEl = item.querySelector('.legend-symbol');
      var meaningEl = item.querySelector('.legend-meaning');
      if (symbols[i]) {
        symEl.textContent = symbols[i];
        symEl.className = 'legend-symbol ' + glowClass(symbols[i]);
        meaningEl.textContent = '= ?';
      }
    }
  }

  function updateStatus() {
    if (!game) return;
    if (guessesLeftEl) guessesLeftEl.textContent = (MAX_GUESSES - game.guesses.length) + ' left';
    if (wordLengthTag) wordLengthTag.textContent = game.wordLength + ' letters';
  }

  function updateKeyboard() {
    if (!game) return;
    var used = {};
    for (var g = 0; g < game.guesses.length; g++) {
      for (var i = 0; i < game.guesses[g].word.length; i++) {
        used[game.guesses[g].word[i]] = true;
      }
    }
    var keys = document.querySelectorAll('.kb-key');
    for (var k = 0; k < keys.length; k++) {
      var letter = keys[k].dataset.key;
      if (letter && letter.length === 1 && used[letter]) {
        keys[k].classList.add('kb-used');
      } else {
        keys[k].classList.remove('kb-used');
      }
    }
  }

  // ─── Messages ───────────────────────────────────────────────────────

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = type || '';
    if (type) {
      setTimeout(function () {
        if (messageEl.textContent === text) {
          messageEl.textContent = '';
          messageEl.className = '';
        }
      }, 3000);
    }
  }

  // ─── Overlays ───────────────────────────────────────────────────────

  // ─── Daily share ─────────────────────────────────────────────────────────
  function shareDailyResult() {
    var text = '\uD83E\uDDE9 Figural Daily' + (currentGameIsDaily && dailyData && dailyData.date ? ' ' + dailyData.date : '') +
      ' \u2014 decoded in ' + game.guesses.length + ' guess' + (game.guesses.length === 1 ? '' : 'es') +
      '\nhttps://wordtycoon.live/figural/solo/';
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(null, function () {
        try { window.prompt('Copy your result:', text); } catch (e) {}
      });
    } else {
      try { window.prompt('Copy your result:', text); } catch (e) {}
    }
  }

  function showWin() {
    if (!window.WinCard) return;
    var winner;
    if (userSession) {
      // /api/me/session never returns a discordId field, so this always
      // resolved to 'web' anyway — now it says so. 'web' is also the platform
      // the MP servers canonicalise a hub login to, and the only one WT
      // resolves cosmetics for without a linked_accounts row.
      winner = {
        username: userSession.username,
        displayName: userSession.displayName || userSession.username,
        platform: 'web',
        platformUserId: userSession.id || null,
        profilePic: userSession.avatar || null,
        linkedDiscord: (userSession.provider || 'discord') === 'discord' ? userSession.id : null
      };
    } else {
      // Guest — no hub identity; WinCard auto-hides the total-wins chip.
      winner = { displayName: 'You', platform: 'web' };
    }
    var actions = [{
      label: 'NEW GAME',
      primary: true,
      onClick: function () {
        hideOverlays();
        newGame();
      }
    }];
    if (currentGameIsDaily) {
      actions.push({ label: 'Share', onClick: shareDailyResult });
    }
    WinCard.showSolo({
      game: 'figural',
      gameName: 'Figural',
      word: game.word,
      guessCount: game.guesses.length,
      winner: winner,
      actions: actions,
      autoHideMs: 0 // sticky — old overlay stayed until NEW GAME was clicked
    });
  }

  function showFail() {
    if (failEmoji) failEmoji.textContent = '\uD83D\uDE14';
    if (failWord) failWord.textContent = game.word;
    failOverlay.classList.remove('hidden');
  }

  function hideOverlays() {
    failOverlay.classList.add('hidden');
    if (window.WinCard) WinCard.hide();
  }

  function shakeCurrentRow() {
    var row = document.getElementById('current-row');
    if (!row) return;
    row.classList.add('shake-row');
    setTimeout(function () { row.classList.remove('shake-row'); }, 400);
  }

  // ─── Keyboard Input ─────────────────────────────────────────────────

  function handleKey(key) {
    if (!game || game.solved || game.failed) return;

    if (key === 'Backspace') {
      currentInput = currentInput.slice(0, -1);
      renderBoard();
      return;
    }

    if (key === 'Enter') {
      submitGuess();
      return;
    }

    if (/^[A-Z]$/.test(key) && currentInput.length < game.wordLength) {
      currentInput += key;
      renderBoard();

      var currentRow = document.getElementById('current-row');
      if (currentRow) {
        var cells = currentRow.querySelectorAll('.cell.filled');
        var lastCell = cells[cells.length - 1];
        if (lastCell) {
          lastCell.classList.add('pop');
          setTimeout(function () { lastCell.classList.remove('pop'); }, 120);
        }
      }
    }
  }

  function submitGuess() {
    if (submitCooldown || loading) return;
    var word = currentInput.trim();
    if (!word || word.length !== game.wordLength) {
      showMessage('Need ' + game.wordLength + ' letters', 'error');
      shakeCurrentRow();
      return;
    }

    var result = processGuess(word);
    currentInput = '';

    if (result.error) {
      showMessage(result.error, 'error');
      shakeCurrentRow();
      renderBoard();
    } else {
      renderBoard();
      updateStatus();
      updateKeyboard();
      if (result.solved) {
        showWin();
      } else if (result.failed) {
        showFail();
      }
    }

    submitCooldown = true;
    setTimeout(function () { submitCooldown = false; }, 300);
  }

  // Physical keyboard
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    var key = e.key;
    if (key === 'Backspace' || key === 'Enter') {
      e.preventDefault();
      handleKey(key);
    } else if (key.length === 1 && /[a-zA-Z]/.test(key)) {
      e.preventDefault();
      handleKey(key.toUpperCase());
    }
  });

  // On-screen keyboard
  document.getElementById('keyboard').addEventListener('click', function (e) {
    var btn = e.target.closest('.kb-key');
    if (!btn) return;
    var key = btn.dataset.key;
    if (key === 'Enter') handleKey('Enter');
    else if (key === 'Backspace') handleKey('Backspace');
    else handleKey(key);
  });

  // ─── Word Size Toggle ──────────────────────────────────────────────

  function buildWordSizeToggle() {
    if (!wordSizeToggle) return;
    wordSizeToggle.innerHTML = '';
    // Single cycling button for SP mode
    var btn = document.createElement('button');
    btn.className = 'ws-btn active ws-cycle';
    btn.textContent = currentWordLength;
    btn.setAttribute('type', 'button');
    btn.setAttribute('title', 'Change word length');
    btn.addEventListener('click', function () {
      var idx = WORD_LENGTHS.indexOf(currentWordLength);
      var nextLen = WORD_LENGTHS[(idx + 1) % WORD_LENGTHS.length];
      newGame(nextLen);
    });
    wordSizeToggle.appendChild(btn);
  }

  function updateWordSizeToggle() {
    if (!wordSizeToggle) return;
    var btn = wordSizeToggle.querySelector('.ws-cycle');
    if (btn) btn.textContent = currentWordLength;
  }

  // ─── New Game Buttons ───────────────────────────────────────────────

  if (failNewGameBtn) {
    failNewGameBtn.addEventListener('click', function () {
      hideOverlays();
      newGame();
    });
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

  // ─── Local Stats (localStorage) ────────────────────────────────────

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
      localStorage.setItem('figural_sp_daily_date', dailyData.date);
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
        historyEl.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:11px;padding:8px 0">No games yet</div>';
      } else {
        historyEl.innerHTML = recent.map(function (h) {
          return '<div class="stats-h-entry">' +
            '<span class="stats-h-word">' + (h.word || '???') + '</span>' +
            '<span class="stats-h-guesses">' + (h.won ? h.guessCount + ' guesses' : 'failed') + '</span>' +
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

  // ─── Session Check ───────────────────────────────────────────────

  var completionsReady = false;
  var dailyReady = false;
  var initStarted = false;

  function tryStartInit() {
    if (initStarted || !completionsReady || !dailyReady) return;
    if (dailyData) dailyPlayed = localStorage.getItem('figural_sp_daily_date') === dailyData.date || !!serverCompletedDates[dailyData.date];
    initStarted = true;
    startGame();
  }

  fetch(getAuthBaseURL() + '/api/me/session', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.ok) {
      soloAccount.bind(data.user);
      userSession = data.user;
      renderStats();
      fetchServerCompletions(function() {
        completionsReady = true;
        tryStartInit();
      });
    } else {
      soloAccount.bind(null);
      renderStats();
      completionsReady = true;
      tryStartInit();
    }
  }).catch(function () {
    soloAccount.bind(null);
    renderStats();
    completionsReady = true;
    tryStartInit();
  });

  // ─── Init ──────────────────────────────────────────────────────────

  buildWordSizeToggle();
  renderStats();

  function restoreFromState(saved) {
    currentWordLength = saved.wordLength;
    currentGameIsDaily = saved.isDaily || false;
    game = {
      word: saved.word,
      wordLength: saved.wordLength,
      symbols: saved.symbols,
      symbolColors: saved.symbolColors,
      symbolMeanings: saved.symbolMeanings,
      meaningToSymbol: saved.meaningToSymbol,
      guesses: saved.guesses || [],
      solved: false,
      failed: false
    };
    currentInput = '';
    buildColorMap(game.symbols, game.symbolColors);
    var badge = document.getElementById('daily-badge');
    if (badge) {
      if (currentGameIsDaily) badge.classList.remove('hidden');
      else badge.classList.add('hidden');
    }
    hideOverlays();
    renderBoard();
    renderLegend();
    updateStatus();
    updateKeyboard();
    updateWordSizeToggle();
  }

  function startGame() {
    // Try to restore a saved game
    var saved = loadGameState();

    // Daily mode: discard any saved non-daily game so we don't restore it
    if (launchMode === 'daily' && saved && saved.isDaily === false) {
      clearGameState();
      saved = null;
    }

    if (saved && !saved.solved && !saved.failed) {
      fetchWords(saved.wordLength, function () {
        restoreFromState(saved);
      });
    } else {
      if (saved) clearGameState();
      // For daily mode with no local state, try loading from server
      var dailySaved = loadDailyGameState();
      if (launchMode === 'daily' && !dailySaved) {
        loadGameStateFromServer(function(serverState) {
          if (serverState && serverState.word && serverState.guesses && serverState.guesses.length > 0) {
            // Save server state locally and restore
            try { localStorage.setItem(DAILY_STATE_KEY, JSON.stringify(serverState)); } catch(e) {}
            dailyData = { word: serverState.word, date: serverState.dailyDate, length: serverState.wordLength };
            fetchWords(serverState.wordLength, function () {
              restoreFromState({
                word: serverState.word,
                wordLength: serverState.wordLength,
                symbols: serverState.symbols,
                symbolColors: serverState.symbolColors,
                symbolMeanings: serverState.symbolMeanings,
                meaningToSymbol: serverState.meaningToSymbol,
                guesses: serverState.guesses,
                isDaily: true
              });
            });
          } else {
            newGame(currentWordLength);
          }
        });
      } else {
        newGame(currentWordLength);
      }
    }
  }

  // Wait for both fetchDaily and fetchServerCompletions before starting
  // so dailyData and serverCompletedDates are available when newGame() checks them
  fetchDaily(currentWordLength, function() {
    dailyReady = true;
    tryStartInit();
  });

})();
