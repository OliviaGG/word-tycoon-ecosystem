// ===== Guess List =====
// Manages guess bubble elements with spring physics.
// Entries bounce into position, wobble on reorder, and have velocity-based rotation.
// Uses DOMRenderer for direct CSS transform positioning (no CSS3DRenderer).

import { GuessEntry } from './canvas-water/GuessEntryCanvas.js';
import { XpBubble } from './XpBubble.js';
import config from '../config.js';
import { queueGuessEntrance, tickGuessEntrances } from './GuessEntranceEffects.js';

// Spring physics constants
const SPRING_K = 180;  // stiffness — higher = faster snap
const SPRING_D = 14;   // damping — higher = less bounce

// Sleep thresholds — skip physics when entry is at rest
const SLEEP_VEL = 0.5;   // max velocity to consider sleeping
const SLEEP_DISP = 0.3;  // max displacement from target to consider sleeping

// Dematerialize: an entry that's been detached (out of view) for this long is
// destroyed and moved back to the virtual pool. Bounds canvas memory regardless
// of guess count — without this, scrolling through a 1000-guess game leaves
// 1000 canvas backing stores (~360 MB on desktop) sitting in the JS heap.
const DEMATERIALIZE_DELAY_MS = 2000;
// Hard cap on materialized entries — emergency overflow handling. Normal flow
// keeps this well below the cap via DEMATERIALIZE_DELAY_MS expiry.
const MAX_MATERIALIZED = 80;

export class GuessList {
  constructor(domRenderer, animationManager) {
    this.domRenderer = domRenderer;
    this.anim = animationManager;
    this.entries = new Map();     // word -> GuessEntry
    this._springs = new Map();    // word -> { tx, ty, tz, vx, vy, vz }
    this._exiting = new Map();    // word -> { entry, spring }
    this._virtualPool = new Map(); // word -> { guess, tx, ty, tz } — not yet materialized
    this.topOffset = 0;
    this._scrollY = 0;
    this._viewHeight = 3600;      // updated from SceneManager viewport

    this._cachedRowH = 0;
    this._hadEntries = false;
    this._centerX = config.baseWidth / 2;
    this._lastTotalRankedWords = 0;
    this._lastWinHistory = null;

    // Drawer offset — smoothly animated when stats drawer opens/closes
    this._drawerOffset = 0;   // current (animated)
    this._drawerTarget = 0;   // target (0 = closed, N = drawer height)

    // Track current group Y for DOM updates
    this._groupY = 0;
  }

  setViewHeight(h) {
    this._viewHeight = h;
  }

  _updateGroupY() {
    const y = -(this.topOffset + this._drawerOffset - this._scrollY);
    this._groupY = y;
    this.domRenderer.setGroupY(y);
  }

  setTopOffset(y) {
    this.topOffset = y;
    this._updateGroupY();
  }

  setScrollY(y) {
    this._scrollY = y;
    this._updateGroupY();
  }

  setDrawerOffset(target) {
    this._drawerTarget = target;
  }

  get drawerOffset() {
    return this._drawerOffset;
  }

  getScrollY() {
    return this._scrollY;
  }

  getMaxScroll() {
    const count = this.entries.size + this._virtualPool.size;
    return Math.max(0, count * this.getRowHeight() - this._viewHeight + this.topOffset);
  }

  getRowHeight() {
    if (!this._cachedRowH) {
      const bubbleH = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--bubble-height')
      ) || 216;
      this._cachedRowH = bubbleH + 27;
    }
    return this._cachedRowH;
  }

  invalidateRowHeight() {
    this._cachedRowH = 0;
  }

  /**
   * True if the entry for `word` currently lands inside the visible
   * viewport (header bottom → bottom of viewport). Mirrors the same
   * worldY math used by update() for detach/reattach decisions, but
   * with no margin — strict on-screen test only. Used by audio cues
   * so we only ping for guesses the viewer can actually see.
   */
  isWordInView(word) {
    const spring = this._springs.get(word);
    const virt = this._virtualPool.get(word);
    const ty = spring ? spring.ty : (virt ? virt.ty : null);
    if (ty === null) return false;
    const bannerWorldY = -this.topOffset + 2 * this._drawerOffset - 72;
    const visibleTop = bannerWorldY;
    const visibleBottom = bannerWorldY - this._viewHeight;
    const worldY = -(this.topOffset - this._scrollY) + ty;
    return worldY < visibleTop && worldY > visibleBottom;
  }

  _getEntryZ(index) {
    if (index >= 10) return 0;
    return 25 - index * 2.5;
  }

  // Remove entry element from DOM — renderer won't touch it at all
  _detachEntry(entry, spring) {
    spring.detached = true;
    spring.detachedAt = performance.now();
    this.domRenderer.remove(entry.element);
  }

  // Re-add element to group — DOMRenderer will position it on next transform write
  _reattachEntry(entry, spring) {
    spring.detached = false;
    spring.detachedAt = 0;
    this.domRenderer.addToGroup(entry.element);
    // Clear visibility:hidden that may have been set before detach
    if (entry.element.style.visibility === 'hidden') entry.element.style.visibility = '';
    // Write transform immediately so it appears at the right position
    const obj = entry.object3D;
    this.domRenderer.applyTransform(entry.element, obj.position.x, obj.position.y, obj.position.z, obj.rotation.x, obj.rotation.y);
    // Restore canvas fill in case it was cleared while detached from DOM
    entry.flattenWater();
  }

  // Create a GuessEntry from virtual pool data (lazy materialization)
  _materializeEntry(word, virt) {
    const entry = new GuessEntry(virt.guess, this._lastTotalRankedWords, this._lastWinHistory, this._lastWinCounts);
    entry.element.style.width = (config.baseWidth - 144) + 'px';
    entry.object3D.position.set(this._centerX, virt.ty, virt.tz);
    entry.element.style.opacity = '1';
    entry.flattenWater();
    this.domRenderer.addToGroup(entry.element);
    this.domRenderer.applyTransform(entry.element, virt.tx, virt.ty, virt.tz, 0, 0);
    this.entries.set(word, entry);
    this._springs.set(word, {
      tx: this._centerX, ty: virt.ty, tz: virt.tz,
      vx: 0, vy: 0, vz: 0, sleeping: true, detached: false, detachedAt: 0,
      guess: virt.guess,
    });
    this._virtualPool.delete(word);
    this._enforceMaterializedCap();
  }

  // Destroy DOM/canvas for an entry, moving its data back to the virtual pool
  // so it can be re-materialized later if scrolled into view.
  _dematerializeEntry(word, entry, spring) {
    this._virtualPool.set(word, {
      guess: spring.guess,
      tx: spring.tx, ty: spring.ty, tz: spring.tz,
    });
    entry.dispose();
    this.entries.delete(word);
    this._springs.delete(word);
  }

  // Emergency overflow handler — when materialized count exceeds MAX_MATERIALIZED,
  // evict the first detached entry we find. Targeted eviction by age happens
  // separately via DEMATERIALIZE_DELAY_MS in update().
  _enforceMaterializedCap() {
    if (this.entries.size <= MAX_MATERIALIZED) return;
    for (const [word, s] of this._springs) {
      if (s.detached) {
        const entry = this.entries.get(word);
        if (entry) {
          this._dematerializeEntry(word, entry, s);
          if (this.entries.size <= MAX_MATERIALIZED) return;
        }
      }
    }
  }

  // Called every frame from the animation loop
  update(delta) {
    const dt = Math.min(delta, 0.033); // cap for stability

    // Smoothly animate drawer offset (stats panel push-down)
    const drawerDiff = this._drawerTarget - this._drawerOffset;
    if (Math.abs(drawerDiff) > 0.5) {
      this._drawerOffset += drawerDiff * Math.min(1, 10 * dt);
      this._updateGroupY();
    } else if (drawerDiff !== 0) {
      this._drawerOffset = this._drawerTarget;
      this._updateGroupY();
    }

    const rowH = this.getRowHeight();
    const totalCount = this.entries.size + this._virtualPool.size;
    const contentH = totalCount * rowH + this.topOffset;
    // viewTop/viewBot — wide bounds for water-update visibility checks on
    // already-materialized active entries. Loose to avoid OBS auto-scroll
    // false-detaching live springs.
    const viewTop = Math.max(this._viewHeight, contentH);
    const viewBot = -(Math.max(this._viewHeight * 2, contentH + this._viewHeight));

    // Banner boundary: entries with worldY above this value have scrolled behind
    // the header/jackpot/pinned banner and must be detached from the DOM.
    // This replaces CSS overflow:hidden clipping which is unreliable in OBS's
    // CEF browser (translate3d compositing layers can escape overflow clips).
    // Formula derived from: entry top reaches banner bottom in scaleEl coords
    // when worldY > -topOffset + 2*drawerOffset - 72.
    const bannerWorldY = -this.topOffset + 2 * this._drawerOffset - 72;

    // Visible-viewport bounds — TIGHT band used for materialize / detach /
    // reattach decisions. Without this, entries below the viewport never
    // detach (they stay materialized forever) and the materialize loop
    // re-creates entries that aren't actually visible. VIEWPORT_MARGIN
    // pre-renders rows just outside the visible edge so scroll doesn't pop.
    const VIEWPORT_MARGIN = 600;
    const visibleTop = bannerWorldY;                                 // above this = behind header
    const visibleBottom = bannerWorldY - this._viewHeight - VIEWPORT_MARGIN;

    const now = performance.now();
    // Collect dematerialize candidates while iterating; mutating entries/springs
    // mid-loop would invalidate the Map iterators.
    let _dematerializeBatch = null;

    // Update active entries
    for (const [word, entry] of this.entries) {
      const s = this._springs.get(word);
      if (!s) continue;

      // Detached entries: removed from DOM, skip entirely
      if (s.detached) {
        // Reattach if scrolled back into the visible viewport
        const worldY = -(this.topOffset - this._scrollY) + s.ty;
        if (worldY < visibleTop && worldY > visibleBottom) {
          this._reattachEntry(entry, s);
        } else if (s.detachedAt && (now - s.detachedAt) > DEMATERIALIZE_DELAY_MS) {
          // Detached long enough — destroy DOM/canvas, move back to virtual pool
          (_dematerializeBatch ||= []).push(word);
        }
        continue;
      }

      // Settling: spring is at rest, water damping to flat naturally
      if (s.settling) {
        const worldY = -(this.topOffset - this._scrollY) + entry.object3D.position.y;
        if (worldY > visibleTop || worldY < visibleBottom) {
          // Outside visible viewport — flatten water, detach from DOM
          if (entry._water) entry._water.flatten();
          s.settling = false;
          this._detachEntry(entry, s);
        } else {
          const water = entry._water;
          if (water) {
            water.update(dt, 0, 0);
            // Fade out idle wave during settling, then snap flat once gone
            if (typeof water.idleFade !== 'undefined') {
              water.idleFade = Math.max(0, water.idleFade - dt * 3);
              if (water.idleFade <= 0) { water.flatten(); s.settling = false; }
            } else if (water._flat) {
              s.settling = false;
            }
          } else {
            s.settling = false;
          }
        }
        continue;
      }

      // Sleeping entries: detach if scrolled outside the visible viewport.
      // This is the key memory bound — without it, every entry the materialize
      // loop touches stays in DOM forever (sleeping but holding a canvas).
      if (s.sleeping) {
        const worldY = -(this.topOffset - this._scrollY) + s.ty;
        if (worldY > visibleTop || worldY < visibleBottom) {
          this._detachEntry(entry, s);
        }
        continue;
      }

      const obj = entry.object3D;

      // Spring force: F = -K * displacement - D * velocity
      const dx = obj.position.x - s.tx;
      s.vx += (-SPRING_K * dx - SPRING_D * s.vx) * dt;
      obj.position.x += s.vx * dt;

      const dy = obj.position.y - s.ty;
      s.vy += (-SPRING_K * dy - SPRING_D * s.vy) * dt;
      obj.position.y += s.vy * dt;

      const dz = obj.position.z - s.tz;
      s.vz += (-SPRING_K * dz - SPRING_D * s.vz) * dt;
      obj.position.z += s.vz * dt;

      // Check if entry has come to rest — snap and sleep
      const avx = Math.abs(s.vx), avy = Math.abs(s.vy), avz = Math.abs(s.vz);
      if (avx < SLEEP_VEL && avy < SLEEP_VEL && avz < SLEEP_VEL
        && Math.abs(dx) < SLEEP_DISP && Math.abs(dy) < SLEEP_DISP && Math.abs(dz) < SLEEP_DISP) {
        obj.position.x = s.tx;
        obj.position.y = s.ty;
        obj.position.z = s.tz;
        s.vx = 0; s.vy = 0; s.vz = 0;
        obj.rotation.x = 0; obj.rotation.y = 0;
        entry.applySecondaryMotion(0, 0);
        this.domRenderer.applyTransform(entry.element, s.tx, s.ty, s.tz, 0, 0);
        // Clear visibility:hidden that may have been set during animation
        // (entry was above banner during spring overshoot but is now at rest)
        if (entry.element.style.visibility === 'hidden') entry.element.style.visibility = '';
        s.sleeping = true;
        s.settling = true;  // water decays smoothly instead of snapping flat
        continue;
      }

      // Rotation from velocity — tilt in movement direction (clamped to subtle lean)
      obj.rotation.y = Math.max(-0.15, Math.min(0.15, -s.vx * 0.0003));
      obj.rotation.x = Math.max(-0.08, Math.min(0.08, s.vy * 0.0003));

      // Secondary motion on text elements inside the entry
      entry.applySecondaryMotion(s.vx, s.vy);

      // Write CSS transform for this frame
      this.domRenderer.applyTransform(entry.element, obj.position.x, obj.position.y, obj.position.z, obj.rotation.x, obj.rotation.y);

      // Hide active entries that bounce above the banner (visibility, not detach,
      // so the spring animation continues and they reappear when scrolled back)
      const worldY = -(this.topOffset - this._scrollY) + obj.position.y;
      const aboveBanner = worldY > bannerWorldY;
      if (aboveBanner) {
        if (entry.element.style.visibility !== 'hidden') entry.element.style.visibility = 'hidden';
      } else {
        if (entry.element.style.visibility === 'hidden') entry.element.style.visibility = '';
      }

      // Water simulation — update if visible OR actively moving (spring animation)
      const isVisible = worldY > viewBot && worldY < viewTop && !aboveBanner;
      const isMoving = avx > 5 || avy > 5;
      if (isVisible || isMoving) {
        entry.updateWater(dt, s.vx, s.vy);
      }
    }

    // Process deferred dematerializations (collected during the loop above to
    // avoid mutating entries/_springs while iterating them).
    if (_dematerializeBatch) {
      for (const word of _dematerializeBatch) {
        const entry = this.entries.get(word);
        const spring = this._springs.get(word);
        if (entry && spring) this._dematerializeEntry(word, entry, spring);
      }
    }

    // Materialize virtual pool entries that are inside the visible viewport.
    // Cap at 3 per frame — prevents a frame spike when scrolling fast over
    // many off-screen entries.
    let _materializeCount = 0;
    for (const [word, virt] of this._virtualPool) {
      const worldY = -(this.topOffset - this._scrollY) + virt.ty;
      if (worldY < visibleTop && worldY > visibleBottom) {
        this._materializeEntry(word, virt);
        if (++_materializeCount >= 3) break;
      }
    }

    // Update exiting entries (softer spring)
    for (const [word, data] of this._exiting) {
      const { entry, spring: s } = data;
      if (!s) continue;
      const obj = entry.object3D;

      const dx = obj.position.x - s.tx;
      s.vx += (-SPRING_K * 0.5 * dx - SPRING_D * 0.7 * s.vx) * dt;
      obj.position.x += s.vx * dt;

      const dy = obj.position.y - s.ty;
      s.vy += (-SPRING_K * 0.5 * dy - SPRING_D * 0.7 * s.vy) * dt;
      obj.position.y += s.vy * dt;

      obj.rotation.y = -s.vx * 0.003;
      entry.applySecondaryMotion(s.vx, s.vy);
      entry.updateWater(dt, s.vx, s.vy);
      this.domRenderer.applyTransform(entry.element, obj.position.x, obj.position.y, obj.position.z, 0, obj.rotation.y);
    }
    tickGuessEntrances(this);
  }

  /** Retroactively apply cosmetics to all materialized entries */
  applyCosmeticsToAll(cosmetics) {
    for (const entry of this.entries.values()) {
      entry.applyCosmeticsRetro(cosmetics);
    }
  }

  updateList(guesses, totalRankedWords, winHistory, winCounts) {
    const sorted = guesses.slice().sort((a, b) => a.rank - b.rank);
    const rowH = this.getRowHeight();
    const halfH = rowH / 2;
    const hadEntries = this._hadEntries;

    // Store for lazy materialization of virtual pool entries
    const winHistoryChanged = winHistory !== this._lastWinHistory;
    this._lastTotalRankedWords = totalRankedWords;
    this._lastWinHistory = winHistory;
    this._lastWinCounts = winCounts || {};

    const posMap = new Map();
    sorted.forEach((g, i) => posMap.set(g.word, i));

    const currentWords = new Set(sorted.map(g => g.word));
    const existingWords = new Set(this.entries.keys());

    // EXIT — materialized entries
    for (const word of existingWords) {
      if (!currentWords.has(word)) {
        const entry = this.entries.get(word);
        const spring = this._springs.get(word);
        this._startExit(word, entry, spring);
        this.entries.delete(word);
        this._springs.delete(word);
      }
    }

    // EXIT — virtual pool entries (no DOM to dispose, just drop data)
    for (const word of this._virtualPool.keys()) {
      if (!currentWords.has(word)) {
        this._virtualPool.delete(word);
      }
    }

    // ENTER + UPDATE
    for (const guess of sorted) {
      const idx = posMap.get(guess.word);
      const targetY = -(idx * rowH + halfH);
      const targetZ = this._getEntryZ(idx);

      if (this.entries.has(guess.word)) {
        // UPDATE — materialized entry, change spring target
        const entry = this.entries.get(guess.word);
        entry.updateRank(guess.rank, totalRankedWords);
        // Re-apply cosmetics if they changed (e.g. cosmetics-updated broadcast)
        if (guess.user && guess.user.cosmetics) {
          const nextSig = GuessEntry._cosmeticsSignature(guess.user.cosmetics);
          const prevSig = entry._lastCosSignature || '';
          if (nextSig !== prevSig) {
            entry.applyCosmeticsRetro(guess.user.cosmetics);
          }
        }
        // Re-apply fan-club badge — the user may have been flagged FC server-side
        // after the entry was first created (e.g. they liked/joined later).
        if (guess.user && typeof entry.updateFanClub === 'function') {
          entry.updateFanClub(!!guess.user.isFanClub);
        }
        const spring = this._springs.get(guess.word);
        if (spring) {
          // Wake materialized entries whose target shifted. Detached entries
          // intentionally stay asleep — they have no DOM to animate, and
          // reattach happens automatically when scrolled into view.
          if ((spring.ty !== targetY || spring.tz !== targetZ) && !spring.detached) {
            spring.sleeping = false;
            spring.settling = false;
          }
          spring.ty = targetY;
          spring.tz = targetZ;
          spring.guess = guess;
        }
      } else if (this._virtualPool.has(guess.word)) {
        // UPDATE — virtual entry (just update position + guess data, no DOM work)
        const virt = this._virtualPool.get(guess.word);
        virt.ty = targetY;
        virt.tz = targetZ;
        virt.guess = guess;
      } else {
        // ENTER — new entry
        if (!hadEntries) {
          // Initial batch — only create DOM for visible entries
          const worldY = -(this.topOffset - this._scrollY) + targetY;
          const inView = worldY > -(this._viewHeight + 450) && worldY < 450;
          if (inView) {
            // In view — create real entry
            const entry = new GuessEntry(guess, totalRankedWords, winHistory, this._lastWinCounts);
            entry.element.style.width = (config.baseWidth - 144) + 'px';
            entry.object3D.position.set(this._centerX, targetY, targetZ);
            entry.element.style.opacity = '1';
            entry.flattenWater();
            this.domRenderer.addToGroup(entry.element);
            this.domRenderer.applyTransform(entry.element, this._centerX, targetY, targetZ, 0, 0);
            this.entries.set(guess.word, entry);
            this._springs.set(guess.word, {
              tx: this._centerX, ty: targetY, tz: targetZ,
              vx: 0, vy: 0, vz: 0, sleeping: true, detached: false, detachedAt: 0,
              guess,
            });
          } else {
            // Off-screen — store in virtual pool (NO DOM, NO canvas, NO WaterWave)
            this._virtualPool.set(guess.word, {
              guess, tx: this._centerX, ty: targetY, tz: targetZ,
            });
          }
        } else {
          // New guess mid-game — fly in from right with spring bounce
          const entry = new GuessEntry(guess, totalRankedWords, winHistory, this._lastWinCounts, {
            rankColorTransition: !window.__ALT_MODE,
          });
          entry.element.style.width = (config.baseWidth - 144) + 'px';
          this.entries.set(guess.word, entry);
          this.domRenderer.addToGroup(entry.element);
          const startX = this._centerX + 900;
          entry.object3D.position.set(startX, targetY, targetZ + 180);
          entry.element.style.opacity = '1';
          this.domRenderer.applyTransform(entry.element, startX, targetY, targetZ + 180, 0, 0);
          entry.startRankColorTransition();
          this._springs.set(guess.word, {
            tx: this._centerX, ty: targetY, tz: targetZ,
            vx: 0, vy: 0, vz: 0, sleeping: false, detached: false, detachedAt: 0,
            guess,
          });
          queueGuessEntrance(this, guess.word);
          this._enforceMaterializedCap();

          // Ripple: kick nearby entries' velocity for a wave effect
          // Cap at 8 affected entries — avoids iterating all 600+ springs pointlessly
          let _rippleCount = 0;
          for (const [w, s] of this._springs) {
            if (w === guess.word) continue;
            const dist = Math.abs(s.ty - targetY);
            if (dist < rowH * 3) {
              s.vy -= 30 * (1 - dist / (rowH * 3));
              s.sleeping = false; s.settling = false;
              if (s.detached) {
                const rippleEntry = this.entries.get(w);
                if (rippleEntry) this._reattachEntry(rippleEntry, s);
              }
              if (++_rippleCount >= 8) break;
            }
          }

          // XP bubble — server attaches xpAward to the new-guess payload;
          // a non-zero value means this guess scored points (top-10 tier
          // or proximity/climb bonus). Spawn one floater at the row.
          // worldY adds _groupY so the bubble lands at the entry's on-
          // screen position even though the bubble lives outside _groupEl
          // (so it can paint over the pinned-guess overlay).
          if (guess.xpAward && guess.xpAward > 0) {
            XpBubble.spawn(this.domRenderer, this._centerX, targetY + this._groupY, {
              xpAmount: guess.xpAward,
              playerName: guess.user && guess.user.displayName,
              cosmetics: guess.user && guess.user.cosmetics,
            });
          }
        }
      }
    }

    this._hadEntries = sorted.length > 0 || hadEntries;

    // Win badges removed from ranked guess entries — shown only on header banner
    // and pinned (most recent) guess to reduce visual noise.
  }

  _startExit(word, entry, spring) {
    if (spring && spring.detached) {
      // Not in DOM — dispose immediately, no animation needed
      entry.dispose();
      return;
    }

    if (spring) {
      spring.tx = this._centerX - 1350;
      this._exiting.set(word, { entry, spring });
    }

    // Fade out with CSS transition, then dispose
    entry.element.style.transition = 'opacity 400ms ease-out';
    entry.element.style.opacity = '0';

    setTimeout(() => {
      entry.dispose();
      this._exiting.delete(word);
    }, 450);
  }
}
