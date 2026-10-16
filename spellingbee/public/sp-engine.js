(function() {
'use strict';

// ─── Constants ─────────────────────────
var STATS_KEY = 'spellingbee_sp_stats';
var BANNER_KEY = 'spellingbee_banner_dismissed';
var GAME_STATE_KEY = 'spellingbee_sp_game';
var MIN_WORD_LENGTH = 4;

// ─── State ─────────────────────────────
var dictionary = {};     // word -> true (all valid words)
var targetSet = {};      // word -> true (curated common words)
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

// Game state
var letters = [];        // [center, ...outer] — 7 letters
var centerLetter = '';
var validWords = {};     // word -> true (valid for this puzzle)
var commonWords = {};    // word -> true
var rareWords = {};      // word -> true
var commonCount = 0;
var rareCount = 0;
var foundCommon = {};
var foundRare = {};
var foundCommonCount = 0;
var foundRareCount = 0;
var currentScore = 0;
var currentWordBuffer = ''; // letters typed via hex clicks

// ─── DOM Refs ──────────────────────────
var puzzleSelector, puzzleGrid, randomPuzzleBtn, gameScreen, backBtn;
var hexRowTop, hexRowMid, hexRowBot, honeycombArea;
var currentWordEl, scoreValEl;
var btnDelete, btnShuffle, btnSubmit;
var progressBar, foundCountEl, totalCountEl, foundLabel;
var incorrectArea, foundWordsList;
var winOverlay, winStats, winRareStats, newGameBtn;
var statsDropdown, errorToast;
var puzzleInfoEl, puzzleNumEl, puzzleNameEl, puzzleThemeBadgeEl;
var rareCountEl, rareLabelEl, rareWordsList, rareSection;

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

    // Win
    winOverlay = document.getElementById('win-overlay');
    winStats = document.getElementById('win-stats');
    winRareStats = document.getElementById('win-rare-stats');
    newGameBtn = document.getElementById('new-game-btn');

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

    // Setup UI
    setupBanner();
    setupKeyboard();
    setupStats();
    setupActions();
    setupNewGame();
    setupBackButton();
    setupDragInput();

    // Check session first (for cross-device daily sync), then load data
    checkSession(function() { loadData(); });
}

function setupBanner() {
    var banner = document.getElementById('login-banner');
    if (localStorage.getItem(BANNER_KEY)) { banner.style.display = 'none'; return; }
    document.getElementById('dismiss-banner').onclick = function() {
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

        // If win overlay is showing in weekly mode, Enter or Space goes to portal
        if ((e.key === 'Enter' || e.key === ' ') && launchMode === 'weekly' && winOverlay && !winOverlay.classList.contains('hidden')) {
            e.preventDefault();
            window.location.href = '/me';
            return;
        }

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

function setupNewGame() {
    newGameBtn.onclick = function() {
        winOverlay.classList.add('hidden');
        showPuzzleSelector();
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
function getBaseURL() {
    var loc = window.location;
    return loc.protocol + '//' + loc.host;
}

function getWeekStart() {
    var d = new Date();
    var day = d.getUTCDay();
    var diff = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10);
}

function fetchServerCompletions(callback) {
    var baseURL = getBaseURL();
    var x = new XMLHttpRequest();
    // Check weekly completions (stored under key 'spellingbee-sp-weekly')
    x.open('GET', baseURL + '/api/sp-daily/status/spellingbee-sp-weekly', true);
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
        if (callback) callback();
    };
    x.onerror = function() { if (callback) callback(); };
    x.send();
}

function saveServerCompletion(weekStart) {
    if (!isLoggedIn) return;
    var baseURL = getBaseURL();
    var x = new XMLHttpRequest();
    x.open('POST', baseURL + '/api/sp-weekly/complete/spellingbee-sp', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ weekStart: weekStart, evidence: { foundWords: Object.keys(foundCommon).concat(Object.keys(foundRare)) } }));
}

function checkSession(callback) {
    var baseURL = getBaseURL();
    var x = new XMLHttpRequest();
    x.open('GET', baseURL + '/api/me/session', true);
    x.onload = function() {
        if (x.status === 200) {
            try {
                var data = JSON.parse(x.responseText);
                if (data.ok && data.user) {
                    isLoggedIn = true;
                    // Hide login banner — user is already logged in
                    var banner = document.getElementById('login-banner');
                    if (banner) banner.style.display = 'none';
                    fetchServerCompletions(callback);
                    return;
                }
            } catch(e) {}
        }
        if (callback) callback();
    };
    x.onerror = function() { if (callback) callback(); };
    x.send();
}

// ─── Data Loading ──────────────────────
function loadData() {
    showToast('Loading...');

    var dictionaryLoaded = false;
    var targetsLoaded = false;
    var puzzlesLoaded = false;

    // Load dictionary
    fetch('api/sp/dictionary')
        .then(function(res) { return res.json(); })
        .then(function(words) {
            dictionary = {};
            for (var i = 0; i < words.length; i++) {
                var w = words[i].trim().toLowerCase();
                if (w.length >= 4 && /^[a-z]+$/.test(w)) dictionary[w] = true;
            }
            dictionaryLoaded = true;
            checkAllLoaded();
        })
        .catch(function() {
            showToast('Failed to load dictionary. Retrying...');
            setTimeout(loadData, 3000);
        });

    // Load targets
    fetch('api/sp/targets')
        .then(function(res) { return res.json(); })
        .then(function(words) {
            targetSet = {};
            for (var i = 0; i < words.length; i++) {
                var w = words[i].trim().toLowerCase();
                if (w.length >= 4 && /^[a-z]+$/.test(w)) targetSet[w] = true;
            }
            targetsLoaded = true;
            checkAllLoaded();
        })
        .catch(function() {
            targetSet = {};
            targetsLoaded = true;
            checkAllLoaded();
        });

    // Load puzzles
    fetch('api/puzzles')
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

    // Fetch weekly puzzle — in weekly mode, defer startGame until fetch completes
    var weeklyFetched = false;
    if (launchMode === 'weekly') {
        fetchWeekly(function() {
            weeklyFetched = true;
            if (dictionaryLoaded && targetsLoaded && puzzlesLoaded) startGame();
        });
    } else {
        fetchWeekly();
    }

    function checkAllLoaded() {
        if (dictionaryLoaded && targetsLoaded && puzzlesLoaded) {
            if (launchMode === 'weekly') {
                // In weekly mode, wait for fetchWeekly to complete first
                if (weeklyFetched) startGame();
                return;
            }
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
            // For daily puzzles, also check that the date still matches
            var savedIsWeekly2 = typeof saved.puzzleId === 'string' && saved.puzzleId.indexOf('weekly_') === 0;
            var weeklyStale = savedIsWeekly2 && weeklyData && ('weekly_' + weeklyData.weekStart) !== saved.puzzleId;
            if (!weeklyStale) {
                restoreGameState(saved);
                return;
            }
            // Weekly puzzle changed — discard stale save
            clearGameState();
            saved = null;
        }

        // If no local state and weekly launch mode, try loading from server
        if (!saved && launchMode === 'weekly' && isLoggedIn) {
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
        // If weekly is available and not yet played, start it directly
        if (weeklyData && !weeklyPlayed && weeklyData.letters && weeklyData.centerLetter) {
            startWeekly();
        } else if (launchMode === 'weekly') {
            showWeeklyCompleted();
            return;
        } else {
            showPuzzleSelector();
        }
    }
}

// ─── Weekly Puzzle ─────────────────────
function fetchWeekly(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', 'api/sp/weekly', true);
    x.onload = function() {
        if (x.status === 200) {
            try {
                weeklyData = JSON.parse(x.responseText);
                var played = localStorage.getItem('spellingbee_sp_weekly');
                weeklyPlayed = (played === weeklyData.weekStart) || !!serverCompletedDates[weeklyData.weekStart];
                console.log('[SP] Weekly fetched, played:', weeklyPlayed);
                // If other data already loaded, re-check so weekly isn't missed
                if (!cb && dictionaryLoaded && targetsLoaded && puzzlesLoaded && !weeklyPlayed && weeklyData.letters && weeklyData.centerLetter) {
                    startWeekly();
                }
            } catch(e) { weeklyData = null; }
        }
        if (cb) cb();
    };
    x.onerror = function() { weeklyData = null; if (cb) cb(); };
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
    startGameWithPuzzle(puzzleObj);
    var badge = document.getElementById('daily-badge');
    if (badge) badge.classList.remove('hidden');
    console.log('[SP] Starting WEEKLY puzzle');
}

// ─── Puzzle Selector ───────────────────
function showPuzzleSelector() {
    // Don't clear game state here — let saved progress persist for return visits
    // Don't mark daily as completed — only handleComplete() does that
    currentGameIsWeekly = false;

    document.body.classList.remove('game-active');
    gameScreen.style.display = 'none';
    puzzleSelector.style.display = 'flex';
    var badge = document.getElementById('daily-badge');
    if (badge) badge.classList.add('hidden');
    renderPuzzleGrid();
}

function showGameScreen() {
    puzzleSelector.style.display = 'none';
    gameScreen.style.display = 'block';
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
        var randomId = pool[Math.floor(Math.random() * pool.length)];
        loadPuzzle(randomId);
    };
}

function loadPuzzle(puzzleId) {
    showToast('Loading puzzle...');
    fetch('api/puzzles/' + puzzleId)
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
        if (w.length < 4) continue;
        if (w.indexOf(centerLetter) === -1) continue;
        var valid = true;
        for (var k = 0; k < w.length; k++) {
            if (!letterSet[w[k]]) { valid = false; break; }
        }
        if (valid) validWords[w] = true;
    }

    // Split into common and rare
    commonWords = {};
    rareWords = {};
    commonCount = 0;
    rareCount = 0;

    var wordKeys = Object.keys(validWords);
    var hasTargets = Object.keys(targetSet).length > 0;

    for (var m = 0; m < wordKeys.length; m++) {
        var word = wordKeys[m];
        if (!hasTargets || targetSet[word]) {
            commonWords[word] = true;
            commonCount++;
        } else {
            rareWords[word] = true;
            rareCount++;
        }
    }

    // Reset found state
    foundCommon = {};
    foundRare = {};
    foundCommonCount = 0;
    foundRareCount = 0;
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
        currentScore = saved.currentScore || 0;
        if (saved.isWeekly || saved.isDaily) currentGameIsWeekly = true;
        console.log('[SP] Restored saved progress:', foundCommonCount, 'common,', foundRareCount, 'rare');
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
    incorrectArea.innerHTML = '';
    winOverlay.classList.add('hidden');

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
    style.textContent = '.library-toast{position:fixed;top:20px;right:20px;background:linear-gradient(135deg,#1a0f00,#2d1f0a);border:1px solid #8b6914;border-radius:12px;padding:12px 20px;color:#f5deb3;font-size:14px;font-weight:600;z-index:10000;opacity:0;transform:translateX(50px);transition:opacity .3s,transform .3s;pointer-events:none;box-shadow:0 4px 20px rgba(139,105,20,.3)}.library-toast.show{opacity:1;transform:translateX(0)}.library-toast strong{color:#ffd700;letter-spacing:1px}';
    document.head.appendChild(style);
  }
  var toast = document.createElement('div');
  toast.className = 'library-toast';
  toast.innerHTML = '\uD83D\uDCDA Word Found! <strong>' + word.toUpperCase() + '</strong>';
  document.body.appendChild(toast);
  setTimeout(function() { toast.classList.add('show'); }, 10);
  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
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
    if (foundCommon[word] || foundRare[word]) {
        showIncorrect(word, 'already_found');
        return;
    }

    // Valid word?
    if (!validWords[word]) {
        showIncorrect(word, 'incorrect');
        return;
    }

    // Score the word
    var score = word.length === 4 ? 1 : word.length;
    var isPangram = isPangramWord(word);
    if (isPangram) score += 7;
    var isRare = !!rareWords[word];
    if (isRare) score += 3;

    currentScore += score;

    if (isRare) {
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

    // Check completion
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

function handleComplete() {
    clearGameState();
    clearGameStateFromServer();

    // Mark weekly as completed now that all common words are found
    if (currentGameIsWeekly && weeklyData && weeklyData.weekStart) {
        localStorage.setItem('spellingbee_sp_weekly', weeklyData.weekStart);
        saveServerCompletion(weeklyData.weekStart);
    }

    var statsText = foundCommonCount + ' words found! Score: ' + currentScore;
    if (foundRareCount > 0) {
        winRareStats.textContent = '+ ' + foundRareCount + ' bonus rare words!';
        winRareStats.style.display = '';
    } else {
        winRareStats.textContent = '';
        winRareStats.style.display = 'none';
    }
    winStats.textContent = statsText;
    winOverlay.classList.remove('hidden');

    // In weekly launch mode, replace "New Game" button with portal link
    if (launchMode === 'weekly') {
        newGameBtn.textContent = '\u2190 Back to Portal';
        newGameBtn.onclick = function() { window.location.href = '/me'; };
    }

    saveStats(false, true);
}

function showWeeklyCompleted() {
    var overlay = document.getElementById('win-overlay') || document.querySelector('.win-overlay') || document.querySelector('.overlay');
    if (overlay) {
        overlay.innerHTML = '<div style="text-align:center;padding:40px 20px;"><div style="font-size:3rem;margin-bottom:12px;">\u2705</div><div style="font-size:1.3rem;font-weight:700;margin-bottom:8px;">Weekly Completed!</div><div style="color:#aaa;margin-bottom:16px;">You\'ve already finished this week\'s challenge.</div><a href="/me" style="display:inline-block;padding:10px 24px;background:#ffab00;color:#000;border-radius:8px;text-decoration:none;font-weight:600;">\u2190 Back to Portal</a></div>';
        overlay.classList.remove('hidden');
        overlay.style.display = '';
    }
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
    foundCountEl.textContent = foundCommonCount;
    totalCountEl.textContent = commonCount;
    foundLabel.textContent = foundCommonCount;
    var pct = commonCount > 0 ? (foundCommonCount / commonCount * 100) : 0;
    progressBar.style.width = pct + '%';
    if (scoreValEl) scoreValEl.textContent = currentScore;

    // Rare counter
    if (foundRareCount > 0) {
        rareCountEl.textContent = '+' + foundRareCount + ' rare';
        rareCountEl.classList.remove('hidden');
    } else {
        rareCountEl.classList.add('hidden');
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
        stats.totalWordsFound = (stats.totalWordsFound || 0) + foundCommonCount + foundRareCount;
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
        foundCommon: Object.keys(foundCommon),
        foundRare: Object.keys(foundRare),
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
    currentGameIsWeekly = !!saved.isWeekly || !!saved.isDaily; // backward compat

    // Build valid/common/rare word sets from dictionary (same logic as startGameWithPuzzle)
    var letterSet = {};
    for (var i = 0; i < letters.length; i++) letterSet[letters[i]] = true;

    validWords = {};
    var allDictWords = Object.keys(dictionary);
    for (var j = 0; j < allDictWords.length; j++) {
        var w = allDictWords[j];
        if (w.length < 4) continue;
        if (w.indexOf(centerLetter) === -1) continue;
        var valid = true;
        for (var k = 0; k < w.length; k++) {
            if (!letterSet[w[k]]) { valid = false; break; }
        }
        if (valid) validWords[w] = true;
    }

    commonWords = {};
    rareWords = {};
    commonCount = 0;
    rareCount = 0;

    var wordKeys = Object.keys(validWords);
    var hasTargets = Object.keys(targetSet).length > 0;

    for (var m = 0; m < wordKeys.length; m++) {
        var word = wordKeys[m];
        if (!hasTargets || targetSet[word]) {
            commonWords[word] = true;
            commonCount++;
        } else {
            rareWords[word] = true;
            rareCount++;
        }
    }

    // Restore found words — only accept words that are actually valid for this puzzle
    foundCommon = {};
    foundRare = {};
    foundCommonCount = 0;
    foundRareCount = 0;
    currentScore = 0;

    for (var ci = 0; ci < saved.foundCommon.length; ci++) {
        var cw = saved.foundCommon[ci];
        if (commonWords[cw]) {
            foundCommon[cw] = true;
            foundCommonCount++;
            var score = cw.length === 4 ? 1 : cw.length;
            if (isPangramWord(cw)) score += 7;
            currentScore += score;
        }
    }

    for (var ri = 0; ri < saved.foundRare.length; ri++) {
        var rw = saved.foundRare[ri];
        if (rareWords[rw]) {
            foundRare[rw] = true;
            foundRareCount++;
            var rScore = rw.length === 4 ? 1 : rw.length;
            if (isPangramWord(rw)) rScore += 7;
            rScore += 3; // rare bonus
            currentScore += rScore;
        }
    }

    currentWordBuffer = '';

    // Show game screen
    showGameScreen();

    // Puzzle info
    var isWeeklyPuzzle2 = typeof currentPuzzleId === 'string' && (currentPuzzleId.indexOf('weekly_') === 0 || currentPuzzleId.indexOf('daily_') === 0);
    if (isWeeklyPuzzle2) {
        puzzleNumEl.textContent = '';
        puzzleNameEl.textContent = 'Weekly Puzzle';
        puzzleThemeBadgeEl.textContent = weeklyData ? weeklyData.weekStart : '';
        puzzleThemeBadgeEl.style.display = '';
        puzzleInfoEl.classList.remove('hidden');
        var badge = document.getElementById('daily-badge');
        if (badge) badge.classList.remove('hidden');
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
    incorrectArea.innerHTML = '';
    winOverlay.classList.add('hidden');

    console.log('[SP] Restored saved game for puzzle', currentPuzzleId,
        '- found', foundCommonCount, '/', commonCount, 'common,',
        foundRareCount, 'rare');
}

// ─── Server Game State Sync ─────────────
function saveGameStateToServer() {
    if (!isLoggedIn || !currentGameIsWeekly) return;
    var stateRaw = localStorage.getItem(GAME_STATE_KEY);
    if (!stateRaw) return;
    var state = JSON.parse(stateRaw);
    state.weekStart = weeklyData ? weeklyData.weekStart : null;
    var x = new XMLHttpRequest();
    x.open('POST', '/api/sp-state/spellingbee-sp', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify({ state: state }));
}

function clearGameStateFromServer() {
    if (!isLoggedIn) return;
    var x = new XMLHttpRequest();
    x.open('DELETE', '/api/sp-state/spellingbee-sp', true);
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
