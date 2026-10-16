(function() {
'use strict';

var user = null;
var socket = null;
var currentWordBuffer = '';
var localLetters = []; // copy for shuffle (visual only)
var gameLetters = [];  // original letters from server

// Drag state
var isDragging = false;
var dragJustEnded = false;
var lastDragCellEl = null;
var dragPath = [];
var dragPreviewEl = null;
var svgOverlay = null;

// ─── DOM Refs ───
var loginScreen, gameUI;
var hexRowTop, hexRowMid, hexRowBot, honeycombArea;
var currentWordEl, scoreValEl;
var btnDelete, btnShuffle, btnSubmit;
var progressBar, foundCountEl, totalCountEl, foundLabel;
var incorrectArea, foundWordsList;
var winOverlay, winStats, winRareStats, countdownText;
var statsDropdown, errorToast;
var topPlayersEl;
var puzzleInfoEl, puzzleNumEl, puzzleNameEl, puzzleThemeBadgeEl;
var rareCountEl, rareLabelEl, rareWordsList, rareSection;
var dailyBadgeEl, frenzyBadgeEl, frenzyMultiplierEl;

function initDom() {
    loginScreen = document.getElementById('login-screen');
    gameUI = document.getElementById('game-ui');

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
    countdownText = document.getElementById('countdown-text');

    // Stats / misc
    statsDropdown = document.getElementById('stats-dropdown');
    errorToast = document.getElementById('error-toast');
    topPlayersEl = document.getElementById('top-players');

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

    // Daily/Frenzy badges
    dailyBadgeEl = document.getElementById('daily-badge');
    frenzyBadgeEl = document.getElementById('frenzy-badge');
    frenzyMultiplierEl = document.getElementById('frenzy-multiplier');
}

// ─── Auth Check ───
function checkAuth() {
    fetch('/api/me/session')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.ok) {
                user = data.user;
                showGame();
            } else {
                showLogin();
            }
        })
        .catch(function() { showLogin(); });
}

function showLogin() {
    document.body.classList.remove('game-active');
    loginScreen.style.display = 'flex';
    gameUI.style.display = 'none';
}

function showGame() {
    loginScreen.style.display = 'none';
    gameUI.style.display = 'block';
    document.body.classList.add('game-active');
    window.scrollTo(0, 0);
    connectSocket();
    fetchStats();
    setupKeyboard();
    setupActions();
    setupStatsToggle();
    setupDragInput();
}

// ─── Socket.IO ───
function connectSocket() {
    socket = io();

    socket.on('game-state', function(state) {
        renderGameState(state);
    });

    socket.on('guess-result', function(result) {
        handleGuessResult(result);
    });

    socket.on('word-found', function(entry) {
        // Handled by game-state update
    });

    socket.on('game-over', function(data) {
        showWin(data);
    });

    socket.on('new-game', function(state) {
        winOverlay.classList.add('hidden');
        currentWordBuffer = '';
        renderCurrentWord();
        renderGameState(state);
    });

    socket.on('all-words-found', function(state) {
        // game-over will follow
    });

    socket.on('frenzy-update', function(frenzy) {
        renderFrenzy(frenzy);
    });

    socket.on('connect_error', function() {
        showToast('Connection lost. Reconnecting...');
    });

    socket.on('connect', function() {
        hideToast();
    });
}

// ─── Render Game State ───
function renderGameState(state) {
    if (!state || !state.letters || state.letters.length !== 7) return;

    gameLetters = state.letters;
    // Only update localLetters if the puzzle changed (new letters)
    if (localLetters.length !== 7 || localLetters[0] !== state.letters[0]) {
        localLetters = state.letters.slice();
    }

    // Puzzle info
    if (state.puzzleId) {
        puzzleNumEl.textContent = '#' + state.puzzleId;
        puzzleNameEl.textContent = state.puzzleName || '';
        puzzleThemeBadgeEl.textContent = state.puzzleTheme || '';
        puzzleThemeBadgeEl.style.display = state.puzzleTheme ? '' : 'none';
        puzzleInfoEl.classList.remove('hidden');
    } else {
        puzzleInfoEl.classList.add('hidden');
    }

    // Honeycomb
    renderHoneycomb();
    renderCurrentWord();

    // Progress
    var cc = state.commonCount || state.totalWords || 0;
    var fc = state.foundCommonCount || state.foundCount || 0;
    foundCountEl.textContent = fc;
    totalCountEl.textContent = cc;
    foundLabel.textContent = fc;
    var pct = cc > 0 ? (fc / cc * 100) : 0;
    progressBar.style.width = pct + '%';

    // Score
    if (scoreValEl) scoreValEl.textContent = state.currentScore || 0;

    // Rare counter
    var rc = state.foundRareCount || 0;
    if (rc > 0) {
        rareCountEl.textContent = '+' + rc + ' rare';
        rareCountEl.classList.remove('hidden');
    } else {
        rareCountEl.classList.add('hidden');
    }

    // Found words - common
    var commonW = state.foundCommonWords || [];
    if (commonW.length === 0) {
        foundWordsList.innerHTML = '<span class="found-empty">No words found yet</span>';
    } else {
        var html = '';
        for (var i = 0; i < commonW.length; i++) {
            var w = commonW[i];
            var entry = state.foundWords ? state.foundWords[w] : null;
            var cls = 'found-word';
            if (entry && entry.isPangram) cls += ' pangram';
            html += '<span class="' + cls + '">' + w + '</span>';
        }
        foundWordsList.innerHTML = html;
    }

    // Found words - rare
    var rareW = state.foundRareWords || [];
    rareLabelEl.textContent = rareW.length;
    if (state.rareCount > 0) {
        rareSection.style.display = '';
        if (rareW.length === 0) {
            rareWordsList.innerHTML = '<span class="found-empty">Find bonus rare words!</span>';
        } else {
            var rHtml = '';
            for (var r = 0; r < rareW.length; r++) {
                var rw = rareW[r];
                var rEntry = state.foundWords ? state.foundWords[rw] : null;
                var rCls = 'found-word rare';
                if (rEntry && rEntry.isPangram) rCls += ' pangram';
                rHtml += '<span class="' + rCls + '">' + rw + '</span>';
            }
            rareWordsList.innerHTML = rHtml;
        }
    } else {
        rareSection.style.display = 'none';
    }

    // Top players
    renderTopPlayers(state.topPlayers || []);

    // Daily/Frenzy badges
    renderDaily(state.isDaily);
    renderFrenzy(state.frenzy);
}

// ─── Honeycomb ───
function renderHoneycomb() {
    hexRowTop.innerHTML = '';
    hexRowMid.innerHTML = '';
    hexRowBot.innerHTML = '';

    var center = localLetters[0];
    var outer = localLetters.slice(1);

    // Top row: outer[0], outer[1]
    hexRowTop.appendChild(createHexCell(outer[0], false, center));
    hexRowTop.appendChild(createHexCell(outer[1], false, center));

    // Mid row: outer[2], CENTER, outer[3]
    hexRowMid.appendChild(createHexCell(outer[2], false, center));
    hexRowMid.appendChild(createHexCell(center, true, center));
    hexRowMid.appendChild(createHexCell(outer[3], false, center));

    // Bot row: outer[4], outer[5]
    hexRowBot.appendChild(createHexCell(outer[4], false, center));
    hexRowBot.appendChild(createHexCell(outer[5], false, center));
}

function createHexCell(letter, isCenter, centerLetter) {
    var cell = document.createElement('div');
    cell.className = 'hex-cell' + (isCenter ? ' center' : '');
    cell.textContent = letter.toUpperCase();
    cell.dataset.letter = letter;
    cell.addEventListener('click', function() {
        if (isDragging || dragJustEnded) return;
        cell.classList.remove('pop-animation');
        void cell.offsetWidth;
        cell.classList.add('pop-animation');
        currentWordBuffer += letter;
        renderCurrentWord();
    });
    return cell;
}

function renderCurrentWord() {
    if (!localLetters.length) { currentWordEl.innerHTML = '&nbsp;'; return; }
    var center = localLetters[0];
    var html = '';
    for (var i = 0; i < currentWordBuffer.length; i++) {
        var ch = currentWordBuffer[i];
        if (ch === center) {
            html += '<span class="center-letter">' + ch.toUpperCase() + '</span>';
        } else {
            html += ch.toUpperCase();
        }
    }
    currentWordEl.innerHTML = html || '&nbsp;';
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

    if (word.length >= 4) {
        submitToServer(word);
    } else if (word.length > 0) {
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
    var allCells = honeycombArea.querySelectorAll('.hex-cell');
    for (var i = 0; i < allCells.length; i++) {
        allCells[i].classList.remove('drag-active');
    }

    var letterMap = {};
    for (var j = 0; j < dragPath.length; j++) {
        letterMap[dragPath[j]] = true;
    }
    for (var k = 0; k < allCells.length; k++) {
        if (letterMap[allCells[k].dataset.letter]) {
            allCells[k].classList.add('drag-active');
        }
    }

    var word = dragPath.join('').toUpperCase();
    if (word.length > 0) {
        dragPreviewEl.textContent = word;
        dragPreviewEl.classList.remove('hidden');
    } else {
        dragPreviewEl.classList.add('hidden');
    }

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

// ─── Top Players ───
function renderTopPlayers(players) {
    if (!players || players.length === 0) {
        topPlayersEl.innerHTML = '';
        return;
    }

    var tiers = ['gold', 'silver', 'bronze'];
    var crowns = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
    var html = '';

    for (var i = 0; i < Math.min(players.length, 3); i++) {
        var p = players[i];
        var name = p.displayName || p.name || 'Anonymous';
        var avatarHtml;
        if (p.profileImage) {
            avatarHtml = '<img class="top-player-avatar" src="' + p.profileImage + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
                         '<span class="top-player-avatar-fallback" style="display:none">' + name.charAt(0).toUpperCase() + '</span>';
        } else {
            avatarHtml = '<span class="top-player-avatar-fallback">' + name.charAt(0).toUpperCase() + '</span>';
        }

        html += '<div class="top-player-card ' + tiers[i] + '">' +
            '<div class="top-player-avatar-wrap">' +
                '<span class="top-player-crown">' + crowns[i] + '</span>' +
                avatarHtml +
            '</div>' +
            '<span class="top-player-name">' + escapeHtml(name) + '</span>' +
            '<span class="top-player-score">' + (p.score || 0) + '</span>' +
        '</div>';
    }
    topPlayersEl.innerHTML = html;
}

// ─── Guess Result ───
function handleGuessResult(result) {
    if (!result) return;
    if (result.valid) {
        // Word accepted — clear buffer
        currentWordBuffer = '';
        renderCurrentWord();
    } else {
        var reason = result.result || result.error || 'incorrect';
        showIncorrect(result.word || currentWordBuffer, reason);
        currentWordBuffer = '';
        renderCurrentWord();
    }
}

// ─── Win / Game Over ───
var countdownTimer = null;
function showWin(data) {
    var stats = data.stats || {};
    winStats.textContent = (stats.foundCommonCount || stats.foundCount || 0) + ' words found! Score: ' + (stats.currentScore || 0);

    var rc = stats.foundRareCount || 0;
    if (rc > 0) {
        winRareStats.textContent = '+ ' + rc + ' bonus rare words!';
        winRareStats.style.display = '';
    } else {
        winRareStats.style.display = 'none';
    }

    winOverlay.classList.remove('hidden');

    // Countdown
    if (countdownTimer) clearInterval(countdownTimer);
    var countdown = data.countdown || 30;
    countdownText.textContent = 'Next puzzle in ' + countdown + 's';
    countdownTimer = setInterval(function() {
        countdown--;
        if (countdown <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            countdownText.textContent = 'Starting...';
        } else {
            countdownText.textContent = 'Next puzzle in ' + countdown + 's';
        }
    }, 1000);
}

// ─── Keyboard (desktop letter keys, no text input) ───
function setupKeyboard() {
    document.addEventListener('keydown', function(e) {
        if (!gameUI || gameUI.style.display === 'none') return;
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

        if (e.key === 'Enter') {
            e.preventDefault();
            if (currentWordBuffer.length > 0) {
                submitToServer(currentWordBuffer);
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
        var ch = e.key.toLowerCase();
        if (ch.length === 1 && /^[a-z]$/.test(ch) && localLetters.indexOf(ch) !== -1) {
            e.preventDefault();
            currentWordBuffer += ch;
            renderCurrentWord();
            var cell = findCellByLetter(ch);
            if (cell) {
                cell.classList.remove('pop-animation');
                void cell.offsetWidth;
                cell.classList.add('pop-animation');
            }
        }
    });
}

function setupActions() {
    btnDelete.onclick = function() {
        if (currentWordBuffer.length > 0) {
            currentWordBuffer = currentWordBuffer.slice(0, -1);
            renderCurrentWord();
        }
    };

    btnShuffle.onclick = function() {
        var outer = localLetters.slice(1);
        for (var i = outer.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = outer[i];
            outer[i] = outer[j];
            outer[j] = temp;
        }
        localLetters = [localLetters[0]].concat(outer);
        renderHoneycomb();
    };

    btnSubmit.onclick = function() {
        if (currentWordBuffer.length > 0) {
            submitToServer(currentWordBuffer);
        }
    };
}

function submitToServer(word) {
    if (!socket || !user) return;
    socket.emit('guess', {
        word: word,
        platform: 'discord',
        platformUserId: user.id,
        displayName: user.globalName || user.username,
        linkedDiscord: user.id,
        profilePic: user.avatar
    });
}

// ─── Stats ───
function setupStatsToggle() {
    document.getElementById('stats-toggle').onclick = function() {
        statsDropdown.classList.toggle('hidden');
        if (!statsDropdown.classList.contains('hidden')) fetchStats();
    };
}

function fetchStats() {
    fetch('/api/me/spellingbee')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.ok) {
                document.getElementById('stat-words').textContent = data.totalWordsFound || 0;
                document.getElementById('stat-games').textContent = data.gamesParticipated || 0;
                document.getElementById('stat-pangrams').textContent = data.totalPangrams || 0;
                document.getElementById('stat-score').textContent = data.totalScore || 0;
            }
        })
        .catch(function() {});
}

// ─── Incorrect Feedback ───
function showIncorrect(word, reason) {
    var tag = document.createElement('span');
    var cls, text;
    if (reason === 'already_found') {
        cls = 'already-found-tag';
        text = (word || '').toUpperCase();
    } else if (reason === 'too_short') {
        cls = 'too-short-tag';
        text = 'Too short';
    } else if (reason === 'missing_center') {
        cls = 'missing-center-tag';
        text = 'Missing center letter';
    } else if (reason === 'not_active') {
        cls = 'too-short-tag';
        text = 'Game not active';
    } else {
        cls = 'incorrect-word';
        text = (word || '').toUpperCase();
    }
    tag.className = cls;
    tag.textContent = text;
    incorrectArea.appendChild(tag);

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

// ─── Daily / Frenzy Badges ───
function renderDaily(isDailyFlag) {
    if (!dailyBadgeEl) return;
    if (isDailyFlag) {
        dailyBadgeEl.classList.remove('hidden');
    } else {
        dailyBadgeEl.classList.add('hidden');
    }
}

function renderFrenzy(frenzy) {
    if (!frenzyBadgeEl) return;
    if (frenzy && frenzy.multiplier > 1.0) {
        frenzyMultiplierEl.textContent = frenzy.multiplier.toFixed(1) + 'x';
        frenzyBadgeEl.classList.remove('hidden');
    } else {
        frenzyBadgeEl.classList.add('hidden');
    }
}

// ─── Helpers ───
function showToast(msg) {
    errorToast.textContent = msg;
    errorToast.classList.remove('hidden');
}

function hideToast() {
    errorToast.classList.add('hidden');
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ─── Bootstrap ───
function bootstrap() {
    initDom();
    checkAuth();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}

})();
