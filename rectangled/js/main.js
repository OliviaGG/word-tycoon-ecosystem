// main.js - OBS overlay (server-synced display client)
// The server is authoritative — overlay only displays the server's game state.

import { loadDictionary } from './dictionary.js?v=2';
import { Game } from './game.js?v=2';
import { UI } from './ui.js?v=32';
import { WebSocketClient } from './websocket.js?v=3';
import { loadSettings } from './admin.js?v=2';
import { getPlayerCosmetics, invalidatePlayer } from './cosmetics-cache.js?v=2';
import { loadViewerVisibility } from './viewer-visibility.js?v=1';

let trie = null;
let game = null;
let ui = null;
let wsClient = null;

// Streamer-private session: server redirects /overlay/<handle> to
// /?session=<handle>. Detect the query param and append it to every
// /api/game/state poll so the displayed board reflects the streamer's
// private session. Also gates SSE (public-only channel) and adds a
// session socket bridge for per-event animations.
const SESSION_HANDLE = (() => {
    try {
        const h = new URLSearchParams(location.search).get('session');
        return h && /^[a-z0-9_-]{1,32}$/i.test(h) ? h.toLowerCase() : null;
    } catch (_) { return null; }
})();
const STATE_URL = SESSION_HANDLE
    ? `api/game/state?session=${encodeURIComponent(SESSION_HANDLE)}`
    : 'api/game/state';

const IS_DESKTOP_VIEW = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
const ROTATION_CLASSES = ['', 'rotated-180'];
const ROTATE_INTERVAL = 10 * 60 * 1000;
let rotationIndex = 0;
let rotationTimer = null;
let lastPresentationState = null;
let presentationPublishTimer = null;
let lastPresentationHash = '';

async function init() {
    ui = new UI();
    await loadViewerVisibility();
    const settings = loadSettings();
    applyDisplaySettings(settings);

    // Load dictionary (only once — needed to resolve cell paths for animations)
    if (!trie) {
        ui.showLoading('Loading dictionary...');
        trie = await loadDictionary('data/dictionary.txt');
    }

    ui.showLoading('Connecting to server...');
    await new Promise(resolve => setTimeout(resolve, 50));

    game = new Game();

    // Fetch server game state — the server is the only source of truth
    await fetchAndLoadServerGame();

    // Connect WebSocket — receives chat guesses for grid animations.
    // Skip in session mode: chat-relay's chat-message channel carries
    // every streamer's chat tagged with streamerHandle, so listening here
    // would show OTHER streamers' guesses on this overlay AND double-process
    // our own session's chat (already handled server-side via handleSessionChat
    // and bridged through the session socket in connectSSE).
    if (SESSION_HANDLE) {
        // no-op
    } else if (wsClient) {
        wsClient.reconnectTo(settings.wsUrl);
    } else {
        wsClient = new WebSocketClient(
            settings.wsUrl,
            async (word, username, profileImage, platform) => {
                // Validate against local word list (same grid, same dictionary) for animation
                // showBanner: false — SSE word-found handles the banner with server-authoritative rarity
                const result = game.guess(word, username, profileImage);
                ui.handleGuessResult(result, game, { showBanner: false });
                if (result.result === 'correct') {
                    game.saveState();
                    const fc = game.serverCommonCount > 0 ? game.serverFoundCommonCount / game.serverCommonCount : 0;
                    ui.updateLetterStats(game.getLetterStats(), fc);
                    // Fetch and apply cosmetics to top player cards
                    getPlayerCosmetics(platform || 'unknown', username).then(cos => {
                        if (cos && Object.keys(cos).length > 0) {
                            ui.applyTopPlayerCosmetics(username, cos);
                        }
                    }).catch(() => {});
                }
            },
            (connected) => {
                ui.updateConnectionStatus(connected);
            },
            (platform, platformUserId, equipped) => {
                // Cosmetics updated — invalidate cache and re-apply to visible cards
                invalidatePlayer(platform, platformUserId, equipped);
                if (equipped && ui) {
                    // Re-apply to any visible top player cards matching this user
                    ui.applyTopPlayerCosmetics(platformUserId, equipped);
                }
            }
        );
    }

    // Listen for admin page triggers (cross-tab communication via storage events)
    window.addEventListener('storage', (e) => {
        if (e.key === 'rectangled_display' || e.key === 'rectangled_settings') {
            applyDisplaySettings(loadSettings());
        }
    });

    // Listen for remote admin commands via SSE
    connectSSE();

    initOrientationControl();

    ui.hideLoading();
    console.log(`Game ready! ${game.serverCommonCount || game.allWords.size} common words to find in a ${game.rows}x${game.cols} grid.`);
}

// ─── Orientation control (desktop) ──────────────────────────────────────────

function applyRotation() {
    const container = ui.gridContainer;
    if (!container) return;
    for (const cls of ROTATION_CLASSES) {
        if (cls) container.classList.remove(cls);
    }
    const cls = ROTATION_CLASSES[rotationIndex];
    if (cls) container.classList.add(cls);
    const btn = document.getElementById('orientation-btn');
    if (btn) btn.classList.toggle('active', rotationIndex !== 0);
    scheduleBoardPresentationPublish('rotation');
}

function toggleOrientation() {
    rotationIndex = (rotationIndex + 1) % ROTATION_CLASSES.length;
    applyRotation();
    startAutoRotate();
}

function resetRotation() {
    rotationIndex = 0;
    applyRotation();
}

function startAutoRotate() {
    if (rotationTimer) clearInterval(rotationTimer);
    rotationTimer = setInterval(() => {
        rotationIndex = (rotationIndex + 1) % ROTATION_CLASSES.length;
        applyRotation();
    }, ROTATE_INTERVAL);
}

function normalizeRect(rect, viewportWidth, viewportHeight) {
    if (!rect || !viewportWidth || !viewportHeight) return null;
    return {
        leftPct: rect.left / viewportWidth,
        topPct: rect.top / viewportHeight,
        widthPct: rect.width / viewportWidth,
        heightPct: rect.height / viewportHeight
    };
}

function buildBoardPresentationPayload() {
    if (!lastPresentationState || !ui || !ui.gridContainer) return null;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const boardRect = ui.gridContainer.getBoundingClientRect();
    const hudEl = document.getElementById('game-board') || ui.gridContainer;
    const hudRect = hudEl.getBoundingClientRect();
    if (!boardRect || boardRect.width <= 0 || boardRect.height <= 0) return null;

    const cellRects = Array.from(ui.gridContainer.querySelectorAll('.grid-cell'))
        .map(cell => normalizeRect(cell.getBoundingClientRect(), viewportWidth, viewportHeight))
        .filter(Boolean);

    return {
        game: 'rectangled',
        rows: lastPresentationState.rows || 0,
        cols: lastPresentationState.cols || 0,
        activeCells: [...(lastPresentationState.activeCells || [])],
        revealedCells: [...(lastPresentationState.revealedCells || [])],
        currentRing: lastPresentationState.currentRing || 0,
        totalRings: lastPresentationState.totalRings || 0,
        rotation: rotationIndex === 1 ? 180 : 0,
        layout: {
            ...normalizeRect(boardRect, viewportWidth, viewportHeight),
            hudBottomPct: hudRect.top / viewportHeight
        },
        cellRects,
        source: 'overlay'
    };
}

function scheduleBoardPresentationPublish() {
    if (presentationPublishTimer) clearTimeout(presentationPublishTimer);
    presentationPublishTimer = setTimeout(() => {
        presentationPublishTimer = null;
        requestAnimationFrame(() => {
            const payload = buildBoardPresentationPayload();
            if (!payload) return;
            const hash = JSON.stringify(payload);
            if (hash === lastPresentationHash) return;
            lastPresentationHash = hash;
            fetch('api/board-presentation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(() => {});
        });
    }, 40);
}

function initOrientationControl() {
    const btn = document.getElementById('orientation-btn');
    if (btn) {
        if (!IS_DESKTOP_VIEW) {
            btn.style.display = 'none';
        } else {
            btn.addEventListener('click', toggleOrientation);
        }
    }
    applyRotation();
    startAutoRotate();
}

// Fetch server state and load the server's game
async function fetchAndLoadServerGame() {
    let serverState = null;
    try {
        const r = await fetch(STATE_URL);
        if (r.ok) serverState = await r.json();
    } catch (e) {
        console.warn('Could not fetch server state:', e.message);
    }

    if (serverState && serverState.grid) {
        loadServerGame(serverState);
    } else {
        // Server unavailable — show waiting state, will sync when SSE connects
        console.warn('Server unavailable, waiting for SSE...');
        ui.updateWordCount(0, 0);
    }
}

// Load the server's game into the overlay
function loadServerGame(serverState) {
    if (!serverState || !serverState.grid) return;

    game = new Game();
    game.restoreFrom({
        grid: serverState.grid,
        rows: serverState.rows,
        cols: serverState.cols,
        minWordLength: serverState.minWordLength || 3,
        foundWords: serverState.foundWords || [],
        playerScores: []
    }, trie);
    // Use server's common-only stats for display
    game.setServerStats(serverState);
    game.saveState();

    ui.reset();
    ui.renderGrid(game.grid, game.activeCells);
    applyRotation();
    lastPresentationState = {
        rows: game.rows,
        cols: game.cols,
        activeCells: [...(serverState.activeCells || [])],
        revealedCells: [...(serverState.revealedCells || [])],
        currentRing: serverState.currentRing || 0,
        totalRings: serverState.totalRings || 0
    };
    scheduleBoardPresentationPublish('load');
    const foundC = serverState.foundCommonCount || game.foundWords.size;
    const totalC = serverState.commonCount || game.allWords.size;
    ui.updateWordCount(foundC, totalC);
    const hintPct = totalC > 0 ? foundC / totalC : 0;
    ui.updateLetterStats(game.getLetterStats(), hintPct);
    ui.hideComplete();
    ui.hideLoading();

    // Apply display settings from server (persists across OBS reloads)
    if (serverState.displaySettings) {
        applyDisplaySettings(serverState.displaySettings);
    }

    // Show top players from server
    if (serverState.topPlayers) {
        ui.updateTopPlayers(serverState.topPlayers);
    }

    // Restore last found word card if still valid for this game
    ui.restoreLastFound(game.foundWords);

    // Update rare/ultra-rare counts
    ui.updateRareCounts(serverState);

    // Render recent guess tags from server state
    if (serverState.recentGuessTags) {
        for (const tag of serverState.recentGuessTags) {
            if (!tag || !tag.word) continue;
            if (tag.result === 'incorrect') ui.onIncorrectGuess(tag.word);
            else if (tag.result === 'already_found') ui.onAlreadyFound(tag.word);
        }
    }

    // Update badges
    updateBadges(serverState);

    console.log(`Server game loaded: ${game.rows}x${game.cols} grid, ${serverState.foundCommonCount || 0}/${serverState.commonCount || game.allWords.size} common words found`);
}

function updateBadges(state) {
    const dailyBadge = document.getElementById('daily-badge');
    const frenzyBadge = document.getElementById('frenzy-badge');
    const frenzyMultiplier = document.getElementById('frenzy-multiplier');

    if (dailyBadge) {
        dailyBadge.style.display = state.isDaily ? '' : 'none';
    }

    if (frenzyBadge && frenzyMultiplier) {
        const frenzy = state.frenzy;
        if (frenzy && frenzy.multiplier > 1) {
            frenzyMultiplier.textContent = frenzy.multiplier.toFixed(1) + 'x';
            frenzyBadge.style.display = '';
        } else {
            frenzyBadge.style.display = 'none';
        }
    }
}

function applyDisplaySettings(settings) {
    const gameFrame = document.querySelector('.game-frame');
    if (gameFrame) {
        gameFrame.classList.toggle('light-mode', !!settings.lightMode);
    }
    const root = document.documentElement;
    if (settings.letterScale !== undefined) {
        root.style.setProperty('--letter-scale', settings.letterScale);
    }
    if (settings.numberScale !== undefined) {
        root.style.setProperty('--number-scale', settings.numberScale);
    }
}

// Sync found words from server state — catches words the overlay may have missed
function syncFoundWords(serverState) {
    if (!game || !serverState) return;

    // Update server stats (common-only letterStats, activeCells, counts)
    game.setServerStats(serverState);

    const serverFound = serverState.foundWords || [];
    let synced = 0;
    for (const word of serverFound) {
        if (!game.foundWords.has(word) && game.allWords.has(word)) {
            game.foundWords.add(word);
            synced++;
        }
    }

    // Always update active cells (greyed letters) from server state
    ui.updateActiveCells(game.activeCells);
    lastPresentationState = {
        rows: game.rows,
        cols: game.cols,
        activeCells: [...(serverState.activeCells || [])],
        revealedCells: [...(serverState.revealedCells || [])],
        currentRing: serverState.currentRing || 0,
        totalRings: serverState.totalRings || 0
    };
    scheduleBoardPresentationPublish('sync');

    const foundC = serverState.foundCommonCount || game.foundWords.size;
    const totalC = serverState.commonCount || game.allWords.size;
    ui.updateWordCount(foundC, totalC);
    const hintPct = totalC > 0 ? foundC / totalC : 0;
    ui.updateLetterStats(game.getLetterStats(), hintPct);

    if (synced > 0) {
        game.saveState();
        console.log(`Synced ${synced} words from server (now ${foundC}/${totalC})`);
    }

    // Update top players from server
    if (serverState.topPlayers) {
        ui.updateTopPlayers(serverState.topPlayers);
    }

    // Update rare/ultra-rare counts
    ui.updateRareCounts(serverState);
}

function connectSSE() {
    // In session mode the public SSE channel carries the public game's
    // events, NOT this streamer's. Use a synthetic EventTarget instead and
    // bridge per-session socket.io emits onto it so the same addEventListener
    // handlers below fire from session-room broadcasts.
    let sessionSocket = null;
    const evtSource = SESSION_HANDLE
        ? Object.assign(new EventTarget(), { close() {}, readyState: 1 })
        : new EventSource('api/events');
    if (SESSION_HANDLE && typeof io !== 'undefined') {
        sessionSocket = io({
            reconnection: true,
            reconnectionDelay: 3000,
            reconnectionDelayMax: 30000,
            transports: ['websocket', 'polling'],
            auth: { session: SESSION_HANDLE }
        });
        const replay = (name) => (data) => {
            evtSource.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data || {}) }));
        };
        sessionSocket.on('word-found', replay('word-found'));
        sessionSocket.on('chat-guess', replay('chat-guess'));
        sessionSocket.on('new-game', replay('new-game'));
        sessionSocket.on('game-state', replay('game-state'));
        sessionSocket.on('game-over', replay('game-over'));
        sessionSocket.on('connect', () => console.log(`[RecTangled overlay] session socket connected (${SESSION_HANDLE})`));
        sessionSocket.on('disconnect', () => console.log('[RecTangled overlay] session socket disconnected'));
    }

    // ─── End-of-round celebration hold ──────────────────────────────
    // The server builds the next board in the same tick it announces the win,
    // so 'game-over' and 'new-game' arrive together. Applied straight away,
    // new-game swapped the grid out from under the winning word's highlight
    // and the completion screen — on stream the round just blinked over.
    // Hold the new board until the celebration has played.
    //
    // Only a completion opens the window, so an admin new-game or the first
    // state after connect still lands immediately.
    const ROUND_CELEBRATION_MS = 5000;
    let celebrationUntil = 0;
    let heldState = null, heldIsNewGame = false, heldTimer = null;

    function startFreshBoard(serverState) {
        Game.clearState();
        // Reset rotation on new game and restart timer
        resetRotation();
        startAutoRotate();
        // Load server's new game (server's grid, not a random one)
        loadServerGame(serverState);
    }

    function applyStateUpdate(state) {
        updateBadges(state);
        // Sync found words from server in case overlay missed any
        syncFoundWords(state);
    }

    function flushHeldState() {
        heldTimer = null;
        if (!heldState) return;
        const state = heldState, isNew = heldIsNewGame;
        heldState = null; heldIsNewGame = false;
        if (isNew) startFreshBoard(state); else applyStateUpdate(state);
    }

    // Board-changing updates route through here. During the celebration the
    // freshest state is kept back and applied once, so a guess landing on the
    // new board mid-window can't sneak the new grid in early either.
    function applyOrHold(state, isNewGame) {
        const wait = celebrationUntil - Date.now();
        if (wait <= 0) {
            if (isNewGame) startFreshBoard(state); else applyStateUpdate(state);
            return;
        }
        heldState = state;
        heldIsNewGame = heldIsNewGame || isNewGame;
        if (!heldTimer) heldTimer = setTimeout(flushHeldState, wait);
    }

    evtSource.addEventListener('new-game', (e) => {
        applyOrHold(JSON.parse(e.data), true);
    });

    evtSource.addEventListener('display', (e) => {
        const settings = JSON.parse(e.data);
        applyDisplaySettings(settings);
    });

    evtSource.addEventListener('frenzy-update', (e) => {
        const frenzy = JSON.parse(e.data);
        const frenzyBadge = document.getElementById('frenzy-badge');
        const frenzyMultiplier = document.getElementById('frenzy-multiplier');
        if (frenzyBadge && frenzyMultiplier) {
            if (frenzy && frenzy.multiplier > 1) {
                frenzyMultiplier.textContent = frenzy.multiplier.toFixed(1) + 'x';
                frenzyBadge.style.display = '';
            } else {
                frenzyBadge.style.display = 'none';
            }
        }
    });

    evtSource.addEventListener('game-state', (e) => {
        applyOrHold(JSON.parse(e.data), false);
    });

    evtSource.addEventListener('game-over', (e) => {
        const data = JSON.parse(e.data);
        const stats = data.stats || data;
        // Opens the hold window before the completion screen is drawn, so the
        // new board can't land on top of it.
        celebrationUntil = Date.now() + ROUND_CELEBRATION_MS;
        updateBadges(stats);
        syncFoundWords(stats);

        // Update top players so showComplete has them
        if (stats.topPlayers) {
            ui.updateTopPlayers(stats.topPlayers);
        }

        // In streamer-session mode the chat-relay overlay
        // (/win-overlay?streamer=<handle>) renders the win card.
        // Skip the in-overlay completion screen so they don't double up.
        if (!SESSION_HANDLE && game) {
            ui.showComplete(game);
        }

        // Start countdown. The server now builds the next board immediately
        // and sends countdown:0 — `|| 30` read that falsy 0 as "30" and put
        // "New game in 30s" on stream while the board changed a moment later.
        // Count down the celebration hold instead, which is the real wait.
        const winCountdownEl = document.getElementById('win-countdown');
        if (winCountdownEl) {
            const declared = Number(data.countdown);
            let remaining = Number.isFinite(declared) && declared > 0
                ? declared
                : Math.round(ROUND_CELEBRATION_MS / 1000);
            winCountdownEl.textContent = `New game in ${remaining}s`;
            if (window._winCountdownTimer) clearInterval(window._winCountdownTimer);
            window._winCountdownTimer = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                    clearInterval(window._winCountdownTimer);
                    window._winCountdownTimer = null;
                    winCountdownEl.textContent = 'Starting...';
                } else {
                    winCountdownEl.textContent = `New game in ${remaining}s`;
                }
            }, 1000);
        }
    });

    evtSource.addEventListener('word-found', (e) => {
        const data = JSON.parse(e.data);
        if (!game) return;

        // game-state arrives before word-found, so game.guess() often returns
        // 'already_found'.  Build the result directly from the authoritative
        // SSE payload so the banner + highlight always fire.
        const result = game.guess(data.word, data.displayName, data.profilePic);

        const announceResult = {
            result: 'correct',
            word: data.word,
            cells: data.cells,
            isRare: data.isRare || false,
            isHidden: data.isHidden || false,
            isThreeLetter: data.isThreeLetter || false,
            letterRarityBonus: data.letterRarityBonus || 0,
            wordLengthBonus: data.wordLengthBonus || 0,
            username: data.displayName,
            profilePic: data.profilePic || null,
            platform: data.platform || null,
            platformUserId: data.platformUserId || null,
            foundCount: result.foundCount || game.serverFoundCommonCount || game.foundWords.size,
            totalCount: result.totalCount || game.serverCommonCount || game.allWords.size,
            topPlayers: result.topPlayers || game.getTopPlayers()
        };

        // Show correct word tag with checkmark (like game page)
        ui.onFoundWord(data.word);

        const cosmeticsPromise = (data.platform && data.platformUserId)
            ? getPlayerCosmetics(data.platform, data.platformUserId)
            : null;
        ui.onCorrectGuess(announceResult, game, true, cosmeticsPromise);

        if (result.result === 'correct') {
            game.saveState();
        }
        const fc = game.serverCommonCount > 0 ? game.serverFoundCommonCount / game.serverCommonCount : 0;
        ui.updateLetterStats(game.getLetterStats(), fc);

    });

    // Show guess tags (incorrect + already found) like the game page
    evtSource.addEventListener('chat-guess', (e) => {
        const data = JSON.parse(e.data);
        if (data.result === 'incorrect') {
            ui.onIncorrectGuess(data.word);
        } else if (data.result === 'already_found') {
            ui.onAlreadyFound(data.word);
        }
    });

    evtSource.addEventListener('clear-state', () => {
        Game.clearState();
    });

    evtSource.onerror = () => {
        console.log('SSE connection lost, reconnecting...');
    };
}

init().catch(err => {
    console.error('Failed to initialize game:', err);
    document.getElementById('loading-text').textContent = 'Error loading game. Check console.';
});
