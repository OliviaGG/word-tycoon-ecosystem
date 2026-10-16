// ===== Header Bar =====
// Top of the overlay. Shows previous-round results in 4 player slots
// (XP winner / target finder / 2nd / 3rd by XP), an animated ad slot,
// live current-round stats (time / guesses / leader XP), and the
// session URL. Stats drawer (toggleable below the row) is preserved
// from the prior design.

import { getPlatformColor } from '../utils/ColorUtils.js';
import { applyCosmetics } from '../utils/CosmeticsApplier.js';
import { markAvatarLogo } from '../utils/AvatarLogo.js';
import config from '../config.js';
import { audio } from '../audio/AudioBridge.js';

const SLOT_COUNT = 4;
// Slot tier-color CSS classes by position. Slot 0 = target finder
// (green ring), slot 1 = XP winner (gold), slots 2/3 = 2nd/3rd by XP
// (silver/bronze).
const SLOT_TIER_CLASSES = ['is-target', 'is-gold', 'is-silver', 'is-bronze'];
// Default labels used when no previous-round data exists.
const SLOT_LABELS_EMPTY = ['--', 'XP --', 'XP --', 'XP --'];
const MODE_SWITCH_STYLE_ID = 'searchle-header-mode-switch-style';
const WORD_TYCOON_SEARCHLE_ORIGIN = 'https://wordtycoon.live';
const WORD_TYCOON_SEARCHLE_ONLINE_PATH = '/game/searchle/';
const WORD_TYCOON_SEARCHLE_SOLO_PATH = '/game/searchle/sp.html';

function getSearchleModeHref(path) {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  if (isLocal) return window.location.origin + path;
  const internalPath = path === '/solo'
    ? WORD_TYCOON_SEARCHLE_SOLO_PATH
    : WORD_TYCOON_SEARCHLE_ONLINE_PATH;
  return WORD_TYCOON_SEARCHLE_ORIGIN + internalPath;
}

// Ad copy + click destinations. Cards crossfade through this list in
// order; each card shows game name on top, full URL underneath.
const ADS = [
  { name: 'Word Tycoon',     url: 'www.wordtycoon.live',     href: 'https://wordtycoon.live',     gradient: 'linear-gradient(135deg, #1e1b4b, #4c1d95)' },
  { name: 'recTangled',      url: 'www.rectangled.live',     href: 'https://rectangled.live',     gradient: 'linear-gradient(135deg, #134e4a, #064e3b)' },
  { name: 'erecTangled',     url: 'www.erectangled.com',     href: 'https://erectangled.com',     gradient: 'linear-gradient(135deg, #7c2d12, #831843)' },
  { name: 'WiKiContexto',    url: 'www.wikicontexto.com',    href: 'https://wikicontexto.com',    gradient: 'linear-gradient(135deg, #422006, #78350f)' },
  { name: 'WiKirecTangled',  url: 'www.wikirectangled.com',  href: 'https://wikirectangled.com',  gradient: 'linear-gradient(135deg, #14532d, #166534)' },
];

export class HeaderBar {
  constructor(domRenderer) {
    this.domRenderer = domRenderer;
    this.timerInterval = null;
    this.startTime = null;
    this.isWon = false;
    this.winHistory = [];
    this.mode = null; // 'sp' or 'mp'
    this.drawerOpen = false;
    this.drawerEnabled = !window.__SP_MODE;
    this.onDrawerToggle = null;

    // Live current-round podium (top players by XP). Updated on every
    // podium-update event from main.js.
    this._currentPodium = [];
    // Last completed round's snapshot — { winner, target, second, third, word }.
    // Filled when updateWinner fires; rendered into slots immediately and
    // persists across the next round.
    this._lastRound = null;

    ensureModeSwitchStyles();
    this.element = this._buildElement();
    this.object3D = domRenderer.makeObject(this.element);
    this.object3D.position.set(config.baseWidth / 2, -215, 0);
    domRenderer.add(this.element);

    // Cache stat refs
    this.guessCountEl = this.element.querySelector('.header-stat-guesses .header-stat-value');
    this.timerEl      = this.element.querySelector('.header-stat-time .header-stat-value');
    this.xpEl         = this.element.querySelector('.header-stat-xp .header-stat-value');

    // Cache slot refs
    this.slots = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const root = this.element.querySelector('.header-slot[data-slot-index="' + i + '"]');
      this.slots.push({
        root,
        picWrap:    root.querySelector('.header-slot-pic-wrap'),
        pic:        root.querySelector('.header-slot-pic'),
        picFb:      root.querySelector('.header-slot-pic-fb'),
        label:      root.querySelector('.header-slot-label'),
        name:       root.querySelector('.header-slot-name'),
      });
    }

    // Combined card refs (target finder === XP winner mode)
    this.slotsContainerEl   = this.element.querySelector('.header-slots');
    const cc                = this.element.querySelector('.header-combined-card');
    this.combined = {
      root:    cc,
      picWrap: cc.querySelector('.header-combined-pic-wrap'),
      pic:     cc.querySelector('.header-combined-pic'),
      picFb:   cc.querySelector('.header-combined-pic-fb'),
      name:    cc.querySelector('.header-combined-name'),
      tag:     cc.querySelector('.header-combined-tag'),
      target:  cc.querySelector('.header-combined-pill.target'),
      xp:      cc.querySelector('.header-combined-pill.xp'),
    };

    // URL + drawer
    this.urlEl              = this.element.querySelector('.header-url-band');
    this.wordNumEl          = this.element.querySelector('.header-wordnum');
    this.modeSwitchEl       = this.element.querySelector('.header-mode-switch');
    if (this.modeSwitchEl) {
      const isSoloMode = !!window.__SP_MODE;
      this.modeSwitchEl.textContent = isSoloMode ? 'Online' : 'Solo';
      this.modeSwitchEl.href = getSearchleModeHref(isSoloMode ? '/online' : '/solo');
      this.modeSwitchEl.setAttribute('aria-label', isSoloMode ? 'Play Searchle online' : 'Play Searchle solo');
      this.modeSwitchEl.title = isSoloMode ? 'Play online' : 'Play solo';
    }
    // Mode-switch CTA — bidirectional pill:
    //   - Regular Searchle (window.__ALT_MODE false): "Click Here To
    //     Try Grid Mode" → grid.subtextle.com[/<handle>]
    //   - Grid (window.__ALT_MODE true): "Back to Normal Searchle" →
    //     subtextle.com[/<handle>]
    // setSessionUrl() keeps the href in sync with the active session.
    this.gridCtaEl = this.element.querySelector('.header-grid-cta');
    if (this.gridCtaEl) {
      if (window.__ALT_MODE) {
        this.gridCtaEl.textContent = 'Back to Normal Searchle';
        this.gridCtaEl.href = 'https://subtextle.com';
      } else {
        this.gridCtaEl.textContent = 'Click Here To Try Grid Mode';
        this.gridCtaEl.href = 'https://grid.subtextle.com';
      }
    }

    // Live streamers dropdown — shows count + expandable list of active
    // streamer handles fetched from chat-relay. Clicking the toggle
    // flips the menu open/closed; clicking outside closes it.
    this.streamersEl       = this.element.querySelector('.header-streamers');
    this.streamersToggleEl = this.element.querySelector('.header-streamers-toggle');
    this.streamersCountEl  = this.element.querySelector('.header-streamers-count');
    this.streamersLabelEl  = this.element.querySelector('.header-streamers-label');
    this.streamersMenuEl   = this.element.querySelector('.header-streamers-menu');
    if (this.streamersToggleEl) {
      this.streamersToggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = this.streamersEl.getAttribute('data-state') === 'open';
        this.streamersEl.setAttribute('data-state', open ? 'closed' : 'open');
      });
      // Outside click closes the menu
      document.addEventListener('click', () => {
        if (this.streamersEl) this.streamersEl.setAttribute('data-state', 'closed');
      });
      // Initial fetch + periodic refresh so the count reflects live state
      this._refreshStreamers();
      this._streamersInterval = setInterval(() => this._refreshStreamers(), 60_000);
    }
    this.drawerEl           = this.element.querySelector('.stats-drawer');
    this.drawerContentEl    = this.element.querySelector('.stats-drawer-content');
    this.statsToggleEl      = this.element.querySelector('.stats-toggle');
    this.statsToggleChevron = this.element.querySelector('.stats-toggle-chevron');

    if (this.statsToggleEl && this.drawerEnabled) {
      this.statsToggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleDrawer();
      });
    }

    if (this.drawerEnabled) this._createBannerOverlay();
    else this._disableDrawerInteractions();

    // Render slots in their initial empty state.
    this._renderSlots();
  }

  _buildElement() {
    const el = document.createElement('div');
    el.className = 'header-bar';
    el.style.width = config.baseWidth + 'px';

    let slotsHtml = '';
    for (let i = 0; i < SLOT_COUNT; i++) {
      slotsHtml += `
        <div class="header-slot ${SLOT_TIER_CLASSES[i]}" data-slot-index="${i}">
          <div class="header-slot-pic-wrap">
            <img class="header-slot-pic hidden" src="" alt="">
            <div class="header-slot-pic-fb"></div>
          </div>
          <div class="header-slot-label">${SLOT_LABELS_EMPTY[i]}</div>
          <div class="header-slot-name">--</div>
        </div>
      `;
    }

    // Combined card — shown only when target finder === XP winner
    // (same person won both). Spans the first 2 slot columns; slots 0
    // and 1 hide via .header-slots.is-combined.
    const combinedHtml = `
      <div class="header-combined-card hidden">
        <div class="header-combined-pic-ring">
          <div class="header-combined-pic-wrap">
            <img class="header-combined-pic hidden" src="" alt="">
            <div class="header-combined-pic-fb"></div>
          </div>
        </div>
        <div class="header-combined-info">
          <span class="header-combined-tag">target &middot; xp</span>
          <span class="header-combined-name">--</span>
          <div class="header-combined-pills">
            <span class="header-combined-pill xp">XP --</span>
            <span class="header-combined-pill target">--</span>
          </div>
        </div>
      </div>
    `;

    // Each ad card carries a 3-row parallax marquee behind a centered
    // name + URL pin. Rows scroll independently (top + bottom go left
    // at different speeds, middle goes right) for a "busy texture"
    // background. Tiles are duplicated so a -50% translate loop is
    // seamless.
    const TILES_PER_ROW = 8;
    function _tilesHtml(label) {
      // build TILES_PER_ROW tiles and duplicate them so the track is
      // exactly twice the visible width — animation translates by -50%.
      let h = '';
      for (let n = 0; n < TILES_PER_ROW * 2; n++) {
        h += `<span class="header-ad-tile">${label}</span>`;
      }
      return h;
    }

    let adsHtml = '';
    ADS.forEach((ad, i) => {
      adsHtml += `
        <a class="header-ad-card" data-ad-index="${i}" href="${ad.href}" target="_blank" rel="noopener" style="background:${ad.gradient};">
          <div class="header-ad-row header-ad-row-1"><div class="header-ad-track">${_tilesHtml(ad.name)}</div></div>
          <div class="header-ad-row header-ad-row-2"><div class="header-ad-track">${_tilesHtml(ad.name)}</div></div>
          <div class="header-ad-row header-ad-row-3"><div class="header-ad-track">${_tilesHtml(ad.name)}</div></div>
          <div class="header-ad-center">
            <div class="header-ad-name">${ad.name}</div>
            <div class="header-ad-url">${ad.url}</div>
          </div>
        </a>
      `;
    });

    // Stats live INSIDE the slots area (in row 2 of its grid), so they
    // sit directly below the silver+bronze slots and share vertical
    // space with the combined card. Keeps the header compact.
    const statsHtml = `
      <div class="header-stats">
        <div class="header-stat header-stat-time">
          <span class="header-stat-label">Time</span>
          <span class="header-stat-value header-value-timer">0:00</span>
        </div>
        <div class="header-stat header-stat-guesses">
          <span class="header-stat-label">Guesses</span>
          <span class="header-stat-value header-value-guesses">0</span>
        </div>
        <div class="header-stat header-stat-xp">
          <span class="header-stat-label">XP</span>
          <span class="header-stat-value header-value-xp">0</span>
        </div>
      </div>
    `;

    el.innerHTML = `
      <div class="header-bar-row">
        <div class="header-slots">${combinedHtml}${slotsHtml}${statsHtml}</div>
        <div class="header-ad-slot">${adsHtml}</div>
      </div>
      <div class="header-url-row">
        <div class="header-streamers" data-state="closed">
          <button type="button" class="header-streamers-toggle" title="Live streamers">
            <span class="header-streamers-dot"></span>
            <span class="header-streamers-count">0</span>
            <span class="header-streamers-label">Live Streamers</span>
            <span class="header-streamers-chevron">&#9662;</span>
          </button>
          <div class="header-streamers-menu" role="menu"></div>
        </div>
        <span class="header-url-band">www.subtextle.com</span>
        <a class="header-mode-switch" href="${getSearchleModeHref('/solo')}" target="_top" rel="noopener">Solo</a>
        <a class="header-grid-cta" href="https://grid.subtextle.com" target="_top" rel="noopener">Click Here To Try Grid Mode</a>
        <span class="header-wordnum hidden"></span>
      </div>
      <div class="header-toggle-row">
        <span class="stats-toggle" title="Toggle Stats">
          <span class="stats-toggle-icon">&#9776;</span>
          <span class="stats-toggle-chevron">&#9660;</span>
        </span>
      </div>
      <div class="stats-drawer">
        <div class="stats-drawer-content"></div>
      </div>
    `;

    return el;
  }

  getLayoutHeight() {
    return this.element.offsetHeight || 360;
  }

  get height() {
    return this.element.offsetHeight || 360;
  }

  // ===== Live stats column =====

  updateGuessCount(count) {
    if (this.guessCountEl) this.guessCountEl.textContent = (count || 0).toLocaleString();
  }

  updateRoundXp(xp) {
    if (this.xpEl) this.xpEl.textContent = (xp || 0).toLocaleString();
  }

  startTimer(startTime) {
    this.startTime = startTime;
    this.isWon = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (!this.startTime || this.isWon) return;
      const elapsed = Math.floor((Date.now() - new Date(this.startTime).getTime()) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      if (this.timerEl) this.timerEl.textContent = mins + ':' + secs.toString().padStart(2, '0');
    }, config.timerInterval);
  }

  stopTimer(durationSeconds) {
    this.isWon = true;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = null;
    if (Number.isFinite(durationSeconds) && durationSeconds >= 0 && this.timerEl) {
      const seconds = Math.floor(durationSeconds);
      this.timerEl.textContent = Math.floor(seconds / 60) + ':' + (seconds % 60).toString().padStart(2, '0');
    }
  }

  // ===== Slot data =====

  /**
   * Cache the latest live podium and refresh the live XP stat. Called
   * on every podium-update broadcast (top 7 by game XP).
   */
  updatePodium(podium) {
    this._currentPodium = Array.isArray(podium) ? podium : [];
    const leaderXp = (this._currentPodium[0] && this._currentPodium[0].xp) || 0;
    this.updateRoundXp(leaderXp);
  }

  /**
   * Round just ended (or page just loaded with last-round data from the
   * server). Snapshot the previous-round results into the slot row.
   *
   * Args:
   *   word: target word (last round)
   *   user: XP WINNER (top XP, not necessarily the target finder)
   *   winGuessCount: total guesses
   *   winHistory, winCounts, eloLeaderboard: stats drawer inputs (kept
   *     positional for backward compat)
   *   opts: {
   *     targetFinder: who actually guessed rank-1 word (often === user)
   *     podiumSnapshot: top-N from end of round (preferred over live cache
   *       so refresh works without a fresh podium-update event)
   *   }
   */
  updateWinner(word, user, winGuessCount, winHistory, winCounts, eloLeaderboard, opts) {
    this.winHistory = winHistory || this.winHistory;
    const o = opts || {};
    // Don't fall back to `user` when targetFinder is missing — that
    // would show the XP winner in slot 0 (target slot) without us
    // knowing they actually found the target. Better to leave it empty.
    const targetFinderRaw = o.targetFinder || null;
    const podium = Array.isArray(o.podiumSnapshot) && o.podiumSnapshot.length
      ? o.podiumSnapshot
      : (this._currentPodium || []);
    const top = podium.filter(Boolean);

    // The server's `user` (XP winner) and `targetFinder` payloads carry
    // identity + cosmetics but NOT the `xp` value. Look both up in the
    // podium (which has xp) so the XP-amount pills under slots 1/2/3
    // show real numbers instead of "XP --".
    const xpWinnerRaw = user || top[0] || null;
    const xpWinner = _enrichWithPodium(xpWinnerRaw, top);
    const targetFinder = _enrichWithPodium(targetFinderRaw, top);

    const xpWinnerKey = _identityKey(xpWinner);
    const targetKey = _identityKey(targetFinder);

    // Slot 2/3 = next 2 by XP, excluding only the XP winner (who already
    // occupies slot 1). The target finder is NOT excluded here — if
    // they happen to also be 2nd or 3rd by XP, they should appear in
    // both slot 0 (target role) and the silver/bronze slot (XP rank
    // role) so their podium standing isn't dropped from the row.
    const others = top.filter((p) => {
      const k = _identityKey(p);
      if (!k) return false;
      if (k === xpWinnerKey) return false;
      return true;
    });

    this._lastRound = {
      word: word || '',
      winGuessCount: winGuessCount || 0,
      slot0: targetFinder,    // target finder (green ring, leftmost)
      slot1: xpWinner,        // XP winner (gold ring)
      slot2: others[0] || null,
      slot3: others[1] || null,
    };

    this._renderSlots();
  }

  _renderSlots() {
    if (!this._lastRound) {
      // Cold start — render the empty state, hide combined card.
      this._setCombinedMode(false);
      this.combined.root.classList.add('hidden');
      for (let i = 0; i < SLOT_COUNT; i++) {
        this._renderEmptySlot(this.slots[i], i);
      }
      return;
    }
    const r = this._lastRound;

    // Same person as both target finder AND XP winner → combined card.
    const sameWinner =
      r.slot0 && r.slot1 &&
      _identityKey(r.slot0) === _identityKey(r.slot1);

    if (sameWinner) {
      this._setCombinedMode(true);
      this._renderCombinedCard(r.slot0, r.word);
      // slots 0/1 hide via .is-combined; still reset their data so
      // stale cosmetics don't bleed in if the mode flips back.
      this._renderEmptySlot(this.slots[0], 0);
      this._renderEmptySlot(this.slots[1], 1);
    } else {
      this._setCombinedMode(false);
      this.combined.root.classList.add('hidden');
      this._renderFilledSlot(this.slots[0], r.slot0, _wordLabel(r.word));
      this._renderFilledSlot(this.slots[1], r.slot1, _xpLabel(r.slot1));
    }
    this._renderFilledSlot(this.slots[2], r.slot2, _xpLabel(r.slot2));
    this._renderFilledSlot(this.slots[3], r.slot3, _xpLabel(r.slot3));
  }

  _setCombinedMode(on) {
    if (!this.slotsContainerEl) return;
    this.slotsContainerEl.classList.toggle('is-combined', !!on);
  }

  _renderCombinedCard(person, word) {
    const c = this.combined;
    if (!c || !c.root) return;
    c.root.classList.remove('hidden');
    if (c.picWrap) c.picWrap.classList.toggle('has-fan-club-badge', !!(person && person.isFanClub));
    // Truncate long display names so the combined card's natural width
    // can't blow past its grid column. Without this the wider card
    // pushes the slots area's auto track past 1fr, collapsing the ad
    // slot beside it to 0 width.
    const rawName = person.displayName || '--';
    const MAX_NAME_CHARS = 12;
    c.name.textContent = rawName.length > MAX_NAME_CHARS
      ? rawName.slice(0, MAX_NAME_CHARS) + '…'
      : rawName;
    c.target.textContent = _wordLabel(word);
    c.xp.textContent = _xpLabel(person);

    if (person.profilePic) {
      c.pic.src = person.profilePic;
      c.pic.classList.remove('hidden');
      c.picFb.classList.add('hidden');
      c.pic.onerror = () => {
        c.pic.classList.add('hidden');
        c.picFb.classList.remove('hidden');
        c.picFb.style.background = getPlatformColor(person.platform);
        c.picFb.textContent = (person.displayName || '?')[0].toUpperCase();
      };
      markAvatarLogo(c.pic, c.picWrap);
    } else {
      c.pic.classList.add('hidden');
      c.picFb.classList.remove('hidden');
      c.picFb.style.background = getPlatformColor(person.platform);
      c.picFb.textContent = (person.displayName || '?')[0].toUpperCase();
    }

    const avatarEl = person.profilePic ? c.pic : c.picFb;
    applyCosmetics({
      avatarEl,
      avatarHostEl: c.picWrap,
      nameEl: c.name,
      surfaceEl: c.root,
      avatarSize: 200,
    }, person.cosmetics || {});
  }

  _renderEmptySlot(slot, idx) {
    if (!slot) return;
    slot.root.classList.add('is-empty');
    if (slot.picWrap) slot.picWrap.classList.remove('has-fan-club-badge');
    slot.pic.classList.add('hidden');
    slot.pic.removeAttribute('src');
    slot.picFb.classList.remove('hidden');
    slot.picFb.style.background = '';
    slot.picFb.textContent = '';
    slot.label.textContent = SLOT_LABELS_EMPTY[idx] || '';
    slot.name.textContent = '--';
    // Reset cosmetics
    applyCosmetics({
      avatarEl: slot.picFb,
      avatarHostEl: slot.picWrap,
      nameEl: slot.name,
      surfaceEl: slot.root,
      avatarSize: 96,
    }, {});
    slot.pic.style.cssText = '';
    slot.picFb.style.cssText = '';
  }

  _renderFilledSlot(slot, person, labelText) {
    if (!slot) return;
    if (!person || !person.displayName) {
      this._renderEmptySlot(slot, _slotIndex(slot));
      return;
    }
    slot.root.classList.remove('is-empty');
    slot.label.textContent = labelText || '';
    slot.name.textContent = person.displayName || '--';
    if (slot.picWrap) slot.picWrap.classList.toggle('has-fan-club-badge', !!person.isFanClub);

    if (person.profilePic) {
      slot.pic.src = person.profilePic;
      slot.pic.classList.remove('hidden');
      slot.picFb.classList.add('hidden');
      slot.pic.onerror = () => {
        slot.pic.classList.add('hidden');
        slot.picFb.classList.remove('hidden');
        slot.picFb.style.background = getPlatformColor(person.platform);
        slot.picFb.textContent = (person.displayName || '?')[0].toUpperCase();
      };
      markAvatarLogo(slot.pic, slot.picWrap);
    } else {
      slot.pic.classList.add('hidden');
      slot.picFb.classList.remove('hidden');
      slot.picFb.style.background = getPlatformColor(person.platform);
      slot.picFb.textContent = (person.displayName || '?')[0].toUpperCase();
    }

    // Apply cosmetics. Hero badge applies to the slot root as a surface,
    // name_color/name_glow apply to the name pill, profile_border/glow
    // apply to the avatar (over the tier ring).
    const avatarEl = person.profilePic ? slot.pic : slot.picFb;
    applyCosmetics({
      avatarEl,
      avatarHostEl: slot.picWrap,
      nameEl: slot.name,
      surfaceEl: slot.root,
      avatarSize: 96,
    }, person.cosmetics || {});
  }

  // ===== Session URL + word number =====

  setSessionUrl(handle, opts) {
    if (!this.urlEl) return;
    const bare = !!(opts && opts.bare);
    // Sync the mode-switch CTA href with the current session handle so
    // clicking it preserves the viewer's room. Both directions:
    //   - Regular Searchle → grid.subtextle.com[/<handle>]
    //   - Grid → subtextle.com[/<handle>]
    const ctaEl = this.element && this.element.querySelector('.header-grid-cta');
    if (ctaEl) {
      const safeHandle = (handle && /^[a-z0-9_-]{1,32}$/i.test(handle))
        ? handle.toLowerCase()
        : '';
      const targetBase = window.__ALT_MODE
        ? 'https://subtextle.com'
        : 'https://grid.subtextle.com';
      ctaEl.href = safeHandle ? targetBase + '/' + safeHandle : targetBase;
    }
    if (bare) {
      this.urlEl.textContent = 'www.subtextle.com';
      this.urlEl.classList.remove('hidden');
      return;
    }
    if (handle && /^[a-z0-9_-]{1,32}$/i.test(handle)) {
      this.urlEl.textContent = 'www.subtextle.com/' + handle.toLowerCase();
      this.urlEl.classList.remove('hidden');
    } else {
      this.urlEl.textContent = 'www.subtextle.com';
      this.urlEl.classList.remove('hidden');
    }
  }

  // ===== Live streamers dropdown =====
  // Fetches active streamer handles from chat-relay and populates the
  // dropdown. The badge shows the count (with a red live-dot). Clicking
  // any handle navigates the top-level page to that streamer's room.
  async _refreshStreamers() {
    try {
      // Chat Relay's public live snapshot includes every currently-live
      // streamer across all games. Searchle only wants the streamers who
      // are actively running Searchle itself (regular or grid), so we
      // filter by gameId client-side.
      const res = await fetch('https://wordtycoon.live/api/streamers/live', { credentials: 'omit' });
      if (!res.ok) return;
      const data = await res.json();
      const live = Array.isArray(data && data.streamers) ? data.streamers : [];
      const handles = live
        .filter((s) => {
          const gameId = String(s && s.gameId || '').toLowerCase();
          return gameId === 'searchle' || gameId === 'searchle-grid';
        })
        .map((s) => String(s && s.handle || '').toLowerCase())
        .filter((h, i, arr) => /^[a-z0-9_-]{1,32}$/.test(h) && arr.indexOf(h) === i);
      if (this.streamersCountEl) this.streamersCountEl.textContent = String(handles.length);
      if (this.streamersLabelEl) {
        this.streamersLabelEl.textContent = handles.length === 1 ? 'Live Streamer' : 'Live Streamers';
      }
      if (this.streamersMenuEl) {
        // Build menu — each streamer is a link to their session room.
        // Target depends on which mode we're in so the dropdown stays
        // within the user's current Searchle variant (grid vs regular).
        const base = window.__ALT_MODE ? 'https://grid.subtextle.com' : 'https://subtextle.com';
        const items = handles.length === 0
          ? '<div class="header-streamers-empty">No streamers live right now</div>'
          : handles.map((h) => {
              const safe = String(h).toLowerCase().replace(/[^a-z0-9_-]/g, '');
              if (!safe) return '';
              return `<a class="header-streamers-item" href="${base}/${safe}" target="_top" rel="noopener">${safe}</a>`;
            }).join('');
        this.streamersMenuEl.innerHTML = items;
      }
    } catch (_) {
      /* Network glitch — keep previous values */
    }
  }

  updateWordNumber(num, label) {
    if (!this.wordNumEl) return;
    if (num) {
      const prefix = label === 'daily' ? 'Daily #' : label === 'weekly' ? 'Weekly #' : 'Game #';
      this.wordNumEl.textContent = prefix + num;
      this.wordNumEl.classList.remove('hidden');
    } else {
      this.wordNumEl.classList.add('hidden');
    }
  }

  reset(startTime) {
    this.updateGuessCount(0);
    this.updateRoundXp(0);
    if (this.timerEl) this.timerEl.textContent = '0:00';
    this.isWon = false;
    this.updateWordNumber(null);
    // Clear live podium for the new round, but KEEP the slot snapshot so
    // last-round results stay visible until the next win event.
    this._currentPodium = [];
    this.startTimer(startTime);
  }

  // ===== SP mode: hide the slot row entirely (no "previous winner" concept) =====

  setSPUser(/* user, cosmetics */) {
    this.element.classList.add('mode-sp');
  }

  setSPAnon() {
    this.element.classList.add('mode-sp');
    this._createLoginOverlay();
  }

  hideLoginOverlay() {
    if (this._loginOverlay) {
      this._loginOverlay.remove();
      this._loginOverlay = null;
    }
  }

  _createLoginOverlay() {
    if (this._loginOverlay) return;
    const loginUrl = location.origin + '/auth/discord?returnTo=' + encodeURIComponent(location.pathname);
    const btn = document.createElement('a');
    btn.className = 'login-overlay-btn';
    btn.href = loginUrl;
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>' +
      '<span>Log in with Discord</span>';
    document.body.appendChild(btn);
    this._loginOverlay = btn;
  }

  // ===== Stats Drawer =====

  setMode(mode) {
    this.mode = mode;
    if (mode === 'sp') this._disableDrawerInteractions();
  }

  _toggleDrawer() {
    if (!this.drawerEnabled) return;
    audio.play('drawer-toggle');
    this.drawerOpen = !this.drawerOpen;
    if (this.drawerEl) this.drawerEl.classList.toggle('open', this.drawerOpen);
    if (this.statsToggleChevron) this.statsToggleChevron.style.transform = this.drawerOpen ? 'rotate(180deg)' : '';
    if (this.statsToggleEl) this.statsToggleEl.classList.toggle('active', this.drawerOpen);
    if (this._bannerOverlay) this._bannerOverlay.classList.toggle('drawer-open', this.drawerOpen);
    if (this._drawerThemeBtn) {
      if (this.drawerOpen) {
        const row = this.element.querySelector('.header-bar-row');
        if (row) {
          const rect = row.getBoundingClientRect();
          this._drawerThemeBtn.style.top = (rect.bottom + 8) + 'px';
        }
        this._drawerThemeBtn.classList.add('visible');
      } else {
        this._drawerThemeBtn.classList.remove('visible');
      }
    }
    if (this.onDrawerToggle) {
      const h = this.drawerOpen && this.drawerEl ? this.drawerEl.scrollHeight : 0;
      this.onDrawerToggle(h);
    }
  }

  _createBannerOverlay() {
    if (!this.drawerEnabled) return;
    const overlay = document.createElement('div');
    overlay.className = 'banner-overlay';

    const hint = document.createElement('div');
    hint.className = 'banner-pull-hint';
    hint.textContent = '▼';
    overlay.appendChild(hint);

    let startY = 0, touchUsed = false, moved = false;
    overlay.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY; moved = false;
    }, { passive: true });
    overlay.addEventListener('touchmove', () => { moved = true; }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
      touchUsed = true;
      const deltaY = e.changedTouches[0].clientY - startY;
      if (deltaY > 30 && !this.drawerOpen) this._toggleDrawer();
      else if (deltaY < -30 && this.drawerOpen) this._toggleDrawer();
      else if (!moved) this._toggleDrawer();
    }, { passive: true });
    overlay.addEventListener('click', () => {
      if (touchUsed) { touchUsed = false; return; }
      this._toggleDrawer();
    });

    document.body.appendChild(overlay);
    this._bannerOverlay = overlay;

    const themeBtn = document.createElement('div');
    themeBtn.className = 'drawer-theme-btn';
    const isLight = document.documentElement.dataset.theme === 'light';
    themeBtn.innerHTML = isLight
      ? '<span class="dtheme-icon">☀</span> Dark Mode'
      : '<span class="dtheme-icon">☾</span> Light Mode';
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowLight = document.documentElement.dataset.theme === 'light';
      if (nowLight) {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem('searchle-theme');
        themeBtn.innerHTML = '<span class="dtheme-icon">☾</span> Light Mode';
      } else {
        document.documentElement.dataset.theme = 'light';
        localStorage.setItem('searchle-theme', 'light');
        themeBtn.innerHTML = '<span class="dtheme-icon">☀</span> Dark Mode';
      }
    });
    document.body.appendChild(themeBtn);
    this._drawerThemeBtn = themeBtn;
  }

  _disableDrawerInteractions() {
    this.drawerEnabled = false;
    this.drawerOpen = false;
    if (this.drawerEl) this.drawerEl.classList.remove('open');
    if (this.statsToggleEl) this.statsToggleEl.classList.remove('active');
    if (this.statsToggleChevron) this.statsToggleChevron.style.transform = '';
    const toggleRow = this.element && this.element.querySelector('.header-toggle-row');
    if (toggleRow) toggleRow.style.display = 'none';
    if (this._bannerOverlay) {
      this._bannerOverlay.remove();
      this._bannerOverlay = null;
    }
    if (this._drawerThemeBtn) {
      this._drawerThemeBtn.remove();
      this._drawerThemeBtn = null;
    }
    if (this.onDrawerToggle) this.onDrawerToggle(0);
  }

  updateStats(winHistory) {
    this.winHistory = winHistory || this.winHistory;
    if (!this.drawerContentEl || !this.mode) return;
    if (this.mode === 'sp') {
      this.drawerContentEl.innerHTML = this._renderSPStats(this.winHistory);
    } else {
      this.drawerContentEl.innerHTML = this._renderMPStats(this.winHistory);
    }
  }

  _renderSPStats(history) {
    const total = history.length;
    if (total === 0) return '<div class="stats-empty">No games completed yet</div>';
    const totalGuesses = history.reduce((s, w) => s + (w.guessCount || 0), 0);
    const avg = Math.round(totalGuesses / total);
    const best = Math.min(...history.map(w => w.guessCount || Infinity));
    const recent = [...history].reverse().slice(0, 5);
    return `
      <div class="stats-summary-row">
        <div class="stats-box"><div class="stats-box-value">${total}</div><div class="stats-box-label">Won</div></div>
        <div class="stats-box"><div class="stats-box-value">${avg}</div><div class="stats-box-label">Avg Guesses</div></div>
        <div class="stats-box"><div class="stats-box-value">${best === Infinity ? '-' : best}</div><div class="stats-box-label">Best</div></div>
      </div>
      <div class="stats-section-label">Recent Games</div>
      <div class="stats-recent-list">
        ${recent.map(w => `
          <div class="stats-recent-row">
            <span class="stats-recent-num">${w.wordNumber ? '#' + w.wordNumber : ''}</span>
            <span class="stats-recent-word">${(w.word || '').toUpperCase()}</span>
            <span class="stats-recent-guesses">${w.guessCount || '?'}g</span>
            <span class="stats-recent-time">${this._timeAgo(w.timestamp)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  _renderMPStats(history) {
    const total = history.length;
    if (total === 0) return '<div class="stats-empty">No games completed yet</div>';
    const totalGuesses = history.reduce((s, w) => s + (w.guessCount || 0), 0);
    const avg = Math.round(totalGuesses / total);
    const winMap = new Map();
    const keyToName = new Map();
    const keyToPlatform = new Map();
    for (const w of history) {
      const name = w.user ? (w.user.displayName || 'Unknown') : (w.displayName || 'Unknown');
      const platform = w.user ? (w.user.platform || '') : '';
      const key = (w.user && w.user.linkedDiscord) ? w.user.linkedDiscord : name;
      winMap.set(key, (winMap.get(key) || 0) + 1);
      keyToName.set(key, name);
      keyToPlatform.set(key, platform);
    }
    const leaderboard = [...winMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const recent = [...history].reverse().slice(0, 5);
    return `
      <div class="stats-summary-row">
        <div class="stats-box"><div class="stats-box-value">${total}</div><div class="stats-box-label">Games</div></div>
        <div class="stats-box"><div class="stats-box-value">${avg}</div><div class="stats-box-label">Avg Guesses</div></div>
        <div class="stats-box"><div class="stats-box-value">${leaderboard.length}</div><div class="stats-box-label">Players</div></div>
      </div>
      <div class="stats-section-label">Last 5 Games</div>
      <div class="stats-recent-list">
        ${recent.map(w => {
          const name = w.user ? (w.user.displayName || '?') : (w.displayName || '?');
          const plat = w.user ? (w.user.platform || '') : '';
          return `
            <div class="stats-recent-row">
              <span class="stats-recent-word">${(w.word || '').toUpperCase()}</span>
              <span class="stats-recent-winner">${this._platformDot(plat)}${this._escHtml(name)}</span>
              <span class="stats-recent-guesses">${w.guessCount || '?'}g</span>
              <span class="stats-recent-time">${this._timeAgo(w.timestamp)}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="stats-section-label" style="margin-top:36px">Top 10 Players</div>
      <div class="stats-lb-list">
        ${leaderboard.map((entry, i) => {
          const plat = keyToPlatform.get(entry[0]) || '';
          return `
            <div class="stats-lb-row">
              <span class="stats-lb-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}.</span>
              <span class="stats-lb-name">${this._platformDot(plat)}${this._escHtml(keyToName.get(entry[0]) || entry[0])}</span>
              <span class="stats-lb-wins">${entry[1]}<span class="stats-lb-wins-label">w</span></span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _platformDot(platform) {
    if (!platform) return '';
    const colors = { tiktok: '#69C9D0', youtube: '#FF0000', discord: '#5865F2' };
    const c = colors[platform] || 'rgba(255,255,255,0.3)';
    return '<span class="stats-plat-dot" style="background:' + c + '"></span>';
  }

  _escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    return Math.floor(hrs / 24) + 'd';
  }

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
}

// ----- helpers -----

function ensureModeSwitchStyles() {
  if (document.getElementById(MODE_SWITCH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MODE_SWITCH_STYLE_ID;
  style.textContent = `
    .header-mode-switch {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      padding: 8px 18px;
      border: 2px solid rgba(34, 211, 238, 0.65);
      border-radius: 999px;
      background: rgba(34, 211, 238, 0.1);
      color: #e0faff;
      font-size: 22px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0.5px;
      text-decoration: none;
      text-transform: uppercase;
      white-space: nowrap;
      pointer-events: auto;
      cursor: pointer;
      transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
    }
    .header-mode-switch:hover {
      background: rgba(34, 211, 238, 0.18);
      border-color: rgba(34, 211, 238, 0.9);
      transform: translateY(-1px);
    }
    .header-mode-switch:active {
      background: rgba(34, 211, 238, 0.24);
      transform: translateY(0);
    }
    .header-bar.mode-sp .header-mode-switch {
      padding: 7px 16px;
      font-size: 21px;
    }
    [data-theme="light"] .header-mode-switch {
      background: rgba(8, 145, 178, 0.08);
      border-color: rgba(8, 145, 178, 0.32);
      color: #056278;
    }
    [data-theme="light"] .header-mode-switch:hover {
      background: rgba(8, 145, 178, 0.14);
      border-color: rgba(8, 145, 178, 0.48);
    }
  `;
  document.head.appendChild(style);
}

function _identityKey(p) {
  if (!p) return null;
  if (p.linkedDiscord) return 'discord:' + p.linkedDiscord;
  return ((p.platform || '?') + ':' + (p.platformUserId || p.id || 'unknown'));
}

function _xpLabel(person) {
  if (!person || !person.xp) return 'XP --';
  const xp = person.xp;
  if (xp >= 1000) return 'XP ' + (xp / 1000).toFixed(xp >= 10000 ? 0 : 1) + 'K';
  return 'XP ' + xp;
}

function _wordLabel(word) {
  if (!word) return '--';
  return String(word).toUpperCase();
}

// Server's winnerUser / targetFinder payloads strip the xp field.
// Look the person up in the podium snapshot (which keeps xp) and merge
// so the slot's XP pill renders a real number instead of "XP --".
function _enrichWithPodium(person, podium) {
  if (!person) return null;
  const k = _identityKey(person);
  if (!k || !Array.isArray(podium)) return person;
  const match = podium.find((p) => _identityKey(p) === k);
  if (!match) return person;
  return { ...match, ...person, xp: (typeof person.xp === 'number' ? person.xp : match.xp) };
}

function _slotIndex(slot) {
  return parseInt(slot.root.getAttribute('data-slot-index'), 10) || 0;
}
