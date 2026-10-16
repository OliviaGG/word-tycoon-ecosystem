(function() {
'use strict';
  // Load both current ownership helpers before reading any game progress.
  if (!window.WordTycoonSoloAccount || window.WTDurableCompletion?.sessionContextVersion !== 2) {
    var engineURL = document.currentScript.src;
    var dependencies = ['../solo-account.js?v=20261003-owner2','../durable-completion.js?v=20261003-owner2'];
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
  var soloAccount = window.WordTycoonSoloAccount.create({ game: 'spellingbee-sp', authBase: getAuthBaseURL() });
  var localStorage = soloAccount.storage;
  var XMLHttpRequest = soloAccount.XMLHttpRequest;


// ─── Scoring (3-layer) ─────────────────
var _LR = {e:0,t:0,a:0,o:0,i:0,n:0,s:0,h:0,r:0,d:15,l:15,c:30,u:30,m:30,w:30,f:30,g:60,y:60,p:60,b:105,v:105,k:105,j:180,x:180,q:300,z:300};
var _WLB = {4:75,5:150,6:300,7:500,8:800,9:1200,10:1750,11:2500};
function _scoreWordFull(word, isRare, isHidden, isThree, isPangram) {
  var base = isThree ? 100 : (isHidden ? 1500 : (isRare ? 1000 : 500));
  for (var i = 0; i < word.length; i++) base += (_LR[word[i]] || 0);
  var len = word.length;
  if (len >= 12) base += 3500;
  else if (len >= 4) base += (_WLB[len] || 0);
  if (isPangram) base += 1000;
  return base;
}

// ─── Constants ─────────────────────────
var STATS_KEY = 'spellingbee_sp_stats';
var BANNER_KEY = 'spellingbee_banner_dismissed';
var GAME_STATE_KEY = 'spellingbee_sp_game';
var MIN_WORD_LENGTH = 3;

// ─── State ─────────────────────────────
var dictionary = {};     // word -> true (all valid words)
var frequencyData = {};  // word -> Zipf score (from word bank)
var puzzles = [];        // puzzle metadata from /api/puzzles
var currentPuzzleId = null;

// Weekly puzzle state
var weeklyData = null;
var weeklyPlayed = false;
var currentGameIsWeekly = false; // whether the current game is the weekly puzzle
var serverCompletedDates = {};  // cross-device: { date: true }
var isLoggedIn = false;
var launchMode = new URLSearchParams(window.location.search).get('mode');
var stateSyncTimer = null;

// Daily puzzle state
var dailyData = null;       // { letters, centerLetter, date }
var dailyPlayed = false;
var currentGameIsDaily = false;
var serverCompletedDaily = {};  // cross-device: { date: true }

// Data-loading flags (module-level so fetchWeekly can see them)
var dictionaryLoaded = false;
var frequencyLoaded = false;
var puzzlesLoaded = false;
var weeklyLoaded = false;
var dailyLoaded = false;

// Game state
var letters = [];        // [center, ...outer] — 7 letters
var centerLetter = '';
var validWords = {};     // word -> true (valid for this puzzle)
var commonWords = {};    // word -> true
var rareWords = {};      // word -> true
var hiddenWords = {};    // word -> true (no frequency data)
var threeLetterWords = {}; // word -> true (3-letter words)
var commonCount = 0;
var rareCount = 0;
var hiddenCount = 0;
var threeLetterCount = 0;
var foundCommon = {};
var foundRare = {};
var foundHidden = {};
var foundThreeLetter = {};
var foundCommonCount = 0;
var foundRareCount = 0;
var foundHiddenCount = 0;
var foundThreeLetterCount = 0;
var currentScore = 0;
var currentWordBuffer = ''; // letters typed via hex clicks

// ─── DOM Refs ──────────────────────────
var puzzleSelector, puzzleGrid, randomPuzzleBtn, gameScreen, backBtn;
var hexRowTop, hexRowMid, hexRowBot, honeycombArea;
var currentWordEl, scoreValEl;
var btnDelete, btnShuffle, btnSubmit;
var progressBar, foundCountEl, totalCountEl, foundLabel;
var incorrectArea, foundWordsList;
// Win UI is the shared WinCard (win-card.js from the hub) — the old
// #win-overlay / #win-stats / #new-game-btn markup is gone from sp.html.
var userSession = null;
var statsDropdown, errorToast;
var puzzleInfoEl, puzzleNumEl, puzzleNameEl, puzzleThemeBadgeEl;
var rareCountEl, rareLabelEl, rareWordsList, rareSection;
var hiddenCountEl, hiddenLabelEl, hiddenWordsList, hiddenSection;
var threeLetterCountEl, threeLetterLabelEl, threeLetterWordsList, threeLetterSection;

// Drag state
var isDragging = false;
var dragJustEnded = false;
var lastDragCellEl = null;
var dragPath = [];       // array of letters
var dragPreviewEl = null;
var svgOverlay = null;

// ─── Init ──────────────────────────────
function init() {
    // Puzzle selector
    puzzleSelector = document.getElementById('puzzle-selector');
    puzzleGrid = document.getElementById('puzzle-grid');
    randomPuzzleBtn = document.getElementById('random-puzzle-btn');
    gameScreen = document.getElementById('game-screen');
    backBtn = document.getElementById('back-to-puzzles');

    // Honeycomb
    honeycombArea = document.getElementById('honeycomb-area');
    hexRowTop = document.getElementById('hex-row-top');
    hexRowMid = document.getElementById('hex-row-mid');
    hexRowBot = document.getElementById('hex-row-bot');

    // Current word + actions
    currentWordEl = document.getElementById('current-word');
    scoreValEl = document.getElementById('score-val');
    btnDelete = document.getElementById('btn-delete');
    btnShuffle = document.getElementById('btn-shuffle');
    btnSubmit = document.getElementById('btn-submit');

    // Progress
    progressBar = document.getElementById('progress-bar');
    foundCountEl = document.getElementById('found-count');
    totalCountEl = document.getElementById('total-count');
    foundLabel = document.getElementById('found-label');

    // Feedback
    incorrectArea = document.getElementById('incorrect-area');
    foundWordsList = document.getElementById('found-words');


    // Stats
    statsDropdown = document.getElementById('stats-dropdown');
    errorToast = document.getElementById('error-toast');

    // Puzzle info
    puzzleInfoEl = document.getElementById('puzzle-info');
    puzzleNumEl = document.getElementById('puzzle-num');
    puzzleNameEl = document.getElementById('puzzle-name');
    puzzleThemeBadgeEl = document.getElementById('puzzle-theme-badge');

    // Rare words
    rareCountEl = document.getElementById('rare-count');
    rareLabelEl = document.getElementById('rare-label');
    rareWordsList = document.getElementById('rare-words');
    rareSection = document.getElementById('rare-section');

    // Hidden words
    hiddenCountEl = document.getElementById('hidden-count');
    hiddenLabelEl = document.getElementById('hidden-label');
    hiddenWordsList = document.getElementById('hidden-words');
    hiddenSection = document.getElementById('hidden-section');

    // 3-letter words
    threeLetterCountEl = document.getElementById('three-letter-count');
    threeLetterLabelEl = document.getElementById('three-letter-label');
    threeLetterWordsList = document.getElementById('three-letter-words');
    threeLetterSection = document.getElementById('three-letter-section');

    // Setup UI
    setupBanner();
    setupKeyboard();
    setupStats();
    setupActions();
    setupBackButton();
    setupDragInput();
    setupCheatSheet();

    // Check session first (for cross-device daily sync), then load data
    checkSession(function() { loadData(); });
}

function setupBanner() {
    var banner = document.getElementById('login-banner');
    var dismiss = document.getElementById('dismiss-banner');
    if (!banner || !dismiss) return;
    if (localStorage.getItem(BANNER_KEY)) { banner.style.display = 'none'; return; }
    dismiss.onclick = function() {
        banner.style.display = 'none';
        localStorage.setItem(BANNER_KEY, '1');
    };
}

function setupKeyboard() {
    // Desktop keyboard: type letters, Enter to submit, Backspace to delete
    document.addEventListener('keydown', function(e) {
        if (!gameScreen || gameScreen.style.display === 'none') return;
        // Ignore if typing in a real input (e.g. stats dropdown)
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

        if (e.key === 'Enter') {
            e.preventDefault();
            if (currentWordBuffer.length > 0) {
                submitGuess(currentWordBuffer);
                currentWordBuffer = '';
                renderCurrentWord();
            }
            return;
        }
        if (e.key === 'Backspace') {
            e.preventDefault();
            if (currentWordBuffer.length > 0) {
                currentWordBuffer = currentWordBuffer.slice(0, -1);
                renderCurrentWord();
            }
            return;
        }
        // Letter key — only accept if it's one of the puzzle letters
        var ch = e.key.toLowerCase();
        if (ch.length === 1 && /^[a-z]$/.test(ch) && letters.indexOf(ch) !== -1) {
            e.preventDefault();
            currentWordBuffer += ch;
            renderCurrentWord();
            // Animate the hex cell
            var cell = findCellByLetter(ch);
            if (cell) {
                cell.classList.remove('pop-animation');
                void cell.offsetWidth;
                cell.classList.add('pop-animation');
            }
        }
    });
}

function setupStats() {
    document.getElementById('stats-toggle').onclick = function() {
        statsDropdown.classList.toggle('hidden');
        if (!statsDropdown.classList.contains('hidden')) renderStats();
    };
}

function setupCheatSheet() {
    if (!window.SpellingBeeCheatSheet) return;
    window.SpellingBeeCheatSheet.init();
}

function setupActions() {
    btnDelete.onclick = function() {
        if (currentWordBuffer.length > 0) {
            currentWordBuffer = currentWordBuffer.slice(0, -1);
            renderCurrentWord();
        }
    };

    btnShuffle.onclick = function() {
        shuffleOuter();
    };

    btnSubmit.onclick = function() {
        if (currentWordBuffer.length > 0) {
            submitGuess(currentWordBuffer);
            currentWordBuffer = '';
            renderCurrentWord();
        }
    };
}

function setupBackButton() {
    backBtn.onclick = function() {
        showPuzzleSelector();
    };
}

// ─── Drag/Swipe Input ─────────────────
function setupDragInput() {
    if (!honeycombArea) return;

    // Create drag preview element
    dragPreviewEl = document.createElement('div');
    dragPreviewEl.className = 'drag-preview hidden';
    honeycombArea.parentNode.insertBefore(dragPreviewEl, honeycombArea);

    // Mouse events
    honeycombArea.addEventListener('mousedown', function(e) {
        var cell = getHexCellFromPoint(e.clientX, e.clientY);
        if (!cell) return;
        e.preventDefault();
        startDrag(cell);
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        continueDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', function() {
        if (!isDragging) return;
        endDrag();
    });

    // Touch events
    honeycombArea.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) return;
        var touch = e.touches[0];
        var cell = getHexCellFromPoint(touch.clientX, touch.clientY);
        if (!cell) return;
        e.preventDefault();
        startDrag(cell);
    }, { passive: false });

    honeycombArea.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        e.preventDefault();
        if (e.touches.length !== 1) return;
        var touch = e.touches[0];
        continueDrag(touch.clientX, touch.clientY);
    }, { passive: false });

    honeycombArea.addEventListener('touchend', function(e) {
        if (!isDragging) return;
        e.preventDefault();
        endDrag();
    });

    honeycombArea.addEventListener('touchcancel', function() {
        cancelDrag();
    });

    document.addEventListener('mouseleave', function() {
        if (isDragging) cancelDrag();
    });
}

function getHexCellFromPoint(x, y) {
    var cells = honeycombArea.querySelectorAll('.hex-cell');
    if (cells.length === 0) return null;

    var closest = null;
    var closestDist = Infinity;
    var maxR = 0;

    for (var i = 0; i < cells.length; i++) {
        var rect = cells[i].getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        if (i === 0) maxR = rect.width;
        var dx = x - cx;
        var dy = y - cy;
        var dist = dx * dx + dy * dy;
        if (dist < closestDist) {
            closestDist = dist;
            closest = cells[i];
        }
    }

    // Only snap if within 1 cell width
    if (closest && closestDist > maxR * maxR) return null;
    return closest;
}

function startDrag(cell) {
    var letter = cell.dataset.letter;
    if (!letter) return;

    isDragging = true;
    dragJustEnded = false;
    lastDragCellEl = cell;
    dragPath = [letter];

    // Don't clear currentWordBuffer here — if this turns out to be a
    // single tap we want to APPEND the letter. Buffer is cleared in
    // continueDrag when a real multi-cell swipe begins.

    updateDragVisuals();
}

function continueDrag(x, y) {
    if (!isDragging) return;
    var cell = getHexCellFromPoint(x, y);
    if (!cell) return;

    // Same physical cell as last — no action (prevents wobble re-entry)
    if (cell === lastDragCellEl) return;

    var letter = cell.dataset.letter;
    if (!letter) return;

    // First move to a second cell — this is a real swipe, clear the tap buffer
    if (dragPath.length === 1) {
        currentWordBuffer = '';
    }

    // Track the new cell
    lastDragCellEl = cell;
    dragPath.push(letter);
    updateDragVisuals();
}

function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    lastDragCellEl = null;

    // Single-cell "drag" = tap — append letter to word buffer instead of submitting
    if (dragPath.length === 1) {
        var tappedLetter = dragPath[0];
        clearDragVisuals();
        dragPath = [];

        // Suppress the click event that fires after touchend
        dragJustEnded = true;
        setTimeout(function() { dragJustEnded = false; }, 150);

        // Append letter and animate
        currentWordBuffer += tappedLetter;
        renderCurrentWord();
        var cell = findCellByLetter(tappedLetter);
        if (cell) {
            cell.classList.remove('pop-animation');
            void cell.offsetWidth;
            cell.classList.add('pop-animation');
        }
        return;
    }

    // Multi-cell swipe — submit as word
    dragJustEnded = true;
    setTimeout(function() { dragJustEnded = false; }, 150);

    var word = dragPath.join('');
    clearDragVisuals();
    dragPath = [];

    if (word.length >= MIN_WORD_LENGTH) {
        submitGuess(word);
    } else if (word.length > 0 && word.length < MIN_WORD_LENGTH) {
        showIncorrect(word, 'too_short');
    }

    renderCurrentWord();
}

function cancelDrag() {
    isDragging = false;
    lastDragCellEl = null;
    dragJustEnded = true;
    setTimeout(function() { dragJustEnded = false; }, 150);
    dragPath = [];
    clearDragVisuals();
}

function updateDragVisuals() {
    // Clear all drag-active
    var allCells = honeycombArea.querySelectorAll('.hex-cell');
    for (var i = 0; i < allCells.length; i++) {
        allCells[i].classList.remove('drag-active');
    }

    // Mark cells in current path
    // Since letters can repeat, mark ALL matching cells (there's only one of each letter in hex)
    var letterMap = {};
    for (var j = 0; j < dragPath.length; j++) {
        letterMap[dragPath[j]] = true;
    }
    for (var k = 0; k < allCells.length; k++) {
        if (letterMap[allCells[k].dataset.letter]) {
            allCells[k].classList.add('drag-active');
        }
    }

    // Update drag preview text
    var word = dragPath.join('').toUpperCase();
    if (word.length > 0) {
        dragPreviewEl.textContent = word;
        dragPreviewEl.classList.remove('hidden');
    } else {
        dragPreviewEl.classList.add('hidden');
    }

    // Draw SVG lines
    updateDragLines();
}

function updateDragLines() {
    if (!svgOverlay || !honeycombArea.contains(svgOverlay)) {
        svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgOverlay.setAttribute('class', 'drag-svg-overlay');
        honeycombArea.appendChild(svgOverlay);
    }

    while (svgOverlay.firstChild) svgOverlay.removeChild(svgOverlay.firstChild);

    if (dragPath.length < 2) return;

    var containerRect = honeycombArea.getBoundingClientRect();
    svgOverlay.setAttribute('width', containerRect.width);
    svgOverlay.setAttribute('height', containerRect.height);

    for (var i = 0; i < dragPath.length - 1; i++) {
        var cellA = findCellByLetter(dragPath[i]);
        var cellB = findCellByLetter(dragPath[i + 1]);
        if (!cellA || !cellB) continue;

        var rectA = cellA.getBoundingClientRect();
        var rectB = cellB.getBoundingClientRect();

        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', rectA.left + rectA.width / 2 - containerRect.left);
        line.setAttribute('y1', rectA.top + rectA.height / 2 - containerRect.top);
        line.setAttribute('x2', rectB.left + rectB.width / 2 - containerRect.left);
        line.setAttribute('y2', rectB.top + rectB.height / 2 - containerRect.top);
        line.setAttribute('class', 'drag-line');
        svgOverlay.appendChild(line);
    }
}

function findCellByLetter(letter) {
    var cells = honeycombArea.querySelectorAll('.hex-cell');
    for (var i = 0; i < cells.length; i++) {
        if (cells[i].dataset.letter === letter) return cells[i];
    }
    return null;
}

function clearDragVisuals() {
    var allCells = honeycombArea.querySelectorAll('.hex-cell');
    for (var i = 0; i < allCells.length; i++) {
        allCells[i].classList.remove('drag-active');
    }
    if (dragPreviewEl) {
        dragPreviewEl.classList.add('hidden');
        dragPreviewEl.textContent = '';
    }
    if (svgOverlay) {
        while (svgOverlay.firstChild) svgOverlay.removeChild(svgOverlay.firstChild);
    }
}

// ─── Cross-device Daily Sync ──────────
function getGameBaseURL() {
    var loc = window.location;
    var origin = loc.protocol + '//' + loc.host;
    var path = loc.pathname || '/';
    var proxied = path.match(/^\/game\/[^/]+/);
    if (proxied) return origin + proxied[0];
    var legacy = path.match(/^\/(spellingbee)(?=\/|$)/);
    if (legacy && (loc.hostname === 'wordtycoon.live' || loc.hostname === 'www.wordtycoon.live')) {
        return origin + legacy[0];
    }
    return origin;
}

function getAuthBaseURL() {
    var host = window.location.hostname;
    if (host === 'wordtycoon.live' || host === 'www.wordtycoon.live' || host === 'localhost' || host === '127.0.0.1') {
        return window.location.origin;
    }
    return 'https://wordtycoon.live';
}

function getToday() {
    return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

function getWeekStart() {
    var d = new Date(getToday()+'T12:00:00Z');
    var day = d.getUTCDay();
    var diff = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10);
}

function fetchServerCompletions(callback) {
    var baseURL = getAuthBaseURL();
    var pending = 2;
    function done() { pending--; if (pending <= 0 && callback) callback(); }

    // Check weekly completions (stored under key 'spellingbee-sp-weekly')
    var x = new XMLHttpRequest();
    x.open('GET', baseURL + '/api/sp-daily/status/spellingbee-sp-weekly', true);
    x.withCredentials = true;
    x.onload = function() {
        if (x.status === 200) {
            try {
                var data = JSON.parse(x.responseText);
                if (data.ok && data.completedDates) {
                    for (var i = 0; i < data.completedDates.length; i++) {
                        serverCompletedDates[data.completedDates[i]] = true;
                    }
                    // If server knows this week is done, sync to localStorage
                    var ws = getWeekStart();
                    if (serverCompletedDates[ws]) {
                        localStorage.setItem('spellingbee_sp_weekly', ws);
                        weeklyPlayed = true;
                    }
                }
            } catch(e) {}
        }
        done();
    };
    x.onerror = function() { done(); };
    x.timeout=10000; x.ontimeout=x.onerror;
    x.send();

    // Check daily completions (stored under key 'spellingbee-sp')
    var x2 = new XMLHttpRequest();
    x2.open('GET', baseURL + '/api/sp-daily/status/spellingbee-sp', true);
    x2.withCredentials = true;
    x2.onload = function() {
        if (x2.status === 200) {
            try {
                var data = JSON.parse(x2.responseText);
                if (data.ok && data.completedDates) {
                    for (var i = 0; i < data.completedDates.length; i++) {
                        serverCompletedDaily[data.completedDates[i]] = true;
                    }
                    // If server knows today is done, sync to localStorage
                    var today = getToday();
                    if (serverCompletedDaily[today]) {
                        localStorage.setItem('spellingbee_sp_daily', today);
                        dailyPlayed = true;
                    }
                }
            } catch(e) {}
        }
        done();
    };
    x2.onerror = function() { done(); };
    x2.timeout=10000; x2.ontimeout=x2.onerror;
    x2.send();
}

var dailyCompletionQueue = null, weeklyCompletionQueue = null;
function completionQueue(period) {
  if(period==='weekly' && weeklyCompletionQueue)return weeklyCompletionQueue;
  if(period==='daily' && dailyCompletionQueue)return dailyCompletionQueue;
  var queue = WTDurableCompletion.attach({gameId:'spellingbee-sp',period:period,
    getSession:function(){return userSession;},getAccount:function(){return isLoggedIn && userSession ? userSession.anchorId || userSession.id : null;},baseUrl:getAuthBaseURL,
    getPeriod:period==='weekly'?getWeekStart:getToday});
  if(period==='weekly')weeklyCompletionQueue=queue;else dailyCompletionQueue=queue;
  return queue;
}
function completionEvidence() {
  return {foundWords:Object.keys(foundCommon).concat(Object.keys(foundRare),Object.keys(foundHidden),Object.keys(foundThreeLetter))};
}
function saveServerCompletion(weekStart) {
  if (!isLoggedIn) return;
  completionQueue('weekly').submit(weekStart,completionEvidence());
}
function saveDailyServerCompletion(date) {
  if (!isLoggedIn) return;
  completionQueue('daily').submit(date,completionEvidence());
}

function checkSession(callback) {
    var baseURL = getAuthBaseURL();
    var x = new XMLHttpRequest();
    x.open('GET', baseURL + '/api/me/session', true);
    x.withCredentials = true;
    x.onload = function() {
        if (x.status === 200) {
            try {
                var data = JSON.parse(x.responseText);
                if (data.ok && data.user) {
                    soloAccount.bind(data.user);
                    isLoggedIn = true;
                    userSession = data.user;   // identity for the WinCard
                    completionQueue('daily').recover(); completionQueue('weekly').recover();
                    // Hide login banner — user is already logged in
                    var banner = document.getElementById('login-banner');
                    if (banner) banner.style.display = 'none';
                    fetchServerCompletions(callback);
                    return;
                }
            } catch(e) {}
        }
        soloAccount.bind(null);
        if (callback) callback();
    };
    x.onerror = function() { soloAccount.bind(null); if (callback) callback(); };
    x.timeout=10000; x.ontimeout=x.onerror;
    x.send();
}

// ─── Data Loading ──────────────────────
function loadData() {
    showToast('Loading...');

    dictionaryLoaded = false;
    frequencyLoaded = false;
    puzzlesLoaded = false;
    weeklyLoaded = false;
    dailyLoaded = false;

    // Load dictionary
    fetch(getGameBaseURL() + '/api/sp/dictionary')
        .then(function(res) { return res.json(); })
        .then(function(words) {
            dictionary = {};
            for (var i = 0; i < words.length; i++) {
                var w = words[i].trim().toLowerCase();
                if (w.length >= MIN_WORD_LENGTH && /^[a-z]+$/.test(w)) dictionary[w] = true;
            }
            dictionaryLoaded = true;
            checkAllLoaded();
        })
        .catch(function() {
            showToast('Failed to load dictionary. Retrying...');
            setTimeout(loadData, 3000);
        });

    // Load frequency data
    fetch(getGameBaseURL() + '/api/sp/frequency')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            frequencyData = {};
            var keys = Object.keys(data);
            for (var i = 0; i < keys.length; i++) {
                frequencyData[keys[i].toLowerCase()] = data[keys[i]];
            }
            console.log('[SP] Loaded ' + keys.length + ' word frequencies');
            frequencyLoaded = true;
            checkAllLoaded();
        })
        .catch(function() {
            console.log('[SP] Could not load frequency data, all words will be common');
            frequencyData = {};
            frequencyLoaded = true;
            checkAllLoaded();
        });

    // Load puzzles
    fetch(getGameBaseURL() + '/api/puzzles')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            puzzles = data || [];
            puzzlesLoaded = true;
            checkAllLoaded();
        })
        .catch(function() {
            showToast('Failed to load puzzles. Retrying...');
            setTimeout(loadData, 3000);
        });

    // Fetch weekly + daily puzzles — both part of checkAllLoaded flow
    fetchWeekly(function() {
        checkAllLoaded();
    });
    fetchDaily(function() {
        checkAllLoaded();
    });

    function checkAllLoaded() {
        if (dictionaryLoaded && frequencyLoaded && puzzlesLoaded && weeklyLoaded && dailyLoaded) {
            startGame();
        }
    }

    var startGameCalled = false;
    function startGame() {
        if (startGameCalled) return;
        startGameCalled = true;
        hideToast();

        // Check for saved in-progress game first
        var saved = loadGameState();

        // In weekly mode, discard any non-weekly saved game
        if (saved && launchMode === 'weekly') {
            var savedIsWeekly = typeof saved.puzzleId === 'string' && saved.puzzleId.indexOf('weekly_') === 0;
            if (!savedIsWeekly) {
                clearGameState();
                saved = null;
            }
        }

        if (saved) {
            // Verify puzzle identity matches — restore if valid
            var savedIsWeekly2 = typeof saved.puzzleId === 'string' && saved.puzzleId.indexOf('weekly_') === 0;
            var savedIsDaily2 = typeof saved.puzzleId === 'string' && saved.puzzleId.indexOf('daily_') === 0;
            var weeklyStale = savedIsWeekly2 && weeklyData && ('weekly_' + weeklyData.weekStart) !== saved.puzzleId;
            var dailyStale = savedIsDaily2 && dailyData && ('daily_' + dailyData.date) !== saved.puzzleId;
            if (!weeklyStale && !dailyStale) {
                restoreGameState(saved);
                return;
            }
            // Puzzle changed — discard stale save
            clearGameState();
            saved = null;
        }

        // If no local state and weekly/daily launch mode, try loading from server
        if (!saved && (launchMode === 'weekly' || launchMode === 'daily') && isLoggedIn) {
            loadGameStateFromServer(function(serverState) {
                if (serverState && serverState.puzzleId && serverState.letters && serverState.centerLetter) {
                    // Save to localStorage so restoreGameState can use it
                    try { localStorage.setItem(GAME_STATE_KEY, JSON.stringify(serverState)); } catch(e) {}
                    restoreGameState(serverState);
                } else {
                    proceedAfterStateCheck();
                }
            });
            return;
        }

        proceedAfterStateCheck();
    }

    function proceedAfterStateCheck() {
        // Weekly launch mode: always start weekly directly
        if (launchMode === 'weekly') {
            if (weeklyData && weeklyData.letters && weeklyData.centerLetter) {
                startWeekly();
            } else {
                showPuzzleSelector();
            }
            return;
        }
        // Daily takes priority over weekly in normal mode
        if (dailyData && !dailyPlayed && dailyData.letters && dailyData.centerLetter) {
            startDaily();
        } else if (weeklyData && !weeklyPlayed && weeklyData.letters && weeklyData.centerLetter) {
            startWeekly();
        } else {
            showPuzzleSelector();
        }
    }
}

// ─── Weekly Puzzle ─────────────────────
function fetchWeekly(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', getGameBaseURL() + '/api/sp/weekly', true);
    x.onload = function() {
        if (x.status === 200) {
            try {
                weeklyData = JSON.parse(x.responseText);
            } catch(e) {
                console.warn('[SP] Weekly parse error:', e);
                weeklyData = null;
            }
            if (weeklyData) {
                var played = localStorage.getItem('spellingbee_sp_weekly');
                weeklyPlayed = (played === weeklyData.weekStart) || !!serverCompletedDates[weeklyData.weekStart];
                console.log('[SP] Weekly fetched, played:', weeklyPlayed);
            }
        }
        weeklyLoaded = true;
        if (cb) cb();
    };
    x.onerror = function() { weeklyData = null; weeklyLoaded = true; if (cb) cb(); };
    x.timeout=10000; x.ontimeout=x.onerror;
    x.send();
}

function startWeekly() {
    if (!weeklyData || !weeklyData.letters || !weeklyData.centerLetter) return;
    // Build puzzle data in the format startGameWithPuzzle expects
    // letters array: [centerLetter, ...outerLetters]
    var outerLetters = [];
    for (var i = 0; i < weeklyData.letters.length; i++) {
        if (weeklyData.letters[i] !== weeklyData.centerLetter) {
            outerLetters.push(weeklyData.letters[i]);
        }
    }
    var puzzleLetters = [weeklyData.centerLetter].concat(outerLetters);
    var puzzleObj = {
        letters: puzzleLetters,
        centerLetter: weeklyData.centerLetter
    };
    currentPuzzleId = 'weekly_' + weeklyData.weekStart;
    weeklyPlayed = true;
    currentGameIsWeekly = true;
    currentGameIsDaily = false;
    startGameWithPuzzle(puzzleObj);
    var badge = document.getElementById('daily-badge');
    if (badge) {
        badge.textContent = 'WEEKLY';
        badge.classList.remove('hidden');
    }
    console.log('[SP] Starting WEEKLY puzzle');
}

// ─── Daily Puzzle ─────────────────────
function fetchDaily(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', getGameBaseURL() + '/api/sp/daily', true);
    x.onload = function() {
        if (x.status === 200) {
            try {
                dailyData = JSON.parse(x.responseText);
            } catch(e) {
                console.warn('[SP] Daily parse error:', e);
                dailyData = null;
            }
            if (dailyData) {
                var played = localStorage.getItem('spellingbee_sp_daily');
                dailyPlayed = (played === dailyData.date) || !!serverCompletedDaily[dailyData.date];
                console.log('[SP] Daily fetched, played:', dailyPlayed);
            }
        }
        dailyLoaded = true;
        if (cb) cb();
    };
    x.onerror = function() { dailyData = null; dailyLoaded = true; if (cb) cb(); };
    x.timeout=10000; x.ontimeout=x.onerror;
    x.send();
}

function startDaily() {
    if (!dailyData || !dailyData.letters || !dailyData.centerLetter) return;
    var outerLetters = [];
    for (var i = 0; i < dailyData.letters.length; i++) {
        if (dailyData.letters[i] !== dailyData.centerLetter) {
            outerLetters.push(dailyData.letters[i]);
        }
    }
    var puzzleLetters = [dailyData.centerLetter].concat(outerLetters);
    var puzzleObj = {
        letters: puzzleLetters,
        centerLetter: dailyData.centerLetter
    };
    currentPuzzleId = 'daily_' + dailyData.date;
    dailyPlayed = true;
    currentGameIsDaily = true;
    currentGameIsWeekly = false;
    startGameWithPuzzle(puzzleObj);
    var badge = document.getElementById('daily-badge');
    if (badge) {
        badge.textContent = 'DAILY';
        badge.classList.remove('hidden');
    }
    console.log('[SP] Starting DAILY puzzle');
}

// ─── Puzzle Selector ───────────────────
function showPuzzleSelector() {
    // Don't clear game state here — let saved progress persist for return visits
    // Don't mark daily as completed — only handleComplete() does that
    currentGameIsWeekly = false;
    currentGameIsDaily = false;

    document.body.classList.remove('game-active');
    gameScreen.style.display = 'none';
    puzzleSelector.style.display = 'flex';
    var help = document.getElementById('game-help');
    if (help) help.style.display = '';
    var badge = document.getElementById('daily-badge');
    if (badge) badge.classList.add('hidden');
    renderPuzzleGrid();
}

function showGameScreen() {
    puzzleSelector.style.display = 'none';
    gameScreen.style.display = 'block';
    var help = document.getElementById('game-help');
    if (help) help.style.display = 'none';
    document.body.classList.add('game-active');
    window.scrollTo(0, 0);
}

function renderPuzzleGrid() {
    var stats = loadStats();
    var completed = stats.completedPuzzles || [];
    var completedMap = {};
    for (var c = 0; c < completed.length; c++) {
        completedMap[completed[c]] = true;
    }

    puzzleGrid.innerHTML = '';

    // Daily challenge card at top (if available)
    if (dailyData && dailyData.letters && dailyData.centerLetter) {
        var dailyId = 'daily_' + dailyData.date;
        var dCard = document.createElement('div');
        dCard.className = 'puzzle-card daily-card';
        if (dailyPlayed || completedMap[dailyId]) dCard.className += ' completed';

        var dBadge = document.createElement('div');
        dBadge.className = 'weekly-badge';
        dBadge.textContent = 'DAILY';
        dCard.appendChild(dBadge);

        var dName = document.createElement('div');
        dName.className = 'puzzle-name';
        dName.textContent = 'Daily Challenge';
        dCard.appendChild(dName);

        var dDate = document.createElement('div');
        dDate.className = 'puzzle-theme';
        dDate.textContent = dailyData.date;
        dCard.appendChild(dDate);

        if (dailyPlayed || completedMap[dailyId]) {
            var dCheck = document.createElement('div');
            dCheck.className = 'puzzle-completed-check';
            dCheck.textContent = '\u2713';
            dCard.appendChild(dCheck);
        }

        dCard.addEventListener('click', function() {
            startDaily();
        });
        puzzleGrid.appendChild(dCard);
    }

    // Weekly challenge card (if available)
    if (weeklyData && weeklyData.letters && weeklyData.centerLetter) {
        var weeklyId = 'weekly_' + weeklyData.weekStart;
        var wCard = document.createElement('div');
        wCard.className = 'puzzle-card weekly-card';
        if (weeklyPlayed || completedMap[weeklyId]) wCard.className += ' completed';

        var wBadge = document.createElement('div');
        wBadge.className = 'weekly-badge';
        wBadge.textContent = 'WEEKLY';
        wCard.appendChild(wBadge);

        var wName = document.createElement('div');
        wName.className = 'puzzle-name';
        wName.textContent = 'Weekly Challenge';
        wCard.appendChild(wName);

        var wDate = document.createElement('div');
        wDate.className = 'puzzle-theme';
        wDate.textContent = 'Week of ' + weeklyData.weekStart;
        wCard.appendChild(wDate);

        if (weeklyPlayed || completedMap[weeklyId]) {
            var wCheck = document.createElement('div');
            wCheck.className = 'puzzle-completed-check';
            wCheck.textContent = '\u2713';
            wCard.appendChild(wCheck);
        }

        wCard.addEventListener('click', function() {
            startWeekly();
        });
        puzzleGrid.appendChild(wCard);
    }

    for (var i = 0; i < puzzles.length; i++) {
        var p = puzzles[i];
        var card = document.createElement('div');
        card.className = 'puzzle-card';
        if (completedMap[p.id]) card.className += ' completed';
        card.dataset.puzzleId = p.id;

        var numSpan = document.createElement('div');
        numSpan.className = 'puzzle-num';
        numSpan.textContent = '#' + p.id;
        card.appendChild(numSpan);

        var nameSpan = document.createElement('div');
        nameSpan.className = 'puzzle-name';
        nameSpan.textContent = p.name || 'Puzzle ' + p.id;
        card.appendChild(nameSpan);

        var themeSpan = document.createElement('div');
        themeSpan.className = 'puzzle-theme';
        themeSpan.textContent = p.theme || '';
        card.appendChild(themeSpan);

        (function(puzzleId) {
            card.addEventListener('click', function() {
                loadPuzzle(puzzleId);
            });
        })(p.id);

        puzzleGrid.appendChild(card);
    }

    // Random puzzle button
    randomPuzzleBtn.onclick = function() {
        var uncompleted = [];
        for (var j = 0; j < puzzles.length; j++) {
            if (!completedMap[puzzles[j].id]) uncompleted.push(puzzles[j].id);
        }
        var pool = uncompleted.length > 0 ? uncompleted : puzzles.map(function(p) { return p.id; });
        if (!pool.length) {
            loadRandomPuzzle();
            return;
        }
        var randomId = pool[Math.floor(Math.random() * pool.length)];
        loadPuzzle(randomId);
    };
}

function loadPuzzle(puzzleId) {
    showToast('Loading puzzle...');
    fetch(getGameBaseURL() + '/api/puzzles/' + encodeURIComponent(puzzleId))
        .then(function(res) { return res.json(); })
        .then(function(data) {
            hideToast();
            currentPuzzleId = puzzleId;
            startGameWithPuzzle(data);
        })
        .catch(function() {
            showToast('Failed to load puzzle. Try again.');
            setTimeout(hideToast, 3000);
        });
}

function loadRandomPuzzle() {
    showToast('Generating puzzle...');
    fetch(getGameBaseURL() + '/api/sp/random')
        .then(function(res) {
            if (!res.ok) throw new Error('random puzzle failed');
            return res.json();
        })
        .then(function(data) {
            hideToast();
            currentPuzzleId = data.id || ('random_' + Date.now());
            startGameWithPuzzle(data);
        })
        .catch(function() {
            showToast('Could not generate a puzzle. Try again.');
            setTimeout(hideToast, 3000);
        });
}

// ─── Game Logic ────────────────────────
function startGameWithPuzzle(puzzleData) {
    letters = puzzleData.letters;
    centerLetter = puzzleData.centerLetter;

    // Hide weekly badge by default (startWeekly shows it when appropriate)
    var badge = document.getElementById('daily-badge');
    if (badge) badge.classList.add('hidden');

    // Find all valid words for this puzzle from our dictionary
    var letterSet = {};
    for (var i = 0; i < letters.length; i++) letterSet[letters[i]] = true;

    validWords = {};
    var allDictWords = Object.keys(dictionary);
    for (var j = 0; j < allDictWords.length; j++) {
        var w = allDictWords[j];
        if (w.length < 3) continue;
        if (w.indexOf(centerLetter) === -1) continue;
        var valid = true;
        for (var k = 0; k < w.length; k++) {
            if (!letterSet[w[k]]) { valid = false; break; }
        }
        if (valid) validWords[w] = true;
    }

    // Split into common, rare, hidden, 3-letter based on frequency data
    var ZIPF_COMMON_THRESHOLD = 3.0;
    commonWords = {};
    rareWords = {};
    hiddenWords = {};
    threeLetterWords = {};
    commonCount = 0;
    rareCount = 0;
    hiddenCount = 0;
    threeLetterCount = 0;

    var wordKeys = Object.keys(validWords);
    var hasFreq = Object.keys(frequencyData).length > 0;

    for (var m = 0; m < wordKeys.length; m++) {
        var word = wordKeys[m];
        if (word.length === 3) {
            threeLetterWords[word] = true;
            threeLetterCount++;
            continue;
        }
        if (!hasFreq) {
            commonWords[word] = true;
            commonCount++;
        } else {
            var zipf = frequencyData[word];
            if (zipf !== undefined) {
                if (zipf >= ZIPF_COMMON_THRESHOLD) {
                    commonWords[word] = true;
                    commonCount++;
                } else {
                    rareWords[word] = true;
                    rareCount++;
                }
            } else {
                hiddenWords[word] = true;
                hiddenCount++;
            }
        }
    }

    // Reset found state
    foundCommon = {};
    foundRare = {};
    foundHidden = {};
    foundThreeLetter = {};
    foundCommonCount = 0;
    foundRareCount = 0;
    foundHiddenCount = 0;
    foundThreeLetterCount = 0;
    currentScore = 0;
    currentWordBuffer = '';

    // Restore saved progress if same puzzle
    var saved = loadGameState();
    if (saved && saved.puzzleId === currentPuzzleId) {
        var sc = saved.foundCommon || [];
        for (var si = 0; si < sc.length; si++) {
            if (validWords[sc[si]] && commonWords[sc[si]] && !foundCommon[sc[si]]) {
                foundCommon[sc[si]] = true;
                foundCommonCount++;
            }
        }
        var sr = saved.foundRare || [];
        for (var sj = 0; sj < sr.length; sj++) {
            if (validWords[sr[sj]] && rareWords[sr[sj]] && !foundRare[sr[sj]]) {
                foundRare[sr[sj]] = true;
                foundRareCount++;
            }
        }
        var sh = saved.foundHidden || [];
        for (var sk = 0; sk < sh.length; sk++) {
            if (validWords[sh[sk]] && hiddenWords[sh[sk]] && !foundHidden[sh[sk]]) {
                foundHidden[sh[sk]] = true;
                foundHiddenCount++;
            }
        }
        currentScore = saved.currentScore || 0;
        if (saved.isWeekly || saved.isDaily) currentGameIsWeekly = true;
        console.log('[SP] Restored saved progress:', foundCommonCount, 'common,', foundRareCount, 'rare,', foundHiddenCount, 'hidden');
    } else {
        // New puzzle — clear any stale saved state
        clearGameState();
    }

    // Show game
    showGameScreen();

    // Puzzle info
    var isWeeklyPuzzle = typeof currentPuzzleId === 'string' && currentPuzzleId.indexOf('weekly_') === 0;
    if (isWeeklyPuzzle) {
        puzzleNumEl.textContent = '';
        puzzleNameEl.textContent = 'Weekly Puzzle';
        puzzleThemeBadgeEl.textContent = weeklyData ? weeklyData.weekStart : '';
        puzzleThemeBadgeEl.style.display = '';
        puzzleInfoEl.classList.remove('hidden');
    } else {
        var puzzleMeta = null;
        for (var p = 0; p < puzzles.length; p++) {
            if (puzzles[p].id === currentPuzzleId) { puzzleMeta = puzzles[p]; break; }
        }
        if (puzzleMeta) {
            puzzleNumEl.textContent = '#' + puzzleMeta.id;
            puzzleNameEl.textContent = puzzleMeta.name || '';
            puzzleThemeBadgeEl.textContent = puzzleMeta.theme || '';
            puzzleThemeBadgeEl.style.display = puzzleMeta.theme ? '' : 'none';
            puzzleInfoEl.classList.remove('hidden');
        } else {
            puzzleInfoEl.classList.add('hidden');
        }
    }

    // Render
    renderHoneycomb();
    renderCurrentWord();
    updateProgress();
    renderFoundWords();
    updateCheatSheet();
    incorrectArea.innerHTML = '';
    if (window.WinCard) WinCard.hide();

    // Track game start
    saveStats(true, false);
}

// --- Library word reporting ---
function reportLibraryWord(word, gameId) {
  if (!isLoggedIn || !word) return;
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

function submitGuess(word) {
    word = word.toLowerCase().trim();

    if (word.length < MIN_WORD_LENGTH) {
        showIncorrect(word, 'too_short');
        return;
    }

    // Check all letters are in the puzzle
    var letterSet = {};
    for (var i = 0; i < letters.length; i++) letterSet[letters[i]] = true;
    for (var j = 0; j < word.length; j++) {
        if (!letterSet[word[j]]) {
            showIncorrect(word, 'incorrect');
            return;
        }
    }

    // Check center letter
    if (word.indexOf(centerLetter) === -1) {
        showIncorrect(word, 'missing_center');
        return;
    }

    // Already found?
    if (foundCommon[word] || foundRare[word] || foundHidden[word] || foundThreeLetter[word]) {
        showIncorrect(word, 'already_found');
        return;
    }

    // Valid word?
    if (!validWords[word]) {
        showIncorrect(word, 'incorrect');
        return;
    }

    // Score the word (3-layer: word rarity + letter rarity + length bonus + pangram)
    var isPangram = isPangramWord(word);
    var isRare = !!rareWords[word];
    var isHidden = !!hiddenWords[word];
    var isThreeLetter = !!threeLetterWords[word];
    var score = _scoreWordFull(word, isRare, isHidden, isThreeLetter, isPangram);

    currentScore += score;

    if (isThreeLetter) {
        foundThreeLetter[word] = true;
        foundThreeLetterCount++;
    } else if (isHidden) {
        foundHidden[word] = true;
        foundHiddenCount++;
    } else if (isRare) {
        foundRare[word] = true;
        foundRareCount++;
    } else {
        foundCommon[word] = true;
        foundCommonCount++;
    }

    reportLibraryWord(word, 'spellingbee-sp');

    saveGameState();
    debouncedSaveToServer();
    updateProgress();
    renderFoundWords();

    // Check completion — common words only
    if (foundCommonCount === commonCount && commonCount > 0) {
        handleComplete();
    }
}

function isPangramWord(word) {
    var used = {};
    for (var i = 0; i < word.length; i++) used[word[i]] = true;
    for (var j = 0; j < letters.length; j++) {
        if (!used[letters[j]]) return false;
    }
    return true;
}

// ─── Daily share ─────────────────────────────────────────────────────────
// Built at completion time, invoked by the WinCard's Share action.
var shareText = '';
function shareResult() {
  if (!shareText) return;
  if (navigator.share) {
    navigator.share({ text: shareText }).catch(function () {});
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareText).then(function () { showToast('Copied!'); }, function () {
      try { window.prompt('Copy your result:', shareText); } catch (e) {}
    });
  } else {
    try { window.prompt('Copy your result:', shareText); } catch (e) {}
  }
}

// Winner identity from the relay session captured in checkSession().
function buildWinner() {
  if (!userSession) return { displayName: 'You', platform: 'web' };
  return {
    displayName: userSession.globalName || userSession.displayName || userSession.username || 'You',
    username: userSession.username,
    platform: 'discord',
    platformUserId: userSession.id,
    linkedDiscord: userSession.id,
    profilePic: userSession.avatar || userSession.profilePic || null
  };
}

function handleComplete() {
    clearGameState();
    clearGameStateFromServer();

    // Mark weekly as completed now that all common words are found
    if (currentGameIsWeekly && weeklyData && weeklyData.weekStart) {
        saveServerCompletion(weeklyData.weekStart);
        try { localStorage.setItem('spellingbee_sp_weekly', weeklyData.weekStart); } catch (_) {}
    }

    // Mark daily as completed
    if (currentGameIsDaily && dailyData && dailyData.date) {
        saveDailyServerCompletion(dailyData.date);
        try { localStorage.setItem('spellingbee_sp_daily', dailyData.date); } catch (_) {}
    }

    // Spelling Bee has no single winning word and no guess count, so the
    // per-puzzle numbers go on the card's free-text stats line instead of the
    // word/guesses/XP chips.
    var statsText = foundCommonCount + ' words found \u00B7 score ' + currentScore;
    var bonusParts = [];
    if (foundRareCount > 0) bonusParts.push(foundRareCount + ' rare');
    if (foundHiddenCount > 0) bonusParts.push(foundHiddenCount + ' ultra rare');
    if (foundThreeLetterCount > 0) bonusParts.push(foundThreeLetterCount + ' three-letter');
    if (bonusParts.length > 0) statsText += ' \u00B7 + ' + bonusParts.join(' + ') + ' bonus';

    var shareLabel = (currentGameIsDaily && dailyData && dailyData.date) ? 'Daily ' + dailyData.date
        : ((currentGameIsWeekly && weeklyData && weeklyData.weekStart) ? 'Weekly ' + weeklyData.weekStart : '');
    shareText = '\uD83D\uDC1D Spelling Bee ' + shareLabel + ' \u2014 ' + foundCommonCount + ' words, score ' + currentScore +
        '\nhttps://wordtycoon.live/spellingbee/solo/';

    // Record the completion BEFORE the card renders so the total-wins chip
    // counts this puzzle.
    saveStats(false, true);

    if (!window.WinCard) return;
    var actions = [];
    if (shareLabel) actions.push({ label: 'Share', primary: true, onClick: shareResult });
    actions.push({
        label: 'New Puzzle',
        onClick: function () { WinCard.hide(); showPuzzleSelector(); }
    });
    WinCard.showSolo({
        game: 'spellingbee',
        gameName: 'Spelling Bee',
        winner: buildWinner(),
        totalWins: loadStats().gamesCompleted,
        stats: statsText,
        actions: actions,
        // Sticky \u2014 the old overlay stayed up until New Game was clicked.
        autoHideMs: 0
    });
}

function showWeeklyCompleted() {
    // The old #win-overlay this used to repaint is gone; the same notice now
    // renders as a sticky WinCard (the player did complete the weekly \u2014 just
    // not in this sitting).
    if (!window.WinCard) {
        showToast("You've already finished this week's challenge.");
        return;
    }
    WinCard.showSolo({
        game: 'spellingbee',
        gameName: 'Spelling Bee',
        winner: buildWinner(),
        totalWins: loadStats().gamesCompleted,
        stats: "Weekly completed \u2014 you've already finished this week's challenge.",
        actions: [
            { label: 'New Puzzle', primary: true, onClick: function () { WinCard.hide(); showPuzzleSelector(); } },
            { label: '\u2190 Back to Portal', href: '/me' }
        ],
        autoHideMs: 0
    });
}

// ─── Honeycomb Rendering ───────────────
function renderHoneycomb() {
    hexRowTop.innerHTML = '';
    hexRowMid.innerHTML = '';
    hexRowBot.innerHTML = '';

    // Layout: top row = 2 cells, mid row = 3 cells (center in middle), bot row = 2 cells
    // letters[0] = center, letters[1-6] = outer
    var outer = letters.slice(1);

    // Top row: outer[0], outer[1]
    hexRowTop.appendChild(createHexCell(outer[0], false));
    hexRowTop.appendChild(createHexCell(outer[1], false));

    // Mid row: outer[2], CENTER, outer[3]
    hexRowMid.appendChild(createHexCell(outer[2], false));
    hexRowMid.appendChild(createHexCell(letters[0], true));
    hexRowMid.appendChild(createHexCell(outer[3], false));

    // Bot row: outer[4], outer[5]
    hexRowBot.appendChild(createHexCell(outer[4], false));
    hexRowBot.appendChild(createHexCell(outer[5], false));
}

function createHexCell(letter, isCenter) {
    var cell = document.createElement('div');
    cell.className = 'hex-cell' + (isCenter ? ' center' : '');
    cell.textContent = letter.toUpperCase();
    cell.dataset.letter = letter;
    cell.setAttribute('role', 'button'); cell.tabIndex = 0;
    cell.setAttribute('aria-label', 'Letter ' + letter.toUpperCase() + (isCenter ? ', center letter' : ''));
    cell.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); cell.click(); } });
    // Click handler — suppressed during and right after drag
    cell.addEventListener('click', function(e) {
        if (isDragging || dragJustEnded) return;
        cell.classList.remove('pop-animation');
        void cell.offsetWidth;
        cell.classList.add('pop-animation');
        currentWordBuffer += letter;
        renderCurrentWord();
    });
    return cell;
}

function shuffleOuter() {
    var outer = letters.slice(1);
    for (var i = outer.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = outer[i];
        outer[i] = outer[j];
        outer[j] = temp;
    }
    letters = [letters[0]].concat(outer);
    renderHoneycomb();
}

function renderCurrentWord() {
    var html = '';
    for (var i = 0; i < currentWordBuffer.length; i++) {
        var ch = currentWordBuffer[i];
        if (ch === centerLetter) {
            html += '<span class="center-letter">' + ch.toUpperCase() + '</span>';
        } else {
            html += ch.toUpperCase();
        }
    }
    currentWordEl.innerHTML = html || '&nbsp;';
    if (scoreValEl) scoreValEl.textContent = currentScore;
}

// ─── Progress & Found Words ────────────
function updateProgress() {
    // Goal = common words only
    foundCountEl.textContent = foundCommonCount;
    totalCountEl.textContent = commonCount;
    foundLabel.textContent = foundCommonCount;
    var pct = commonCount > 0 ? (foundCommonCount / commonCount * 100) : 0;
    progressBar.style.width = pct + '%';
    if (scoreValEl) scoreValEl.textContent = currentScore;

    // Rare counter
    if (rareCount > 0) {
        rareCountEl.textContent = '+' + foundRareCount + ' rare';
        rareCountEl.classList.remove('hidden');
    } else {
        rareCountEl.classList.add('hidden');
    }

    // Ultra rare counter
    if (hiddenCountEl) {
        if (hiddenCount > 0) {
            hiddenCountEl.textContent = '+' + foundHiddenCount + ' ultra rare';
            hiddenCountEl.classList.remove('hidden');
        } else {
            hiddenCountEl.classList.add('hidden');
        }
    }

    // 3-letter counter
    if (threeLetterCountEl) {
        if (threeLetterCount > 0) {
            threeLetterCountEl.textContent = '+' + foundThreeLetterCount + ' 3-letter';
            threeLetterCountEl.classList.remove('hidden');
        } else {
            threeLetterCountEl.classList.add('hidden');
        }
    }
}

function renderFoundWords() {
    // Common words
    var commonKeys = Object.keys(foundCommon).sort();
    if (commonKeys.length === 0) {
        foundWordsList.innerHTML = '<span class="found-empty">No words found yet</span>';
    } else {
        var html = '';
        for (var i = 0; i < commonKeys.length; i++) {
            var w = commonKeys[i];
            var cls = 'found-word';
            if (isPangramWord(w)) cls += ' pangram';
            html += '<span class="' + cls + '">' + w + '</span>';
        }
        foundWordsList.innerHTML = html;
    }

    // Rare words
    var rareKeys = Object.keys(foundRare).sort();
    rareLabelEl.textContent = foundRareCount;
    if (rareCount > 0) {
        rareSection.style.display = '';
        if (rareKeys.length === 0) {
            rareWordsList.innerHTML = '<span class="found-empty">Find bonus rare words!</span>';
        } else {
            var rHtml = '';
            for (var r = 0; r < rareKeys.length; r++) {
                var rw = rareKeys[r];
                var rCls = 'found-word rare';
                if (isPangramWord(rw)) rCls += ' pangram';
                rHtml += '<span class="' + rCls + '">' + rw + '</span>';
            }
            rareWordsList.innerHTML = rHtml;
        }
    } else {
        rareSection.style.display = 'none';
    }

    // Hidden words (ultra rare)
    if (hiddenSection) {
        var hiddenKeys = Object.keys(foundHidden).sort();
        if (hiddenLabelEl) hiddenLabelEl.textContent = foundHiddenCount;
        if (hiddenCount > 0) {
            hiddenSection.style.display = '';
            if (hiddenKeys.length === 0) {
                hiddenWordsList.innerHTML = '<span class="found-empty">Ultra rare words — 4 pts each</span>';
            } else {
                var hHtml = '';
                for (var h = 0; h < hiddenKeys.length; h++) {
                    var hw = hiddenKeys[h];
                    var hCls = 'found-word hidden-word';
                    if (isPangramWord(hw)) hCls += ' pangram';
                    hHtml += '<span class="' + hCls + '">' + hw + '</span>';
                }
                hiddenWordsList.innerHTML = hHtml;
            }
        } else {
            hiddenSection.style.display = 'none';
        }
    }

    // 3-letter words
    if (threeLetterSection) {
        var tlKeys = Object.keys(foundThreeLetter).sort();
        if (threeLetterLabelEl) threeLetterLabelEl.textContent = foundThreeLetterCount;
        if (threeLetterCount > 0) {
            threeLetterSection.style.display = '';
            if (tlKeys.length === 0) {
                threeLetterWordsList.innerHTML = '<span class="found-empty">3-letter words — 1 pt each</span>';
            } else {
                var tlHtml = '';
                for (var tl = 0; tl < tlKeys.length; tl++) {
                    tlHtml += '<span class="found-word three-letter">' + tlKeys[tl] + '</span>';
                }
                threeLetterWordsList.innerHTML = tlHtml;
            }
        } else {
            threeLetterSection.style.display = 'none';
        }
    }
}

function updateCheatSheet() {
    if (!window.SpellingBeeCheatSheet) return;
    var wordKeys = Object.keys(validWords).sort();
    var entries = [];
    for (var i = 0; i < wordKeys.length; i++) {
        var word = wordKeys[i];
        entries.push({
            word: word,
            score: _scoreWordFull(word, !!rareWords[word], !!hiddenWords[word], !!threeLetterWords[word], isPangramWord(word))
        });
    }
    window.SpellingBeeCheatSheet.setSummary({
        letters: letters,
        centerLetter: centerLetter,
        words: entries
    });
}

// ─── Incorrect Feedback ────────────────
function showIncorrect(word, reason) {
    var tag = document.createElement('span');
    var cls, text;
    if (reason === 'already_found') {
        cls = 'already-found-tag';
        text = word.toUpperCase();
    } else if (reason === 'too_short') {
        cls = 'too-short-tag';
        text = 'Too short';
    } else if (reason === 'missing_center') {
        cls = 'missing-center-tag';
        text = 'Missing center letter';
    } else {
        cls = 'incorrect-word';
        text = word.toUpperCase();
    }
    tag.className = cls;
    tag.textContent = text;
    incorrectArea.appendChild(tag);

    // Also shake the current word display
    currentWordEl.classList.remove('shake');
    void currentWordEl.offsetWidth;
    currentWordEl.classList.add('shake');

    setTimeout(function() {
        tag.classList.add('fading');
        setTimeout(function() {
            if (tag.parentNode) tag.parentNode.removeChild(tag);
        }, 400);
    }, 1500);
}

// ─── Stats ─────────────────────────────
function loadStats() {
    try {
        var raw = localStorage.getItem(STATS_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
        gamesPlayed: 0,
        gamesCompleted: 0,
        totalWordsFound: 0,
        totalRareFound: 0,
        bestCompletion: 0,
        completedPuzzles: [],
        history: []
    };
}

function saveStats(isStart, isComplete) {
    var stats = loadStats();
    if (isStart) {
        stats.gamesPlayed++;
    }
    if (isComplete) {
        stats.gamesCompleted++;
        var pct = commonCount > 0 ? Math.round(foundCommonCount / commonCount * 100) : 0;
        if (pct > stats.bestCompletion) stats.bestCompletion = pct;
        if (currentPuzzleId && stats.completedPuzzles.indexOf(currentPuzzleId) === -1) {
            stats.completedPuzzles.push(currentPuzzleId);
        }
        stats.totalWordsFound = (stats.totalWordsFound || 0) + foundCommonCount + foundRareCount + foundHiddenCount;
        stats.totalRareFound = (stats.totalRareFound || 0) + foundRareCount;
    }

    // Keep last 20 in history
    stats.history = stats.history || [];
    if (isComplete || isStart) {
        stats.history.unshift({
            puzzleId: currentPuzzleId,
            wordsFound: foundCommonCount,
            rareFound: foundRareCount,
            score: currentScore,
            timestamp: Date.now()
        });
        if (stats.history.length > 20) stats.history.length = 20;
    }

    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
}

function renderStats() {
    var stats = loadStats();
    document.getElementById('stat-played').textContent = stats.gamesPlayed || 0;
    document.getElementById('stat-completed').textContent = stats.gamesCompleted || 0;
    document.getElementById('stat-words').textContent = stats.totalWordsFound || 0;
    document.getElementById('stat-best').textContent = (stats.bestCompletion || 0) + '%';
}

// ─── Game State Persistence ─────────────
function saveGameState() {
    var state = {
        puzzleId: currentPuzzleId,
        letters: letters,
        centerLetter: centerLetter,
        isWeekly: currentGameIsWeekly,
        isDaily: currentGameIsDaily,
        foundCommon: Object.keys(foundCommon),
        foundRare: Object.keys(foundRare),
        foundHidden: Object.keys(foundHidden),
        foundThreeLetter: Object.keys(foundThreeLetter),
        currentScore: currentScore,
        timestamp: Date.now()
    };
    try { localStorage.setItem(GAME_STATE_KEY, JSON.stringify(state)); } catch (e) {}
}

function loadGameState() {
    try {
        var raw = localStorage.getItem(GAME_STATE_KEY);
        if (!raw) return null;
        var state = JSON.parse(raw);
        // Validate required fields
        if (!state || !state.puzzleId || !state.letters || !state.centerLetter) return null;
        if (!Array.isArray(state.letters) || state.letters.length !== 7) return null;
        if (!Array.isArray(state.foundCommon)) return null;
        if (!Array.isArray(state.foundRare)) return null;
        return state;
    } catch (e) {
        return null;
    }
}

function clearGameState() {
    try { localStorage.removeItem(GAME_STATE_KEY); } catch (e) {}
}

function restoreGameState(saved) {
    // Rebuild puzzle letters and center from saved state
    letters = saved.letters;
    centerLetter = saved.centerLetter;
    currentPuzzleId = saved.puzzleId;
    currentGameIsWeekly = !!saved.isWeekly;
    currentGameIsDaily = !!saved.isDaily;

    // Build valid/common/rare word sets from dictionary (same logic as startGameWithPuzzle)
    var letterSet = {};
    for (var i = 0; i < letters.length; i++) letterSet[letters[i]] = true;

    validWords = {};
    var allDictWords = Object.keys(dictionary);
    for (var j = 0; j < allDictWords.length; j++) {
        var w = allDictWords[j];
        if (w.length < 3) continue;
        if (w.indexOf(centerLetter) === -1) continue;
        var valid = true;
        for (var k = 0; k < w.length; k++) {
            if (!letterSet[w[k]]) { valid = false; break; }
        }
        if (valid) validWords[w] = true;
    }

    var ZIPF_COMMON_THRESHOLD = 3.0;
    commonWords = {};
    rareWords = {};
    hiddenWords = {};
    threeLetterWords = {};
    commonCount = 0;
    rareCount = 0;
    hiddenCount = 0;
    threeLetterCount = 0;

    var wordKeys = Object.keys(validWords);
    var hasFreq = Object.keys(frequencyData).length > 0;

    for (var m = 0; m < wordKeys.length; m++) {
        var word = wordKeys[m];
        if (word.length === 3) {
            threeLetterWords[word] = true;
            threeLetterCount++;
            continue;
        }
        if (!hasFreq) {
            commonWords[word] = true;
            commonCount++;
        } else {
            var zipf = frequencyData[word];
            if (zipf !== undefined) {
                if (zipf >= ZIPF_COMMON_THRESHOLD) {
                    commonWords[word] = true;
                    commonCount++;
                } else {
                    rareWords[word] = true;
                    rareCount++;
                }
            } else {
                hiddenWords[word] = true;
                hiddenCount++;
            }
        }
    }

    // Restore found words — only accept words that are actually valid for this puzzle
    foundCommon = {};
    foundRare = {};
    foundHidden = {};
    foundThreeLetter = {};
    foundCommonCount = 0;
    foundRareCount = 0;
    foundHiddenCount = 0;
    foundThreeLetterCount = 0;
    currentScore = 0;

    for (var ci = 0; ci < saved.foundCommon.length; ci++) {
        var cw = saved.foundCommon[ci];
        if (commonWords[cw] && !foundCommon[cw]) {
            foundCommon[cw] = true;
            foundCommonCount++;
            currentScore += _scoreWordFull(cw, false, false, false, isPangramWord(cw));
        }
    }

    for (var ri = 0; ri < saved.foundRare.length; ri++) {
        var rw = saved.foundRare[ri];
        if (rareWords[rw] && !foundRare[rw]) {
            foundRare[rw] = true;
            foundRareCount++;
            currentScore += _scoreWordFull(rw, true, false, false, isPangramWord(rw));
        }
    }

    var savedHidden = saved.foundHidden || [];
    for (var hi = 0; hi < savedHidden.length; hi++) {
        var hw = savedHidden[hi];
        if (hiddenWords[hw] && !foundHidden[hw]) {
            foundHidden[hw] = true;
            foundHiddenCount++;
            currentScore += _scoreWordFull(hw, false, true, false, isPangramWord(hw));
        }
    }

    var savedThreeLetter = saved.foundThreeLetter || [];
    for (var ti = 0; ti < savedThreeLetter.length; ti++) {
        var tw = savedThreeLetter[ti];
        if (threeLetterWords[tw] && !foundThreeLetter[tw]) {
            foundThreeLetter[tw] = true;
            foundThreeLetterCount++;
            currentScore += _scoreWordFull(tw, false, false, true, isPangramWord(tw));
        }
    }

    currentWordBuffer = '';

    // Show game screen
    showGameScreen();

    // Puzzle info
    var isSpecialPuzzle = typeof currentPuzzleId === 'string' && (currentPuzzleId.indexOf('weekly_') === 0 || currentPuzzleId.indexOf('daily_') === 0);
    if (isSpecialPuzzle) {
        puzzleNumEl.textContent = '';
        if (currentGameIsDaily) {
            puzzleNameEl.textContent = 'Daily Puzzle';
            puzzleThemeBadgeEl.textContent = dailyData ? dailyData.date : '';
        } else {
            puzzleNameEl.textContent = 'Weekly Puzzle';
            puzzleThemeBadgeEl.textContent = weeklyData ? weeklyData.weekStart : '';
        }
        puzzleThemeBadgeEl.style.display = '';
        puzzleInfoEl.classList.remove('hidden');
        var badge = document.getElementById('daily-badge');
        if (badge) {
            badge.textContent = currentGameIsDaily ? 'DAILY' : 'WEEKLY';
            badge.classList.remove('hidden');
        }
    } else {
        var puzzleMeta = null;
        for (var p = 0; p < puzzles.length; p++) {
            if (puzzles[p].id === currentPuzzleId) { puzzleMeta = puzzles[p]; break; }
        }
        if (puzzleMeta) {
            puzzleNumEl.textContent = '#' + puzzleMeta.id;
            puzzleNameEl.textContent = puzzleMeta.name || '';
            puzzleThemeBadgeEl.textContent = puzzleMeta.theme || '';
            puzzleThemeBadgeEl.style.display = puzzleMeta.theme ? '' : 'none';
            puzzleInfoEl.classList.remove('hidden');
        } else {
            puzzleInfoEl.classList.add('hidden');
        }
        var badge2 = document.getElementById('daily-badge');
        if (badge2) badge2.classList.add('hidden');
    }

    // Render
    renderHoneycomb();
    renderCurrentWord();
    updateProgress();
    renderFoundWords();
    updateCheatSheet();
    incorrectArea.innerHTML = '';
    if (window.WinCard) WinCard.hide();

    console.log('[SP] Restored saved game for puzzle', currentPuzzleId,
        '- found', foundCommonCount, '/', commonCount, 'common,',
        foundRareCount, 'rare,', foundHiddenCount, 'hidden');
}

// ─── Server Game State Sync ─────────────
function saveGameStateToServer() {
    if (!isLoggedIn || (!currentGameIsWeekly && !currentGameIsDaily)) return;
    var stateRaw = localStorage.getItem(GAME_STATE_KEY);
    if (!stateRaw) return;
    var state = JSON.parse(stateRaw);
    state.weekStart = weeklyData ? weeklyData.weekStart : null;
    state.date = dailyData ? dailyData.date : null;
    var x = new XMLHttpRequest();
    x.open('POST', '/api/sp-state/spellingbee-sp', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ state: state }));
}

function clearGameStateFromServer() {
    if (!isLoggedIn) return;
    var x = new XMLHttpRequest();
    x.open('DELETE', '/api/sp-state/spellingbee-sp', true);
    x.timeout=10000; x.ontimeout=x.onerror;
    x.send();
}

function loadGameStateFromServer(callback) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/sp-state/spellingbee-sp', true);
    x.onload = function() {
        if (x.status === 200) {
            try {
                var data = JSON.parse(x.responseText);
                callback(data.ok && data.state ? data.state : null);
            } catch(e) { callback(null); }
        } else { callback(null); }
    };
    x.onerror = function() { callback(null); };
    x.timeout=10000; x.ontimeout=x.onerror;
    x.send();
}

function debouncedSaveToServer() {
    if (stateSyncTimer) clearTimeout(stateSyncTimer);
    stateSyncTimer = setTimeout(saveGameStateToServer, 2000);
}

// ─── Toast ─────────────────────────────
function showToast(msg) {
    errorToast.textContent = msg;
    errorToast.classList.remove('hidden');
}

function hideToast() {
    errorToast.classList.add('hidden');
}

// ─── Bootstrap ─────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();
