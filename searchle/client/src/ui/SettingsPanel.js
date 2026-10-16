// ===== Settings Panel =====
// Plain HTML overlay for streamer settings (not 3D).

import config from '../config.js';

export class SettingsPanel {
  constructor(guessList, onRender, socket) {
    this.guessList = guessList;
    this.onRender = onRender;
    this.socket = socket;
    this._initControls();
    this._initKeyToggle();
    this._applySettings(this._getSettings());
  }

  _getSettings() {
    try {
      return Object.assign({}, config.defaults, JSON.parse(localStorage.getItem(config.storageKey) || '{}'));
    } catch (e) {
      return Object.assign({}, config.defaults);
    }
  }

  _saveSettings(s) {
    localStorage.setItem(config.storageKey, JSON.stringify(s));
    this._applySettings(s);
  }

  _applySettings(s) {
    const root = document.documentElement.style;
    root.setProperty('--font-family', s.fontFamily);
    root.setProperty('--text-size', s.textSize + 'px');
    root.setProperty('--score-size', s.scoreSize + 'px');
    root.setProperty('--bubble-height', s.bubbleSize + 'px');
    root.setProperty('--bubble-radius', config.bubbleRadiusMap[s.bubbleStyle] || '8px');

    const tsv = document.getElementById('text-size-val');
    const bsv = document.getElementById('bubble-size-val');
    const ssv = document.getElementById('score-size-val');
    if (tsv) tsv.textContent = s.textSize + 'px';
    if (bsv) bsv.textContent = s.bubbleSize + 'px';
    if (ssv) ssv.textContent = s.scoreSize + 'px';
  }

  _initControls() {
    const s = this._getSettings();

    const fontSelect = document.getElementById('setting-font');
    const textSizeRange = document.getElementById('setting-text-size');
    const bubbleSizeRange = document.getElementById('setting-bubble-size');
    const bubbleStyleSelect = document.getElementById('setting-bubble-style');
    const scoreSizeRange = document.getElementById('setting-score-size');

    if (fontSelect) fontSelect.value = s.fontFamily;
    if (textSizeRange) textSizeRange.value = s.textSize;
    if (bubbleSizeRange) bubbleSizeRange.value = s.bubbleSize;
    if (bubbleStyleSelect) bubbleStyleSelect.value = s.bubbleStyle;
    if (scoreSizeRange) scoreSizeRange.value = s.scoreSize;

    if (fontSelect) fontSelect.addEventListener('change', () => {
      const cur = this._getSettings(); cur.fontFamily = fontSelect.value; this._saveSettings(cur);
    });
    if (textSizeRange) textSizeRange.addEventListener('input', () => {
      const cur = this._getSettings(); cur.textSize = parseInt(textSizeRange.value); this._saveSettings(cur);
    });
    if (bubbleSizeRange) bubbleSizeRange.addEventListener('input', () => {
      const cur = this._getSettings(); cur.bubbleSize = parseInt(bubbleSizeRange.value); this._saveSettings(cur);
      if (this.guessList) this.guessList.invalidateRowHeight();
      if (this.onRender) this.onRender();
    });
    if (bubbleStyleSelect) bubbleStyleSelect.addEventListener('change', () => {
      const cur = this._getSettings(); cur.bubbleStyle = bubbleStyleSelect.value; this._saveSettings(cur);
    });
    if (scoreSizeRange) scoreSizeRange.addEventListener('input', () => {
      const cur = this._getSettings(); cur.scoreSize = parseInt(scoreSizeRange.value); this._saveSettings(cur);
    });

    const newGameBtn = document.getElementById('new-game-btn');
    if (newGameBtn) {
      newGameBtn.addEventListener('click', () => {
        if (window.__SP_MODE) {
          document.dispatchEvent(new CustomEvent('sp-new-game-request'));
        } else {
          fetch('/api/game/new', { method: 'POST' });
        }
      });
    }
  }

  _initKeyToggle() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 's' || e.key === 'S') {
        const panel = document.getElementById('settings-panel');
        if (panel) panel.classList.toggle('hidden');
      }
    });
  }
}
