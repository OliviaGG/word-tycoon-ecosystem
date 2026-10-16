// main.js - OBS overlay (server-synced display client)
// The server is authoritative — overlay only displays the server's game state.

import { loadDictionary } from './dictionary.js?v=2';
import { Game } from './game.js?v=2';
import { UI } from './ui.js?v=31';
import { WebSocketClient } from './websocket.js?v=3';
import { loadSettings } from './admin.js?v=2';
import { getPlayerCosmetics, invalidatePlayer } from './cosmetics-cache.js?v=2';

let trie = null;
let game = null;
let ui = null;
let wsClient = null;

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

    // Connect WebSocket — receives chat guesses for grid animations
    if (wsClient) {
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
    if (!btn) return;
    if (!IS_DESKTOP_VIEW) {
        btn.style.display = 'none';
        return;
    }
    btn.addEventListener('click', toggleOrientation);
    applyRotation();
    startAutoRotate();
}

// Fetch server state and load the server's game
async function fetchAndLoadServerGame() {
    let serverState = null;
    try {
        const r = await fetch('api/game/state');
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
    const evtSource = new EventSource('api/events');

    evtSource.addEventListener('new-game', (e) => {
        const serverState = JSON.parse(e.data);
        Game.clearState();
        // Clear win-screen timers
        if (window._winScrollTimer) { clearInterval(window._winScrollTimer); window._winScrollTimer = null; }
        if (window._winCountdownTimer) { clearInterval(window._winCountdownTimer); window._winCountdownTimer = null; }
        // Reset rotation on new game and restart timer
        resetRotation();
        startAutoRotate();
        // Load server's new game (server's grid, not a random one)
        loadServerGame(serverState);
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
        const state = JSON.parse(e.data);
        updateBadges(state);
        // Sync found words from server in case overlay missed any
        syncFoundWords(state);
    });

    evtSource.addEventListener('game-over', (e) => {
        const data = JSON.parse(e.data);
        const stats = data.stats || data;
        updateBadges(stats);
        syncFoundWords(stats);
        // Show completion overlay
        if (ui.completeOverlay) {
            const fc = stats.foundCommonCount || stats.foundCount || game.foundWords.size;
            const fr = stats.foundRareCount || 0;
            const ftl = stats.foundThreeLetterCount || 0;
            let statsLine = `${fc} common words found!`;
            const bonusParts = [];
            if (fr > 0) bonusParts.push(`${fr} rare`);
            if (ftl > 0) bonusParts.push(`${ftl} three-letter`);
            if (bonusParts.length > 0) statsLine += ` + ${bonusParts.join(' + ')} bonus`;
            ui.completeStats.textContent = statsLine;

            // Build top 3 players display (crown cards)
            const winTopEl = document.getElementById('win-top-players');
            const players = stats.topPlayers || [];
            const crowns = ['\u{1F451}', '\u{1FA76}', '\u{1F949}'];
            if (winTopEl && players.length > 0) {
                winTopEl.innerHTML = players.slice(0, 3).map((p, i) => {
                    const name = (p.displayName || 'Player').replace(/</g, '&lt;');
                    const initial = (name[0] || '?').toUpperCase();
                    const avatar = p.profileImage
                        ? `<img class="win-player-avatar" src="${p.profileImage.replace(/"/g, '&quot;')}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="win-player-avatar-fallback" style="display:none">${initial}</span>`
                        : `<span class="win-player-avatar-fallback">${initial}</span>`;
                    return `<div class="win-player"><span class="win-player-crown">${crowns[i]}</span>${avatar}<span class="win-player-name">${name}</span><span class="win-player-score">${p.score.toLocaleString()} pts</span></div>`;
                }).join('');
            } else if (winTopEl) {
                winTopEl.innerHTML = '';
            }

            // Build scroll list — all players ranked 4th and beyond
            const scrollEl = document.getElementById('win-scroll-list');
            if (scrollEl) {
                if (window._winScrollTimer) { clearInterval(window._winScrollTimer); window._winScrollTimer = null; }
                const scrollPlayers = players.slice(3);
                if (scrollPlayers.length > 0) {
                    scrollEl.innerHTML = scrollPlayers.map((p, i) => {
                        const name = (p.displayName || 'Player').replace(/</g, '&lt;');
                        const avatar = p.profileImage
                            ? `<img class="win-player-avatar" src="${p.profileImage.replace(/"/g, '&quot;')}" alt="" style="width:24px;height:24px;flex-shrink:0" onerror="this.style.display='none'">`
                            : '';
                        return `<div class="win-scroll-player" style="animation-delay:${(i * 0.05).toFixed(2)}s"><span class="win-scroll-rank">#${i + 4}</span>${avatar}<span class="win-scroll-name">${name}</span><span class="win-scroll-score">${p.score.toLocaleString()}</span></div>`;
                    }).join('');
                    scrollEl.scrollTop = 0;
                    scrollEl.style.display = '';
                    // Auto-scroll through the list, looping back to top
                    window._winScrollTimer = setInterval(() => {
                        if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2) {
                            scrollEl.scrollTop = 0;
                        } else {
                            scrollEl.scrollTop += 1;
                        }
                    }, 50);
                } else {
                    scrollEl.innerHTML = '';
                    scrollEl.style.display = 'none';
                }
            }

            // Start countdown
            const winCountdownEl = document.getElementById('win-countdown');
            if (winCountdownEl) {
                let remaining = data.countdown || 30;
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

            ui.completeOverlay.classList.remove('hidden');
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
            username: data.displayName,
            profilePic: data.profilePic || null,
            foundCount: result.foundCount || game.serverFoundCommonCount || game.foundWords.size,
            totalCount: result.totalCount || game.serverCommonCount || game.allWords.size,
            topPlayers: result.topPlayers || game.getTopPlayers()
        };

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
