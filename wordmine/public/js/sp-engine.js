/**
 * Word Mine — SP Engine
 * Mine selector, game play, depth unlocking, word validation, save/restore.
 */
(function () {
  'use strict';

  // ─── Constants (mirror mine-engine.js) ──────────────────────────────────────

  var DEPTH_TIERS = [
    { id: 'surface', label: 'Surface', ore: 'Coal',    icon: '\u2B1B', color: '#6b7280', xp: 2 },
    { id: 'shallow', label: 'Shallow', ore: 'Iron',    icon: '\uD83D\uDFEB', color: '#a1724a', xp: 2 },
    { id: 'medium',  label: 'Medium',  ore: 'Silver',  icon: '\u26AA', color: '#94a3b8', xp: 2 },
    { id: 'deep',    label: 'Deep',    ore: 'Gold',    icon: '\uD83D\uDFE1', color: '#f59e0b', xp: 3 },
    { id: 'core',    label: 'Core',    ore: 'Diamond', icon: '\uD83D\uDC8E', color: '#06b6d4', xp: 3 },
  ];

  var TIER_IDS = ['surface', 'shallow', 'medium', 'deep', 'core'];

  var TIER_XP = {};
  DEPTH_TIERS.forEach(function (t) { TIER_XP[t.id] = t.xp; });

  var TIER_MAP = {};
  DEPTH_TIERS.forEach(function (t) { TIER_MAP[t.id] = t; });
  // Hidden tier display info (valid guesses not shown in counts)
  TIER_MAP.hidden = { id: 'hidden', label: 'Ultra Rare', ore: 'Fossil', icon: '\uD83E\uDEA8', color: '#7c3aed', xp: 4 };

  var DEPTH_THRESHOLDS_DEFAULT = { surface: 5, shallow: 4, medium: 3, deep: 2 };

  // ─── State ──────────────────────────────────────────────────────────────────

  var mineList = [];
  var dailyMine = null;
  var weeklyMine = null;

  // Current game
  var currentMine = null;
  var currentMineId = null;
  var isDaily = false;
  var isWeekly = false;
  var letters = [];
  var initialIndices = [];
  var bonusOrder = [];
  var revealedBonusCount = 0;
  var currentDepth = 'surface';
  var depthProgress = { surface: 0, shallow: 0, medium: 0, deep: 0, core: 0 };
  var depthThresholds = null; // Per-game dynamic thresholds, set by startGame
  var unlockedDepths = ['surface'];
  var foundWords = {};
  var totalXP = 0;
  var wordsByTier = null;
  var mineDictionary = null;  // Set of valid words filtered to mine's 12 letters
  var frequencyData = null;   // { word: zipfScore }
  var currentWord = '';
  var letterDisplayOrder = [];
  var depthClearShown = false;

  // Save keys
  var STATS_KEY = 'wordmine_sp_stats';
  var GAME_KEY = 'wordmine_sp_game';

  // ─── DOM Refs ───────────────────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };

  var elMineSelector, elGameScreen;
  var elMineGrid, elRandomBtn;
  var elBackBtn, elMineName, elDailyBadge, elXPCount;
  var elLetterRow1, elLetterRow2, elLetterRow3;
  var elCurrentWord, elBtnDelete, elBtnShuffle, elBtnDig;
  var elFeedback, elDepthTiers;
  var elFoundCount, elWordsTotal, elFoundList;

  // ─── Init ───────────────────────────────────────────────────────────────────

  function init() {
    elMineSelector = $('mine-selector');
    elGameScreen   = $('game-screen');
    elMineGrid     = $('mine-grid');
    elRandomBtn    = $('random-mine-btn');
    elBackBtn      = $('back-btn');
    elMineName     = $('mine-name');
    elDailyBadge   = $('daily-badge');
    elXPCount      = $('xp-count');
    elLetterRow1   = $('letter-row-1');
    elLetterRow2   = $('letter-row-2');
    elLetterRow3   = $('letter-row-3');
    elCurrentWord  = $('current-word');
    elBtnDelete    = $('btn-delete');
    elBtnShuffle   = $('btn-shuffle');
    elBtnDig       = $('btn-dig');
    elFeedback     = $('feedback');
    elDepthTiers   = $('depth-tiers');
    elFoundCount   = $('found-count');
    elWordsTotal   = $('words-total');
    elFoundList    = $('found-list');

    // Button events
    elRandomBtn.addEventListener('click', pickRandomMine);
    elBackBtn.addEventListener('click', backToSelector);
    elBtnDelete.addEventListener('click', deleteLetter);
    elBtnShuffle.addEventListener('click', shuffleLetters);
    elBtnDig.addEventListener('click', submitWord);

    // Keyboard
    document.addEventListener('keydown', onKeyDown);

    // Theme toggle (both selector and game headers)
    var themeBtns = document.querySelectorAll('#theme-toggle-selector, #theme-toggle-game');
    for (var i = 0; i < themeBtns.length; i++) {
      themeBtns[i].addEventListener('click', function () {
        var html = document.documentElement;
        var current = html.getAttribute('data-theme');
        var next = current === 'light' ? 'dark' : 'light';
        if (next === 'dark') html.removeAttribute('data-theme');
        else html.setAttribute('data-theme', next);
        try { localStorage.setItem('wordmine-theme', next === 'dark' ? '' : next); } catch(e) {}
      });
    }

    // Load data
    loadData();
  }

  function onKeyDown(e) {
    if (elGameScreen.style.display === 'none') return;
    if (isWinCardOpen()) return;

    if (e.key === 'Enter') { submitWord(); e.preventDefault(); }
    else if (e.key === 'Backspace') { deleteLetter(); e.preventDefault(); }
    else if (/^[a-zA-Z]$/.test(e.key)) { typeLetter(e.key.toLowerCase()); }
  }

  // ─── Data Loading ───────────────────────────────────────────────────────────

  function loadData() {
    var ready = { mines: false, daily: false, weekly: false };

    fetch('/api/mines')
      .then(function (r) { return r.json(); })
      .then(function (data) { mineList = data || []; })
      .catch(function () { mineList = []; })
      .finally(function () { ready.mines = true; check(); });

    fetch('/api/sp/daily')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { dailyMine = data; })
      .catch(function () { dailyMine = null; })
      .finally(function () { ready.daily = true; check(); });

    fetch('/api/sp/weekly')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { weeklyMine = data; })
      .catch(function () { weeklyMine = null; })
      .finally(function () { ready.weekly = true; check(); });

    function check() {
      if (ready.mines && ready.daily && ready.weekly) resumeOrShowSelector();
    }
  }

  // ─── Resume / Selector ──────────────────────────────────────────────────────

  function resumeOrShowSelector() {
    var saved = loadGameState();
    if (saved && saved.mineId) {
      // Staleness checks
      if (saved.isDaily && dailyMine) {
        if (saved.mineId !== 'sp-daily-' + dailyMine.date) {
          console.log('[SP] Discarding stale daily save');
          clearGameState();
          showSelector();
          return;
        }
      }
      if (saved.isWeekly && weeklyMine) {
        if (saved.mineId !== 'sp-weekly-' + weeklyMine.weekStart) {
          console.log('[SP] Discarding stale weekly save');
          clearGameState();
          showSelector();
          return;
        }
      }
      restoreGame(saved);
      return;
    }
    showSelector();
  }

  // ─── Mine Selector ──────────────────────────────────────────────────────────

  function showSelector() {
    elMineSelector.style.display = '';
    elGameScreen.style.display = 'none';
    renderMineGrid();
  }

  function renderMineGrid() {
    elMineGrid.innerHTML = '';
    var stats = loadStats();
    var completed = stats.completedMines || {};
    var progress = stats.puzzleProgress || {};

    // Daily card
    if (dailyMine) {
      var dId = 'sp-daily-' + dailyMine.date;
      elMineGrid.appendChild(createMineCard({
        id: dId, name: dailyMine.name || 'Daily Mine', theme: 'Daily',
        badge: 'daily', completed: !!completed[dId], progress: progress[dId],
      }));
    }

    // Weekly card
    if (weeklyMine) {
      var wId = 'sp-weekly-' + weeklyMine.weekStart;
      elMineGrid.appendChild(createMineCard({
        id: wId, name: weeklyMine.name || 'Weekly Mine', theme: 'Weekly',
        badge: 'weekly', completed: !!completed[wId], progress: progress[wId],
      }));
    }

    // Pool mines
    for (var i = 0; i < mineList.length; i++) {
      var m = mineList[i];
      var mid = String(m.id);
      var isArchDaily = mid.startsWith('sp-daily-');
      var isArchWeekly = mid.startsWith('sp-weekly-');

      elMineGrid.appendChild(createMineCard({
        id: mid, name: m.name, theme: m.theme,
        badge: null,
        archived: isArchDaily ? 'daily' : isArchWeekly ? 'weekly' : null,
        completed: !!completed[mid],
        progress: progress[mid],
        num: (!isArchDaily && !isArchWeekly) ? (i + 1) : null,
      }));
    }
  }

  function createMineCard(opts) {
    var div = document.createElement('div');
    div.className = 'mine-card';
    if (opts.completed) div.classList.add('completed');
    if (opts.badge === 'daily')  div.classList.add('daily-card');
    if (opts.badge === 'weekly') div.classList.add('weekly-card');
    if (opts.archived === 'daily')  div.classList.add('archived-daily');
    if (opts.archived === 'weekly') div.classList.add('archived-weekly');

    var html = '';

    // Badge
    if (opts.badge) {
      html += '<div class="challenge-badge ' + opts.badge + '">' +
        (opts.badge === 'daily' ? '\u2600 TODAY' : '\uD83D\uDCC5 THIS WEEK') + '</div>';
    }
    if (opts.archived === 'daily')  html += '<div class="mine-num">\u2600 PAST DAILY</div>';
    if (opts.archived === 'weekly') html += '<div class="mine-num">\uD83D\uDCC5 PAST WEEKLY</div>';
    if (opts.num) html += '<div class="mine-num">MINE #' + opts.num + '</div>';

    html += '<div class="mine-card-name">' + esc(opts.name) + '</div>';
    html += '<div class="mine-card-theme">' + esc(opts.theme) + '</div>';

    if (opts.completed) {
      html += '<div class="mine-pct complete">COMPLETE \u2713</div>';
    } else if (opts.progress && opts.progress.total) {
      var pct = Math.round((opts.progress.found / opts.progress.total) * 100);
      html += '<div class="mine-pct">' + pct + '% \u2014 ' +
        opts.progress.found + '/' + opts.progress.total + '</div>';
    }

    div.innerHTML = html;
    div.addEventListener('click', function () { loadMineById(opts.id); });
    return div;
  }

  // ─── Load Mine ──────────────────────────────────────────────────────────────

  function loadMineById(mineId) {
    var id = String(mineId);

    // Daily
    if (dailyMine && id === 'sp-daily-' + dailyMine.date) {
      startGame(dailyMine, id, true, false);
      return;
    }
    // Weekly
    if (weeklyMine && id === 'sp-weekly-' + weeklyMine.weekStart) {
      startGame(weeklyMine, id, false, true);
      return;
    }

    // Pool mine — fetch full data with pre-solved words
    fetch('/api/mines/' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { showFeedback('Mine not found', 'error'); return; }
        startGame(data, id, false, false);
      })
      .catch(function () { showFeedback('Failed to load mine', 'error'); });
  }

  function pickRandomMine() {
    if (mineList.length === 0) { showFeedback('No mines available', 'error'); return; }
    var stats = loadStats();
    var completed = stats.completedMines || {};

    // Prefer uncompleted pool mines (skip archived daily/weekly)
    var pool = mineList.filter(function (m) {
      var mid = String(m.id);
      return !completed[mid] && !mid.startsWith('sp-daily-') && !mid.startsWith('sp-weekly-');
    });
    if (pool.length === 0) pool = mineList.filter(function (m) {
      var mid = String(m.id);
      return !mid.startsWith('sp-daily-') && !mid.startsWith('sp-weekly-');
    });
    if (pool.length === 0) pool = mineList;

    var pick = pool[Math.floor(Math.random() * pool.length)];
    loadMineById(pick.id);
  }

  // ─── Start Game ─────────────────────────────────────────────────────────────

  function startGame(mineData, mineId, daily, weekly) {
    currentMine   = mineData;
    currentMineId = mineId;
    isDaily       = daily;
    isWeekly      = weekly;

    letters        = mineData.letters.map(function (l) { return l.toLowerCase(); });
    initialIndices = mineData.initialIndices;
    bonusOrder     = mineData.bonusOrder;
    wordsByTier    = mineData.wordsByTier;

    // Build word lookup for fast validation: word → tier
    buildWordLookup();

    // Fetch dictionary + frequency for fallback validation
    var mineLetterSet = new Set(letters);
    fetch('/api/sp/dictionary').then(function(r) { return r.json(); }).then(function(dict) {
      mineDictionary = new Set();
      for (var i = 0; i < dict.length; i++) {
        var w = dict[i].toLowerCase();
        if (w.length >= 4 && wordFormedFrom(w, mineLetterSet)) mineDictionary.add(w);
      }
    });
    fetch('/api/sp/frequency').then(function(r) { return r.json(); }).then(function(freq) {
      frequencyData = freq;
    });

    // Per-game dynamic thresholds: use server-provided if available, else compute from word counts
    if (wordsByTier && wordsByTier.thresholds) {
      depthThresholds = {};
      for (var k in wordsByTier.thresholds) depthThresholds[k] = wordsByTier.thresholds[k];
    } else if (wordsByTier && wordsByTier.totals) {
      // Compute from actual word counts per tier (find all words = threshold)
      depthThresholds = {};
      for (var ti = 0; ti < TIER_IDS.length; ti++) {
        if (TIER_IDS[ti] !== 'core') depthThresholds[TIER_IDS[ti]] = wordsByTier.totals[TIER_IDS[ti]] || 0;
      }
    } else {
      depthThresholds = { surface: 5, shallow: 4, medium: 3, deep: 2 };
    }

    // Reset game state
    revealedBonusCount = 0;
    currentDepth       = 'surface';
    depthProgress      = { surface: 0, shallow: 0, medium: 0, deep: 0, core: 0 };
    unlockedDepths     = ['surface'];
    foundWords         = {};
    totalXP            = 0;
    currentWord        = '';
    depthClearShown    = false;

    // Auto-skip tiers with 0 target words (nothing to find)
    while (currentDepth !== 'core') {
      var th = depthThresholds[currentDepth];
      if (th === 0) {
        var skipIdx = TIER_IDS.indexOf(currentDepth);
        if (skipIdx >= 0 && skipIdx < TIER_IDS.length - 1) {
          unlockedDepths.push(TIER_IDS[skipIdx + 1]);
          currentDepth = TIER_IDS[skipIdx + 1];
          if (revealedBonusCount < bonusOrder.length) revealedBonusCount++;
        } else break;
      } else break;
    }

    // Display order: initial letters then bonus letters
    letterDisplayOrder = initialIndices.concat(bonusOrder);

    // Show game screen
    elMineSelector.style.display = 'none';
    elGameScreen.style.display = '';

    // Header
    elMineName.textContent = mineData.name || 'Mine';
    if (daily) {
      elDailyBadge.textContent = 'DAILY';
      elDailyBadge.className = 'daily-badge';
    } else if (weekly) {
      elDailyBadge.textContent = 'WEEKLY';
      elDailyBadge.className = 'daily-badge weekly-badge';
    } else {
      elDailyBadge.className = 'daily-badge hidden';
    }
    elXPCount.textContent = '0';

    // Render
    renderLetters();
    renderDepthMeter();
    renderFoundWords();
    renderCurrentWord();
    updateWordCount();
  }

  // ─── Word Lookup ────────────────────────────────────────────────────────────

  var wordLookup = {}; // word → tier

  function buildWordLookup() {
    wordLookup = {};
    for (var t = 0; t < TIER_IDS.length; t++) {
      var tid = TIER_IDS[t];
      var words = wordsByTier[tid] || [];
      for (var i = 0; i < words.length; i++) {
        wordLookup[words[i].toLowerCase()] = tid;
      }
    }
    // Include hidden (ultra rare) words in lookup
    var hiddenWords = wordsByTier.hidden || [];
    for (var h = 0; h < hiddenWords.length; h++) {
      wordLookup[hiddenWords[h].toLowerCase()] = 'hidden';
    }
  }

  // ─── Dictionary Fallback Helpers ────────────────────────────────────────────

  function wordFormedFrom(word, letterSet) {
    for (var i = 0; i < word.length; i++) {
      if (!letterSet.has(word[i])) return false;
    }
    return true;
  }

  function classifyWordSP(word) {
    if (!frequencyData) return 'deep';
    var zipf = frequencyData[word.toLowerCase()];
    if (zipf !== undefined) {
      if (zipf >= 5.0) return 'surface';
      if (zipf >= 4.0) return 'shallow';
      if (zipf >= 3.0) return 'medium';
      return 'deep';
    }
    // No frequency data — ultra rare
    return 'hidden';
  }

  // ─── Letters ────────────────────────────────────────────────────────────────

  function getAvailableIndices() {
    var available = new Set(initialIndices);
    for (var i = 0; i < revealedBonusCount; i++) {
      available.add(bonusOrder[i]);
    }
    return available;
  }

  function getAvailableLetterSet() {
    var available = getAvailableIndices();
    var set = new Set();
    available.forEach(function (idx) { set.add(letters[idx]); });
    return set;
  }

  function renderLetters() {
    elLetterRow1.innerHTML = '';
    elLetterRow2.innerHTML = '';
    elLetterRow3.innerHTML = '';

    var available = getAvailableIndices();

    for (var di = 0; di < letterDisplayOrder.length; di++) {
      var li = letterDisplayOrder[di];
      var ch = letters[li];
      var isBonus = bonusOrder.indexOf(li) >= 0;
      var isRevealed = available.has(li);

      var cell = document.createElement('div');
      cell.className = 'letter-cell';
      cell.dataset.letterIdx = li;

      if (isBonus && !isRevealed) {
        cell.classList.add('locked');
        cell.textContent = '?';
      } else {
        cell.classList.add('revealed');
        cell.textContent = ch.toUpperCase();
        cell.addEventListener('click', (function (c) {
          return function () { typeLetter(c); };
        })(ch));
      }

      // 6+5+4 upside-down pyramid layout
      if (di < 6)        elLetterRow1.appendChild(cell);
      else if (di < 11)  elLetterRow2.appendChild(cell);
      else               elLetterRow3.appendChild(cell);
    }
  }

  function typeLetter(ch) {
    var available = getAvailableLetterSet();
    if (!available.has(ch.toLowerCase())) return;
    currentWord += ch.toLowerCase();
    renderCurrentWord();
  }

  function deleteLetter() {
    if (currentWord.length > 0) {
      currentWord = currentWord.slice(0, -1);
      renderCurrentWord();
    }
  }

  function shuffleLetters() {
    // Shuffle only the 11 initial positions (rows 1+2); bonus row stays in place
    var initial = letterDisplayOrder.slice(0, 11);
    for (var i = initial.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = initial[i]; initial[i] = initial[j]; initial[j] = tmp;
    }
    letterDisplayOrder = initial.concat(letterDisplayOrder.slice(11));
    renderLetters();
  }

  function renderCurrentWord() {
    elCurrentWord.textContent = currentWord.toUpperCase();
  }

  // ─── Word Submission ────────────────────────────────────────────────────────

  function validateWord(word) {
    word = word.toLowerCase().trim();

    if (word.length < 4)
      return { valid: false, reason: 'Too short (min 4 letters)' };

    if (foundWords[word])
      return { valid: false, reason: 'Already found!' };

    // Check all characters are in available letters
    var available = getAvailableLetterSet();
    for (var i = 0; i < word.length; i++) {
      if (!available.has(word[i]))
        return { valid: false, reason: 'Letter \'' + word[i].toUpperCase() + '\' not available' };
    }

    // Check against pre-solved word list, then dictionary fallback
    var tier = wordLookup[word];
    if (!tier) {
      if (mineDictionary && mineDictionary.has(word)) {
        tier = classifyWordSP(word);
      } else {
        return { valid: false, reason: 'Not a valid word' };
      }
    }

    var xp = tier === 'hidden' ? 4 : TIER_XP[tier];
    return { valid: true, tier: tier, xp: xp };
  }

  function submitWord() {
    if (!currentWord) return;

    var result = validateWord(currentWord);

    if (!result.valid) {
      showFeedback(result.reason, 'error');
      shakeInput();
      currentWord = '';
      renderCurrentWord();
      return;
    }

    var word  = currentWord.toLowerCase();
    var tier  = result.tier;
    var xp    = result.xp;

    // Record
    foundWords[word] = { tier: tier, xp: xp };
    totalXP += xp;
    elXPCount.textContent = totalXP;

    // Depth progress — only SURFACE (common) words drive depth progression.
    // Shallow/medium/deep/hidden are bonus and can be found at any time.
    if (tier === 'surface') {
      depthProgress[currentDepth]++;
      var threshold = depthThresholds ? depthThresholds[currentDepth] : DEPTH_THRESHOLDS_DEFAULT[currentDepth];
      if (threshold && depthProgress[currentDepth] >= threshold) {
        unlockNextDepth();
      }
    }

    // Feedback
    var td = TIER_MAP[tier];
    var feedbackClass = 'success';
    if (tier === 'deep' || tier === 'core' || tier === 'hidden') feedbackClass = 'info';
    showFeedback(td.icon + ' +' + xp + ' ' + td.ore + '!', feedbackClass);

    // Update UI
    renderDepthMeter();
    addFoundWordToList(word, tier, xp);
    updateWordCount();

    // Clear input
    currentWord = '';
    renderCurrentWord();

    // Save
    saveGameState();

    // Win check
    checkWin();
  }

  // ─── Depth Unlocking ────────────────────────────────────────────────────────

  function unlockNextDepth() {
    var idx = TIER_IDS.indexOf(currentDepth);
    if (idx < 0 || idx >= TIER_IDS.length - 1) return;

    var nextTier = TIER_IDS[idx + 1];
    unlockedDepths.push(nextTier);
    currentDepth = nextTier;

    // Auto-skip the next tier too if it has 0 words
    while (currentDepth !== 'core') {
      var nextTh = depthThresholds ? depthThresholds[currentDepth] : null;
      if (nextTh === 0) {
        var skipIdx = TIER_IDS.indexOf(currentDepth);
        if (skipIdx >= 0 && skipIdx < TIER_IDS.length - 1) {
          if (revealedBonusCount < bonusOrder.length) revealedBonusCount++;
          unlockedDepths.push(TIER_IDS[skipIdx + 1]);
          currentDepth = TIER_IDS[skipIdx + 1];
        } else break;
      } else break;
    }

    // Reveal bonus letter if available
    if (revealedBonusCount < bonusOrder.length) {
      revealedBonusCount++;
      renderLetters();

      // Flash the just-unlocked cell
      var bonusIdx = bonusOrder[revealedBonusCount - 1];
      setTimeout(function () {
        var cells = document.querySelectorAll('.letter-cell');
        for (var i = 0; i < cells.length; i++) {
          if (parseInt(cells[i].dataset.letterIdx) === bonusIdx) {
            cells[i].classList.add('just-unlocked');
            (function (c) {
              setTimeout(function () { c.classList.remove('just-unlocked'); }, 800);
            })(cells[i]);
          }
        }
      }, 50);

      var td = TIER_MAP[nextTier];
      showFeedback('\u26CF ' + td.label + ' unlocked! New letter: ' +
        letters[bonusOrder[revealedBonusCount - 1]].toUpperCase() + '!', 'depth-unlock');
    } else {
      // No bonus letter to reveal (0 bonus letters or all revealed)
      var td2 = TIER_MAP[nextTier];
      showFeedback('\u26CF ' + td2.label + ' unlocked!', 'depth-unlock');
    }
  }

  // ─── Depth Meter ────────────────────────────────────────────────────────────

  function renderDepthMeter() {
    elDepthTiers.innerHTML = '';

    for (var i = 0; i < DEPTH_TIERS.length; i++) {
      var tier = DEPTH_TIERS[i];
      var tid  = tier.id;
      var isUnlocked = unlockedDepths.indexOf(tid) >= 0;
      var isCurrent  = tid === currentDepth;
      var isLocked   = !isUnlocked;

      var row = document.createElement('div');
      row.className = 'depth-tier';
      if (isLocked)       row.classList.add('locked');
      else if (isCurrent) row.classList.add('current');
      else                row.classList.add('unlocked');

      // Icon
      var iconEl = document.createElement('span');
      iconEl.className = 'tier-icon';
      iconEl.textContent = isLocked ? '\uD83D\uDD12' : tier.icon;
      row.appendChild(iconEl);

      // Label
      var labelEl = document.createElement('span');
      labelEl.className = 'tier-label';
      labelEl.style.color = tier.color;
      labelEl.textContent = tier.label;
      row.appendChild(labelEl);

      // Progress bar
      var progWrap = document.createElement('div');
      progWrap.className = 'tier-progress';
      var bar = document.createElement('div');
      bar.className = 'tier-progress-bar';
      bar.style.background = tier.color;

      var threshold = depthThresholds ? depthThresholds[tid] : DEPTH_THRESHOLDS_DEFAULT[tid];
      var prog = depthProgress[tid] || 0;

      if (isLocked) {
        bar.style.width = '0%';
      } else if (threshold) {
        // Tiers with a threshold: show progress toward it
        var tierIdx = TIER_IDS.indexOf(tid);
        var currentIdx = TIER_IDS.indexOf(currentDepth);
        if (tierIdx < currentIdx) {
          // Already surpassed this tier — show full
          bar.style.width = '100%';
        } else {
          bar.style.width = Math.min(100, (prog / threshold) * 100) + '%';
        }
      } else {
        // Core tier (no threshold) — show based on found words
        var coreCount = countFoundInTier(tid);
        bar.style.width = coreCount > 0 ? '100%' : '0%';
      }

      progWrap.appendChild(bar);
      row.appendChild(progWrap);

      // Count text
      var countEl = document.createElement('span');
      countEl.className = 'tier-count';
      if (threshold && isCurrent) {
        countEl.textContent = prog + '/' + threshold;
      } else if (!isLocked) {
        var found = countFoundInTier(tid);
        var avail = countAvailableInTier(tid);
        countEl.textContent = found + '/' + avail;
      }
      row.appendChild(countEl);

      // XP value
      var xpEl = document.createElement('span');
      xpEl.className = 'tier-xp';
      xpEl.textContent = '\u2726' + tier.xp;
      row.appendChild(xpEl);

      elDepthTiers.appendChild(row);
    }
  }

  function countFoundInTier(tierId) {
    var n = 0;
    for (var w in foundWords) {
      if (foundWords[w].tier === tierId) n++;
    }
    return n;
  }

  function countAvailableInTier(tierId) {
    // Count words in this tier that can be formed from currently available letters
    var available = getAvailableLetterSet();
    var words = wordsByTier[tierId] || [];
    var n = 0;
    for (var i = 0; i < words.length; i++) {
      if (canFormWord(words[i], available)) n++;
    }
    return n;
  }

  function canFormWord(word, letterSet) {
    for (var i = 0; i < word.length; i++) {
      if (!letterSet.has(word[i])) return false;
    }
    return true;
  }

  // ─── Found Words ────────────────────────────────────────────────────────────

  function renderFoundWords() {
    elFoundList.innerHTML = '';
    var allDisplayTiers = TIER_IDS.concat(['hidden']);
    for (var t = 0; t < allDisplayTiers.length; t++) {
      var tid = allDisplayTiers[t];
      var td  = TIER_MAP[tid];
      var words = [];
      for (var w in foundWords) {
        if (foundWords[w].tier === tid) words.push(w);
      }
      if (words.length === 0) continue;
      words.sort();

      var group = document.createElement('div');
      group.className = 'found-tier-group';

      var label = document.createElement('div');
      label.className = 'found-tier-label';
      label.style.background = td.color + '22';
      label.style.color = td.color;
      label.textContent = td.icon + ' ' + td.ore + ' \u2014 ' + td.label + ' (' + words.length + ')';
      group.appendChild(label);

      for (var j = 0; j < words.length; j++) {
        group.appendChild(createFoundWordRow(words[j], td));
      }
      elFoundList.appendChild(group);
    }
  }

  function addFoundWordToList(word, tier, xp) {
    // Re-render the entire found list for simplicity and correct grouping
    renderFoundWords();

    // Scroll the found list to the bottom
    elFoundList.scrollTop = elFoundList.scrollHeight;
  }

  function createFoundWordRow(word, tierDef) {
    var row = document.createElement('div');
    row.className = 'found-word-row';

    var text = document.createElement('span');
    text.className = 'found-word-text';
    text.textContent = word;
    row.appendChild(text);

    var xpEl = document.createElement('span');
    xpEl.className = 'found-word-xp';
    xpEl.textContent = '\u2726' + tierDef.xp;
    row.appendChild(xpEl);

    return row;
  }

  function updateWordCount() {
    // Goal = non-hidden words only (ultra rare are bonus)
    var found = 0;
    for (var w in foundWords) {
      if (foundWords[w].tier !== 'hidden') found++;
    }
    var total = (wordsByTier && wordsByTier.totals) ? wordsByTier.totals.total : 0;
    elFoundCount.textContent = found;
    elWordsTotal.textContent = total;
  }

  // ─── Win Check ──────────────────────────────────────────────────────────────

  function checkWin() {
    if (!wordsByTier || !wordsByTier.totals) return;

    // Main win: all surface words found (= core reached via surface milestones)
    if (unlockedDepths.indexOf('core') >= 0 && !depthClearShown) {
      depthClearShown = true;

      // Full clear bonus: check if all non-hidden words also found
      var found = 0;
      for (var w in foundWords) {
        if (foundWords[w].tier !== 'hidden') found++;
      }
      if (found >= wordsByTier.totals.total) {
        showWin('Mine Cleared!', 'Every gem unearthed — perfect run!', true);
      } else {
        showWin('Mine Complete!', 'You found all the common words! Keep digging for bonus gems.', false);
      }
    }
  }

  function isWinCardOpen() {
    var wc = document.getElementById('wt-win-card');
    return !!(wc && wc.style.display !== 'none');
  }

  function showWin(title, subtitle, isFullClear) {
    // Shared win card. JACKPOT keeps the full-clear distinction (word chip).
    if (window.WinCard) {
      var spName = '';
      try { spName = localStorage.getItem('wordmine-name') || ''; } catch (e) {}
      var opts = {
        game: 'wordmine',
        gameName: 'Word Mine',
        jackpot: totalXP,
        winner: { displayName: spName || 'You' },
        autoHideMs: 0,
        actions: [{ label: 'Continue Mining', primary: true, onClick: function () { window.WinCard.hide(); } }]
      };
      if (isFullClear) opts.word = 'JACKPOT';
      window.WinCard.showSolo(opts);
    }

    // Mark completed
    markCompleted(isFullClear);

    // Report daily/weekly to Word Mine server + Chat Relay
    if (isDaily && isFullClear) {
      fetch('/api/sp/daily/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(function () {});
      // Forward to Chat Relay centralized daily tracker
      var xd = new XMLHttpRequest();
      xd.open('POST', getBaseURL() + '/api/sp-daily/complete/wordmine-sp', true);
      xd.setRequestHeader('Content-Type', 'application/json');
      xd.send(JSON.stringify({ date: getToday() }));
    }
    if (isWeekly && isFullClear) {
      fetch('/api/sp/weekly/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(function () {});
      // Forward to Chat Relay centralized weekly tracker
      var xw = new XMLHttpRequest();
      xw.open('POST', getBaseURL() + '/api/sp-weekly/complete/wordmine-sp', true);
      xw.setRequestHeader('Content-Type', 'application/json');
      xw.send(JSON.stringify({ weekStart: getWeekStart() }));
    }
  }

  function markCompleted(isFullClear) {
    var stats = loadStats();
    if (!stats.completedMines) stats.completedMines = {};
    stats.completedMines[currentMineId] = {
      xp: totalXP,
      words: Object.keys(foundWords).length,
      deepest: currentDepth,
      fullClear: isFullClear,
      date: new Date().toISOString(),
    };
    saveStats(stats);
  }

  // ─── Back to Selector ───────────────────────────────────────────────────────

  function backToSelector() {
    if (currentMineId) saveGameState();
    currentWord = '';
    depthClearShown = false;
    isDaily = false;
    isWeekly = false;
    showSelector();
  }

  // ─── Feedback ───────────────────────────────────────────────────────────────

  var feedbackTimer = null;

  function showFeedback(msg, type) {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    elFeedback.textContent = msg;
    elFeedback.className = 'feedback ' + (type || 'info');
    feedbackTimer = setTimeout(function () {
      elFeedback.classList.add('hidden');
    }, type === 'depth-unlock' ? 3000 : 1500);
  }

  function shakeInput() {
    elCurrentWord.style.transition = 'none';
    elCurrentWord.style.transform = 'translateX(0)';
    var steps = [8, -8, 6, -6, 3, -3, 0];
    var i = 0;
    var step = function () {
      if (i >= steps.length) { elCurrentWord.style.transform = ''; return; }
      elCurrentWord.style.transform = 'translateX(' + steps[i] + 'px)';
      i++;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  function saveGameState() {
    if (!currentMineId) return;
    var state = {
      mineId: currentMineId,
      isDaily: isDaily,
      isWeekly: isWeekly,
      foundWords: foundWords,
      totalXP: totalXP,
      revealedBonusCount: revealedBonusCount,
      currentDepth: currentDepth,
      depthProgress: depthProgress,
      depthThresholds: depthThresholds,
      unlockedDepths: unlockedDepths,
      letterDisplayOrder: letterDisplayOrder,
      depthClearShown: depthClearShown,
    };
    try { localStorage.setItem(GAME_KEY, JSON.stringify(state)); } catch (e) {}

    // Update puzzle progress in stats (goal = non-hidden only)
    var stats = loadStats();
    if (!stats.puzzleProgress) stats.puzzleProgress = {};
    var nonHiddenFound = 0;
    for (var pw in foundWords) {
      if (foundWords[pw].tier !== 'hidden') nonHiddenFound++;
    }
    stats.puzzleProgress[currentMineId] = {
      found: nonHiddenFound,
      total: (wordsByTier && wordsByTier.totals) ? wordsByTier.totals.total : 0,
    };
    saveStats(stats);
  }

  function loadGameState() {
    try {
      var raw = localStorage.getItem(GAME_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearGameState() {
    try { localStorage.removeItem(GAME_KEY); } catch (e) {}
  }

  function restoreGame(saved) {
    var id = saved.mineId;

    if (saved.isDaily && dailyMine) {
      startGame(dailyMine, id, true, false);
      applySavedState(saved);
      return;
    }
    if (saved.isWeekly && weeklyMine) {
      startGame(weeklyMine, id, false, true);
      applySavedState(saved);
      return;
    }

    // Pool mine — need to fetch
    fetch('/api/mines/' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { clearGameState(); showSelector(); return; }
        startGame(data, id, false, false);
        applySavedState(saved);
      })
      .catch(function () { clearGameState(); showSelector(); });
  }

  function applySavedState(saved) {
    foundWords         = saved.foundWords || {};
    totalXP            = saved.totalXP || saved.totalCoins || 0;
    revealedBonusCount = saved.revealedBonusCount || 0;
    currentDepth       = saved.currentDepth || 'surface';
    depthProgress      = saved.depthProgress || { surface: 0, shallow: 0, medium: 0, deep: 0, core: 0 };
    unlockedDepths     = saved.unlockedDepths || ['surface'];
    depthClearShown    = saved.depthClearShown || false;
    // Restore saved thresholds if available (overrides the ones startGame computed)
    if (saved.depthThresholds) depthThresholds = saved.depthThresholds;
    if (saved.letterDisplayOrder && saved.letterDisplayOrder.length === letterDisplayOrder.length) {
      letterDisplayOrder = saved.letterDisplayOrder;
    }

    // If Core already unlocked, mark depth clear as shown
    if (unlockedDepths.indexOf('core') >= 0) depthClearShown = true;

    elXPCount.textContent = totalXP;
    renderLetters();
    renderDepthMeter();
    renderFoundWords();
    updateWordCount();
  }

  function loadStats() {
    try {
      var raw = localStorage.getItem(STATS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveStats(stats) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  // ─── Chat Relay Daily/Weekly Forwarding ─────────────────────────────────────

  function getBaseURL() {
    return window.location.protocol + '//' + window.location.host;
  }
  function getToday() {
    return new Date().toISOString().slice(0, 10);
  }
  function getWeekStart() {
    var d = new Date();
    var day = d.getUTCDay();
    var diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)).toISOString().slice(0, 10);
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ─── Boot ───────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
