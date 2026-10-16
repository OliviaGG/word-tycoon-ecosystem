// ===== UnWordle SP Engine =====
// Reverse Wordle — given the answer and color patterns, fill in the missing words.
// Supports daily challenge mode (deterministic daily answer from word bank).

(function () {
  'use strict';
  // Load both current ownership helpers before reading any game progress.
  if (!window.WordTycoonSoloAccount || window.WTDurableCompletion?.sessionContextVersion !== 2) {
    var engineURL = document.currentScript.src;
    var dependencies = ['solo-account.js?v=20261003-owner2','durable-completion.js?v=20261003-owner2'];
    function loadDependency() {
      var script = document.createElement('script');
      if (!dependencies.length) { script.src = engineURL; document.head.appendChild(script); return; }
      script.src = new URL(dependencies.shift(), engineURL).href;
      script.onload = loadDependency;
      script.onerror = function () { var notice = document.createElement('p'); notice.setAttribute('role', 'status'); notice.textContent = 'Progress protection could not load. Refresh to try again.'; document.body.appendChild(notice); };
      document.head.appendChild(script);
    }
    loadDependency(); return;
  }
  var soloAccount = window.WordTycoonSoloAccount.create({ game: 'unwordle-sp', authBase: getAuthBaseURL() });
  var localStorage = soloAccount.storage;
  var XMLHttpRequest = soloAccount.XMLHttpRequest;


  // ─── Constants ──────────────────────────────────────────────────────

  var WORD_LENGTH = 5;
  var ROWS_NORMAL = 3;
  var ROWS_HARD = 5;
  var DIFFICULTY_KEY = 'unwordle_sp_difficulty';
  var AUTO_RESTART_SECONDS = 8;
  var DAILY_DATE_KEY = 'unwordle_sp_daily_date';
  var DAILY_STATE_KEY = 'unwordle_sp_daily_game';

  // Load saved difficulty
  var difficulty = 'normal';
  try { var d = localStorage.getItem(DIFFICULTY_KEY); if (d === 'hard') difficulty = 'hard'; } catch (e) {}

  function getNumRows() { return difficulty === 'hard' ? ROWS_HARD : ROWS_NORMAL; }
  function getStatsKey() { return difficulty === 'hard' ? 'unwordle_sp_stats_hard' : 'unwordle_sp_stats'; }
  var KB_ROWS = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['\u232B', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'ENTER']
  ];

  // ─── Seeded PRNG (for deterministic daily puzzles) ─────────────────

  function hashString(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h = h | 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function createSeededRNG(seedStr) {
    return mulberry32(hashString(seedStr));
  }

  function getGameBaseURL() {
    var origin = window.location.protocol + '//' + window.location.host;
    var path = window.location.pathname || '/';
    var proxied = path.match(/^\/game\/[^/]+/);
    if (proxied) return origin + proxied[0];
    var legacy = path.match(/^\/(unwordle)(?=\/|$)/);
    if (legacy && (window.location.hostname === 'wordtycoon.live' || window.location.hostname === 'www.wordtycoon.live')) {
      return origin + legacy[0];
    }
    return origin;
  }

  // Auth + daily-completion routes belong to the RELAY, which serves them at
  // the ORIGIN root. server.js also proxies them under /game/unwordle, but
  // going straight to the root keeps this in step with the sibling games
  // whose servers have no such proxy (there it 404'd with an HTML body, and
  // the r.json() throw left the page silently logged out).
  function getAuthBaseURL() {
    var host = window.location.hostname;
    if (host === 'wordtycoon.live' || host === 'www.wordtycoon.live' || host === 'localhost' || host === '127.0.0.1') {
      return window.location.protocol + '//' + window.location.host;
    }
    return 'https://wordtycoon.live';
  }

  // ─── State ──────────────────────────────────────────────────────────

  var wordCache = null;      // { targets: [...], dictionary: Set }
  var puzzle = null;          // { answer, rows: [{pattern}], solved: [], playerWords: [] }
  var currentRow = 0;         // which clue row is active
  var rowInputs = [];         // per-row typed letters (persistent across row switches)
  var currentInput = [];      // reference to rowInputs[currentRow]
  var cursorPos = 0;          // which tile the cursor is on (0 to WORD_LENGTH-1)
  var lastTypedTile = null;   // {row, col} — for pop animation on just-typed tile only
  var invalidRow = -1;        // row index with red rings (-1 = none)
  var invalidTimeout = null;  // timer to clear red rings

  function initRowInputs(numRows) {
    rowInputs = [];
    for (var r = 0; r < numRows; r++) {
      var arr = [];
      for (var i = 0; i < WORD_LENGTH; i++) arr.push('');
      rowInputs.push(arr);
    }
    currentInput = rowInputs.length > 0 ? rowInputs[0] : [];
  }

  function switchToRow(r) {
    currentRow = r;
    currentInput = rowInputs[r] || [];
    // Place cursor at first empty slot
    cursorPos = WORD_LENGTH;
    for (var i = 0; i < WORD_LENGTH; i++) {
      if (!currentInput[i]) { cursorPos = i; break; }
    }
  }

  function getInputWord() {
    return currentInput.join('');
  }

  function isInputFull() {
    for (var i = 0; i < WORD_LENGTH; i++) { if (!currentInput[i]) return false; }
    return true;
  }

  // After typing, advance cursor to next empty slot
  function advanceCursor() {
    for (var i = cursorPos + 1; i < WORD_LENGTH; i++) {
      if (!currentInput[i]) { cursorPos = i; return; }
    }
    for (var i = 0; i < cursorPos; i++) {
      if (!currentInput[i]) { cursorPos = i; return; }
    }
    cursorPos = WORD_LENGTH;
  }

  var timerStart = null;
  var timerInterval = null;
  var errorTimeout = null;
  var submitCooldown = false;
  var loading = false;
  var statsOpen = false;
  var userSession = null;

  // Daily challenge state
  var dailyData = null;            // { word, date, length } from /api/sp/daily
  var dailyPlayed = false;         // whether today's daily has been WON
  var dailyEnabled = true;         // whether daily mode is enabled (from server settings)
  var currentGameIsDaily = false;  // whether the current game uses the daily word
  var serverCompletedDates = {};   // dates completed on server (for cross-device sync)

  // Launch mode from URL (e.g. ?mode=daily from portal)
  var launchMode = null;
  try {
    var params = new URLSearchParams(window.location.search);
    launchMode = params.get('mode');
  } catch (e) {}

  // ─── DOM Refs ───────────────────────────────────────────────────────

  var gridEl = document.getElementById('wordle-grid');
  var keyboardEl = document.getElementById('keyboard');
  var errorToast = document.getElementById('error-toast');
  var timerEl = document.getElementById('timer');
  var newPuzzleBtn = document.getElementById('new-puzzle-btn');
  var toggleBtn = document.getElementById('stats-toggle');
  var dropdown = document.getElementById('stats-dropdown');
  var closeStatsBtn = document.getElementById('stats-close');
  var dailyBadge = document.getElementById('daily-badge');

  // ─── Difficulty Toggle ─────────────────────────────────────────────

  var diffToggle = document.getElementById('difficulty-toggle');
  if (diffToggle) {
    var diffBtns = diffToggle.querySelectorAll('.diff-btn');
    diffBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === difficulty);
    });

    diffToggle.addEventListener('click', function (e) {
      var btn = e.target.closest('.diff-btn');
      if (!btn) return;
      var mode = btn.getAttribute('data-mode');

      // During daily: switching to Hard saves daily progress, switching to Normal restores it
      if (currentGameIsDaily && mode === 'hard') {
        // Save daily progress before switching away
        saveDailyGameState();
        currentGameIsDaily = false;
        difficulty = 'hard';
        try { localStorage.setItem(DIFFICULTY_KEY, difficulty); } catch (e2) {}
        diffBtns.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-mode') === difficulty);
        });
        renderStats();
        // Generate random hard game (not daily)
        fetchWords(function (err, words) {
          if (err || !words) return;
          puzzle = generatePuzzle(words);
          initRowInputs(puzzle.rows.length);
          switchToRow(0);
          updateDailyBadge();
          updatePuzzleLabel();
          hideWin();
          startTimer();
          renderGrid();
          updateKeyboard();
        });
        return;
      }

      if (!currentGameIsDaily && mode === 'normal') {
        // Switching back to Normal — try to restore daily
        difficulty = 'normal';
        try { localStorage.setItem(DIFFICULTY_KEY, difficulty); } catch (e2) {}
        diffBtns.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-mode') === difficulty);
        });
        renderStats();
        newGame(); // newGame will restore saved daily if it exists
        return;
      }

      if (mode === difficulty) return;

      difficulty = mode;
      try { localStorage.setItem(DIFFICULTY_KEY, difficulty); } catch (e2) {}

      diffBtns.forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === difficulty);
      });

      renderStats();
      newGame();
    });
  }

  // ─── Word Loading ───────────────────────────────────────────────────

  function fetchWords(cb) {
    if (wordCache) return cb(null, wordCache);

    var base = window.location.protocol + '//' + window.location.host;
    var targetsUrl = base + '/api/word-bank/targets/' + WORD_LENGTH;
    var dictUrl = base + '/api/word-bank/dictionary/' + WORD_LENGTH;

    Promise.all([
      fetch(targetsUrl, { signal: AbortSignal.timeout(20000) }).then(function (r) { return r.ok ? r.json() : []; }),
      fetch(dictUrl, { signal: AbortSignal.timeout(20000) }).then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (results) {
      var targets = results[0] || [];
      var dictWords = results[1] || [];
      var dict = new Set(dictWords);
      for (var i = 0; i < targets.length; i++) dict.add(targets[i]);
      wordCache = { targets: targets, dictionary: dict };
      cb(null, wordCache);
    }).catch(function (err) { cb(err); });
  }

  // ─── Daily Word Fetch ─────────────────────────────────────────────

  function fetchDaily(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', getGameBaseURL() + '/api/sp/daily?length=' + WORD_LENGTH, true);
    x.onload = function() {
      if (x.status === 200) {
        try {
          dailyData = JSON.parse(x.responseText);
          var played = localStorage.getItem(DAILY_DATE_KEY);
          dailyPlayed = (played === dailyData.date) || !!serverCompletedDates[dailyData.date];
          console.log('[UnWordle] Daily fetched:', dailyData.word ? '(available)' : 'none', 'played:', dailyPlayed);
        } catch(e) { dailyData = null; }
      }
      if (cb) cb();
    };
    x.onerror = function() { dailyData = null; if (cb) cb(); };
    x.timeout = 10000; x.ontimeout = x.onerror;
    x.send();
  }

  function fetchServerCompletions(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', getAuthBaseURL() + '/api/sp-daily/status/unwordle-sp', true);
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
    x.timeout = 10000; x.ontimeout = x.onerror;
    x.send();
  }

  function fetchSettings(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/sp/settings', true);
    x.onload = function() {
      if (x.status === 200) {
        try {
          var data = JSON.parse(x.responseText);
          if (data.dailyEnabled === false) dailyEnabled = false;
        } catch(e) {}
      }
      if (cb) cb();
    };
    x.onerror = function() { if (cb) cb(); };
    x.timeout = 10000; x.ontimeout = x.onerror;
    x.send();
  }

  var completionRecovery = null;
  function getCompletionRecovery() {
    if (!completionRecovery) completionRecovery = window.WTDurableCompletion.attach({
      gameId: 'unwordle-sp', getSession: function() { return userSession; }, getAccount: function() { return userSession && (userSession.anchorId || userSession.id); }, baseUrl: getAuthBaseURL
    });
    return completionRecovery;
  }
  function saveServerCompletion(date) {
    var evidence = { length: WORD_LENGTH, patterns: puzzle.rows.map(function(row) { return row.pattern.slice(); }), playerWords: puzzle.playerWords.slice() };
    return getCompletionRecovery().submit(date, evidence);
  }

  // ─── Daily Game State Persistence ─────────────────────────────────

  function saveDailyGameState() {
    if (!currentGameIsDaily || !puzzle) return;
    var allSolved = puzzle.solved.every(function(s) { return s; });
    if (allSolved) return;
    try {
      localStorage.setItem(DAILY_STATE_KEY, JSON.stringify({
        answer: puzzle.answer,
        rows: puzzle.rows,
        solved: puzzle.solved,
        playerWords: puzzle.playerWords,
        rowInputs: rowInputs,
        difficulty: difficulty,
        dailyDate: dailyData ? dailyData.date : null,
        version: 6  // multiset hard-mode pattern continuation
      }));
      debouncedSaveToServer();
    } catch (e) {}
  }

  function loadDailyGameState() {
    try {
      var raw = localStorage.getItem(DAILY_STATE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s.answer || !s.rows || !s.dailyDate) return null;
      // Discard old saves from previous generation algorithm
      if (!s.version || s.version < 6) { clearDailyGameState(); return null; }
      // Stale daily from a previous day
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
    x.open('POST', '/api/sp-state/unwordle-sp', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ state: JSON.parse(stateRaw) }));
  }

  function clearGameStateFromServer() {
    if (!userSession) return;
    var x = new XMLHttpRequest();
    x.open('DELETE', '/api/sp-state/unwordle-sp', true);
    x.send();
  }

  function loadGameStateFromServer(cb) {
    if (!userSession) { if (cb) cb(null); return; }
    var x = new XMLHttpRequest();
    x.open('GET', '/api/sp-state/unwordle-sp', true);
    x.onload = function() {
      if (x.status === 200) {
        try {
          var data = JSON.parse(x.responseText);
          if (data.ok && data.state) { if (cb) cb(data.state); return; }
        } catch(e) {}
      }
      if (cb) cb(null);
    };
    x.onerror = function() { if (cb) cb(null); };
    x.timeout = 10000; x.ontimeout = x.onerror;
    x.send();
  }

  // Debounced server state save (2s)
  var saveServerTimeout = null;
  function debouncedSaveToServer() {
    if (saveServerTimeout) clearTimeout(saveServerTimeout);
    saveServerTimeout = setTimeout(saveGameStateToServer, 2000);
  }

  // ─── Wordle Color Check (standard two-pass algorithm) ──────────────

  function checkGuess(guess, target) {
    var result = [];
    var guessArr = guess.split('');
    var targetArr = target.split('');
    var used = new Array(target.length).fill(false);

    for (var i = 0; i < guessArr.length; i++) {
      if (guessArr[i] === targetArr[i]) {
        result[i] = 'correct';
        used[i] = true;
      } else {
        result[i] = 'absent';
      }
    }

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

  // ─── Puzzle Generation ──────────────────────────────────────────────

  function generatePuzzleForAnswer(answer, words, rng) {
    if (!rng) rng = Math.random;
    var numRows = getNumRows();
    var dictArr = Array.from(words.dictionary);

    // Deterministic shuffle (Fisher-Yates) — ensures seeded RNG explores all words
    for (var si = dictArr.length - 1; si > 0; si--) {
      var sj = Math.floor(rng() * (si + 1));
      var tmp = dictArr[si]; dictArr[si] = dictArr[sj]; dictArr[sj] = tmp;
    }

    var rows = [];
    var usedWords = new Set([answer.toLowerCase()]);

    // Hard mode constraints accumulate from row to row:
    // 1. Green letters must stay in position (carried forward)
    // 2. Yellow letters must appear somewhere (carried forward) — tracked with multiplicity
    //    so each row's pattern is a real Wordle-hard-mode continuation of prior rows
    //    (non-gray tile count is monotonically non-decreasing).
    // 3. Gray letters can only be used ONCE — eliminated after use
    // Early rows minimize new greens so patterns stay diverse.
    var greenConstraints = {};    // position (string key) -> letter
    var mustContainCounts = {};   // letter -> min required count (max over prior rows of that letter's green+yellow tile count)
    var eliminatedLetters = {};   // gray letters already used (can't reuse)
    var yellowExclusions = {};    // position -> {letter: true} — yellow letter can't repeat at same position
    var answerSet = {};           // letters in the answer (never eliminated)
    for (var k = 0; k < answer.length; k++) answerSet[answer[k]] = true;

    for (var rowIdx = 0; rowIdx < numRows; rowIdx++) {
      var bestCandidate = null;
      var bestNewGreens = WORD_LENGTH + 1;
      var checked = 0;

      for (var attempt = 0; attempt < dictArr.length; attempt++) {
        var word = dictArr[attempt].toUpperCase();
        if (word.length !== WORD_LENGTH) continue;
        if (usedWords.has(word.toLowerCase())) continue;

        // Enforce green constraints: specific letters at specific positions
        var passGreen = true;
        for (var pos in greenConstraints) {
          if (word[pos] !== greenConstraints[pos]) { passGreen = false; break; }
        }
        if (!passGreen) continue;

        // Enforce yellow multiset: word must contain each known letter at least N times
        // (where N is the largest green+yellow count seen for that letter across prior rows).
        // This makes every row a valid Wordle-hard-mode continuation: a player who already
        // saw 2 yellow Es can't write a guess with only 1 E.
        var passYellow = true;
        for (var letter in mustContainCounts) {
          var need = mustContainCounts[letter];
          var have = 0;
          for (var ki = 0; ki < WORD_LENGTH; ki++) if (word[ki] === letter) have++;
          if (have < need) { passYellow = false; break; }
        }
        if (!passYellow) continue;

        // Enforce gray elimination: can't reuse gray letters from previous rows
        var passElim = true;
        for (var k = 0; k < WORD_LENGTH; k++) {
          if (eliminatedLetters[word[k]]) { passElim = false; break; }
        }
        if (!passElim) continue;

        // Enforce yellow exclusion: letter can't repeat at same position it was yellow
        var passYellowPos = true;
        for (var k = 0; k < WORD_LENGTH; k++) {
          if (yellowExclusions[k] && yellowExclusions[k][word[k]]) { passYellowPos = false; break; }
        }
        if (!passYellowPos) continue;

        var pattern = checkGuess(word, answer);
        var correctCount = 0;
        var absentCount = 0;
        var newGreens = 0;
        for (var k = 0; k < pattern.length; k++) {
          if (pattern[k] === 'correct') {
            correctCount++;
            if (!greenConstraints[k]) newGreens++;
          }
          if (pattern[k] === 'absent') absentCount++;
        }
        if (correctCount === WORD_LENGTH) continue;
        // Avoid all-absent early — want SOME info for the player
        if (absentCount === WORD_LENGTH && rowIdx < numRows - 1 && checked < 200) continue;

        checked++;

        // For non-last rows: pick the word with fewest NEW greens.
        // This keeps patterns diverse — greens accumulate gradually.
        if (rowIdx < numRows - 1) {
          if (newGreens < bestNewGreens) {
            bestCandidate = { word: word, pattern: pattern };
            bestNewGreens = newGreens;
          }
          if (bestNewGreens === 0 && checked >= 50) break;
          if (checked >= 300 && bestCandidate) break;
        } else {
          bestCandidate = { word: word, pattern: pattern };
          break;
        }
      }

      if (!bestCandidate) break;

      usedWords.add(bestCandidate.word.toLowerCase());
      rows.push({ originalWord: bestCandidate.word, pattern: bestCandidate.pattern });

      // Tally this row's letter-reveal counts (greens + yellows count toward must-contain)
      var rowReveal = {};
      for (var k = 0; k < bestCandidate.pattern.length; k++) {
        if (bestCandidate.pattern[k] === 'correct') {
          greenConstraints[k] = bestCandidate.word[k];
          rowReveal[bestCandidate.word[k]] = (rowReveal[bestCandidate.word[k]] || 0) + 1;
        } else if (bestCandidate.pattern[k] === 'present') {
          rowReveal[bestCandidate.word[k]] = (rowReveal[bestCandidate.word[k]] || 0) + 1;
          // Track: this letter can't go at this position again
          if (!yellowExclusions[k]) yellowExclusions[k] = {};
          yellowExclusions[k][bestCandidate.word[k]] = true;
        }
      }
      // Max-merge into accumulated must-contain counts
      for (var L in rowReveal) {
        if (!mustContainCounts[L] || mustContainCounts[L] < rowReveal[L]) {
          mustContainCounts[L] = rowReveal[L];
        }
      }
      // Eliminate gray letters (not in answer) so they can't repeat
      for (var k = 0; k < bestCandidate.word.length; k++) {
        if (!answerSet[bestCandidate.word[k]]) {
          eliminatedLetters[bestCandidate.word[k]] = true;
        }
      }
    }

    // No sorting — order matters for hard mode constraint progression
    return {
      answer: answer,
      rows: rows,
      solved: new Array(rows.length).fill(false),
      playerWords: new Array(rows.length).fill('')
    };
  }

  // ─── Player-Solvability Coverage Estimator ─────────────────────────
  //
  // Returns the fraction of legal Row-0 picks that lead to a valid completion
  // in natural row order under hard-mode constraints. Sampled (to keep it fast
  // on mobile) and capped by an op-budget. Used by the daily seed-retry loop
  // to prefer puzzles where most natural player picks reach a solution.
  function estimatePuzzleCoverage(answer, rows, words, opBudget) {
    var dictArr = Array.from(words.dictionary);
    var answerSet = {};
    for (var ai = 0; ai < answer.length; ai++) answerSet[answer[ai]] = true;
    var answerLower = answer.toLowerCase();
    var ops = 0;
    if (typeof opBudget !== 'number' || opBudget <= 0) opBudget = 80000;

    // Build candidate list per row.
    var candsByRow = [];
    for (var r = 0; r < rows.length; r++) {
      var pat = rows[r].pattern;
      var cands = [];
      for (var di = 0; di < dictArr.length; di++) {
        var w = dictArr[di].toUpperCase();
        if (w.length !== WORD_LENGTH) continue;
        if (w.toLowerCase() === answerLower) continue;
        var p = checkGuess(w, answer);
        var match = true;
        for (var k = 0; k < WORD_LENGTH; k++) if (p[k] !== pat[k]) { match = false; break; }
        if (match) cands.push(w);
      }
      candsByRow.push(cands);
      if (cands.length === 0) return 0;
    }

    function violates(chosen, idx, word) {
      var greens = {}, yEx = {}, req = {}, elim = {};
      for (var pri = 0; pri < idx; pri++) {
        var pw = chosen[pri], pat = rows[pri].pattern;
        var rc = {};
        for (var i = 0; i < WORD_LENGTH; i++) {
          if (pat[i] === 'correct') {
            greens[i] = answer[i];
            rc[pw[i]] = (rc[pw[i]] || 0) + 1;
          } else if (pat[i] === 'present') {
            rc[pw[i]] = (rc[pw[i]] || 0) + 1;
            if (!yEx[i]) yEx[i] = {};
            yEx[i][pw[i]] = true;
          }
        }
        for (var L in rc) if (!req[L] || req[L] < rc[L]) req[L] = rc[L];
        for (var j = 0; j < WORD_LENGTH; j++) if (!answerSet[pw[j]]) elim[pw[j]] = true;
      }
      for (var pos in greens) if (word[pos] !== greens[pos]) return true;
      for (var pos2 in yEx) if (yEx[pos2][word[pos2]]) return true;
      for (var L2 in req) {
        var have = 0;
        for (var i2 = 0; i2 < WORD_LENGTH; i2++) if (word[i2] === L2) have++;
        if (have < req[L2]) return true;
      }
      for (var i3 = 0; i3 < WORD_LENGTH; i3++) if (elim[word[i3]]) return true;
      return false;
    }

    function dfs(chosen, idx) {
      if (idx === rows.length) return true;
      var cands = candsByRow[idx];
      for (var ci = 0; ci < cands.length; ci++) {
        if (++ops > opBudget) return true; // budget exhausted, optimistic
        var w = cands[ci];
        var dup = false;
        for (var pi = 0; pi < chosen.length; pi++) if (chosen[pi] === w) { dup = true; break; }
        if (dup) continue;
        if (violates(chosen, idx, w)) continue;
        chosen.push(w);
        if (dfs(chosen, idx + 1)) { chosen.pop(); return true; }
        chosen.pop();
      }
      return false;
    }

    // Sample up to 80 Row-0 candidates (random-stratified for fairness if more)
    var row0 = candsByRow[0];
    var sampleSize = Math.min(80, row0.length);
    var sampleIndices;
    if (row0.length <= 80) {
      sampleIndices = [];
      for (var s = 0; s < row0.length; s++) sampleIndices.push(s);
    } else {
      // Deterministic stride sample so coverage is stable for the same patterns
      sampleIndices = [];
      var step = row0.length / sampleSize;
      for (var s2 = 0; s2 < sampleSize; s2++) sampleIndices.push(Math.floor(s2 * step));
    }

    var good = 0, total = 0;
    for (var si = 0; si < sampleIndices.length; si++) {
      if (ops > opBudget) break;
      total++;
      if (dfs([row0[sampleIndices[si]]], 1)) good++;
    }
    return total ? good / total : 0;
  }

  function generatePuzzle(words) {
    var numRows = getNumRows();
    // Retry with different answers if we can't fill enough rows
    for (var retries = 0; retries < 10; retries++) {
      var answer = words.targets[Math.floor(Math.random() * words.targets.length)].toUpperCase();
      var result = generatePuzzleForAnswer(answer, words);
      if (result.rows.length === numRows) return result;
    }
    // Fallback — return whatever we got
    var answer = words.targets[Math.floor(Math.random() * words.targets.length)].toUpperCase();
    return generatePuzzleForAnswer(answer, words);
  }

  // ─── Daily Badge ──────────────────────────────────────────────────

  function updateDailyBadge() {
    if (!dailyBadge) return;
    if (currentGameIsDaily) {
      dailyBadge.classList.remove('hidden');
    } else {
      dailyBadge.classList.add('hidden');
    }
  }

  // ─── New Game ───────────────────────────────────────────────────────

  function newGame() {
    if (loading) return;
    loading = true;

    fetchWords(function (err, words) {
      loading = false;
      if (err || !words || words.targets.length === 0) {
        showError('Could not load words. Try refreshing.');
        return;
      }

      // Restore user's saved difficulty (may have been overridden by daily normal mode)
      try { var d = localStorage.getItem(DIFFICULTY_KEY); if (d === 'hard') difficulty = 'hard'; else difficulty = 'normal'; } catch (e) {}

      // Check for saved daily game in progress
      var savedDaily = loadDailyGameState();
      if (savedDaily && savedDaily.rows && savedDaily.rows.length > 0) {
        // Restore in-progress daily game (daily is always normal mode)
        if (savedDaily.difficulty === 'normal' || !savedDaily.difficulty) {
          difficulty = 'normal';
          puzzle = {
            answer: savedDaily.answer,
            rows: savedDaily.rows,
            solved: savedDaily.solved || new Array(savedDaily.rows.length).fill(false),
            playerWords: savedDaily.playerWords || new Array(savedDaily.rows.length).fill('')
          };
          // Restore per-row typed letters
          initRowInputs(puzzle.rows.length);
          if (savedDaily.rowInputs) {
            for (var ri = 0; ri < puzzle.rows.length; ri++) {
              if (savedDaily.rowInputs[ri]) rowInputs[ri] = savedDaily.rowInputs[ri];
            }
          }
          currentGameIsDaily = true;
          // Find first unsolved row
          var firstUnsolved = 0;
          for (var r = 0; r < puzzle.rows.length; r++) {
            if (!puzzle.solved[r]) { firstUnsolved = r; break; }
          }
          switchToRow(firstUnsolved);
          updateDailyBadge();
          updatePuzzleLabel();
          hideWin();
          startTimer();
          renderGrid();
          updateKeyboard();
          console.log('[UnWordle] Restored daily game in progress');
          return;
        } else {
          // Difficulty mismatch — discard saved state
          clearDailyGameState();
        }
      }

      // Always load daily word unless already WON or daily disabled
      if (dailyEnabled && dailyData && !dailyPlayed && dailyData.date && dailyData.word) {
        // Daily is always Normal mode
        var savedDifficulty = difficulty;
        difficulty = 'normal';
        var dailyAnswer = dailyData.word.toUpperCase();
        var dailySuccess = false;
        // Try multiple seeds and pick the one with the highest player-solvability
        // coverage (% of natural Row-0 picks that lead to a valid completion).
        // Total budget capped to keep startup snappy; accept first ≥90% or take best.
        var COVERAGE_TARGET = 0.9;
        var TOTAL_BUDGET_MS = 1500;
        var startMs = Date.now();
        var bestPuzzle = null, bestCoverage = -1, bestRetry = -1;
        var seedRetry = 0;
        for (; seedRetry < 15; seedRetry++) {
          if (Date.now() - startMs > TOTAL_BUDGET_MS) break;
          var seedStr = dailyData.date + '-' + difficulty + (seedRetry > 0 ? '-r' + seedRetry : '');
          var dailyRNG = createSeededRNG(seedStr);
          var attemptPuzzle = generatePuzzleForAnswer(dailyAnswer, words, dailyRNG);
          if (!attemptPuzzle || attemptPuzzle.rows.length !== getNumRows()) continue;
          var remainingMs = TOTAL_BUDGET_MS - (Date.now() - startMs);
          // Op budget proportional to remaining time (~10K ops/100ms on typical phones)
          var opBudget = Math.max(5000, Math.min(60000, remainingMs * 100));
          var coverage = estimatePuzzleCoverage(dailyAnswer, attemptPuzzle.rows, words, opBudget);
          if (coverage > bestCoverage) {
            bestCoverage = coverage;
            bestPuzzle = attemptPuzzle;
            bestRetry = seedRetry;
          }
          if (coverage >= COVERAGE_TARGET) break;
        }
        if (bestPuzzle) {
          puzzle = bestPuzzle;
          dailySuccess = true;
          console.log('[UnWordle] Daily seed retry=' + bestRetry +
                      ' coverage=' + (bestCoverage * 100).toFixed(0) + '% in ' +
                      (Date.now() - startMs) + 'ms');
        }
        if (dailySuccess) {
          currentGameIsDaily = true;
        } else {
          // Failed to generate enough rows for daily — fall back to random
          difficulty = savedDifficulty;
          currentGameIsDaily = false;
          puzzle = generatePuzzle(words);
          console.log('[UnWordle] Daily generation failed, using random');
        }
      } else {
        // Random game (daily already won or disabled)
        currentGameIsDaily = false;
        puzzle = generatePuzzle(words);
      }

      initRowInputs(puzzle.rows.length);
      switchToRow(0);
      updateDailyBadge();
      updatePuzzleLabel();
      hideWin();
      startTimer();
      renderGrid();
      updateKeyboard();

      // Sync difficulty toggle buttons with actual difficulty (daily may override)
      if (diffBtns) {
        diffBtns.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-mode') === difficulty);
        });
      }
    });
  }

  function updatePuzzleLabel() {
    var labelEl = document.getElementById('puzzle-label');
    if (!labelEl) return;
    var n = getNumRows();
    if (currentGameIsDaily) {
      labelEl.textContent = 'Daily Challenge — ' + n + ' words, hints carry forward';
    } else {
      labelEl.textContent = n + ' words — revealed hints must be reused';
    }
  }

  // ─── Timer ──────────────────────────────────────────────────────────

  function startTimer() {
    stopTimer();
    timerStart = Date.now();
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function updateTimerDisplay() {
    if (!timerEl || !timerStart) return;
    var elapsed = Math.floor((Date.now() - timerStart) / 1000);
    timerEl.textContent = formatTime(elapsed);
  }

  function getElapsedSeconds() {
    if (!timerStart) return 0;
    return Math.floor((Date.now() - timerStart) / 1000);
  }

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ─── Rendering ──────────────────────────────────────────────────────

  function renderGrid() {
    if (!puzzle) return;

    gridEl.innerHTML = '';
    gridEl.style.setProperty('--cols', WORD_LENGTH);

    for (var row = 0; row < puzzle.rows.length; row++) {
      var rowData = puzzle.rows[row];
      var rowEl = document.createElement('div');
      rowEl.className = 'wordle-row';

      if (row === currentRow && !puzzle.solved[row]) {
        rowEl.classList.add('active-row');
      }
      if (puzzle.solved[row]) {
        rowEl.classList.add('solved-row');
      }

      for (var col = 0; col < WORD_LENGTH; col++) {
        var tile = document.createElement('div');
        tile.className = 'wordle-tile pattern-' + rowData.pattern[col];

        if (puzzle.solved[row]) {
          tile.textContent = puzzle.playerWords[row][col];
          tile.classList.add('locked');
          // A solved row can be the one flagged by the forward conflict check
          if (row === invalidRow) {
            tile.classList.add('tile-invalid');
          }
        } else {
          // Show persistent typed letters for ALL unsolved rows
          var ri = rowInputs[row];
          if (ri && ri[col]) {
            tile.textContent = ri[col];
            tile.classList.add('has-letter');
            if (lastTypedTile && lastTypedTile.row === row && lastTypedTile.col === col) {
              tile.classList.add('tile-pop');
            }
          }
          if (row === currentRow && col === cursorPos) {
            tile.classList.add('cursor');
          }
          if (row === invalidRow && ri && ri[col]) {
            tile.classList.add('tile-invalid');
          }
        }

        (function (r, c) {
          tile.addEventListener('click', function (e) {
            e.stopPropagation();
            if (puzzle.solved[r]) {
              // Un-solve this row so the player can re-edit it
              puzzle.solved[r] = false;
              rowInputs[r] = puzzle.playerWords[r].split('');
              switchToRow(r);
              cursorPos = c;
              renderGrid();
              if (currentGameIsDaily) saveDailyGameState();
              return;
            }
            if (r !== currentRow) {
              // Switch to clicked row, preserving typed letters
              switchToRow(r);
              cursorPos = c;
            } else {
              cursorPos = c;
            }
            renderGrid();
          });
        })(row, col);

        rowEl.appendChild(tile);
      }

      gridEl.appendChild(rowEl);
    }

    // Answer row
    var answerRowEl = document.createElement('div');
    answerRowEl.className = 'wordle-row answer-row';
    for (var col = 0; col < WORD_LENGTH; col++) {
      var tile = document.createElement('div');
      tile.className = 'wordle-tile answer-tile';
      tile.textContent = puzzle.answer[col];
      answerRowEl.appendChild(tile);
    }
    gridEl.appendChild(answerRowEl);

    // Update keyboard colors after every grid render
    updateKeyboard();

    // Clear so only the just-typed tile pops (not on re-renders)
    lastTypedTile = null;
  }

  // ─── Keyboard ───────────────────────────────────────────────────────

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

  function updateKeyboard() {
    if (!puzzle) return;
    var answerLetters = new Set(puzzle.answer.split(''));

    // Collect used letters from solved rows + all typed inputs
    var usedLetters = new Set();
    for (var r = 0; r < puzzle.rows.length; r++) {
      if (puzzle.solved[r] && puzzle.playerWords[r]) {
        for (var i = 0; i < puzzle.playerWords[r].length; i++) {
          usedLetters.add(puzzle.playerWords[r][i]);
        }
      }
      if (rowInputs[r]) {
        for (var i = 0; i < rowInputs[r].length; i++) {
          if (rowInputs[r][i]) usedLetters.add(rowInputs[r][i]);
        }
      }
    }

    var keys = keyboardEl.querySelectorAll('.kb-key');
    keys.forEach(function (btn) {
      var letter = btn.getAttribute('data-key');
      if (!letter || letter === 'ENTER' || letter === 'BACK') return;
      btn.classList.remove('in-answer', 'kb-used');
      if (answerLetters.has(letter)) {
        btn.classList.add('in-answer');
      } else if (usedLetters.has(letter)) {
        btn.classList.add('kb-used');
      }
      // else: default light grey (unused)
    });
  }

  // ─── Input Handling ─────────────────────────────────────────────────

  function handleKeyPress(key) {
    if (!puzzle) return;

    var allDone = puzzle.solved.every(function (s) { return s; });
    if (allDone) return;

    if (puzzle.solved[currentRow]) {
      // Un-solve current row so the player can re-edit it
      puzzle.solved[currentRow] = false;
      rowInputs[currentRow] = puzzle.playerWords[currentRow].split('');
      currentInput = rowInputs[currentRow];
      cursorPos = WORD_LENGTH; // place cursor at end
      renderGrid();
      if (currentGameIsDaily) saveDailyGameState();
      return;
    }

    // Clear red rings on any keystroke
    if (invalidRow !== -1) {
      invalidRow = -1;
      if (invalidTimeout) { clearTimeout(invalidTimeout); invalidTimeout = null; }
    }

    if (key === 'ENTER') {
      submitGuess();
    } else if (key === 'BACK') {
      lastTypedTile = null;
      if (cursorPos < WORD_LENGTH && currentInput[cursorPos]) {
        currentInput[cursorPos] = '';
      } else if (cursorPos > 0) {
        cursorPos--;
        currentInput[cursorPos] = '';
      } else if (cursorPos === WORD_LENGTH) {
        cursorPos = WORD_LENGTH - 1;
        currentInput[cursorPos] = '';
      }
      renderGrid();
    } else if (/^[A-Z]$/.test(key)) {
      if (cursorPos < WORD_LENGTH) {
        lastTypedTile = { row: currentRow, col: cursorPos };
        currentInput[cursorPos] = key;
        advanceCursor();
        renderGrid();
        // Auto-submit when row is full
        if (isInputFull()) {
          submitGuess();
        }
      }
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Enter') { e.preventDefault(); handleKeyPress('ENTER'); }
    else if (e.key === 'Backspace') { e.preventDefault(); handleKeyPress('BACK'); }
    else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); handleKeyPress(e.key.toUpperCase()); }
  });

  // ─── Hard Mode Constraint Check ────────────────────────────────────

  function ordinalSuffix(n) {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return n + 'th';
  }

  // Accumulate the hard-mode constraints revealed by every solved row above
  // `uptoRow`. `overrideRow`/`overrideWord` let the caller pretend a row holds a
  // word that hasn't been committed yet (used for the forward check below).
  function collectConstraints(uptoRow, overrideRow, overrideWord) {
    var greens = {};         // position -> letter (from answer at green positions)
    var requiredCounts = {}; // letter -> min count required (multiset must-contain)
    var yellowExcl = {};     // position -> {letter: true} — yellow letter can't repeat at same position
    var eliminated = {};     // gray letters already used (can't reuse)

    // Build set of answer letters (these are never "eliminated")
    var answerSet = {};
    for (var i = 0; i < WORD_LENGTH; i++) answerSet[puzzle.answer[i]] = true;

    for (var r = 0; r < uptoRow; r++) {
      var pw = (r === overrideRow) ? overrideWord : (puzzle.solved[r] ? puzzle.playerWords[r] : null);
      if (!pw) continue;
      var pattern = puzzle.rows[r].pattern;
      // Tally this row's letter reveal counts (greens + yellows)
      var rowCounts = {};
      for (var i = 0; i < WORD_LENGTH; i++) {
        if (pattern[i] === 'correct') {
          greens[i] = puzzle.answer[i];
          rowCounts[pw[i]] = (rowCounts[pw[i]] || 0) + 1;
        } else if (pattern[i] === 'present') {
          rowCounts[pw[i]] = (rowCounts[pw[i]] || 0) + 1;
          if (!yellowExcl[i]) yellowExcl[i] = {};
          yellowExcl[i][pw[i]] = true;
        }
      }
      // Max-merge into requiredCounts
      for (var L in rowCounts) {
        if (!requiredCounts[L] || requiredCounts[L] < rowCounts[L]) {
          requiredCounts[L] = rowCounts[L];
        }
      }
      // Track gray letters (not in answer) for elimination
      for (var i = 0; i < WORD_LENGTH; i++) {
        if (!answerSet[pw[i]]) {
          eliminated[pw[i]] = true;
        }
      }
    }

    return { greens: greens, requiredCounts: requiredCounts, yellowExcl: yellowExcl, eliminated: eliminated };
  }

  // Returns a violation descriptor for `word` against `cons`, or null if it's legal.
  function findViolation(word, cons) {
    // Green constraints: must have specific letter at specific position
    for (var pos in cons.greens) {
      var p = parseInt(pos);
      if (word[p] !== cons.greens[pos]) {
        return { type: 'green', pos: p, letter: cons.greens[pos] };
      }
    }

    // Yellow position exclusion: can't put letter back where it was yellow
    for (var pos in cons.yellowExcl) {
      var p = parseInt(pos);
      if (cons.yellowExcl[pos][word[p]]) {
        return { type: 'yellowPos', pos: p, letter: word[p] };
      }
    }

    // Multiset must-contain: word must include each known letter ≥ N times
    for (var letter in cons.requiredCounts) {
      var need = cons.requiredCounts[letter];
      var have = 0;
      for (var j = 0; j < WORD_LENGTH; j++) if (word[j] === letter) have++;
      if (have < need) {
        return { type: 'missing', letter: letter, need: need };
      }
    }

    // Gray elimination: can't reuse gray letters from previous rows
    for (var i = 0; i < WORD_LENGTH; i++) {
      if (cons.eliminated[word[i]]) {
        return { type: 'eliminated', letter: word[i] };
      }
    }

    return null;
  }

  // rowNum is 1-based, or 0 when the violation is on the word being submitted.
  function describeViolation(v, rowNum) {
    if (rowNum) {
      var head = 'Row ' + rowNum + ': ';
      if (v.type === 'green') return head + ordinalSuffix(v.pos + 1) + ' must be ' + v.letter;
      if (v.type === 'yellowPos') return head + v.letter + " can't be at " + ordinalSuffix(v.pos + 1);
      if (v.type === 'missing') return head + 'needs ' + (v.need > 1 ? v.need + ' ' + v.letter + "'s" : v.letter);
      return head + v.letter + ' is eliminated';
    }
    if (v.type === 'green') return ordinalSuffix(v.pos + 1) + ' letter must be ' + v.letter;
    if (v.type === 'yellowPos') return v.letter + ' was already ruled out at ' + ordinalSuffix(v.pos + 1) + ' position';
    if (v.type === 'missing') {
      if (v.need === 1) return 'Guess must contain ' + v.letter;
      return 'Guess must contain ' + v.need + ' ' + v.letter + "'s";
    }
    return v.letter + ' was already eliminated';
  }

  // Backward check: does `word` obey the hints revealed by the solved rows ABOVE it?
  function checkHardModeViolation(word) {
    var v = findViolation(word, collectConstraints(currentRow, -1, null));
    return v ? describeViolation(v, 0) : null;
  }

  // Forward check: rows can be solved in any order, so a word entered on an upper
  // row also has to leave every already-solved row BELOW it legal. Without this,
  // filling the grid bottom-up skipped hard-mode validation entirely.
  // Returns { msg, row } for the first conflicting row, or null.
  function checkLaterRowConflicts(word) {
    for (var b = currentRow + 1; b < puzzle.rows.length; b++) {
      if (!puzzle.solved[b]) continue;
      var cons = collectConstraints(b, currentRow, word);
      var v = findViolation(puzzle.playerWords[b], cons);
      if (v) return { msg: describeViolation(v, b + 1), row: b };
    }
    return null;
  }

  // ─── Guess Submission ───────────────────────────────────────────────

  function submitGuess() {
    if (submitCooldown || loading || !puzzle) return;

    if (!isInputFull()) return;
    var word = getInputWord().toUpperCase();

    if (!wordCache || !wordCache.dictionary.has(word.toLowerCase())) {
      showError('Not a valid word');
      return;
    }

    // Enforce constraints: must reuse revealed hints from previous rows (both modes)
    var hardError = checkHardModeViolation(word);
    if (hardError) {
      showError(hardError);
      return;
    }

    // ...and must not invalidate any row already solved further down the grid
    var laterConflict = checkLaterRowConflicts(word);
    if (laterConflict) {
      showError(laterConflict.msg, laterConflict.row);
      return;
    }

    var actualPattern = checkGuess(word, puzzle.answer);
    var expectedPattern = puzzle.rows[currentRow].pattern;

    var matches = true;
    for (var i = 0; i < WORD_LENGTH; i++) {
      if (actualPattern[i] !== expectedPattern[i]) {
        matches = false;
        break;
      }
    }

    if (!matches) {
      showError("Colors don't match the pattern");
      return;
    }

    // Valid! Lock in the row
    puzzle.solved[currentRow] = true;
    puzzle.playerWords[currentRow] = word;

    reportLibraryWord(word, 'unwordle-sp');

    var allSolved = puzzle.solved.every(function (s) { return s; });

    if (!allSolved) {
      // Find next unsolved row and switch to it
      for (var r = 0; r < getNumRows(); r++) {
        if (!puzzle.solved[r]) { switchToRow(r); break; }
      }
      // Save daily game state after each row solve (not on win)
      if (currentGameIsDaily) saveDailyGameState();
    }

    renderGrid();

    if (allSolved) {
      stopTimer();
      var elapsed = getElapsedSeconds();
      recordResult(puzzle.answer, elapsed);
      showWin(puzzle.answer, elapsed);

      // Mark daily as completed
      if (currentGameIsDaily && dailyData && dailyData.date) {
        saveServerCompletion(dailyData.date);
        try { localStorage.setItem(DAILY_DATE_KEY, dailyData.date); } catch (e) {}
        clearDailyGameState();
      }
    }

    submitCooldown = true;
    setTimeout(function () { submitCooldown = false; }, 300);
  }

  // ─── Library Word Reporting ─────────────────────────────────────────

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

  // ─── Error Toast ────────────────────────────────────────────────────

  function showError(msg, highlightRow) {
    if (errorTimeout) clearTimeout(errorTimeout);
    errorToast.textContent = msg;
    errorToast.className = 'error-toast shake';
    errorTimeout = setTimeout(function () {
      errorToast.classList.add('hidden');
      errorToast.classList.remove('shake');
    }, 2500);

    // Red rings on the offending row (the current row unless told otherwise)
    if (invalidTimeout) clearTimeout(invalidTimeout);
    invalidRow = (typeof highlightRow === 'number') ? highlightRow : currentRow;
    renderGrid();
    invalidTimeout = setTimeout(function () {
      invalidRow = -1;
      renderGrid();
    }, 2500);
  }

  // ─── Win Card (shared Word Tycoon WinCard component) ────────────────

  // ─── Daily share ─────────────────────────────────────────────────────────
  var shareText = '';
  function shareResult() {
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

  // Winner identity from the hub session (/api/me/session proxy).
  // Cosmetics/perks/total-wins are lazy-fetched by WinCard; guests get no wins chip.
  function buildWinner() {
    if (!userSession) return { displayName: 'You', platform: 'web' };
    var provider = userSession.provider || 'discord';
    return {
      displayName: userSession.displayName || userSession.globalName || userSession.username,
      username: userSession.username,
      // 'web', not the OAuth provider: WT stores a hub login as a `web` player
      // row, so a 'google'/'github' platform resolved to no cosmetics at all.
      // The avatar proxy still keys on the provider — that's its cache key.
      platform: 'web',
      platformUserId: userSession.id,
      discordId: provider === 'discord' ? userSession.id : undefined,
      profilePic: 'https://wordtycoon.live/api/avatar/' + provider + '/' + userSession.id
    };
  }

  function showWin(word, elapsed) {
    var timeStr = formatTime(elapsed);
    shareText = '🔄 UnWordle Daily' + (currentGameIsDaily && dailyData && dailyData.date ? ' ' + dailyData.date : '') +
      ' — solved in ' + timeStr + '\nhttps://wordtycoon.live/unwordle/solo/';
    var actions = [];
    if (currentGameIsDaily) actions.push({ label: 'Share', primary: true, onClick: shareResult });
    actions.push({ label: 'Play Again', onClick: function () { hideWin(); newGame(); } });
    // Daily used a 2s pause + 10s countdown; endless mode auto-restarted
    // after AUTO_RESTART_SECONDS — preserve both via autoHideMs/onHide.
    var hideMs = currentGameIsDaily ? 12000 : AUTO_RESTART_SECONDS * 1000;
    if (window.WinCard) {
      WinCard.showSolo({
        game: 'unwordle',
        gameName: 'UnWordle',
        word: word,
        guessCount: getNumRows(),
        winner: buildWinner(),
        actions: actions,
        autoHideMs: hideMs,
        onHide: function () { newGame(); }
      });
    } else {
      // WinCard script failed to load — keep the auto-restart going
      setTimeout(function () { newGame(); }, hideMs);
    }
  }

  function hideWin() {
    if (window.WinCard) window.WinCard.hide();
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  function loadStats() {
    try {
      var raw = localStorage.getItem(getStatsKey());
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { solved: 0, totalTime: 0, bestTime: null, streak: 0, history: [] };
  }

  function saveStats(stats) {
    try { localStorage.setItem(getStatsKey(), JSON.stringify(stats)); } catch (e) {}
  }

  function recordResult(word, elapsed) {
    var stats = loadStats();
    stats.solved++;
    stats.totalTime += elapsed;
    if (stats.bestTime === null || elapsed < stats.bestTime) stats.bestTime = elapsed;
    stats.streak++;
    stats.history.unshift({
      word: word,
      time: elapsed,
      mode: difficulty,
      daily: currentGameIsDaily,
      timestamp: new Date().toISOString()
    });
    if (stats.history.length > 100) stats.history.length = 100;
    saveStats(stats);
    renderStats();
  }

  function renderStats() {
    var stats = loadStats();
    var solvedEl = document.getElementById('stat-solved');
    var avgEl = document.getElementById('stat-avg');
    var bestEl = document.getElementById('stat-best');
    var streakEl = document.getElementById('stat-streak');
    var historyEl = document.getElementById('stats-history');

    if (solvedEl) solvedEl.textContent = stats.solved;
    if (avgEl) avgEl.textContent = stats.solved > 0
      ? formatTime(Math.floor(stats.totalTime / stats.solved)) : '-';
    if (bestEl) bestEl.textContent = stats.bestTime !== null ? formatTime(stats.bestTime) : '-';
    if (streakEl) streakEl.textContent = stats.streak;

    if (historyEl) {
      var recent = (stats.history || []).slice(0, 10);
      if (recent.length === 0) {
        historyEl.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:0.7rem;padding:8px 0">No puzzles yet</div>';
      } else {
        historyEl.innerHTML = recent.map(function (h) {
          var badge = h.mode === 'hard' ? '<span class="stats-h-badge">H</span>' : '';
          var dailyTag = h.daily ? '<span class="stats-h-badge" style="background:#ffab00">D</span>' : '';
          return '<div class="stats-h-entry">' +
            '<span class="stats-h-word">' + (h.word || '???') + badge + dailyTag + '</span>' +
            '<span class="stats-h-time">' + formatTime(h.time) + '</span>' +
            '</div>';
        }).join('');
      }
    }
  }

  // ─── Stats Toggle ───────────────────────────────────────────────────

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

  // ─── New Puzzle Button ──────────────────────────────────────────────

  if (newPuzzleBtn) {
    newPuzzleBtn.addEventListener('click', function () {
      var stats = loadStats();
      stats.streak = 0;
      saveStats(stats);
      renderStats();
      // Clear in-progress daily state (will regenerate fresh daily if not won)
      clearDailyGameState();
      currentGameIsDaily = false;
      updateDailyBadge();
      newGame();
    });
  }

  // ─── Init ───────────────────────────────────────────────────────────

  var completionsReady = false;
  var dailyReady = false;
  var settingsReady = false;
  var initStarted = false;

  function tryStartInit() {
    if (initStarted || !completionsReady || !dailyReady || !settingsReady) return;
    dailyPlayed = !!dailyData && (localStorage.getItem(DAILY_DATE_KEY) === dailyData.date || !!serverCompletedDates[dailyData.date]);
    try { difficulty = localStorage.getItem(DIFFICULTY_KEY) === 'hard' ? 'hard' : 'normal'; } catch (_) {}
    initStarted = true;
    getCompletionRecovery().recover();
    startGame();
  }

  function startGame() {
    // In daily launch mode, try to load server state if no local state
    if (launchMode === 'daily' && !localStorage.getItem(DAILY_STATE_KEY)) {
      loadGameStateFromServer(function(serverState) {
        if (serverState) {
          try {
            localStorage.setItem(DAILY_STATE_KEY, JSON.stringify(serverState));
          } catch(e) {}
        }
        newGame();
      });
    } else {
      newGame();
    }
  }

  buildKeyboard();
  renderStats();

  // Fetch session, then server completions
  fetch(getAuthBaseURL() + '/api/me/session', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(function (r) { return r.json(); }).then(function (data) {
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

  // Fetch daily word in parallel
  fetchDaily(function() {
    dailyReady = true;
    tryStartInit();
  });

  // Fetch settings in parallel (check if daily is enabled)
  fetchSettings(function() {
    settingsReady = true;
    tryStartInit();
  });

})();
