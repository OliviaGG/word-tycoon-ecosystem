// ===== Recent Ticker =====
// Alt-mode (grid) replacement for PinnedGuess. Instead of showing a single
// "latest guess" card, this renders a horizontal run of the most recent
// guesses — as many as fit the column width — with new words entering at
// the right and the oldest sliding off the left edge.
//
// Public surface MATCHES PinnedGuess so the only diff in alt-main.js is
// swapping the import + constructor. Methods that don't apply here
// (spring physics on a single card) are no-ops or reduced to the drawer
// offset tracking that the layout still depends on.
//
// Deliberately NOT built on GuessEntry/CSS3D: a ticker chip is a small
// static bubble, so it's plain DOM inside one positioned container. But
// it IS a structural mirror of an IndexGrid cell (.rt-chip/.rt-pill/.rt-w
// ↔ .cell/.cell-pill/.w) so alt.css can hand it the same water-fill,
// liquid-glass and heat-ring treatment the grid chips get, plus the same
// new-guess heat fade and latest-chip pulse. It rides the grid's
// `body.obs-mode` overrides too — backdrop-filter renders black in
// render1's OBS CEF build, and those rules swap in a baked heat wash.

import config from '../config.js';
import { RANK_INVALID } from '../utils/ColorUtils.js';

// Heat color + water-fill level — identical formulas to
// IndexGrid.rankColor() / rankFill(), so ticker chips, grid chips and the
// top card all sit on one color scale AND one fill scale. Kept inline
// rather than imported for the same reason PinnedGuess duplicates them:
// no cross-component dependency on a private helper. If IndexGrid's
// versions ever change, change these too.
function gridRankColor(rank) {
  const r = (!rank || rank <= 0) ? 1 : rank;
  const closeness = Math.max(0, Math.min(1, 1 - Math.log10(r) / 5));
  const hue = closeness * 120;
  return `hsla(${hue.toFixed(1)}, 80%, 35%, 0.9)`;
}

function gridRankFill(rank) {
  if (!rank || rank <= 0) return 100;
  // Misspelt / non-words fill completely — a solid red chip instead of the
  // empty red shell the plain curve produces. Matches IndexGrid.rankFill().
  if (rank === RANK_INVALID) return 100;
  const p = 100 * (1 - Math.log10(rank) / 5);
  return Math.max(0, Math.min(100, Math.round(p)));
}

// Mystery-purple the new-guess heat fade starts from — must match the
// --heat-start fallback in alt.css's .heat-fading rule.
const HEAT_START = '#6a1ab8';

// Hard ceiling on live chip nodes. The off-screen prune below is the
// primary bound, but it relies on getBoundingClientRect measurements
// that read 0 while the container is display:none (OBS scene switches,
// hidden tabs). This cap keeps the DOM bounded even when measurement
// never resolves.
const MAX_CHIPS = 30;

// Entry animation duration — must match the max-width transition in
// alt.css so the prune pass runs after chips have settled.
const SLIDE_MS = 420;

export class RecentTicker {
  constructor(domRenderer) {
    this.domRenderer = domRenderer;
    this.currentObject = null;
    this.yPosition = 0; // Set by alt-main.js
    this._consumed = 0; // how many entries of `guesses` are already on screen

    // Drawer offset — smoothly animated when stats drawer opens/closes
    this._drawerOffset = 0;
    this._drawerTarget = 0;

    this.element = document.createElement('div');
    this.element.className = 'recent-ticker';
    this.element.style.width = (config.baseWidth - 72) + 'px';

    this._row = document.createElement('div');
    this._row.className = 'recent-ticker-row';
    this.element.appendChild(this._row);

    this._mounted = false;
    // Mount immediately rather than on first guess. The container has a
    // fixed height, so an empty ticker still holds its slot open — that
    // gives alt.html's #game-spacer sync something to measure before the
    // first guess of a round and stops the grid from riding up during
    // the gap between rounds (the failure the spacer's max-ratchet was
    // added to paper over back when this slot held the pinned card).
    this._mount();
  }

  setDrawerOffset(target) {
    this._drawerTarget = target;
  }

  // Y is the top edge handed down by updateLayout(). The element is
  // centered on its position by DOMRenderer's translate(-50%,-50%), so
  // add half the ticker height (alt.css .recent-ticker height / 2) to
  // land the top edge where asked.
  _worldY() {
    return -(this.yPosition + this._drawerOffset + 56);
  }

  setPosition(y) {
    this.yPosition = y;
    if (this.currentObject) {
      this.currentObject.position.set(config.baseWidth / 2, this._worldY(), 40);
    }
  }

  _mount() {
    if (this._mounted) return;
    this.domRenderer.add(this.element);
    this.currentObject = this.domRenderer.makeObject(this.element);
    this.currentObject.position.set(config.baseWidth / 2, this._worldY(), 40);
    this._mounted = true;
  }

  // Drop chips that have travelled fully past the container's left edge.
  // Measured rather than counted because chip widths vary with word
  // length — "a" and "onomatopoeia" don't consume the same room.
  _prune() {
    const left = this.element.getBoundingClientRect().left;
    // A zero-width container means we're not laid out (hidden tab, OBS
    // scene not active). Fall back to the count cap only.
    const measurable = this.element.getBoundingClientRect().width > 0;
    if (measurable) {
      while (this._row.children.length > 1) {
        const first = this._row.firstElementChild;
        if (first.getBoundingClientRect().right >= left - 4) break;
        this._row.removeChild(first);
      }
    }
    while (this._row.children.length > MAX_CHIPS) {
      this._row.removeChild(this._row.firstElementChild);
    }
  }

  // Chip markup mirrors a grid cell's structure so alt.css can give it
  // the same treatment:
  //   .rt-chip  ↔ .cell      — outer card carrying the rank-color water-fill
  //   .rt-pill  ↔ .cell-pill — inner liquid-glass bubble with the heat ring
  //   .rt-w     ↔ .cell .w   — uppercase word
  // No rank label or avatar (word-only ticker, per spec), and no
  // font-fit pass — ticker chips size to their content instead of being
  // squeezed into a fixed grid column, so the word never needs to shrink.
  _addChip(guess, animate) {
    const chip = document.createElement('span');
    chip.setAttribute('data-word-key', guess.word);
    chip.style.setProperty('--fill', gridRankFill(guess.rank) + '%');

    const heat = gridRankColor(guess.rank);
    if (animate) {
      // Same new-guess reveal the grid uses: start at mystery-purple and
      // let CSS drive --heat-progress 0 → 1, computing --heat along an
      // OKLab path. Kicked on the next frame so the 0 state actually
      // lands as the transition's start value.
      chip.className = 'rt-chip heat-fading';
      chip.style.setProperty('--heat-start', HEAT_START);
      chip.style.setProperty('--heat-end', heat);
      chip.style.setProperty('--heat-progress', '0');
    } else {
      chip.className = 'rt-chip';
      chip.style.setProperty('--heat', heat);
    }

    const pill = document.createElement('span');
    pill.className = 'rt-pill';
    const word = document.createElement('span');
    word.className = 'rt-w';
    word.textContent = guess.word;
    pill.appendChild(word);
    chip.appendChild(pill);

    // Newest chip carries the grid's pulsing rank-color halo. Only ever
    // one at a time, so the infinite animation's cost stays bounded.
    const prevLatest = this._row.querySelector('.rt-chip.latest');
    if (prevLatest) prevLatest.classList.remove('latest');
    chip.classList.add('latest');

    this._row.appendChild(chip);

    if (!animate) {
      this._prune();
      return;
    }

    // Measure the chip's natural width, then collapse it and let CSS
    // expand it back. Growing from the right is what pushes the older
    // chips left — no per-chip transform bookkeeping needed.
    // offsetWidth (not scrollWidth) because the chip is a padded,
    // bordered box and we need the full border-box width. It reads in
    // layout units, unaffected by the DOMRenderer's container scale.
    const full = chip.offsetWidth;
    chip.classList.add('rt-enter');
    // Force a style flush so the collapsed state is the transition's
    // starting point rather than being coalesced away.
    void chip.offsetWidth;
    chip.style.maxWidth = full + 'px';
    chip.classList.remove('rt-enter');
    requestAnimationFrame(() => {
      chip.style.setProperty('--heat-progress', '1');
    });

    setTimeout(() => {
      chip.style.maxWidth = '';
      this._prune();
    }, SLIDE_MS + 60);
  }

  update(guesses, totalRankedWords, winHistory, winCounts, eloLeaderboard, options = {}) {
    if (!guesses || guesses.length === 0) {
      this.clear();
      return;
    }

    this._mount();

    // The guesses array only ever grows within a round (new-game calls
    // clear()). A shorter array means we missed a reset — rebuild rather
    // than leaving stale words from the previous round on screen.
    if (guesses.length < this._consumed) {
      this._row.textContent = '';
      this._consumed = 0;
    }

    const animate = options.animate === true;
    for (let i = this._consumed; i < guesses.length; i++) {
      // Only the final arrival of a batch animates; a backfill (page
      // load, reconnect, cosmetics re-render) paints instantly.
      this._addChip(guesses[i], animate && i === guesses.length - 1);
    }
    this._consumed = guesses.length;
  }

  // Drawer offset still animates — the ticker rides the same downward
  // push as the rest of the column when the stats drawer opens.
  animate(dt) {
    const diff = this._drawerTarget - this._drawerOffset;
    if (diff === 0 || !this.currentObject) return;
    if (Math.abs(diff) > 0.5) {
      this._drawerOffset += diff * Math.min(1, 10 * dt);
    } else {
      this._drawerOffset = this._drawerTarget;
    }
    this.currentObject.position.y = this._worldY();
  }

  // A re-guess of a word already on the ticker doesn't append (the word
  // is deduped upstream) — pulse the existing chip instead.
  flashBump(word) {
    const chip = this._row.querySelector('[data-word-key="' + CSS.escape(String(word)) + '"]');
    if (!chip) return;
    chip.classList.remove('bumped');
    void chip.offsetWidth; // force reflow so the animation restarts
    chip.classList.add('bumped');
  }

  clear() {
    this._row.textContent = '';
    this._consumed = 0;
  }
}
