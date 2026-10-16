// ===== Audio Settings Button =====
// Floating bottom-right speaker icon + popover with the two controls
// required by the audio handoff: mute toggle and master volume slider.
// Both persist via the AudioBridge (writes localStorage).
//
// Lives outside the CSS3D / DOMRenderer tree so it's always clickable
// and isn't subject to the viewport transform.

import { audio } from '../audio/AudioBridge.js';
import { isOBS } from '../utils/Mobile.js';

const ICON_VOL = '🔊';
const ICON_MUTED = '🔇';

export class AudioSettingsButton {
  constructor() {
    if (isOBS) return; // OBS overlay shouldn't show user-facing controls
    this._open = false;
    this._build();
    this._sync();
  }

  _build() {
    const btn = document.createElement('button');
    btn.className = 'audio-settings-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Sound settings');
    btn.innerHTML = '<span class="audio-settings-icon">' + ICON_VOL + '</span>';
    this.btn = btn;

    const popover = document.createElement('div');
    popover.className = 'audio-settings-popover hidden';
    popover.innerHTML = `
      <div class="audio-settings-row audio-settings-row-mute">
        <label class="audio-settings-label" for="audio-settings-mute">Sound effects</label>
        <button class="audio-settings-toggle" id="audio-settings-mute" type="button" aria-pressed="true">
          <span class="audio-settings-toggle-knob"></span>
        </button>
      </div>
      <div class="audio-settings-row audio-settings-row-volume">
        <label class="audio-settings-label" for="audio-settings-volume">Volume</label>
        <input class="audio-settings-slider" id="audio-settings-volume" type="range" min="0" max="100" step="1" />
        <span class="audio-settings-volume-value">65</span>
      </div>
    `;
    this.popover = popover;
    this.muteToggle = popover.querySelector('#audio-settings-mute');
    this.slider = popover.querySelector('#audio-settings-volume');
    this.volumeValue = popover.querySelector('.audio-settings-volume-value');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleOpen();
    });

    this.muteToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const state = audio.getState();
      audio.setMuted(!state.muted);
      this._sync();
    });

    this.slider.addEventListener('input', () => {
      const v = Number(this.slider.value) / 100;
      audio.setVolume(v);
      this.volumeValue.textContent = String(this.slider.value);
    });

    // Close popover when clicking outside it.
    document.addEventListener('click', (e) => {
      if (!this._open) return;
      if (this.popover.contains(e.target) || btn.contains(e.target)) return;
      this._setOpen(false);
    });

    document.body.appendChild(btn);
    document.body.appendChild(popover);
  }

  _toggleOpen() { this._setOpen(!this._open); }

  _setOpen(open) {
    this._open = !!open;
    this.popover.classList.toggle('hidden', !this._open);
    this.btn.classList.toggle('active', this._open);
    if (this._open) this._sync();
  }

  _sync() {
    const state = audio.getState();
    if (!state) return;

    // Icon reflects mute state
    const iconEl = this.btn.querySelector('.audio-settings-icon');
    if (iconEl) iconEl.textContent = state.muted ? ICON_MUTED : ICON_VOL;
    this.btn.classList.toggle('is-muted', state.muted);

    // Mute toggle state
    this.muteToggle.classList.toggle('is-on', !state.muted);
    this.muteToggle.setAttribute('aria-pressed', state.muted ? 'false' : 'true');

    // Volume slider value
    const pct = Math.round(state.volume * 100);
    this.slider.value = String(pct);
    this.volumeValue.textContent = String(pct);
    this.slider.disabled = state.muted;
    this.popover.classList.toggle('volume-disabled', state.muted);
  }
}
