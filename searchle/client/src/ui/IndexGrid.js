// ===== IndexGrid =====
// Alt-mode replacement for GuessList. Renders the "Index" chip grid
// (design 05a Avatar Dots) directly into the #index-grid container in
// normal DOM flow — no CSS3D, no spring physics, no DOMRenderer.
//
// Public surface MATCHES GuessList so the only diff in alt-main.js is
// swapping the import. Methods that don't apply (spring stuff, view
// height, scroll offsets) are no-ops; methods that do (updateList,
// applyCosmeticsToAll) drive the chip render.
//
// Visual recipe is the design handoff's "05a" spec:
//   - rank → size tier (.t1–.t7), heat band (data-heat), and fill % (--fill)
//   - per-player signature color on the avatar disc (--c)
//   - .target chip placeholder for rank #1, .latest pulse on newest guess

import { applyCosmetics } from '../utils/CosmeticsApplier.js';
// Only the sentinel is shared — this file's rankColor/rankFill are
// deliberately their own formulas (see the header), but the "not a word"
// rank is a server contract, so there's no reason to re-hardcode it.
import { RANK_INVALID } from '../utils/ColorUtils.js';

// Apply profile_border (ring) + profile_glow (aura) to a chip's avatar
// element. Used by both the grid cells (small avatars, scale=24) and the
// top-card avatar (larger, scale=64). Fan-club isFanClub flag toggles a
// CSS class so .has-fc::after paints the heart-shower fan badge.
//
// Top card additionally gets name_color + name_glow on the username
// element + the title cosmetic appended to the av-col container.
function applyChipCosmetics(avEl, g, opts) {
  if (!avEl) return;
  const cos = (g && g.user && g.user.cosmetics) || {};
  if (g && g.user && g.user.isFanClub) avEl.classList.add('has-fc');
  else avEl.classList.remove('has-fc');
  // Filter to just the categories that make sense on a chip avatar.
  // Grid cells: ring + glow only. Top card: also name + title.
  const filtered = {};
  if (cos.profile_border) filtered.profile_border = cos.profile_border;
  if (cos.profile_glow)   filtered.profile_glow   = cos.profile_glow;
  if (opts && opts.withName) {
    // For alt-mode (grid), strip the `textShadow` baked into name_color
    // before passing it down — the cosmetic catalog combines an 8-dir
    // outline + glow into one shadow string, which reads heavy on the
    // small top-card username. Color stays, animation stays, default
    // CSS `.user-name { text-shadow: ... }` provides baseline drop.
    // Original cosmetic object stays untouched (shallow clone).
    if (cos.name_color) {
      const nc = { ...cos.name_color };
      delete nc.textShadow;
      filtered.name_color = nc;
    }
    if (cos.name_glow)  filtered.name_glow  = cos.name_glow;
    if (cos.title)      filtered.title      = cos.title;
  }
  applyCosmetics({
    avatarEl: avEl,
    nameEl:   opts && opts.nameEl ? opts.nameEl : null,
    titleContainer: opts && opts.titleContainer ? opts.titleContainer : null,
    avatarSize: (opts && opts.avatarSize) || 24,
  }, filtered);
}

const PLAYER_COLORS = [
  '#ff80c0', '#80c0ff', '#c080ff', '#80ffc0', '#ffc080',
];

function hashStr(s) {
  if (!s) return 0;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}

function playerColor(guess) {
  const u = guess.user || {};
  const key = u.platformUserId || u.id || u.displayName || guess.word || '';
  return PLAYER_COLORS[hashStr(String(key)) % PLAYER_COLORS.length];
}

function playerInitial(guess) {
  const u = guess.user || {};
  const name = u.displayName || u.username || '';
  // Strip emojis / leading non-alphanumeric, grab the first letter.
  const m = String(name).match(/[a-zA-Z0-9]/);
  return m ? m[0].toUpperCase() : '?';
}

function playerPfpUrl(guess) {
  return (guess && guess.user && guess.user.profilePic) || null;
}

// Rank-driven HEAT color — continuous HSL gradient from green (#1) to
// red (typo / rank ≥ 100k). Each rank gets a unique color so two chips
// next to each other on the same heat band are still visually distinct.
//
// closeness uses a log scale so the green→yellow→orange→red transition
// is roughly evenly distributed across the typical rank space (1 to 1e5).
// closeness=1 → hue 120 (green); closeness=0 → hue 0 (red).
function rankColor(rank) {
  const r = (!rank || rank <= 0) ? 1 : rank;
  const closeness = Math.max(0, Math.min(1, 1 - Math.log10(r) / 5));
  const hue = closeness * 120;
  // Matched to regular Searchle's rankToColor (config.gradient): fixed
  // 80% saturation, 35% lightness, 0.9 alpha so grid tiles read at the
  // same depth as regular mode (was a bright 55%-lightness taper).
  return `hsla(${hue.toFixed(1)}, 80%, 35%, 0.9)`;
}

// Row-driven SIZE tier. Rank rules where you sit in the grid, but how
// big the chip is at that position is purely a function of row index
// (not rank), so all chips in a row are uniform width and the grid
// shrinks predictably top-to-bottom.
function tierForRow(rowIdx) {
  return Math.min(rowIdx, 9); // tiers 0–9, then capped at 9 (smallest)
}

// Row-driven COLUMNS per row. Rows 1–3 → 3 cols, rows 4–6 → 4 cols,
// rows 7–9 → 5 cols, row 10+ → 6 cols (super small). Tweak here to
// reshape the visual cadence without touching CSS.
function colsForRow(rowIdx) {
  if (rowIdx < 3) return 3;
  if (rowIdx < 6) return 4;
  if (rowIdx < 9) return 5;
  return 6;
}

// Log-scale fill height: rank 1 → 100%, rank 10 → 80%, rank 100 → 60%, ...
// EXCEPT misspelt / non-words (RANK_INVALID), which fill completely — see
// the comment in ColorUtils.rankToFillPercent. Note the outside-pool
// sentinel (99999998) is deliberately NOT included: it's a real word, so it
// stays empty-and-cold like any other very distant guess.
function rankFill(rank) {
  if (!rank || rank <= 0) return 100;
  if (rank === RANK_INVALID) return 100;
  const p = 100 * (1 - Math.log10(rank) / 5);
  return Math.max(0, Math.min(100, Math.round(p)));
}

function formatRank(rank) {
  if (rank === RANK_INVALID) return '—'; // invalid / non-word sentinel
  if (rank === 99999998) return '(N+)';  // outside-ranked-pool sentinel
  if (rank < 1000) return '#' + rank;
  if (rank < 100000) {
    const v = rank / 1000;
    return '#' + (v < 10 ? v.toFixed(1) : Math.round(v)) + 'k';
  }
  return '#' + Math.round(rank / 1000) + 'k';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Minimal CSS attribute-selector escape. Words come from server-side
// guess processing so they're already [a-z]+ in practice, but escape
// defensively in case future i18n widens the character set.
const cssEscape = (typeof CSS !== 'undefined' && CSS.escape)
  ? (s) => CSS.escape(s)
  : (s) => String(s).replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');

function isHeatFadeInProgress(el) {
  if (!el || !el.classList.contains('heat-fading')) return false;
  const progress = parseFloat(getComputedStyle(el).getPropertyValue('--heat-progress'));
  return Number.isFinite(progress) && progress < 0.98;
}

function setChipAvatarContent(avEl, guess) {
  if (!avEl) return;
  const initial = playerInitial(guess);
  const pfpUrl = playerPfpUrl(guess);

  if (avEl.dataset.pfpUrl === (pfpUrl || '') && avEl.dataset.initial === initial) {
    return;
  }

  avEl.replaceChildren();
  if (pfpUrl) {
    const img = document.createElement('img');
    img.src = pfpUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => {
      avEl.textContent = initial;
    };
    avEl.appendChild(img);
  } else {
    avEl.textContent = initial;
  }

  avEl.dataset.pfpUrl = pfpUrl || '';
  avEl.dataset.initial = initial;
}

function createCellElement() {
  const cell = document.createElement('div');
  const pill = document.createElement('span');
  pill.className = 'cell-pill';

  const rankEl = document.createElement('span');
  rankEl.className = 'r';
  pill.appendChild(rankEl);

  const wordEl = document.createElement('span');
  wordEl.className = 'w';
  pill.appendChild(wordEl);

  const avEl = document.createElement('span');
  avEl.className = 'av';

  cell.appendChild(pill);
  cell.appendChild(avEl);

  cell._rankEl = rankEl;
  cell._wordEl = wordEl;
  cell._avEl = avEl;
  return cell;
}

function updateCellElement(cell, guess, opts) {
  const prevTier = cell.getAttribute('data-tier') || '';
  const prevCols = cell.dataset.cols || '';
  const prevWordLen = cell.dataset.wlen || '';
  const keepFade = !opts.shouldFade && isHeatFadeInProgress(cell);

  let cls = 'cell';
  if (opts.isInvalid) cls += ' unknown';
  if (opts.isLatest) cls += ' latest';
  if (opts.shouldFade || keepFade) cls += ' heat-fading';
  cell.className = cls;

  cell.setAttribute('data-tier', String(opts.tier));
  cell.setAttribute('data-word-key', guess.word);
  cell.dataset.cols = String(opts.cols);
  cell.dataset.wlen = String(Math.max(1, guess.word.length));

  if (opts.shouldFade) {
    cell.style.removeProperty('--heat');
    cell.style.removeProperty('--heat-start');
    cell.style.setProperty('--heat-end', opts.heatColor);
    cell.style.setProperty('--heat-progress', '0');
    cell.dataset.needsHeatKick = '1';
  } else if (keepFade) {
    cell.style.setProperty('--heat-end', opts.heatColor);
    delete cell.dataset.needsHeatKick;
  } else {
    cell.style.removeProperty('--heat-start');
    cell.style.removeProperty('--heat-end');
    cell.style.removeProperty('--heat-progress');
    cell.style.setProperty('--heat', opts.heatColor);
    delete cell.dataset.needsHeatKick;
  }

  cell.style.setProperty('--fill', opts.fill + '%');
  cell.style.setProperty('--c', playerColor(guess));

  const rankLbl = opts.isInvalid ? '—' : formatRank(guess.rank);
  if (cell._rankEl.textContent !== rankLbl) cell._rankEl.textContent = rankLbl;
  if (cell._wordEl.textContent !== guess.word) cell._wordEl.textContent = guess.word;

  setChipAvatarContent(cell._avEl, guess);
  applyChipCosmetics(cell._avEl, guess, { avatarSize: 24 });

  return {
    needsFit: opts.isNewCell || prevTier !== String(opts.tier)
      || prevCols !== String(opts.cols)
      || prevWordLen !== cell.dataset.wlen,
    needsHeatKick: opts.shouldFade,
  };
}

export class IndexGrid {
  constructor(_domRenderer, _animationManager) {
    // Constructor args ignored — kept for signature compatibility with
    // GuessList so alt-main.js doesn't need to special-case instantiation.
    this._container = document.getElementById('index-grid');
    if (!this._container) {
      console.warn('[IndexGrid] #index-grid not found in DOM; chip rendering will no-op.');
      this._container = document.createElement('div'); // safety stub
    }
    // Top-rank "best guess so far" card (the lowest-rank valid guess) is
    // surfaced as a single prominent chip above the grid. The card host
    // sits in alt.html above #index-grid.
    this._topCardContainer = document.getElementById('index-top-card');
    this._lastTopCardSig = '';
    // Stubs that match GuessList's public fields so main.js layout math
    // doesn't crash when it reads guessList.topOffset etc.
    this.entries = new Map();
    this.topOffset = 0;
    this._lastSig = '';
    // Particle emitter (BokehParticles) is attached post-construction by
    // alt-main.js via setParticleEmitter(). Set of words rendered last
    // pass — diffed against the current render to find newly-added chips
    // for particle bursts.
    this._particles = null;
    this._prevWords = new Set();
    this._cellCache = new Map();
    // ResizeObserver — when the container size changes (viewport resize,
    // OBS canvas resize, etc.) the chips re-layout and fit-pass needs
    // to re-evaluate. Debounced via rAF to coalesce burst events.
    if (typeof ResizeObserver === 'function') {
      let raf = 0;
      this._resizeObserver = new ResizeObserver(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          raf = 0;
          fitOverflowingWords(this._container);
        });
      });
      this._resizeObserver.observe(this._container);
    }
  }

  setParticleEmitter(emitter) {
    this._particles = emitter;
  }

  setXpFloater(floater) {
    this._xpFloater = floater;
  }

  // Spawn a floating "+N XP" bubble at a chip's viewport position. The
  // chip may not be in the DOM yet (updateList is throttled), so we
  // retry across a couple of animation frames before giving up. Once
  // the chip is found, we call into the attached ChipXpFloater (or
  // no-op if none was set).
  spawnXpAtChip(word, xpAmount, playerName, cosmetics = null) {
    if (!this._xpFloater || !word || !xpAmount || xpAmount <= 0) return;
    const tryFind = (attempt) => {
      const el = this._container.querySelector(
        '.cell[data-word-key="' + cssEscape(word) + '"]'
      );
      if (el) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        this._xpFloater.spawn(cx, cy, xpAmount, playerName, cosmetics);
        return;
      }
      // Up to ~250ms across 4 retries (covers the 150ms updateList throttle).
      if (attempt < 4 && typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => tryFind(attempt + 1));
      }
    };
    tryFind(0);
  }

  // ---------------------------------------------------------------------
  // No-op stubs — GuessList API surface that doesn't apply to a flat grid
  // ---------------------------------------------------------------------
  setViewHeight() {}
  setTopOffset(y) { this.topOffset = y; }
  setScrollY() {}
  setDrawerOffset() {}
  get drawerOffset() { return 0; }
  getScrollY() { return 0; }
  getMaxScroll() { return 0; }
  getRowHeight() { return 0; }
  invalidateRowHeight() {}
  update() {}                       // per-frame physics — N/A
  isWordInView() { return true; }   // audio cues fire for everything in alt mode
  applyCosmeticsToAll() {
    // Cosmetics on the chip grid v1: player color drives avatar disc, but
    // we don't currently honor equipped name_color/glow. If you want that
    // later, store equipped + re-render. Safe no-op for now.
  }

  // ---------------------------------------------------------------------
  // updateList — the only method that actually does work in alt mode.
  // Throttled to at most one re-render per ~150ms; chat-driven games
  // can fire guesses 5+/sec which would otherwise re-render the whole
  // 120-chip grid (backdrop-filter + DOM swap) at the same cadence and
  // peg the GPU. The trailing call ensures the last update always
  // lands so the latest guess is never dropped.
  // ---------------------------------------------------------------------
  updateList(guesses /*, totalRankedWords, winHistory, winCounts */) {
    if (!Array.isArray(guesses)) guesses = [];
    const THROTTLE_MS = 150;
    const now = Date.now();
    this._pendingGuesses = guesses;
    if (this._lastRenderAt && (now - this._lastRenderAt) < THROTTLE_MS) {
      if (this._throttleTimer) return;
      this._throttleTimer = setTimeout(() => {
        this._throttleTimer = null;
        const g = this._pendingGuesses;
        this._pendingGuesses = null;
        this._lastRenderAt = Date.now();
        this._renderNow(g);
      }, THROTTLE_MS - (now - this._lastRenderAt));
      return;
    }
    this._lastRenderAt = now;
    this._renderNow(guesses);
  }

  _renderNow(guesses) {
    if (!Array.isArray(guesses)) guesses = [];

    // Cheap dirty-check: serialize word+rank+latest signature. If the set
    // didn't change, skip re-render. (Chat-heavy MP can fire updateList
    // many times per second.)
    let latestWord = null;
    let latestTs = 0;
    for (const g of guesses) {
      const t = +new Date(g.timestamp || 0) || 0;
      if (t > latestTs) { latestTs = t; latestWord = g.word; }
    }
    const sig = guesses.length + '|' + (latestWord || '') + '|' +
      guesses.map(g => g.word + ':' + g.rank).join(',');
    if (sig === this._lastSig) return;
    this._lastSig = sig;

    // Sort by rank ASC. Invalid / non-word guesses (9999999) go to the tail.
    // Cap to top 90 chips so the DOM doesn't blow up in long games.
    // The tail is the least-interesting part of the grid (rank 50k+
    // chips with negligible heat); culling it keeps render + style-recalc
    // + backdrop-filter costs bounded as guess counts grow. The latest
    // chip is always included even if it would otherwise fall past the
    // cap (see below).
    const MAX_VISIBLE = 90;
    const fullSort = guesses.slice().sort((a, b) => (a.rank || 99e9) - (b.rank || 99e9));
    let sorted = fullSort.slice(0, MAX_VISIBLE);
    // Preserve the latest guess even if it's past the cap, so the
    // streamer's most recent action stays visible.
    if (latestWord && !sorted.some(g => g.word === latestWord)) {
      const latestG = fullSort.find(g => g.word === latestWord);
      if (latestG) sorted = sorted.slice(0, MAX_VISIBLE - 1).concat(latestG)
        .sort((a, b) => (a.rank || 99e9) - (b.rank || 99e9));
    }

    // ─── Top-rank "best guess so far" card ────────────────────────
    // The single lowest-rank valid guess gets surfaced above the grid as
    // a prominent default-Searchle-style chip. Its word is then excluded
    // from the grid below, so the same word never appears twice on screen.
    const topGuess = sorted.find(g => g.rank && g.rank > 1 && g.rank < 9999999) || null;
    this._renderTopCard(topGuess);
    const excludeWord = topGuess ? topGuess.word : null;
    // ───────────────────────────────────────────────────────────────

    // Capture current chip rects before we mutate the DOM so the FLIP
    // pass can slide reused nodes to their new slots.
    const firstRects = new Map();
    const oldCells = this._container.querySelectorAll('.cell[data-word-key]');
    for (const c of oldCells) {
      const k = c.getAttribute('data-word-key');
      const r = c.getBoundingClientRect();
      firstRects.set(k, { x: r.left, y: r.top });
    }

    // Rebuild DOM as row-stacked grid, but REUSE existing chip nodes by
    // word key instead of recreating the whole tree every update. That
    // preserves loaded avatar images, avoids DOM churn/GC spikes, and
    // dramatically cuts style/layout work when chat is busy.
    const frag = document.createDocumentFragment();
    const nextWords = new Set();
    const visibleCells = [];
    const dirtyCells = [];
    const fadeKickCells = [];

    let rowIdx = 0;
    let colsThisRow = colsForRow(rowIdx);
    let rowDiv = makeRow(colsThisRow);
    let chipsInRow = 0;

    for (const g of sorted) {
      const rank = g.rank;
      if (!rank || rank === 1) continue; // skip rank 1 (target — not yet guessed)
      if (excludeWord && g.word === excludeWord) continue; // surfaced as top card

      // Start a new row when current is full.
      if (chipsInRow >= colsThisRow) {
        frag.appendChild(rowDiv);
        rowIdx++;
        colsThisRow = colsForRow(rowIdx);
        rowDiv = makeRow(colsThisRow);
        chipsInRow = 0;
      }

      const isInvalid = rank >= 9999999;
      const tier = tierForRow(rowIdx);  // size from row position
      // Color + fill from the same closeness curve so they stay in lockstep.
      // The one exception is rank=RANK_INVALID (misspelt / non-word), which
      // rankFill pins to 100% — a solid red block rather than the empty red
      // shell it used to render as. Real-but-distant words (incl. the
      // outside-pool sentinel) still get red + near-empty.
      const fill = rankFill(rank);
      const heatColor = rankColor(rank);
      const isLatest = (g.word === latestWord);
      // Newly-inserted chips fade in from "mystery purple" to their real
      // heat color (reveal-the-rank effect). Detect via the diff against
      // last render's word set; suppress the fade on the very first render
      // (re-hydration after refresh) so existing words don't flash purple.
      // Also suppress for tier 7+ chips — they're tiny and at the bottom of
      // the grid, so the 4.2s per-frame color-mix interpolation is wasted
      // GPU time relative to the (imperceptible) visual benefit.
      const isNewToGrid = !this._prevWords.has(g.word) && this._prevWords.size > 0;
      const shouldFade = isNewToGrid && tier < 7;
      let cell = this._cellCache.get(g.word);
      const isNewCell = !cell;
      if (!cell) {
        cell = createCellElement();
        this._cellCache.set(g.word, cell);
      }

      const updateMeta = updateCellElement(cell, g, {
        cols: colsThisRow,
        fill,
        heatColor,
        isInvalid,
        isLatest,
        isNewCell,
        shouldFade,
        tier,
      });
      if (updateMeta.needsFit) dirtyCells.push(cell);
      if (updateMeta.needsHeatKick) fadeKickCells.push(cell);

      rowDiv.appendChild(cell);
      visibleCells.push(cell);
      nextWords.add(g.word);
      chipsInRow++;
    }

    // Flush the last (possibly partial) row.
    if (chipsInRow > 0) frag.appendChild(rowDiv);

    for (const word of Array.from(this._cellCache.keys())) {
      if (!nextWords.has(word)) this._cellCache.delete(word);
    }

    // Plain DOM swap — view transitions disabled (perf cost outweighs
    // the visual smoothness on chat-driven games that fire guesses
    // faster than the transition duration). FLIP below makes existing
    // chips slide to their new positions without re-rendering each frame.
    this._container.replaceChildren(frag);

    // ─── Heat fade: kick --heat-progress from 0 → 1 on every fading chip
    // Includes only brand-new chips. Reused nodes carry any in-progress
    // fade forward on the same element, so they do not need to be reset.
    if (fadeKickCells.length) {
      // eslint-disable-next-line no-unused-expressions
      this._container.offsetWidth;
      requestAnimationFrame(() => {
        for (const c of fadeKickCells) {
          if (!c.isConnected) continue;
          c.style.setProperty('--heat-progress', '1');
          delete c.dataset.needsHeatKick;
        }
      });
    }
    // ───────────────────────────────────────────────────────────────

    // ─── FLIP: invert + play on chips whose positions changed ─────
    // Read new positions, apply the inverse delta synchronously (no
    // transition), then on the next frame remove the transform with a
    // short transition so each chip slides from its old spot to its new.
    // Chips that are brand-new (no entry in firstRects) skip this — they
    // appear in place, paired with the existing bokeh-particle burst.
    const flipTargets = [];
    for (const c of visibleCells) {
      const k = c.getAttribute('data-word-key');
      const prev = firstRects.get(k);
      if (!prev) continue;
      const nr = c.getBoundingClientRect();
      const dx = prev.x - nr.left;
      const dy = prev.y - nr.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      c.style.transition = 'none';
      c.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      flipTargets.push(c);
    }
    if (flipTargets.length) {
      // Force layout flush so the inverted transforms commit before we
      // queue the play. Without this, the browser can collapse the two
      // style changes and the slide is skipped.
      // eslint-disable-next-line no-unused-expressions
      this._container.offsetWidth;
      requestAnimationFrame(() => {
        for (const c of flipTargets) {
          // Longer duration + a smoother out-curve so chips drift to
          // their new spots rather than snapping. ~450ms reads as a
          // deliberate motion without holding up subsequent renders.
          c.style.transition = 'transform 450ms cubic-bezier(0.2, 0, 0.2, 1)';
          c.style.transform = '';
        }
      });
    }
    // ───────────────────────────────────────────────────────────────
    // Synchronous fit-pass — only touch cells whose tier/width changed or
    // were newly created. The late full-container safety nets below still
    // catch the rare avatar/image layout shift.
    fitOverflowingWords(dirtyCells);

    // ─── Particle bursts on newly-added chips ──────────────────────
    // Diff the rendered word set against the previous render's set to
    // find which chips are NEW (didn't exist in the previous render).
    // For each new chip, emit a bokeh burst at its on-screen center.
    // Skip on the very first render so the page-load swarm doesn't
    // emit a hundred bursts at once.
    if (this._particles && this._prevWords.size > 0) {
      const newWords = [];
      for (const g of sorted) {
        if (!this._prevWords.has(g.word)) newWords.push(g);
      }
      if (newWords.length > 0) {
        // Cap new bursts per render to avoid spawn-storms on fast chat.
        const burstWords = newWords.slice(0, 5);
        for (const g of burstWords) {
          const cell = this._container.querySelector(
            '.cell[data-word-key="' + cssEscape(g.word) + '"]'
          );
          if (!cell) continue;
          // Perf: skip particle bursts for chips below row 6 (data-tier
          // 7+). These chips are tiny and at the bottom of the grid —
          // the burst is barely visible while still costing 32 particles
          // worth of GPU work + RAF time on the BokehParticles loop.
          const tierAttr = cell.getAttribute('data-tier');
          const tier = tierAttr ? parseInt(tierAttr, 10) : 0;
          if (tier >= 7) continue;
          const r = cell.getBoundingClientRect();
          const heat = cell.style.getPropertyValue('--heat') || '#ffffff';
          // Win-effect cosmetic — when the guesser has a win_effect
          // equipped, REPLACE the default heat-tier burst entirely
          // with a player-themed one driven by their effect's palette
          // and name. Effect name selects the pool ratios + thematic
          // specials (fireworks-style sparks, snowfall, phoenix flame,
          // etc.); palette colors every particle. Heat is still passed
          // in as the fallback. Schema:
          //   g.user.cosmetics.win_effect = { effect, colors: [...] }
          let palette = null;
          let effectName = null;
          const we = g && g.user && g.user.cosmetics && g.user.cosmetics.win_effect;
          if (we && typeof we.effect === 'string') {
            effectName = we.effect;
          }
          if (we && Array.isArray(we.colors) && we.colors.length > 0) {
            palette = we.colors;
          }
          // Pass the chip rect so particles spawn along its pill border,
          // not from the center like a firework.
          this._particles.emit(
            { x: r.left, y: r.top, width: r.width, height: r.height },
            heat,
            32,
            palette,
            effectName,
          );
        }
      }
    }
    this._prevWords = new Set(sorted.map(g => g.word));
    // ───────────────────────────────────────────────────────────────

    if (typeof requestAnimationFrame === 'function') {
      // One frame later — catches chips that re-laid-out after the
      // initial sync pass (rare but possible with PFP image loads).
      const rafFitCells = dirtyCells.slice();
      requestAnimationFrame(() => fitOverflowingWords(rafFitCells.length ? rafFitCells : this._container));
    }
    // 250ms backup pass — final safety net for late layout shifts (PFP
    // images that finished downloading after the rAF, font-metric
    // changes from late-loading fonts, etc.).
    if (this._lateFitTimer) clearTimeout(this._lateFitTimer);
    this._lateFitTimer = setTimeout(() => {
      this._lateFitTimer = null;
      fitOverflowingWords(this._container);
    }, 250);
  }

  // ---------------------------------------------------------------------
  // _renderTopCard — paints (or clears) the "best guess so far" card
  // above the grid. Pass null to clear. Uses the same chip markup as a
  // grid cell so styling stays consistent, but the outer container
  // (.alt-index-top-card) is sized & styled for full-width prominence
  // and gets its own scaling rules in alt.css.
  // ---------------------------------------------------------------------
  _renderTopCard(g) {
    const host = this._topCardContainer;
    if (!host) return;

    if (!g) {
      // Empty state: nothing valid to surface yet (no guesses, all typos,
      // or only the target has been revealed). Render an invisible
      // placeholder chip with the same internal structure so the slot
      // keeps its height — prevents the grid below from shifting up
      // when a round ends and the top card empties. CSS hides the
      // placeholder via visibility:hidden (still occupies space) and the
      // .placeholder class so it's exempt from heat-fade / particle hooks.
      if (this._lastTopCardSig !== 'placeholder') {
        host.innerHTML =
          '<div class="cell top-card placeholder" aria-hidden="true">' +
            '<span class="cell-pill"></span>' +
            '<span class="av-col"><span class="av"></span></span>' +
          '</div>';
        this._lastTopCardSig = 'placeholder';
      }
      return;
    }

    // Cheap dirty-check — word + rank uniquely identifies a render. PFP
    // changes are rare enough that we don't bother diffing them; they'll
    // pick up on the next word change.
    const sig = g.word + ':' + g.rank;
    if (sig === this._lastTopCardSig) return;
    this._lastTopCardSig = sig;

    const rank = g.rank;
    const fill = rankFill(rank);
    const heat = rankColor(rank);
    const rankLbl = formatRank(rank);
    const initial = playerInitial(g);
    const pfpUrl = playerPfpUrl(g);
    // Top card shows the guesser's display name beneath the avatar disc
    // (the grid chips don't — they're too small). Fall back gracefully
    // when the user object is missing (e.g. SP, bot guesses).
    const userName = (g.user && (g.user.displayName || g.user.username)) || '';
    const avInner = pfpUrl
      ? '<span class="av"><img src="' + escapeHtml(pfpUrl) +
        '" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'' +
        escapeHtml(initial).replace(/'/g, "\\'") + '\'))"></span>'
      : '<span class="av">' + escapeHtml(initial) + '</span>';
    // Wrap avatar + name in a column so they stack vertically; the column
    // sits in the same flex slot as the bare avatar did in the grid chip.
    const avHtml =
      '<span class="av-col">' +
        avInner +
        (userName ? '<span class="user-name">' + escapeHtml(userName) + '</span>' : '') +
      '</span>';

    // Top card fades in like a grid chip: if this word is new to the
    // grid (and we're past the initial hydration render), render the
    // chip with .heat-fading and let the CSS color-mix(in oklab, ...)
    // rule animate --heat-progress from 0 → 1 (kicked via rAF below).
    //
    // If the SAME word is already in the host mid-fade, capture the
    // chip's current resolved --heat (interpolated color-mix result at
    // the current progress) as the new --heat-start so the fade picks
    // up where it left off rather than snapping back to purple.
    let carryStart = null;
    const existing = host.querySelector('.cell.heat-fading');
    if (existing && existing.getAttribute('data-word-key') === g.word) {
      const cur = getComputedStyle(existing).getPropertyValue('--heat').trim();
      const prog = parseFloat(getComputedStyle(existing).getPropertyValue('--heat-progress')) || 0;
      if (cur && prog < 0.98) {
        carryStart = cur;
      }
    }
    const isNewWord = !this._prevWords.has(g.word) && this._prevWords.size > 0;
    const needsFade = !!carryStart || isNewWord;
    const cls = needsFade ? 'cell top-card heat-fading' : 'cell top-card';

    // Single chip — same .cell-pill/.r/.w/.av structure as a grid cell so
    // alt.css's existing chip rules layer in cleanly. The .alt-index-top-card
    // host gets its own prominence rules (height, font size, full-width).
    // Fade-mode chips set --heat-end (target) + --heat-progress=0 (and
    // optionally --heat-start for carry-overs); non-fade chips set
    // --heat directly to the real color. The CSS rule for .heat-fading
    // computes --heat each frame via color-mix(in oklab, start, end).
    let styleProps = '--fill:' + fill + '%;' +
      '--c:' + playerColor(g) + ';' +
      '--wlen:' + Math.max(1, g.word.length) + ';';
    if (needsFade) {
      styleProps += '--heat-end:' + heat + ';--heat-progress:0;';
      if (carryStart) styleProps += '--heat-start:' + carryStart + ';';
    } else {
      styleProps += '--heat:' + heat + ';';
    }
    const html =
      '<div class="' + cls + '" data-word-key="' + escapeHtml(g.word) + '"' +
        ' style="' + styleProps + '">' +
        '<span class="cell-pill">' +
          '<span class="r">' + rankLbl + '</span>' +
          '<span class="w">' + escapeHtml(g.word) + '</span>' +
        '</span>' +
        avHtml +
      '</div>';
    host.innerHTML = html;

    // Apply per-player cosmetics to the top card. Bigger avatar reference
    // (64px) since the top-card pfp is much larger than grid cells. Also
    // styles the username with name_color + name_glow and appends the
    // title cosmetic next to the name. Fan-club marker toggles .has-fc.
    const topAv = host.querySelector('.av');
    const topName = host.querySelector('.user-name');
    const topCol = host.querySelector('.av-col');
    applyChipCosmetics(topAv, g, {
      avatarSize: 64,
      nameEl: topName,
      titleContainer: topCol,
      withName: true,
    });

    // If this is a fade render, kick --heat-progress to 1 on the next
    // frame so the OKLab color-mix transition fires.
    if (needsFade && typeof requestAnimationFrame === 'function') {
      // Force layout flush so the progress=0 state commits first.
      // eslint-disable-next-line no-unused-expressions
      host.offsetWidth;
      requestAnimationFrame(() => {
        const el = host.querySelector('.cell.heat-fading');
        if (el) el.style.setProperty('--heat-progress', '1');
      });
    }

    // Run the same fit-pass logic against the top-card container so very
    // long words shrink instead of clipping.
    fitOverflowingWords(host);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => fitOverflowingWords(host));
    }
  }
}

function fitOverflowingWords(target) {
  if (!target) return;
  const cells = Array.isArray(target)
    ? target
    : (typeof target.length === 'number' && typeof target.item === 'function')
      ? Array.from(target)
      : Array.from(target.querySelectorAll('.cell'));
  for (const c of cells) {
    if (!c || !c.isConnected) continue;
    const w = c.querySelector('.w');
    if (!w) continue;
    // Always clear any prior scaleX transform first so we re-measure
    // the natural width, not a squeezed one.
    if (w.style.transform) w.style.transform = '';
    if (w.style.fontSize) w.style.fontSize = '';
    if (w.scrollWidth <= w.clientWidth + 1) continue; // already fits
    let fs = parseFloat(getComputedStyle(w).fontSize);
    let guard = 80;
    // Shrink font to 3px floor in 0.5px steps.
    while (fs > 3 && w.scrollWidth > w.clientWidth + 1 && guard-- > 0) {
      fs -= 0.5;
      w.style.fontSize = fs + 'px';
    }
    // Last resort: word is STILL wider than chip at 3px font. Apply
    // horizontal scaleX squeeze so the word visually fits inside the
    // chip without ellipsis truncation. Letters get narrower but stay
    // readable. Origin = center so the squeeze stays centered.
    if (w.scrollWidth > w.clientWidth + 1) {
      const scale = Math.max(0.5, w.clientWidth / w.scrollWidth);
      w.style.transformOrigin = 'center';
      w.style.transform = 'scaleX(' + scale.toFixed(3) + ')';
    }
  }
}

function makeRow(cols) {
  const row = document.createElement('div');
  row.className = 'index-row';
  row.setAttribute('data-cols', String(cols));
  return row;
}
