// ===== Jackpot Bar =====
// CSS3DObject wrapping the jackpot display with animated counter.

import config from '../config.js';

export class JackpotBar {
  constructor(domRenderer) {
    this.domRenderer = domRenderer;
    this.startTime = null;
    this.guessCount = 0;
    this.tickerInterval = null;
    this._currentDisplayed = 3000;
    this._visible = true;
    this._frenzyMultiplier = 1.0;

    this.element = this._buildElement();
    this.object3D = domRenderer.makeObject(this.element);
    domRenderer.add(this.element);

    this.amountEl = this.element.querySelector('.jackpot-amount');
    this.weeklyBadgeEl = this.element.querySelector('.weekly-badge');
    this.frenzyBadgeEl = this.element.querySelector('.frenzy-badge');
  }

  _buildElement() {
    const el = document.createElement('div');
    el.className = 'jackpot-bar';

    el.innerHTML = `
      <span class="jackpot-label">XP</span>
      <span class="jackpot-amount">3,000</span>
      <span class="weekly-badge" style="display:none;">WEEKLY</span>
      <span class="frenzy-badge" style="display:none;"><span class="frenzy-label">FRENZY</span><span class="frenzy-value">1.0x</span></span>
    `;

    return el;
  }

  get height() {
    // Pill floats over header — takes no layout space
    return 0;
  }

  setPosition(y) {
    // Pill position is set directly in updateLayout — this is a no-op
  }

  start(startTime, guessCount) {
    this.startTime = startTime;
    this.guessCount = guessCount;
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    this._updateAmount();
    this.tickerInterval = setInterval(() => this._updateAmount(), 1000);
  }

  stop() {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
  }

  addGuess() {
    this.guessCount++;
    // Don't trigger animation here — the 1-second ticker handles display updates.
    // Calling _updateAmount() on every guess caused overlapping animations (visual flash).
  }

  bump() {
    this.element.classList.remove('bump');
    void this.element.offsetWidth;
    this.element.classList.add('bump');
    setTimeout(() => this.element.classList.remove('bump'), 350);
  }

  _calculatePot() {
    if (!this.startTime) return 3000;
    const seconds = (Date.now() - new Date(this.startTime).getTime()) / 1000;
    let guessBonus;
    if (this.guessCount <= 1000) {
      guessBonus = this.guessCount * 10;
    } else {
      guessBonus = 10000 * Math.pow(this.guessCount / 1000, 1.5);
    }
    let timeBonus;
    if (seconds <= 600) {
      timeBonus = (seconds / 600) * 10000;
    } else {
      timeBonus = 10000 * Math.pow(seconds / 600, 1.5);
    }
    return Math.max(3000, Math.round((guessBonus + timeBonus) * (this._frenzyMultiplier || 1.0)));
  }

  _updateAmount() {
    const pot = this._calculatePot();
    if (!this.amountEl) return;
    if (this._currentDisplayed === pot) return;

    // Set directly — no animation. Continuous rAF text updates cause
    // visible flickering/flashing in OBS browser sources due to
    // text-shadow re-rendering on every frame.
    this._currentDisplayed = pot;
    this.amountEl.textContent = pot.toLocaleString();
  }

  setSpecialBadge(label) {
    if (this.weeklyBadgeEl) {
      if (label) {
        this.weeklyBadgeEl.textContent = label.toUpperCase();
        this.weeklyBadgeEl.style.display = 'inline-block';
      } else {
        this.weeklyBadgeEl.style.display = 'none';
      }
    }
  }

  // Legacy compat for SP code that still calls setWeekly
  setWeekly(isWeekly) {
    this.setSpecialBadge(isWeekly ? 'WEEKLY' : null);
  }

  setFrenzy(frenzy) {
    if (!this.frenzyBadgeEl) return;
    const multiplier = frenzy && frenzy.multiplier ? frenzy.multiplier : 1.0;
    this._frenzyMultiplier = multiplier;
    if (multiplier > 1.0) {
      this.frenzyBadgeEl.style.display = 'inline-block';
      const valueEl = this.frenzyBadgeEl.querySelector('.frenzy-value');
      if (valueEl) valueEl.textContent = multiplier.toFixed(1) + 'x';
    } else {
      this.frenzyBadgeEl.style.display = 'none';
    }
  }

  setVisible(visible) {
    if (!visible && this._visible) {
      this.stop();
    }
    this.element.style.display = visible ? '' : 'none';
    this._visible = visible;
  }

  get visible() {
    return this._visible !== false;
  }
}
