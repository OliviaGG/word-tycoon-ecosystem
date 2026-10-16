// ===== Guess Entry (Canvas Water) =====
// Copy of GuessEntry.js with WaterWave swapped to Canvas 2D version.
// Only difference: creates a <canvas> instead of <svg> for water fill.
//
// To use: in main code, change import from './GuessEntry.js' to
// './canvas-water/GuessEntryCanvas.js'

import { rankToColor, rankToFillPercent, rankToWaterGradient, getPlatformColor, formatRank } from '../../utils/ColorUtils.js';
import { WaterWave } from './WaterWaveCanvas.js';
import { applyCosmetics } from '../../utils/CosmeticsApplier.js';
import { markAvatarLogo } from '../../utils/AvatarLogo.js';
import { isMobile, isOBS } from '../../utils/Mobile.js';
import config from '../../config.js';
import { resolveElo } from '../../utils/EloUtils.js';
import { observeGuessPanelSize } from '../../utils/GuessPanelSize.js';

const RANK_COLOR_FADE_START = '#6a1ab8';
const RANK_COLOR_FADE_MS = 4200;

export class GuessEntry {
  constructor(guess, totalRankedWords, winHistory, winCounts, options = {}) {
    this.word = guess.word;
    this.rank = guess.rank;
    this._lastTotalRankedWords = totalRankedWords;
    this._userId = guess.user ? (guess.user.platformUserId || guess.user.id) : null;
    this._linkedDiscord = guess.user ? (guess.user.linkedDiscord || null) : null;
    this._rankColorFadeTimer = null;
    this._rankColorFadeEnd = null;
    this.element = this._buildElement(guess, totalRankedWords, winHistory, winCounts, options);
    // Plain position/rotation object — GuessList writes CSS transforms directly
    this.object3D = {
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      rotation: { x: 0, y: 0, z: 0 },
      visible: true,
      parent: null,
    };
    this._rankEl = this.element.querySelector('.guess-rank');
    this._wordEl = this.element.querySelector('.guess-word');
    this._userEl = this.element.querySelector('.guess-user');
    this._motionActive = false;
  }

  _buildElement(guess, totalRankedWords, winHistory, winCounts, options = {}) {
    const el = document.createElement('div');
    el.className = 'guess-entry guess-entry-panel';
    if (guess.word && guess.word.length >= 10) {
      el.classList.add('compact-user');
    }
    // Default background + outline are now set via CSS (.guess-entry rule
    // in main.css) so the liquid-glass design ships across all modes
    // without inline overrides blocking CSS. Cosmetics that paint a
    // custom background (hero_badge) still write inline at apply time
    // and beat the CSS rule normally — that's why we don't !important
    // the CSS default either.
    const rankColor = rankToColor(guess.rank, totalRankedWords);
    // Expose rank color as a CSS variable so the chip border + rank
    // sub-pill can match the outer card without recomputing.
    el.style.setProperty('--rank-end', rankColor);
    if (options.rankColorTransition) {
      el.classList.add('rank-color-fading');
      el.style.setProperty('--rank-start', RANK_COLOR_FADE_START);
      el.style.setProperty('--rank-progress', '0');
    } else {
      el.style.setProperty('--rc', rankColor);
      el.style.setProperty('--rank-progress', '1');
    }

    // Canvas water fill (replaces SVG)
    const canvas = document.createElement('canvas');
    canvas.className = 'rank-bar-svg'; // reuse same CSS class for positioning
    const bubbleH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bubble-height')) || 216;
    const bubbleW = config.baseWidth - 144;
    // Desktop: half-res buffer. Mobile: quarter-res — saves ~94% GPU memory vs full-res
    const resDivisor = (isMobile || isOBS) ? 4 : 2;
    canvas.width = (bubbleW / resDivisor) | 0;
    canvas.height = (bubbleH / resDivisor) | 0;
    const aspectRatio = bubbleW / bubbleH;
    this._water = new WaterWave(
      canvas,
      rankToWaterGradient(guess.rank, totalRankedWords),
      rankToFillPercent(guess.rank, totalRankedWords),
      aspectRatio
    );
    el.appendChild(canvas);

    // Word
    const wordEl = document.createElement('span');
    wordEl.className = 'guess-word';
    wordEl.textContent = guess.word;

    // User
    const userEl = document.createElement('span');
    userEl.className = 'guess-user';

    // Keep clipped badge artwork separate from avatars, titles and perk badges.
    const panelGlow = document.createElement('span');
    panelGlow.className = 'guess-panel-glow';
    panelGlow.setAttribute('aria-hidden', 'true');
    const panelFrame = document.createElement('span');
    panelFrame.className = 'guess-panel-frame';
    const panelSurface = document.createElement('span');
    panelSurface.className = 'guess-panel-surface';
    panelGlow.append(panelFrame, panelSurface);
    userEl.appendChild(panelGlow);

    // Pic wrapper
    const picWrap = document.createElement('span');
    picWrap.className = 'guess-pic-wrap';
    picWrap.classList.toggle('has-fan-club-badge', !!(guess.user && guess.user.isFanClub));

    // Bumper pic (behind)
    let bumperEl = null;
    if (guess.lastBumper && guess.lastBumper.profilePic) {
      const bumperImg = document.createElement('img');
      bumperImg.src = guess.lastBumper.profilePic;
      bumperImg.className = 'bumper-pic';
      bumperImg.alt = guess.lastBumper.displayName || '';
      bumperImg.onerror = function () {
        const fb = GuessEntry._createFallbackPic(guess.lastBumper.displayName || '?', guess.lastBumper.platform);
        fb.className = 'bumper-pic bumper-pic-fallback';
        this.replaceWith(fb);
      };
      picWrap.appendChild(bumperImg);
      bumperEl = bumperImg;
      markAvatarLogo(bumperImg, picWrap);
    } else if (guess.lastBumper) {
      const bfb = GuessEntry._createFallbackPic(guess.lastBumper.displayName || '?', guess.lastBumper.platform);
      bfb.classList.add('bumper-pic');
      picWrap.appendChild(bfb);
      bumperEl = bfb;
    }
    // Bumper cosmetics: only profile_border + profile_glow apply.
    if (bumperEl && guess.lastBumper && guess.lastBumper.cosmetics) {
      const bcos = {};
      if (guess.lastBumper.cosmetics.profile_border) bcos.profile_border = guess.lastBumper.cosmetics.profile_border;
      if (guess.lastBumper.cosmetics.profile_glow)   bcos.profile_glow   = guess.lastBumper.cosmetics.profile_glow;
      if (Object.keys(bcos).length) {
        applyCosmetics({ avatarEl: bumperEl, avatarSize: 126 }, bcos);
      }
    }

    // Main user pic
    if (guess.user.profilePic) {
      const img = document.createElement('img');
      img.src = guess.user.profilePic;
      img.className = 'user-pic';
      img.alt = guess.user.displayName;
      img.onerror = function () {
        const fb = GuessEntry._createFallbackPic(guess.user.displayName, guess.user.platform);
        this.replaceWith(fb);
      };
      picWrap.appendChild(img);
      markAvatarLogo(img, picWrap);
    } else {
      picWrap.appendChild(GuessEntry._createFallbackPic(guess.user.displayName, guess.user.platform));
    }

    // Win badge — NOT rendered on ranked guess entries (too noisy).
    // Shown only on the header banner (HeaderBar.updateWinner) and
    // the most-recent-guess indicator (PinnedGuess).

    userEl.appendChild(picWrap);

    // Name + title column (title appears below name)
    const nameTitleCol = document.createElement('span');
    nameTitleCol.className = 'name-title-col';

    const nameEl = document.createElement('span');
    nameEl.className = 'user-name';
    nameEl.textContent = guess.user.displayName;
    if (guess.user.customColor) nameEl.style.color = guess.user.customColor;
    nameTitleCol.appendChild(nameEl);
    userEl.appendChild(nameTitleCol);

    const icon = GuessEntry._createPlatformIcon(guess.user.platform);
    if (icon) userEl.appendChild(icon);

    // Rank
    const rankEl = document.createElement('span');
    rankEl.className = 'guess-rank';
    rankEl.textContent = formatRank(guess.rank, totalRankedWords);

    // Combined rank+word chip — rank as inset sub-pill on the left,
    // word fills the remaining space.
    const chipEl = document.createElement('div');
    chipEl.className = 'guess-chip';
    chipEl.appendChild(rankEl);
    chipEl.appendChild(wordEl);

    el.appendChild(chipEl);
    el.appendChild(userEl);

    // Apply cosmetics
    if (guess.user.cosmetics) {
      const avatarEl = userEl.querySelector('.user-pic') || userEl.querySelector('.user-pic-fallback');
      applyCosmetics({ nameEl, avatarEl, surfaceEl: panelSurface, wordFrameEl: panelFrame, wordGlowEl: panelGlow, titleContainer: nameTitleCol, avatarSize: 153 }, guess.user.cosmetics);
      this._lastCosSignature = GuessEntry._cosmeticsSignature(guess.user.cosmetics);
    }

    observeGuessPanelSize(this, el);
    return el;
  }

  startRankColorTransition() {
    const el = this.element;
    if (!el || !el.classList.contains('rank-color-fading')) return;

    const finish = () => {
      const currentEl = this.element;
      if (!currentEl) return;
      if (this._rankColorFadeEnd) {
        currentEl.removeEventListener('transitionend', this._rankColorFadeEnd);
        this._rankColorFadeEnd = null;
      }
      if (this._rankColorFadeTimer) {
        clearTimeout(this._rankColorFadeTimer);
        this._rankColorFadeTimer = null;
      }
      const finalColor = currentEl.style.getPropertyValue('--rank-end').trim()
        || rankToColor(this.rank, this._lastTotalRankedWords);
      currentEl.style.setProperty('--rc', finalColor);
      currentEl.classList.remove('rank-color-fading');
      currentEl.style.removeProperty('--rank-start');
      currentEl.style.removeProperty('--rank-end');
      currentEl.style.removeProperty('--rank-progress');
    };

    this._rankColorFadeEnd = (event) => {
      if (event.propertyName === '--rank-progress') finish();
    };
    el.addEventListener('transitionend', this._rankColorFadeEnd);
    this._rankColorFadeTimer = setTimeout(finish, RANK_COLOR_FADE_MS + 300);

    if (this._water && typeof this._water.startColorTransition === 'function') {
      this._water.startColorTransition(RANK_COLOR_FADE_MS);
    }

    void el.offsetWidth;
    requestAnimationFrame(() => {
      if (!this.element || this.element !== el || !el.isConnected) return;
      el.style.setProperty('--rank-progress', '1');
    });
  }

  /** Retroactively apply cosmetics to an already-rendered entry */
  applyCosmeticsRetro(cosmetics) {
    if (!this.element) return;
    cosmetics = cosmetics || {};
    const userEl = this.element.querySelector('.guess-user');
    if (!userEl) return;
    const avatarEl = userEl.querySelector('.user-pic') || userEl.querySelector('.user-pic-fallback');
    const nameEl = userEl.querySelector('.user-name');
    const nameTitleCol = userEl.querySelector('.name-title-col');
    applyCosmetics({ nameEl, avatarEl,
      surfaceEl: userEl.querySelector('.guess-panel-surface'),
      wordFrameEl: userEl.querySelector('.guess-panel-frame'),
      wordGlowEl: userEl.querySelector('.guess-panel-glow'),
      titleContainer: nameTitleCol || userEl, avatarSize: 153 }, cosmetics);
    this._lastCosSignature = GuessEntry._cosmeticsSignature(cosmetics);
    observeGuessPanelSize(this, this.element);
  }

  updateRank(newRank, totalRankedWords) {
    if (this.rank === newRank && this._lastTotalRankedWords === totalRankedWords) return;
    this.rank = newRank;
    this._lastTotalRankedWords = totalRankedWords;
    if (this._water) {
      this._water.setFill(
        rankToFillPercent(newRank, totalRankedWords),
        rankToWaterGradient(newRank, totalRankedWords)
      );
    }
    if (this._rankEl) {
      this._rankEl.textContent = formatRank(newRank, totalRankedWords);
    }
    const rankColor = rankToColor(newRank, totalRankedWords);
    this.element.style.outlineColor = rankColor;
    this.element.style.setProperty('--rank-end', rankColor);
    if (!this.element.classList.contains('rank-color-fading')) {
      this.element.style.setProperty('--rc', rankColor);
    }
  }

  updateWinBadge(winHistory, winCounts) {
    if (window.__SP_MODE || !this._userId) return;
    const picWrap = this.element.querySelector('.user-pic-wrap');
    if (!picWrap) return;
    const wc = winCounts || {};
    const persistedWins = wc[this._linkedDiscord] || wc[this._userId] || 0;
    const sessionWins = winHistory ? GuessEntry._countUserWins(winHistory, this._userId, this._linkedDiscord) : 0;
    const wins = Math.max(persistedWins, sessionWins);
    let badge = picWrap.querySelector('.guess-win-badge');
    if (wins > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'guess-win-badge';
        picWrap.appendChild(badge);
      }
      badge.textContent = wins;
    } else if (badge) {
      badge.remove();
    }
  }

  // Re-render just the bumper avatar inside this entry's pic-wrap.
  // Wrapped in try/catch so any DOM failure (detached entry, missing
  // pic-wrap, etc.) can never abort the live bump-guess socket handler
  // that calls this method. Mirror of GuessEntry.js's updateBumper —
  // both files need it because GuessList + PinnedGuess import the
  // canvas variant, not the CSS3D one.

  // Re-apply the TikTok fan-club badge to this entry's pic-wrap. Idempotent;
  // called from GuessList's UPDATE branch so an entry created before the
  // viewer was flagged FC picks up the badge once the server marks them.
  updateFanClub(isFanClub) {
    try {
      const picWrap = this.element && this.element.querySelector('.guess-pic-wrap');
      if (!picWrap) return;
      picWrap.classList.toggle('has-fan-club-badge', !!isFanClub);
    } catch (e) { /* swallow */ }
  }

  updateBumper(bumper) {
    try {
      const picWrap = this.element && this.element.querySelector('.guess-pic-wrap');
      if (!picWrap) return;
      for (const old of picWrap.querySelectorAll('.bumper-pic, .bumper-pic-fallback')) {
        old.remove();
      }
      if (!bumper) return;

      let bumperEl;
      if (bumper.profilePic) {
        const bumperImg = document.createElement('img');
        bumperImg.src = bumper.profilePic;
        bumperImg.className = 'bumper-pic';
        bumperImg.alt = bumper.displayName || '';
        bumperImg.onerror = function () {
          const fb = GuessEntry._createFallbackPic(bumper.displayName || '?', bumper.platform);
          fb.className = 'bumper-pic bumper-pic-fallback';
          this.replaceWith(fb);
        };
        bumperEl = bumperImg;
      } else {
        bumperEl = GuessEntry._createFallbackPic(bumper.displayName || '?', bumper.platform);
        bumperEl.classList.add('bumper-pic');
      }
      picWrap.insertBefore(bumperEl, picWrap.firstChild);
      markAvatarLogo(bumperEl, picWrap);

      if (bumper.cosmetics) {
        const bcos = {};
        if (bumper.cosmetics.profile_border) bcos.profile_border = bumper.cosmetics.profile_border;
        if (bumper.cosmetics.profile_glow)   bcos.profile_glow   = bumper.cosmetics.profile_glow;
        if (Object.keys(bcos).length) {
          applyCosmetics({ avatarEl: bumperEl, avatarSize: 126 }, bcos);
        }
      }
    } catch (e) {
      console.error('[GuessEntryCanvas.updateBumper] failed:', e);
    }
  }

  updateElo(eloLeaderboard) {
    const picWrap = this.element.querySelector('.guess-pic-wrap');
    if (!picWrap) return;
    let eloEl = picWrap.querySelector('.guess-elo');
    const eloEntry = resolveElo(eloLeaderboard, { platform: null, platformUserId: this._userId, linkedDiscord: this._linkedDiscord, displayName: null });
    if (eloEntry && typeof eloEntry.elo === 'number') {
      if (!eloEl) {
        eloEl = document.createElement('span');
        eloEl.className = 'guess-elo';
        picWrap.appendChild(eloEl);
      }
      eloEl.textContent = 'ELO ' + eloEntry.elo;
    } else if (eloEl) {
      eloEl.remove();
    }
  }

  applySecondaryMotion(vx, vy) {
    const dominated = Math.abs(vx) < 2 && Math.abs(vy) < 2;
    if (dominated) {
      if (this._motionActive) {
        if (this._wordEl) this._wordEl.style.transform = '';
        if (this._rankEl) this._rankEl.style.transform = '';
        if (this._userEl) this._userEl.style.transform = '';
        this._motionActive = false;
      }
      return;
    }
    this._motionActive = true;
    const lagX = Math.max(-8, Math.min(8, -vx * 0.025));
    const lagY = Math.max(-5, Math.min(5, -vy * 0.015));

    if (this._wordEl) {
      this._wordEl.style.transform = `translate(${lagX}px, ${lagY}px)`;
    }
    if (this._rankEl) {
      this._rankEl.style.transform = `translate(${lagX * 1.3}px, ${lagY * 1.3}px)`;
    }
    if (this._userEl) {
      this._userEl.style.transform = `translate(${lagX * 0.7}px, ${lagY * 0.7}px)`;
    }
  }

  updateWater(dt, vx, vy) {
    if (this._water) this._water.update(dt, vx, vy);
  }

  flattenWater() {
    if (this._water) this._water.flatten();
  }

  dispose() {
    this._guessPanelSizer?.dispose();
    if (this._rankColorFadeTimer) {
      clearTimeout(this._rankColorFadeTimer);
      this._rankColorFadeTimer = null;
    }
    if (this._rankColorFadeEnd && this.element) {
      this.element.removeEventListener('transitionend', this._rankColorFadeEnd);
      this._rankColorFadeEnd = null;
    }
    if (this._water) {
      this._water.dispose();
      this._water = null;
    }
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.object3D = null;
  }

  // ---- Static helpers ----

  /**
   * Count wins for a user, matching by platformUserId OR linkedDiscord.
   * Cross-platform linked accounts (e.g. TikTok + Discord) share a linkedDiscord ID,
   * so wins from either platform are counted together.
   */
  static _countUserWins(winHistory, userId, linkedDiscord) {
    let count = 0;
    for (const w of winHistory) {
      const wId = w.user ? (w.user.platformUserId || w.user.id) : w.userId;
      const wLd = w.user ? w.user.linkedDiscord : null;
      // Match by direct userId
      if (wId === userId) { count++; continue; }
      // Match by linked Discord identity (cross-platform)
      if (linkedDiscord && wLd && wLd === linkedDiscord) { count++; continue; }
      if (linkedDiscord && wId === linkedDiscord) { count++; continue; }
      if (wLd && wLd === userId) { count++; continue; }
    }
    return count;
  }

  static _createFallbackPic(name, platform) {
    const fb = document.createElement('div');
    fb.className = 'user-pic-fallback';
    fb.style.backgroundColor = getPlatformColor(platform);
    fb.textContent = (name || '?')[0].toUpperCase();
    return fb;
  }

  static _createPlatformIcon(platform, size = 63) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.classList.add('platform-icon');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    if (platform === 'tiktok') {
      path.setAttribute('d', 'M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.7a8.16 8.16 0 0 0 4.76 1.52v-3.4a4.85 4.85 0 0 1-1-.13Z');
      path.setAttribute('fill', '#69C9D0');
    } else if (platform === 'youtube') {
      path.setAttribute('d', 'M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z');
      path.setAttribute('fill', '#FF0000');
    } else if (platform === 'discord') {
      path.setAttribute('d', 'M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.27 18.27 0 0 0-5.4 0 12.6 12.6 0 0 0-.62-1.26.07.07 0 0 0-.08-.04 19.74 19.74 0 0 0-4.93 1.51.07.07 0 0 0-.03.03C1.07 8.93.32 13.35.79 17.71a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.12c.13-.09.25-.19.37-.29a.07.07 0 0 1 .07-.01c3.93 1.79 8.18 1.79 12.07 0a.07.07 0 0 1 .08.01c.12.1.25.2.37.29a.08.08 0 0 1 0 .12c-.6.35-1.22.65-1.88.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.07.07 0 0 0 .08.03 19.83 19.83 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.56-5.01-.87-9.4-3.78-13.31a.06.06 0 0 0-.03-.03ZM8.02 15.07c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.17 1.1 2.15 2.42 0 1.34-.95 2.42-2.15 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.17 1.1 2.15 2.42 0 1.34-.94 2.42-2.15 2.42Z');
      path.setAttribute('fill', '#5865F2');
    } else {
      return null;
    }

    svg.appendChild(path);
    return svg;
  }

  static _cosmeticsSignature(value) {
    const normalize = (input) => {
      if (Array.isArray(input)) return input.map(normalize);
      if (input && typeof input === 'object') {
        const out = {};
        for (const key of Object.keys(input).sort()) out[key] = normalize(input[key]);
        return out;
      }
      return input;
    };
    try {
      return JSON.stringify(normalize(value || {}));
    } catch {
      return '';
    }
  }
}
