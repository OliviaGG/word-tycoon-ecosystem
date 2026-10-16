// ===== Pinned Guess =====
// Shows the latest guess (closest word) pinned above the guess list.

import { GuessEntry } from './canvas-water/GuessEntryCanvas.js';
import config from '../config.js';
import { resolveElo } from '../utils/EloUtils.js';
import { RANK_INVALID } from '../utils/ColorUtils.js';

// Alt-mode heat color + fill — matches IndexGrid's rankColor() and
// rankFill() exactly. Used to recolor the pinned-guess card so its
// rank stroke / water-fill / glow lock visually to the grid below
// (the default ColorUtils.rankToColor uses a different scale tied to
// totalRankedWords, which produces noticeably different hues for the
// same rank). Inlined here rather than imported from IndexGrid to
// avoid a cross-component dependency on a private helper.
function gridRankColor(rank) {
  const r = (!rank || rank <= 0) ? 1 : rank;
  const closeness = Math.max(0, Math.min(1, 1 - Math.log10(r) / 5));
  const hue = closeness * 120;
  // Mirror IndexGrid's rankColor: match regular Searchle's rankToColor
  // (fixed 80% saturation, 35% lightness, 0.9 alpha) so the pinned card
  // stays in sync with the darker grid chips below it.
  return `hsla(${hue.toFixed(1)}, 80%, 35%, 0.9)`;
}
function gridRankFill(rank) {
  if (!rank || rank <= 0) return 100;
  // Misspelt / non-words fill completely — matches IndexGrid.rankFill().
  if (rank === RANK_INVALID) return 100;
  const p = 100 * (1 - Math.log10(rank) / 5);
  return Math.max(0, Math.min(100, Math.round(p)));
}
function applyGridHeat(el, rank) {
  if (!el) return;
  el.style.setProperty('--rc', gridRankColor(rank));
  el.style.setProperty('--fill', gridRankFill(rank) + '%');
}

function isObsMode() {
  return !!(document.body && document.body.classList.contains('obs-mode'));
}

function stabilizeObsPinnedEntry(entry) {
  const el = entry && entry.element;
  if (!el || !isObsMode()) return;

  // OBS/CEF can flicker when nested backdrop-filters sit on a transformed
  // element. The pinned card is already layered over a dark panel, so keep
  // the glass styling but remove the expensive live backdrop sampling here.
  el.style.backdropFilter = 'none';
  el.style.webkitBackdropFilter = 'none';
  el.style.backfaceVisibility = 'hidden';

  const chip = el.querySelector('.guess-chip');
  if (chip) {
    chip.style.backdropFilter = 'none';
    chip.style.webkitBackdropFilter = 'none';
    chip.style.backfaceVisibility = 'hidden';
  }
}

export class PinnedGuess {
  constructor(domRenderer) {
    this.domRenderer = domRenderer;
    this.currentObject = null;
    this._entry = null;
    this._settling = false;
    this.yPosition = 0; // Set by main.js
    this._scrollY = 0;

    // Drawer offset — smoothly animated when stats drawer opens/closes
    this._drawerOffset = 0;
    this._drawerTarget = 0;
  }

  setDrawerOffset(target) {
    this._drawerTarget = target;
  }

  setPosition(y) {
    this.yPosition = y;
    // Only snap position when NOT animating — animation handles its own positioning
    if (this.currentObject && !this._settling) {
      const px = config.baseWidth / 2;
      const py = -(this.yPosition + this._drawerOffset + 108);
      this.currentObject.position.set(px, py, 40);
      this.domRenderer.applyTransform(this._entry.element, px, py, 40, 0, this.currentObject.rotation.y);
    }
  }

  update(guesses, totalRankedWords, winHistory, winCounts, eloLeaderboard, options = {}) {
    const obsMode = isObsMode();
    const animate = options.animate === true && !obsMode;

    if (guesses.length === 0) {
      if (this._entry) {
        this.domRenderer.remove(this._entry.element);
        this.currentObject = null;
        this._entry = null;
      }
      return;
    }

    const latest = guesses[guesses.length - 1];

    // Stable identifier for the current bumper (whoever overlay-pic'd this
    // word last). Used to detect bump events that arrive while the same
    // word is already pinned — the optimization below would otherwise
    // return early and skip rendering the new bumper avatar.
    const newBumperKey = latest.lastBumper
      ? (latest.lastBumper.platformUserId || latest.lastBumper.displayName || '')
      : '';

    // Same word (passive refresh or bump): update in place. Recreating the
    // pinned card just to swap the bumper avatar makes the top guess blink
    // in OBS, so bumper changes are patched surgically on the existing entry.
    if (this._entry && this._entry.word === latest.word) {
      this._entry.updateRank(latest.rank, totalRankedWords);
      if (this._entry._lastCosSignature !== GuessEntry._cosmeticsSignature(latest.user?.cosmetics)) {
        this._entry.applyCosmeticsRetro(latest.user?.cosmetics);
      }
      this._entry.updateElo(eloLeaderboard);
      if (this._entry._bumperKey !== newBumperKey && typeof this._entry.updateBumper === 'function') {
        this._entry.updateBumper(latest.lastBumper || null);
        this._entry._bumperKey = newBumperKey;
      }
      if (latest.user && typeof this._entry.updateFanClub === 'function') {
        this._entry.updateFanClub(!!latest.user.isFanClub);
      }
      // Re-apply grid heat on rank change so the card's --rc / --fill
      // stay locked to the grid's color scale.
      if (window.__ALT_MODE) applyGridHeat(this._entry.element, latest.rank);
      stabilizeObsPinnedEntry(this._entry);
      return;
    }

    const oldEntry = this._entry;

    // Regular browser mode keeps the old fly-in behavior. OBS mode swaps the
    // card atomically after the new element is fully positioned, avoiding a
    // one-frame blank top card in browser sources.
    if (oldEntry && !obsMode) {
      this.domRenderer.remove(this._entry.element);
      this.currentObject = null;
    }
    const entry = new GuessEntry(latest, totalRankedWords, winHistory, winCounts, {
      rankColorTransition: animate && !window.__ALT_MODE,
    });
    entry.element.style.width = (config.baseWidth - 72) + 'px';
    entry.element.classList.add('pinned-guess-entry');
    // Lock the pinned card's heat color + fill to the grid's formula in
    // alt mode so the card reads as part of the same color family as the
    // grid chips below it. Regular Searchle keeps the legacy ColorUtils
    // formula by default — alt-only override.
    if (window.__ALT_MODE) applyGridHeat(entry.element, latest.rank);

    // Win badge on pinned (most recent) guess only
    if (!window.__SP_MODE && latest.user) {
      const userId = latest.user.platformUserId || latest.user.id;
      const ld = latest.user.linkedDiscord || null;
      if (userId) {
        const wc = winCounts || {};
        const persistedWins = wc[ld] || wc[userId] || 0;
        const sessionWins = winHistory ? GuessEntry._countUserWins(winHistory, userId, ld) : 0;
        const wins = Math.max(persistedWins, sessionWins);
        if (wins > 0) {
          const picWrap = entry.element.querySelector('.guess-pic-wrap');
          if (picWrap) {
            const badge = document.createElement('span');
            badge.className = 'guess-win-badge';
            badge.textContent = wins;
            picWrap.appendChild(badge);
          }
        }
      }
    }

    // ELO badge on pinned guess pic
    if (!window.__SP_MODE && latest.user) {
      const eloEntry = resolveElo(eloLeaderboard, latest.user);
      if (eloEntry && typeof eloEntry.elo === 'number') {
        const picWrap2 = entry.element.querySelector('.guess-pic-wrap');
        if (picWrap2) {
          const eloBadge = document.createElement('span');
          eloBadge.className = 'guess-elo';
          eloBadge.textContent = 'ELO ' + eloEntry.elo;
          picWrap2.appendChild(eloBadge);
        }
      }
    }

    // Stamp the bumper key onto the new entry so the same-word optimization
    // above can short-circuit on passive refreshes but still detect when a
    // new bump arrives.
    entry._bumperKey = newBumperKey;
    this._entry = entry;
    this.currentObject = entry.object3D;
    this._targetX = config.baseWidth / 2;
    const targetY = -(this.yPosition + this._drawerOffset + 108);
    stabilizeObsPinnedEntry(entry);
    this.domRenderer.add(entry.element);

    if (animate) {
      // Simulate spring oscillation matching the guess list fly-in
      if (entry._water) entry._water.tilt = -0.55;
      this._settling = true;
      this._springDisp = 900;
      this._springVx = 0;
      this.currentObject.position.set(this._targetX + 900, targetY, 40);
      this.domRenderer.applyTransform(entry.element, this._targetX + 900, targetY, 40, 0, 0);
      entry.startRankColorTransition();
      return;
    }

    // Passive refreshes and duplicate bumps should update in place without a fly-in.
    this._settling = false;
    this._springDisp = 0;
    this._springVx = 0;
    this.currentObject.rotation.y = 0;
    this.currentObject.position.set(this._targetX, targetY, 40);
    this.domRenderer.applyTransform(entry.element, this._targetX, targetY, 40, 0, 0);
    if (oldEntry && obsMode) {
      this.domRenderer.remove(oldEntry.element);
    }
  }

  animate(dt) {
    // Smoothly animate drawer offset even when not settling
    const drawerDiff = this._drawerTarget - this._drawerOffset;
    if (Math.abs(drawerDiff) > 0.5) {
      this._drawerOffset += drawerDiff * Math.min(1, 10 * dt);
      if (this.currentObject && !this._settling) {
        const y = -(this.yPosition + this._drawerOffset + 108);
        this.currentObject.position.y = y;
        this.domRenderer.applyTransform(this._entry.element, this.currentObject.position.x, y, this.currentObject.position.z, 0, this.currentObject.rotation.y);
      }
    } else if (drawerDiff !== 0) {
      this._drawerOffset = this._drawerTarget;
      if (this.currentObject && !this._settling) {
        const y = -(this.yPosition + this._drawerOffset + 108);
        this.currentObject.position.y = y;
        this.domRenderer.applyTransform(this._entry.element, this.currentObject.position.x, y, this.currentObject.position.z, 0, this.currentObject.rotation.y);
      }
    }

    if (!this._settling || !this.currentObject) return;
    const obj = this.currentObject;

    // Y tracks scroll directly (no spring on Y axis) — includes drawer offset
    obj.position.y = -(this.yPosition + this._drawerOffset + 108);

    // Spring physics on X (same K=180, D=14 as GuessList)
    const dx = obj.position.x - this._targetX;
    this._springVx += (-180 * dx - 14 * this._springVx) * dt;
    obj.position.x += this._springVx * dt;

    // Rotation from velocity (same as GuessList)
    obj.rotation.y = Math.max(-0.15, Math.min(0.15, -this._springVx * 0.0003));

    // Secondary motion on text
    this._entry.applySecondaryMotion(this._springVx, 0);

    // Water slosh
    if (this._entry._water) {
      this._entry._water.update(dt, this._springVx, 0);
    }

    // Write CSS transform
    this.domRenderer.applyTransform(this._entry.element, obj.position.x, obj.position.y, obj.position.z, 0, obj.rotation.y);

    // Sleep when at rest
    if (Math.abs(this._springVx) < 0.5 && Math.abs(dx) < 0.3) {
      obj.position.x = this._targetX;
      obj.rotation.y = 0;
      this._springVx = 0;
      this._entry.applySecondaryMotion(0, 0);
      const water = this._entry._water;
      if (!water || water._flat) {
        this._settling = false;
      }
    }
  }

  flashBump(word, bumper) {
    if (!this.currentObject) return;
    const el = this.currentObject.element;
    if (el) {
      el.classList.remove('bumped');
      void el.offsetWidth; // force reflow
      el.classList.add('bumped');
    }
  }

  clear() {
    if (this._entry) {
      this.domRenderer.remove(this._entry.element);
      this.currentObject = null;
      this._entry = null;
    }
    this._settling = false;
  }
}
