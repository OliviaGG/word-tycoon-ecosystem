// ===== Audio Bridge =====
// Thin wrapper around the standalone /audio.js drop-in (Claude Design's
// Vapor synth pack). Handles:
//   - Gesture-gated audio context unlock (Web Audio API requirement)
//   - Mute toggle (master gain → 0 immediately, no ramp)
//   - Volume slider (perceptual curve handled inside SearchleAudio)
//   - localStorage persistence for both settings
//
// audio.js is loaded as a regular <script> in index.html / sp.html and
// exposes window.SearchleAudio. This module imports nothing from it —
// it just calls the global at runtime.

const PACK = 'synthwave-vapor';
const STORAGE_KEY = 'searchle.audio';

const DEFAULT_STATE = Object.freeze({
  muted: false,
  volume: 0.65,
});

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}
function _save(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* private browsing / disabled storage — silently skip */ }
}

let _state = { ...DEFAULT_STATE, ..._load() };
let _unlocked = false;

function _hasBridge() {
  return typeof window !== 'undefined' && !!window.SearchleAudio;
}

function _applyMaster() {
  if (!_hasBridge()) return;
  try {
    window.SearchleAudio.setMaster(_state.muted ? 0 : _state.volume);
  } catch (e) {
    // SearchleAudio not fully ready yet — that's fine, will retry on next setter
  }
}

// Bootstrap the audio context on the first user gesture. Web Audio API
// requires this in every modern browser; calls before unlock are silent.
function _bootstrap() {
  if (_unlocked) return;
  _unlocked = true;
  if (!_hasBridge()) return;
  try {
    if (typeof window.SearchleAudio.init === 'function') window.SearchleAudio.init();
    if (typeof window.SearchleAudio.resume === 'function') window.SearchleAudio.resume();
  } catch {}
  _applyMaster();
}

if (typeof window !== 'undefined') {
  ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, _bootstrap, { once: true, passive: true });
  });
  // Apply master eagerly so when the context unlocks the gain is already set.
  // SearchleAudio may not be defined yet on first script eval — we retry on
  // each setter call, and the bootstrap re-applies after unlock.
  setTimeout(_applyMaster, 0);
}

// Public surface
export const audio = {
  /**
   * Play a single Vapor-pack cue.
   * Silent (no-op) while muted, before gesture unlock, or if the audio.js
   * module hasn't loaded yet.
   */
  play(soundId) {
    if (!soundId) return;
    if (_state.muted) return;
    if (!_unlocked) return;
    if (!_hasBridge()) return;
    try { window.SearchleAudio.play(PACK, soundId); }
    catch { /* malformed cue id or audio.js internal error — drop it */ }
  },

  /**
   * Set master volume in [0, 1]. Persisted.
   */
  setVolume(v) {
    const clamped = Math.max(0, Math.min(1, Number(v) || 0));
    _state.volume = clamped;
    _applyMaster();
    _save(_state);
  },

  /**
   * Toggle mute. Persisted.
   */
  setMuted(m) {
    _state.muted = !!m;
    _applyMaster();
    _save(_state);
  },

  /** Current { muted, volume } snapshot. */
  getState() { return { ..._state }; },

  /** True once the audio context has been unlocked by a user gesture. */
  isUnlocked() { return _unlocked; },
};

// Default export for convenience
export default audio;
