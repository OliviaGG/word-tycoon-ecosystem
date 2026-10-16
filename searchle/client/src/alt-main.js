// ===== Searchle 3.0 — Alt Entry Point ("The Index" chip-grid view) =====
// Alt-mode variant of main.js. Only difference: GuessList is aliased to
// IndexGrid so the existing chip layout doesn't change throughout the
// file. Everything else (3D scene, header, podium, pinned-guess, audio,
// cosmetics, login, socket events) is byte-identical to main.js so we
// keep all the existing chrome. If/when alt becomes a permanent feature,
// extract the shared bootstrap into a function and parameterize the
// guess-renderer.

import '../styles/main.css';
import '../styles/animations.css';
import '../styles/cosmetics.css';
import '../styles/alt.css';

import { SceneManager } from './scene/SceneManager.js';
import { AnimationManager } from './animation/AnimationManager.js';
import { SocketClient } from './network/SocketClient.js';
import { IndexGrid as GuessList } from './ui/IndexGrid.js';
import { BokehParticles } from './ui/BokehParticles.js';
import { ChipXpFloater } from './ui/ChipXpFloater.js';
import { RecentTicker } from './ui/RecentTicker.js';
import { HeaderBar } from './ui/HeaderBar.js';
import { JackpotBar } from './ui/JackpotBar.js';
import { PodiumRow } from './ui/PodiumRow.js';
import { WinOverlay } from './ui/WinOverlay.js';
// CoinReward removed — legacy coin-reward popup leaked into private
// session viewers because chat-relay's gameShared.rewardPlayer emits
// 'coin-reward' globally (io.emit, no room scope). The display showed
// stale XP from public-game wins on /handle session pages. Dropping
// the subscription kills the popup everywhere; the component file
// remains in case a future per-player rewards UI brings it back.
// import { CoinReward } from './ui/CoinReward.js';
import { EffectsManager } from './effects/EffectsManager.js';
import { isOBS } from './utils/Mobile.js';
import * as AnimBg from './utils/AnimBg.js';
import { setViewerVisibility } from './utils/CosmeticsApplier.js';
import config from './config.js';
import { SPGameController } from './sp/SPGameController.js';
import { audio } from './audio/AudioBridge.js';
import { AudioSettingsButton } from './ui/AudioSettingsButton.js';

// OBS performance mode — adds CSS class for style overrides
if (isOBS) document.body.classList.add('obs-mode');

// Pull the brightest hex from a hero-badge CSS string (could be a
// linear-gradient with multiple stops, a single hex, or rgba(...)).
// Matches the extraction recipe ad-vertical-betweenly.html uses so the
// bg tint chooses the same accent color the winner's row would.
function _extractHeroColor(str) {
  if (typeof str !== 'string' || !str) return null;
  const hexes = str.match(/#([0-9a-fA-F]{6})/g);
  if (hexes && hexes.length) {
    let best = null, bestBright = 0;
    for (const hex of hexes) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const bright = r + g + b;
      if (bright > bestBright && bright > 40) { best = hex.toLowerCase(); bestBright = bright; }
    }
    if (best) return best;
  }
  const m = str.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const toHex = (v) => Math.max(0, Math.min(255, +v)).toString(16).padStart(2, '0');
    return '#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3]);
  }
  return null;
}

// In obs-mode, the goals overlay parent passes bgPreset/bgPrimary/
// bgSecondary/bgSpeed/bgIntensity via URL params. We mount the same
// animated-background renderer here (inside the iframe) so the ranked
// card backdrop-filter has same-document pixels to sample — without
// this, cross-iframe blur is a no-op and the glass effect dies.
// Parent + iframe both render the same preset with same colors; they
// visually overlay continuously across the iframe boundary.
// Track the v4 sub-config so we can detect changes-only-to-v4 in the
// postMessage handler below and force a remount (the cheapest way to push
// new uniforms into the shader without lifting the WebGL ctx to module
// scope). Set by the URL-first-paint path and by the postMessage handler.
let _lastV4Json = null;
if (isOBS) {
  try {
    const _q = new URLSearchParams(location.search);
    const _hexOk = (s) => /^#[0-9a-f]{6}$/i.test(s || '');
    const _preset = _q.get('bgPreset');
    const _pri = _q.get('bgPrimary');
    const _sec = _q.get('bgSecondary');
    // Optional v4 fine-tuning sub-config — JSON-encoded as a single param
    // so the dashboard slider state (hueOffset/hueSpeed/sat/lum/plasmaScale)
    // reaches the shader on first paint, not just via async postMessage.
    let _v4 = null;
    try {
      const raw = _q.get('v4');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') _v4 = parsed;
      }
    } catch (_) { /* ignore malformed v4 — default uniforms apply */ }
    if (_preset && _preset !== 'none' && _hexOk(_pri) && _hexOk(_sec)) {
      AnimBg.mount({
        preset: _preset,
        primaryColor: _pri,
        secondaryColor: _sec,
        speed: Math.max(1, Math.min(10, Number(_q.get('bgSpeed')) || 4)),
        intensity: Math.max(1, Math.min(10, Number(_q.get('bgIntensity')) || 5)),
        v4: _v4,
      });
      _lastV4Json = _v4 ? JSON.stringify(_v4) : null;
    }
  } catch (_) { /* renderer unavailable — fall back to no anim-bg */ }
}

// Parent overlay posts bg-config updates here whenever a dashboard
// slider moves, so the iframe doesn't need to be reloaded for live
// preview. Routed to AnimBg's incremental methods (no renderer rebuild
// for transform / colors / watermark; full remount only on preset
// change). Initial mount still happens from URL params above for
// first-paint correctness.
if (isOBS) {
  window.addEventListener('message', (ev) => {
    const msg = ev && ev.data;
    if (!msg || typeof msg !== 'object' || msg.type !== 'anim-bg-update') return;
    try {
      const cfg = msg.config || {};
      const _hexOk = (s) => /^#[0-9a-f]{6}$/i.test(s || '');
      // Preset change → full remount so renderer state resets cleanly.
      const presetChanged = cfg.preset && cfg.preset !== msg.lastPreset;
      // v4-only change → also remount (cheapest way to push new shader
      // uniforms without lifting the WebGL ctx to module scope). We diff
      // via JSON-stringify since the v4 object is small + flat.
      const v4Json = cfg.v4 ? JSON.stringify(cfg.v4) : null;
      const v4Changed = cfg.preset === 'prem-nebula-v4' && v4Json !== _lastV4Json;
      if ((presetChanged || v4Changed) && cfg.preset !== 'none' && _hexOk(cfg.primaryColor) && _hexOk(cfg.secondaryColor)) {
        AnimBg.mount({
          preset: cfg.preset,
          primaryColor: cfg.primaryColor,
          secondaryColor: cfg.secondaryColor,
          speed: Math.max(1, Math.min(10, Number(cfg.speed) || 4)),
          intensity: Math.max(1, Math.min(10, Number(cfg.intensity) || 5)),
          x: cfg.x, y: cfg.y, scale: cfg.scale,
          showGameName: !!cfg.showGameName,
          gameName: cfg.gameName || 'Searchle',
          v4: cfg.v4 || null,
        });
        _lastV4Json = v4Json;
        return;
      }
      // Live updates without rebuild.
      if (_hexOk(cfg.primaryColor) || _hexOk(cfg.secondaryColor)) {
        AnimBg.applyColors({ primaryColor: cfg.primaryColor, secondaryColor: cfg.secondaryColor });
      }
      AnimBg.applyTransform({ x: cfg.x, y: cfg.y, scale: cfg.scale });
      AnimBg.setShowGameName(!!cfg.showGameName, cfg.gameName || 'Searchle');
    } catch (_) { /* ignore — live preview is decoration */ }
  });
}

// ===== State =====
let guesses = [];
let totalRankedWords = 0;
let startTime = null;
let isWon = false;
let winHistory = [];
let winCounts = {};
let eloLeaderboard = [];
let guessCount = 0;
let lastWinner = null;

function getHubApiBase() {
  const host = window.location.hostname;
  if (host === 'subtextle.com' || host === 'www.subtextle.com') {
    return 'https://wordtycoon.live';
  }
  return 'http://localhost:3000';
}

// ===== Initialize Scene =====
const sceneManager = new SceneManager(config);
const animationManager = new AnimationManager();
const socket = new SocketClient();

// ===== Initialize UI Components =====
const headerBar = new HeaderBar(sceneManager.domRenderer);
headerBar.setMode(window.__SP_MODE ? 'sp' : 'mp');
// Streamer session: show www.subtextle.com/<handle> in the header.
// When ?disabled=1 (streamer turned off player-page play), show the bare
// www.subtextle.com URL — viewers should play public, not this private game.
try {
  const _q = new URLSearchParams(location.search);
  const _h = _q.get('session');
  const _disabled = _q.get('disabled') === '1';
  if (_h && /^[a-z0-9_-]{1,32}$/i.test(_h)) {
    headerBar.setSessionUrl(_h.toLowerCase(), { bare: _disabled });
  }
} catch (_) {}
const jackpotBar = new JackpotBar(sceneManager.domRenderer);
if (window.__SP_MODE) jackpotBar.setVisible(false); // never show in SP
const podiumRow = new PodiumRow(sceneManager.domRenderer);
if (window.__SP_MODE) podiumRow.element.style.display = 'none'; // SP has no podium
const recentTicker = new RecentTicker(sceneManager.domRenderer);
const guessList = new GuessList(sceneManager.domRenderer, animationManager);
// Streamer-set grid-rows cap (?rows=N). chat-relay appends this from
// the streamer's gameLayouts['searchle-grid'].portrait.gameEmbed-default
// .gridRows setting. Default = 15 rows (~72 chips). Range 3-25.
try {
  const _qr = new URLSearchParams(location.search);
  const _rows = parseInt(_qr.get('rows'), 10);
  if (Number.isFinite(_rows) && _rows >= 3 && _rows <= 25 && typeof guessList.setMaxRows === 'function') {
    guessList.setMaxRows(_rows);
  }
} catch (_) {}
// Bokeh particle bursts on new-chip insertion. Lazy-init: only spin up
// the WebGL canvas + Three.js scene if we're actually rendering the
// alt-grid (so SP / non-grid pages don't pay the cost).
let bokehParticles = null;
try {
  bokehParticles = new BokehParticles();
  guessList.setParticleEmitter(bokehParticles);
} catch (e) {
  console.warn('[alt] BokehParticles init failed (continuing without particles):', e.message);
}
// Floating "+N XP" bubbles for scoring guesses — mirrors default Searchle's
// XpBubble but rendered against viewport coordinates instead of CSS3D.
// Sharing the BokehParticles instance with the floater lets bubbles leave
// a gold sparkle trail behind them as they rise.
try {
  const xpFloater = new ChipXpFloater();
  if (bokehParticles) xpFloater.setParticleSystem(bokehParticles);
  guessList.setXpFloater(xpFloater);
} catch (e) {
  console.warn('[alt] ChipXpFloater init failed (continuing without XP bubbles):', e.message);
}
const winOverlay = new WinOverlay(sceneManager.domRenderer);
// Floating audio-settings button (bottom-right speaker icon + popover).
// No-op on OBS overlays — players configure via OBS-side mute.
const audioSettings = new AudioSettingsButton();
// (CoinReward init removed — see note at the top of the imports.)

const effectsManager = new EffectsManager(sceneManager.viewport);

// Stats drawer toggle — push guesses down smoothly when drawer opens
// _drawerHeight is used by updateLayout() to shift the jackpot bar down
let _drawerHeight = 0;
// Drawer state published for alt.html's spacer-sync script: while the
// drawer is open the ticker sits below its resting position, and
// the spacer's max-ratchet must not lock that displaced measurement in.
// Cleared on a delay slightly longer than the close animation's settle
// so a poll tick can't catch the ticker mid-descent.
window.__altDrawerOffset = 0;
let _drawerClearTimer = null;
headerBar.onDrawerToggle = (drawerHeight) => {
  _drawerHeight = drawerHeight;
  if (_drawerClearTimer) { clearTimeout(_drawerClearTimer); _drawerClearTimer = null; }
  if (drawerHeight > 0) {
    window.__altDrawerOffset = drawerHeight;
  } else {
    _drawerClearTimer = setTimeout(() => {
      _drawerClearTimer = null;
      window.__altDrawerOffset = 0;
    }, 800);
  }
  guessList.setDrawerOffset(drawerHeight);
  recentTicker.setDrawerOffset(drawerHeight);
  podiumRow.setDrawerOffset(drawerHeight);
  updateLayout();
};

// ===== Layout Positioning =====
// Position elements vertically: header -> jackpot -> ticker -> guess list
// All Y values are negative because Y-down in our coordinate system
let _scrollY = 0;

// Sticky max-header-height. HeaderBar's slots area changes height between
// rounds depending on combined vs 4-card layout. Locking to the max
// observed keeps the grid pinned at the taller configuration so it
// never moves between rounds (mirror of the fix in main.js).
let _stickyHeaderH = 0;
function updateLayout() {
  const measuredH = headerBar.height;
  if (measuredH > _stickyHeaderH) _stickyHeaderH = measuredH;
  const headerH = _stickyHeaderH;
  const jackpotH = jackpotBar.visible ? jackpotBar.height : 0;
  // Vertical room reserved for the recent-guess ticker: its 112-unit
  // height (alt.css .recent-ticker) plus margin. Was 252 when this slot
  // held the full-size pinned-guess card — the ticker is a single row of
  // word pills, so the grid below starts much higher.
  const tickerH = 148;
  const halfW = config.baseWidth / 2;
  const sy = _scrollY;
  const drawerH = _drawerHeight; // current stats drawer height (0 when closed)

  // Align content to top of viewport.
  // DOMRenderer places y=0 at CAMERA_CY (1350) units above screen center.
  // topPad = CAMERA_CY - viewH/2 puts the header top edge flush with the viewport top.
  const CAMERA_CY = 1350;
  const viewH = sceneManager.viewport ? sceneManager.viewport.height : 2700;
  const topPad = CAMERA_CY - viewH / 2;

  // DOMRenderer centers elements at their position (translate -50%,-50%)
  // z=50 ensures header/jackpot render in front of guess entries (max z=25)
  // headerH = row height only (drawer excluded — guessList/recentTicker handle it via setDrawerOffset)
  // Static elements (header, jackpot, ticker, winOverlay) are in _scaleEl directly —
  // NOT the scroll group. They must NOT include scrollY or they fly off-screen on scroll.
  headerBar.object3D.position.set(halfW, -(headerH / 2 + topPad), 50);
  // Jackpot pill: anchor right edge of pill to right edge of header (with 24px inset).
  // jackpotBar is centered at its position via translate(-50%,-50%), so subtract half its width.
  const _jpW = (jackpotBar.element && jackpotBar.element.offsetWidth) || 640;
  jackpotBar.object3D.position.set(config.baseWidth - _jpW / 2 - 24, -(headerH + topPad - 60), 60);

  // Podium row sits between header/jackpot and the ticker (MP only).
  // SP mode hides the podium element via display:none, so reserve no space.
  const podiumH = (window.__SP_MODE) ? 0 : podiumRow.height + 12;
  podiumRow.setPosition(headerH + jackpotH + topPad + 18);
  recentTicker.setPosition(headerH + jackpotH + podiumH + topPad + 18);
  guessList.setTopOffset(headerH + jackpotH + podiumH + tickerH + topPad + 18);

  // Position win overlay above all other elements
  winOverlay.object3D.position.set(halfW, -(guessList.topOffset - 180), 50);
  if (sceneManager.viewport) {
    guessList.setViewHeight(sceneManager.viewport.height);
  }

  // Re-sync alt.html's #game-spacer to the ticker's (possibly new)
  // position right away — the header ratchets taller when winner layouts
  // change between rounds, and waiting for the spacer poll's next tick
  // leaves the grid briefly buried under the ticker. applyTransform
  // writes style.transform synchronously, so measuring here is safe.
  if (typeof window.__altSpacerSync === 'function') window.__altSpacerSync();
}

// Defer layout until elements have rendered
requestAnimationFrame(() => {
  requestAnimationFrame(() => updateLayout());
});

// Settings panel removed — defaults come from CSS :root variables in main.css

function rerenderCosmeticsState() {
  guessList.updateList(guesses, totalRankedWords, winHistory, winCounts);
  recentTicker.update(guesses, totalRankedWords, winHistory, winCounts, eloLeaderboard, { animate: false });
  if (lastWinner && lastWinner.user) {
    headerBar.updateWinner(lastWinner.word, lastWinner.user, lastWinner.guessCount, winHistory, winCounts, eloLeaderboard, {
      targetFinder: lastWinner.targetFinder,
      podiumSnapshot: lastWinner.podium,
    });
  }
  updateLayout();
}

async function loadViewerVisibilityForMP() {
  if (isSPMode) return;
  try {
    let vis = null;
    let user = null;
    try { user = JSON.parse(localStorage.getItem('searchle_user')); } catch {}

    if (user && user.id) {
      const provider = user.provider || 'discord';
      const publicRes = await fetch(
        `${getHubApiBase()}/api/public/visibility?platform=${encodeURIComponent(provider)}&platformUserId=${encodeURIComponent(user.id)}`
      );
      if (publicRes.ok) {
        const publicData = await publicRes.json();
        vis = publicData && publicData.visibility && typeof publicData.visibility === 'object'
          ? publicData.visibility
          : {};
      }
    }

    if (!vis) {
      const res = await fetch(`${getHubApiBase()}/api/me/visibility`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      vis = data && data.visibility && typeof data.visibility === 'object' ? data.visibility : {};
    }

    setViewerVisibility(vis);
    rerenderCosmeticsState();
    console.log('[MP] Viewer cosmetic visibility:', vis);
  } catch (err) {
    console.log('[MP] Viewer visibility fetch skipped:', err.message);
  }
}

// ===== Socket Events =====
const isSPMode = !!window.__SP_MODE;

// ---------------------------------------------------------------------------
// SP Mode: Client-side game controller (all processing in browser)
// ---------------------------------------------------------------------------
let spController = null;

if (isSPMode) {
  spController = new SPGameController(socket);

  // Fetch SP user profile + cosmetics from Chat Relay and display in header
  (async () => {
    let user = null;
    try { user = JSON.parse(localStorage.getItem('searchle_user')); } catch {}

    if (!user || !user.id) {
      // Anonymous user — show login prompt in header where PFP would be (not on OBS)
      if (!isOBS) headerBar.setSPAnon();
      return;
    }

    const spUser = {
      displayName: user.globalName || user.username,
      username: user.username,
      profilePic: user.avatar || null,
    };

    // Show pfp immediately (before cosmetics load)
    headerBar.setSPUser(spUser, null);

    // Fetch cosmetics from Chat Relay API (same-origin in production via nginx)
    try {
      const res = await fetch(`${getHubApiBase()}/api/me/profile`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        // Apply viewer's cosmetic visibility preferences globally
        if (data.preferences && data.preferences.cosmetic_visibility) {
          try {
            const vis = typeof data.preferences.cosmetic_visibility === 'string'
              ? JSON.parse(data.preferences.cosmetic_visibility)
              : data.preferences.cosmetic_visibility;
            setViewerVisibility(vis);
            console.log('[SP] Viewer cosmetic visibility:', vis);
          } catch {}
        }

        if (data.ok && data.cosmetics) {
          // Convert cosmetics array to equipped map keyed by category
          // Preserve asset-backed render metadata alongside the legacy css payload.
          const equipped = {};
          for (const c of data.cosmetics) {
            if (c.equipped && c.category && c.css_property) {
              try {
                const css = JSON.parse(c.css_property);
                equipped[c.category] = {
                  ...css,
                  render: c.render || null,
                  fallbackCss: c.fallbackCss || null,
                  renderType: c.renderType || 'css'
                };
              } catch {}
            }
          }
          if (Object.keys(equipped).length > 0) {
            headerBar.setSPUser(spUser, equipped);
            spController.setCosmetics(equipped);
            // Retroactively inject cosmetics into existing guesses (restored from save)
            for (const g of spController.guesses) {
              if (g.user) g.user.cosmetics = equipped;
            }
            // Apply cosmetics to already-rendered guess entries
            guessList.applyCosmeticsToAll(equipped);
            console.log('[SP] Applied cosmetics:', Object.keys(equipped).join(', '));
          }
        }
      }
    } catch (err) {
      console.log('[SP] Cosmetics fetch skipped:', err.message);
    }
  })();

  spController.onWeeklyCompleted = () => {
    // Daily already played — dispatch event so sp.html shows the overlay
    document.dispatchEvent(new CustomEvent('sp-weekly-completed'));
    window.__subtextleGameReady = true;
    document.dispatchEvent(new CustomEvent('subtextle-game-ready'));
  };

  // Tracks whether a game has already been shown this page-load, so the
  // round-start cue plays on restarts/new games but not on initial load
  // (where the audio context isn't gesture-unlocked yet anyway).
  let spHadFirstReady = false;

  spController.onGameReady = (state) => {
    guesses = state.guesses || [];
    totalRankedWords = state.totalRankedWords;
    startTime = state.startTime;
    isWon = false;
    guessCount = 0;
    if (state.winHistory) winHistory = state.winHistory;
    if (spHadFirstReady) audio.play('round-start');
    spHadFirstReady = true;

    guessList.updateList(guesses, totalRankedWords, winHistory);
    recentTicker.clear();
    headerBar.reset(startTime);
    headerBar.updateWordNumber(state.isWeekly ? state.weeklyNumber : state.wordNumber, state.isWeekly ? 'weekly' : null);
    headerBar.updateStats(winHistory);
    winOverlay.hide();
    updateLayout();

    // Dispatch event for sp.html inline script
    document.dispatchEvent(new CustomEvent('sp-guesses-updated', {
      detail: { guesses, totalRankedWords, winHistory, wordNumber: state.wordNumber, weeklyNumber: state.weeklyNumber, isWeekly: !!state.isWeekly }
    }));
    window.__subtextleGameReady = true;
    document.dispatchEvent(new CustomEvent('subtextle-game-ready'));
  };

  spController.onGuessResult = (guess) => {
    guesses = spController.guesses;
    totalRankedWords = spController.totalRankedWords;
    guessCount = guesses.length;

    guessList.updateList(guesses, totalRankedWords, winHistory);
    recentTicker.update(guesses, totalRankedWords, winHistory, winCounts, eloLeaderboard, { animate: true });
    headerBar.updateGuessCount(guesses.length);

    // Audio cues — same rank-tier feedback MP viewers get, gated on the
    // row being on-screen. Rank 1 is silent here: onWin plays
    // target-found. Non-words (9999999) get no semantic cue; real-but-
    // unranked words (100001) read as cold.
    const spRank = guess.rank;
    if (typeof spRank === 'number' && spRank !== 1 && spRank < 9999999
        && guessList.isWordInView(guess.word)) {
      if (spRank <= 10)         audio.play('guess-blazing');
      else if (spRank <= 250)   audio.play('guess-hot');
      else if (spRank <= 1000)  audio.play('guess-warm');
      else                      audio.play('guess-cold');
    }

    // Dispatch event for sp.html inline script
    document.dispatchEvent(new CustomEvent('sp-guesses-updated', {
      detail: { guesses, totalRankedWords, winHistory, wordNumber: spController.wordNumber, weeklyNumber: spController.weeklyNumber, isWeekly: spController.isWeekly }
    }));
  };

  spController.onDuplicateGuess = (word) => {
    guesses = spController.guesses;
    audio.play('guess-bump');
    recentTicker.update(guesses, totalRankedWords, winHistory, winCounts, eloLeaderboard, { animate: false });
    recentTicker.flashBump(word, null);

    document.dispatchEvent(new CustomEvent('sp-guesses-updated', {
      detail: { guesses, totalRankedWords, winHistory, wordNumber: spController.wordNumber, weeklyNumber: spController.weeklyNumber, isWeekly: spController.isWeekly }
    }));
  };

  spController.onWin = (data) => {
    audio.play('target-found');
    isWon = true;
    headerBar.stopTimer();

    // Clear saved game — this game is done
    spController.clearSave();

    // Add to local history
    winHistory.push({ user: data.user, word: data.targetWord, wordNumber: data.wordNumber, guessCount: data.guessCount, timestamp: new Date().toISOString() });
    headerBar.updateStats(winHistory);

    if (!isOBS) winOverlay.show(data.targetWord, data.user, null, data.guessCount);

    // Record played + won word in localStorage
    if (data.targetWord) {
      try {
        const played = JSON.parse(localStorage.getItem('searchle_sp_played') || '[]');
        if (!played.includes(data.targetWord)) {
          played.push(data.targetWord);
          localStorage.setItem('searchle_sp_played', JSON.stringify(played));
        }
      } catch {}
      try {
        const won = JSON.parse(localStorage.getItem('searchle_sp_won') || '[]');
        if (!won.includes(data.targetWord)) {
          won.push(data.targetWord);
          localStorage.setItem('searchle_sp_won', JSON.stringify(won));
        }
      } catch {}
    }

    // Auto-restart after 5 seconds
    setTimeout(() => {
      spController.requestNewGame();
    }, 5000);

    document.dispatchEvent(new CustomEvent('sp-guesses-updated', {
      detail: { guesses, totalRankedWords, winHistory, wordNumber: spController.wordNumber, weeklyNumber: spController.weeklyNumber, isWeekly: spController.isWeekly }
    }));
  };

  spController.onLoading = (loading) => {
    document.dispatchEvent(new CustomEvent('sp-loading', { detail: { loading } }));
  };

  spController.onWordNumber = (num) => {
    headerBar.updateWordNumber(spController.isWeekly ? spController.weeklyNumber : num, spController.isWeekly ? 'weekly' : null);
    document.dispatchEvent(new CustomEvent('sp-guesses-updated', {
      detail: { guesses, totalRankedWords, winHistory, wordNumber: num, weeklyNumber: spController.weeklyNumber, isWeekly: spController.isWeekly }
    }));
  };

  // Listen for guess submissions from sp.html inline script
  document.addEventListener('sp-guess-submit', (e) => {
    if (!spController || !e.detail) return;
    spController.submitGuess(e.detail.input, e.detail.user);
  });

  // Listen for new game requests from sp.html inline script
  document.addEventListener('sp-new-game-request', () => {
    if (!spController) return;
    spController.requestNewGame();
  });

  // Pool browser: server sends game list → forward to sp.html
  spController.onPoolList = (data) => {
    document.dispatchEvent(new CustomEvent('sp-pool-list', { detail: data }));
  };

  // Pool browser: user requests list
  document.addEventListener('sp-request-pool-list', () => {
    if (spController) spController.requestPoolList();
  });

  // Pool browser: user selects a specific game
  document.addEventListener('sp-play-specific', (e) => {
    if (spController && e.detail && e.detail.gameId) spController.playSpecificGame(e.detail.gameId);
  });

  // Listen for login events from sp.html (after OAuth redirect)
  document.addEventListener('sp-user-login', async (e) => {
    if (!e.detail || !e.detail.user) return;
    const u = e.detail.user;
    const spUser = {
      displayName: u.globalName || u.username,
      username: u.username,
      profilePic: u.avatar || null,
    };
    headerBar.hideLoginOverlay();
    headerBar.setSPUser(spUser, null);

    // Fetch cosmetics for newly logged-in user
    try {
      const res = await fetch(`${getHubApiBase()}/api/me/profile`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        // Apply viewer's cosmetic visibility preferences globally
        if (data.preferences && data.preferences.cosmetic_visibility) {
          try {
            const vis = typeof data.preferences.cosmetic_visibility === 'string'
              ? JSON.parse(data.preferences.cosmetic_visibility)
              : data.preferences.cosmetic_visibility;
            setViewerVisibility(vis);
            console.log('[SP] Post-login viewer visibility:', vis);
          } catch {}
        }

        if (data.ok && data.cosmetics) {
          const equipped = {};
          for (const c of data.cosmetics) {
            if (c.equipped && c.category && c.css_property) {
              try { equipped[c.category] = JSON.parse(c.css_property); } catch {}
            }
          }
          if (Object.keys(equipped).length > 0) {
            headerBar.setSPUser(spUser, equipped);
            spController.setCosmetics(equipped);
            for (const g of spController.guesses) {
              if (g.user) g.user.cosmetics = equipped;
            }
            guessList.applyCosmeticsToAll(equipped);
            console.log('[SP] Post-login cosmetics applied:', Object.keys(equipped).join(', '));
          }
        }
      }
    } catch (err) {
      console.log('[SP] Post-login cosmetics fetch skipped:', err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Multiplayer Mode: Socket events (only active when NOT in SP mode)
// ---------------------------------------------------------------------------
if (!isSPMode) {
  loadViewerVisibilityForMP();

  socket.on('game-state', (state) => {
    guesses = state.guesses || [];
    totalRankedWords = state.totalRankedWords;
    startTime = state.startTime;
    isWon = state.isWon;
    guessCount = guesses.length;
    lastWinner = state.lastWinner || null;
    if (state.winHistory) winHistory = state.winHistory;
    if (state.winCounts) winCounts = state.winCounts;
    if (state.eloLeaderboard) eloLeaderboard = state.eloLeaderboard;
    if (Array.isArray(state.podium)) {
      podiumRow.update(state.podium);
      headerBar.updatePodium(state.podium);
    }

    const jpEnabled = state.jackpotEnabled !== false;
    jackpotBar.setVisible(jpEnabled);
    jackpotBar.setSpecialBadge(state.isDaily ? 'DAILY' : state.isWeekly ? 'WEEKLY' : null);
    jackpotBar.setFrenzy(state.frenzy);

    guessList.updateList(guesses, totalRankedWords, winHistory, winCounts);
    recentTicker.update(guesses, totalRankedWords, winHistory, winCounts, eloLeaderboard, { animate: false });
    headerBar.updateGuessCount(guesses.length);
    if (jpEnabled) jackpotBar.start(startTime, guessCount);

    if (state.lastWinner && state.lastWinner.user) {
      headerBar.updateWinner(state.lastWinner.word, state.lastWinner.user, state.lastWinner.guessCount, winHistory, winCounts, eloLeaderboard, {
        targetFinder: state.lastWinner.targetFinder,
        podiumSnapshot: state.lastWinner.podium,
      });
    }
    headerBar.updateStats(winHistory);

    headerBar.startTimer(startTime);
    if (isWon) headerBar.stopTimer(state.completion?.durationSeconds ?? state.completion?.meta?.durationSeconds);

    if (isWon && state.winner && !isOBS) {
      const completion = state.completion;
      const points = completion?.topPlayers || completion?.podium?.map(player => ({ ...player, points: Math.floor((player.xp || 0) * (completion.multiplier || 1)) })) || [];
      winOverlay.show(state.targetWord || '???', state.winner, completion?.displayPot ?? completion?.pot ?? completion?.meta?.pot ?? state.pot ?? null, guesses.length, {
        topPlayers: points, eloLeaderboard, isDaily: completion?.isDaily ?? state.isDaily, frenzy: state.frenzy,
        targetFinder: completion?.targetFinder || state.lastWinner?.targetFinder,
      });
    } else if (!isWon && !isOBS) {
      // Active round (or fresh page-load on a non-won session) — make
      // sure no stale overlay from a previous round, page, or socket
      // reconnect is left visible. Without this an old "you won" card
      // could ride a 10s auto-hide timer through a state transition.
      winOverlay.hide();
    }

    updateLayout();

    // OBS: scroll to show the bottom of the existing list on load
    if (isOBS && guesses.length > 0) {
      const maxRank = guesses.reduce((m, g) => Math.max(m, g.rank), 0);
      obsAutoScrollTo(maxRank);
    }
    window.__subtextleGameReady = true;
    document.dispatchEvent(new CustomEvent('subtextle-game-ready'));
  });

  socket.on('new-guess', (guess) => {
    guesses.push(guess);
    totalRankedWords = guess.totalRankedWords;
    guessCount++;

    guessList.updateList(guesses, totalRankedWords, winHistory, winCounts);
    recentTicker.update(guesses, totalRankedWords, winHistory, winCounts, eloLeaderboard, { animate: true });
    // The first guess of a round re-populates the ticker (new-game
    // cleared it) at whatever Y the sticky header math now dictates —
    // sync the grid spacer immediately so the grid can't sit under it.
    if (typeof window.__altSpacerSync === 'function') window.__altSpacerSync();
    headerBar.updateGuessCount(guesses.length);
    jackpotBar.addGuess();

    // Audio cues — rank-tier feedback, but only for guesses whose row
    // is actually on-screen. Off-viewport guesses would otherwise pile
    // up sound spam from background scrolling, so we gate every cue
    // on guessList.isWordInView(). Target-found fires in the game-won
    // handler instead — that one isn't tied to a row position.
    const r = guess.rank;
    const inView = guessList.isWordInView(guess.word);
    if (inView && r !== 1) {
      if (r <= 10)         audio.play('guess-blazing');
      else if (r <= 250)   audio.play('guess-hot');
      else if (r <= 1000)  audio.play('guess-warm');
      else                 audio.play('guess-cold');
    }

    // XP reward layer — same in-view gate. Staggered so it doesn't
    // collide with the guess-tier cue's attack. Spawn a floating "+N XP"
    // bubble at the chip's viewport position too (alt-mode equivalent of
    // default Searchle's XpBubble); IndexGrid handles waiting for the
    // chip to land in the DOM before placing the bubble.
    if (inView && typeof guess.xpAward === 'number' && guess.xpAward > 0) {
      if (r <= 10) audio.play('xp-tier-bonus');
      else if (r <= 250) setTimeout(() => audio.play('xp-award'), 80);
      const playerName = (guess.user && guess.user.displayName) || '';
      // Pass the full cosmetics object — ChipXpFloater destructures the
      // categories it cares about (win_effect for trail, hero_badge for
      // bubble surface, profile_border/glow for outer frame, name_color
      // for username color, word_color for "+N XP" amount color).
      const cosmetics = (guess.user && guess.user.cosmetics) || null;
      guessList.spawnXpAtChip(guess.word, guess.xpAward, playerName, cosmetics);
    }

    // OBS: auto-scroll to show the new guess
    obsAutoScrollTo(guess.rank);
  });

  socket.on('bump-guess', (data) => {
    audio.play('guess-bump');
    const idx = guesses.findIndex(g => g.word === data.word);
    if (idx !== -1) {
      const bumped = guesses.splice(idx, 1)[0];
      if (data.bumper) bumped.lastBumper = data.bumper;
      guesses.push(bumped);
      // Surgical update on the ranked-list entry for this specific word
      // (if it's currently materialized). Bypasses guessList.updateList
      // entirely — that path iterates ALL entries and the previous attempt
      // to detect bumper changes there broke other live updates. Wrapped
      // in try/catch + already wrapped inside updateBumper so a failure
      // here can't break the rest of the handler.
      try {
        if (guessList.entries && typeof guessList.entries.get === 'function') {
          const entry = guessList.entries.get(data.word);
          if (entry && typeof entry.updateBumper === 'function') {
            entry.updateBumper(data.bumper || null);
          }
        }
      } catch (e) {
        console.error('[bump-guess] list entry update failed:', e);
      }
      recentTicker.update(guesses, totalRankedWords, winHistory, winCounts, eloLeaderboard, { animate: false });
      recentTicker.flashBump(data.word, data.bumper);
    }
  });

  socket.on('game-won', (data) => {
    audio.play('target-found');
    isWon = true;
    headerBar.stopTimer(data.durationSeconds);
    jackpotBar.stop();
    lastWinner = {
      word: data.targetWord,
      user: data.user,
      guessCount: data.guessCount,
      targetFinder: data.targetFinder || data.user,
      podium: Array.isArray(data.podium) ? data.podium : [],
    };

    // Hero-badge color reactivity: in OBS mode, tint the animated bg
    // toward the winner's hero-badge gradient color so the dish briefly
    // celebrates in their tone. Prefer the top-podium (XP winner)
    // cosmetics — that's who the OBS overlay's win card features — and
    // fall back to data.user when podium is empty.
    if (isOBS) {
      try {
        const top = (Array.isArray(data.podium) && data.podium[0]) || data.user || null;
        const cos = (top && (top.cosmetics || (top.equipped && top.equipped))) || {};
        const hero = cos.hero_badge || (cos.equipped && cos.equipped.hero_badge);
        const bgStr = hero && (hero.background || (hero.css && hero.css.background) || hero.color);
        if (bgStr) {
          const hex = _extractHeroColor(bgStr);
          if (hex) AnimBg.tint(hex, 9000);
        }
      } catch (_) { /* tint is decoration — never break the win flow */ }
    }

    winHistory.push({ user: data.user, word: data.targetWord, guessCount: data.guessCount, timestamp: new Date().toISOString() });
    headerBar.updateStats(winHistory);

    if (!isOBS) winOverlay.show(data.targetWord, data.user, data.pot, data.guessCount, {
      topPlayers: data.topPlayers || [],
      eloLeaderboard,
      isDaily: !!data.isDaily,
      frenzy: data.frenzy,
    });
    headerBar.updateWinner(data.targetWord, data.user, data.guessCount, winHistory, winCounts, eloLeaderboard, {
      targetFinder: data.targetFinder,
      podiumSnapshot: data.podium,
    });

    if (data.user && data.user.cosmetics && data.user.cosmetics.win_effect) {
      effectsManager.playWinEffect(data.user.cosmetics.win_effect);
    }
  });

  socket.on('new-game', (data) => {
    audio.play('round-start');
    guesses = [];
    totalRankedWords = data.totalRankedWords;
    startTime = data.startTime;
    isWon = false;
    guessCount = 0;

    guessList.updateList([], totalRankedWords, winHistory, winCounts);
    recentTicker.clear();
    headerBar.reset(startTime);
    jackpotBar.start(startTime, 0);
    podiumRow.update([]); // clear podium for fresh round
    // Hide any lingering win overlay from the previous round. The 10s
    // auto-hide timer can leave it floating across the new-game
    // transition, especially on session pages where it could read as a
    // stale "from the online game" win on a fresh round.
    winOverlay.hide();
    // isWeekly and frenzy will be updated via the game-state event that follows
  });

  // Live podium updates fire on every scoring guess (top-10 finder bonus
  // OR proximity points). Backend sends the top 7 sorted desc by game XP.
  socket.on('podium-update', (data) => {
    if (data && Array.isArray(data.podium)) {
      podiumRow.update(data.podium);
      // Header caches the live podium so it can snapshot top-3-by-XP
      // into the previous-round slots when the round ends, and updates
      // the live XP stat in the corner column on every scoring guess.
      headerBar.updatePodium(data.podium);
    }
  });

  socket.on('frenzy-update', (frenzy) => {
    jackpotBar.setFrenzy(frenzy);
  });
}

// ===== Scroll Handling (momentum-based) =====
let _scrollVelocity = 0;
const SCROLL_FRICTION = 0.93;
const SCROLL_MIN_V = 0.5;

function applyScroll(deltaY) {
  _scrollY += deltaY;
  const max = guessList.getMaxScroll();
  _scrollY = Math.max(0, Math.min(_scrollY, max));
  guessList.setScrollY(_scrollY);
  updateLayout();
}

// ===== OBS Auto-Scroll =====
// OBS browser sources have no user interaction — auto-scroll to follow guesses.
let _obsScrollTarget = -1;

function obsAutoScrollTo(rank) {
  if (!isOBS) return;
  const rowH = guessList.getRowHeight();
  const viewH = sceneManager.viewport ? sceneManager.viewport.height : 2700;
  const CAMERA_CY = 1350;
  // Place the target rank 1 row above the viewport bottom.
  const scrollTarget = -(CAMERA_CY + viewH / 2) + rowH + guessList.topOffset + (rank - 1) * rowH;

  // Cap scroll so the top-ranked (closest) guesses always remain visible.
  // Banner culling hides entries with worldY > bannerWorldY.
  // For rank 1 (idx=0): worldY = -(topOffset - scrollY) - rowH/2
  // It stays visible when scrollY < rowH/2 - 72 (≈50px with standard row height).
  // Keep a small guard band below that hard cutoff; otherwise OBS auto-scroll
  // can settle exactly on the cull boundary and make the top row flicker.
  // At scrollY=0 about 8-9 top entries fit between the banner and viewport bottom.
  // The RecentTicker already shows the newest arrivals, so viewers always see
  // both the recent guesses and the best/closest entries.
  const TOP_ROW_GUARD = 24;
  const maxScroll = Math.max(0, rowH / 2 - 72 - TOP_ROW_GUARD);

  _obsScrollTarget = Math.max(0, Math.min(scrollTarget, maxScroll));
}

// Desktop wheel — each tick adds to velocity for smooth momentum
document.addEventListener('wheel', (e) => {
  if (e.target.closest && e.target.closest('#sp-pool-browser-overlay')) return;
  e.preventDefault();
  _scrollVelocity += e.deltaY * 0.4;
}, { passive: false });

// Mobile touch — direct drag + momentum on release
let _touchLastY = 0;
let _touchVSamples = [];
document.addEventListener('touchstart', (e) => {
  _touchLastY = e.touches[0].clientY;
  _touchVSamples = [];
  _scrollVelocity = 0; // stop momentum on new touch
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (e.target.closest && e.target.closest('#sp-pool-browser-overlay')) return;
  const y = e.touches[0].clientY;
  const deltaY = _touchLastY - y;
  _touchLastY = y;
  if (Math.abs(deltaY) > 0) {
    e.preventDefault();
    applyScroll(deltaY * 3);
    _touchVSamples.push({ v: deltaY * 3, t: performance.now() });
    if (_touchVSamples.length > 5) _touchVSamples.shift();
  }
}, { passive: false });
document.addEventListener('touchend', () => {
  // Average recent velocity samples for smooth flick
  const now = performance.now();
  const recent = _touchVSamples.filter(s => now - s.t < 100);
  if (recent.length > 0) {
    _scrollVelocity = recent.reduce((sum, s) => sum + s.v, 0) / recent.length;
  }
  _touchVSamples = [];
}, { passive: true });

// ===== Animation Loop =====
sceneManager.onUpdate((delta) => {
  // OBS: smooth auto-scroll toward target (replaces user momentum)
  if (isOBS && _obsScrollTarget >= 0) {
    const diff = _obsScrollTarget - _scrollY;
    if (Math.abs(diff) > 1) {
      applyScroll(diff * Math.min(1, 6 * delta));
    } else {
      if (diff !== 0) applyScroll(diff);
      _obsScrollTarget = -1;
    }
  }

  // Apply scroll momentum
  if (Math.abs(_scrollVelocity) > SCROLL_MIN_V) {
    applyScroll(_scrollVelocity);
    _scrollVelocity *= SCROLL_FRICTION;
  } else {
    _scrollVelocity = 0;
  }

  animationManager.update();
  guessList.update(delta);
  recentTicker.animate(delta);
  podiumRow.animate(delta);
});

// ===== Start =====
sceneManager.start();

window.addEventListener('subtextle-header-layout-change', updateLayout);
