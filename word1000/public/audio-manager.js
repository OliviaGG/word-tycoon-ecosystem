// audio-manager.js — Procedural sound effects for Word500 2.0
// Web Audio API with synthesized sounds (no external audio files needed)

(function () {
  'use strict';

  var AudioManager = {
    ctx: null,
    muted: false,
    volume: 0.3,
    _initialized: false,

    init: function () {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this._initialized = true;

        // Load mute state
        var saved = localStorage.getItem('word500_audio_muted');
        if (saved === 'true') this.muted = true;

        // Resume context on user interaction (required by browsers)
        var self = this;
        var resume = function () {
          if (self.ctx && self.ctx.state === 'suspended') {
            self.ctx.resume();
          }
          document.removeEventListener('click', resume);
          document.removeEventListener('keydown', resume);
        };
        document.addEventListener('click', resume);
        document.addEventListener('keydown', resume);

        console.log('[AudioManager] Initialized');
      } catch (e) {
        console.warn('[AudioManager] Web Audio API not available');
      }
    },

    toggleMute: function () {
      this.muted = !this.muted;
      localStorage.setItem('word500_audio_muted', this.muted.toString());
      return this.muted;
    },

    setVolume: function (v) {
      this.volume = Math.max(0, Math.min(1, v));
    },

    // ─── Sound Generators ──────────────────────────────
    play: function (sound) {
      if (!this._initialized || this.muted || !this.ctx) return;
      if (this.ctx.state === 'suspended') return;

      switch (sound) {
        case 'win': this._playWinFanfare(); break;
      }
    },

    // Victory fanfare (ascending notes)
    _playWinFanfare: function () {
      var ctx = this.ctx;
      var now = ctx.currentTime;
      var notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
      var self = this;

      notes.forEach(function (freq, i) {
        var t = now + i * 0.15;
        var gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(self.volume * 0.3, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + 0.4);
      });

      // Sustain on last note
      var lastT = now + notes.length * 0.15;
      var sustainGain = ctx.createGain();
      sustainGain.connect(ctx.destination);
      sustainGain.gain.setValueAtTime(self.volume * 0.2, lastT);
      sustainGain.gain.exponentialRampToValueAtTime(0.001, lastT + 0.8);

      var sustainOsc = ctx.createOscillator();
      sustainOsc.type = 'triangle';
      sustainOsc.frequency.setValueAtTime(1047, lastT);
      sustainOsc.connect(sustainGain);
      sustainOsc.start(lastT);
      sustainOsc.stop(lastT + 0.8);
    },

  };

  // Initialize
  AudioManager.init();
  window.AudioManager = AudioManager;
})();
