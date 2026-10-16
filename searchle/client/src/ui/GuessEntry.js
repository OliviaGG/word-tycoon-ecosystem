// ===== Guess Entry =====
// Single guess bubble wrapped as a CSS3DObject.

import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { rankToColor, rankToFillPercent, rankToWaterGradient, getPlatformColor, formatRank } from '../utils/ColorUtils.js';
import { WaterWave } from './WaterWave.js';
import { applyCosmetics } from '../utils/CosmeticsApplier.js';
import { markAvatarLogo } from '../utils/AvatarLogo.js';
import config from '../config.js';
import { resolveElo } from '../utils/EloUtils.js';

export class GuessEntry {
  constructor(guess, totalRankedWords, winHistory, winCounts) {
    this.word = guess.word;
    this.rank = guess.rank;
    this._lastTotalRankedWords = totalRankedWords;
    this._userId = guess.user ? (guess.user.platformUserId || guess.user.id) : null;
    this._linkedDiscord = guess.user ? (guess.user.linkedDiscord || null) : null;
    this.element = this._buildElement(guess, totalRankedWords, winHistory, winCounts);
    this.object3D = new CSS3DObject(this.element);
    // Cache DOM refs for updates and secondary motion
    this._rankEl = this.element.querySelector('.guess-rank');
    this._wordEl = this.element.querySelector('.guess-word');
    this._userEl = this.element.querySelector('.guess-user');
    this._motionActive = false; // tracks whether transforms are currently applied
  }

  _buildElement(guess, totalRankedWords, winHistory, winCounts) {
    const el = document.createElement('div');
    el.className = 'guess-entry';
    if (guess.word && guess.word.length >= 10) {
      el.classList.add('compact-user');
    }
    el.style.background = config.gradient.bgColor;
    el.style.outline = `9px solid ${rankToColor(guess.rank, totalRankedWords)}`;

    // SVG water fill
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'rank-bar-svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    const bubbleH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bubble-height')) || 216;
    const aspectRatio = (config.baseWidth - 144) / bubbleH;
    this._water = new WaterWave(
      svg,
      rankToWaterGradient(guess.rank, totalRankedWords),
      rankToFillPercent(guess.rank, totalRankedWords),
      aspectRatio
    );
    el.appendChild(svg);

    // Word
    const wordEl = document.createElement('span');
    wordEl.className = 'guess-word';
    wordEl.textContent = guess.word;

    // User
    const userEl = document.createElement('span');
    userEl.className = 'guess-user';

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
    // Bumper cosmetics: only profile_border + profile_glow apply (the
    // bumper is a small overlay avatar — name color / hero badge / title
    // would be noise here). Other categories silently dropped.
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

    const nameEl = document.createElement('span');
    nameEl.className = 'user-name';
    nameEl.textContent = guess.user.displayName;
    if (guess.user.customColor) nameEl.style.color = guess.user.customColor;
    userEl.appendChild(nameEl);

    const icon = GuessEntry._createPlatformIcon(guess.user.platform);
    if (icon) userEl.appendChild(icon);

    // Rank
    const rankEl = document.createElement('span');
    rankEl.className = 'guess-rank';
    rankEl.textContent = formatRank(guess.rank);

    el.appendChild(rankEl);
    el.appendChild(wordEl);
    el.appendChild(userEl);

    // Apply cosmetics
    if (guess.user.cosmetics) {
      const avatarEl = userEl.querySelector('.user-pic') || userEl.querySelector('.user-pic-fallback');
      applyCosmetics({ nameEl, avatarEl, wordEl, titleContainer: userEl, avatarSize: 153 }, guess.user.cosmetics);
    }

    return el;
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
      this._rankEl.textContent = formatRank(newRank);
    }
    this.element.style.outlineColor = rankToColor(newRank, totalRankedWords);
  }

  updateWinBadge(winHistory, winCounts) {
    if (window.__SP_MODE || !this._userId) return;
    const picWrap = this.element.querySelector('.guess-pic-wrap');
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

  // Re-apply the TikTok fan-club badge to this entry's pic-wrap. Cheap idempotent
  // toggle; called from GuessList's UPDATE branch so entries created before the
  // user was flagged FC pick up the badge once the server marks them sticky.
  updateFanClub(isFanClub) {
    try {
      const picWrap = this.element && this.element.querySelector('.guess-pic-wrap');
      if (!picWrap) return;
      picWrap.classList.toggle('has-fan-club-badge', !!isFanClub);
    } catch (e) { /* swallow — never break socket handler */ }
  }

  // Re-render just the bumper avatar inside this entry's pic-wrap.
  // Wrapped in try/catch so any DOM mutation failure (detached entry,
  // missing pic-wrap, etc.) can NEVER abort the caller — this method is
  // called from the live bump-guess socket handler and an exception here
  // would silently break subsequent socket events on the page.
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
      // Insert BEFORE the user-pic (matches constructor's append order so
      // user-pic stacks on top via z-index).
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
      console.error('[GuessEntry.updateBumper] failed:', e);
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

  // Apply velocity-based secondary motion to text elements
  // Creates a "jelly" effect where word/name/rank lag behind the bubble
  applySecondaryMotion(vx, vy) {
    const dominated = Math.abs(vx) < 2 && Math.abs(vy) < 2;
    if (dominated) {
      // Clear transforms once when velocity drops below threshold
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
    if (this._water) {
      this._water.dispose();
      this._water = null;
    }
    if (this.object3D.parent) {
      this.object3D.parent.remove(this.object3D);
    }
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }

  // ---- Static helpers ----

  /** Count wins matching by platformUserId OR linkedDiscord (cross-platform) */
  static _countUserWins(winHistory, userId, linkedDiscord) {
    let count = 0;
    for (const w of winHistory) {
      const wId = w.user ? (w.user.platformUserId || w.user.id) : w.userId;
      const wLd = w.user ? w.user.linkedDiscord : null;
      if (wId === userId) { count++; continue; }
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
}
