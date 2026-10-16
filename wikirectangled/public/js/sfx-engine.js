/* SFX engine for WiKirecTangled.
   Self-contained, no dependencies. Web Audio API only.
   Exposes window.SFX with sound library + intensity switcher + mute toggle.

   --- Design philosophy ---
   The whole sonic identity is built around ONE seed sound: cellTap.
   That sound is:
     • Sine fundamental + 1-octave sine overtone (2x, half gain)
     • Pentatonic ladder so every step is consonant (no wrong notes possible)
     • ~15ms highpass-filtered noise micro-click for tactile "snap"
     • 1ms attack, ~60ms decay — never lingers
     • Low gain (~0.05) — sits under the music, never fatigues

   Every other cue is a recombination of those four primitives:
     pentChime(freq, dur, gain)  — sine + 2x overtone (the cellTap voice, sustained)
     snap(intensity)             — the highpass noise click
     pentLadder(notes, gain)     — sequenced chimes climbing the same scale
     soft(freq, dur, gain)       — single-sine voice for hushed events

   Negative events stay on the pentatonic scale but use lower octaves and
   add a soft lowpass-noise puff instead of buzzing sawtooths. The result:
   the game can never sound bad, and every sound feels like family.

   Intensity:  SFX.setIntensity('soft' | 'standard' | 'punchy')
   Mute:       SFX.setMuted(true|false), SFX.toggleMute()
   Persisted in localStorage. Defaults: 'standard', unmuted.
*/
(function () {
  'use strict';

  // ---------- core ----------
  var audioCtx = null;
  var masterGain = null;
  var muted = false;
  var intensity = 'punchy';

  // restore from localStorage
  try {
    muted = localStorage.getItem('wkt-sfx-muted') === '1';
    var p = localStorage.getItem('wkt-sfx-intensity');
    if (p === 'soft' || p === 'standard' || p === 'punchy') intensity = p;
    // legacy migration: old palette key
    var legacy = localStorage.getItem('wkt-sfx-palette');
    if (legacy && !p) {
      try { localStorage.removeItem('wkt-sfx-palette'); } catch (e) {}
    }
  } catch (e) {}

  function ac() {
    if (!audioCtx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.9;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // Intensity scales gain & decay so the personality stays identical;
  // only the loudness/sustain shifts.
  var INTENSITY_SCALE = {
    soft:     { gain: 0.65, decay: 0.85, snap: 0.5 },
    standard: { gain: 1.00, decay: 1.00, snap: 1.0 },
    punchy:   { gain: 1.35, decay: 1.10, snap: 1.4 }
  };
  function gScale() { return INTENSITY_SCALE[intensity].gain; }
  function dScale() { return INTENSITY_SCALE[intensity].decay; }
  function snapScale() { return INTENSITY_SCALE[intensity].snap; }

  // ---------- low-level primitives ----------

  /**
   * Single oscillator tone with ADSR-ish envelope and optional pitch slide.
   * Internal — most code should use the higher-level pent* helpers.
   */
  function _tone(freq, dur, opts) {
    if (muted) return;
    var ctx = ac(); if (!ctx) return;
    opts = opts || {};
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, t0);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur);
    }
    var peak = (opts.gain == null ? 0.05 : opts.gain) * gScale();
    var attack = opts.attack == null ? 0.001 : opts.attack;
    var decay = (opts.decay == null ? dur : opts.decay) * dScale();
    g.gain.setValueAtTime(0.00001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.00001, t0 + attack + decay);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.02);
  }

  /**
   * Filtered noise burst.
   */
  function _noise(dur, opts) {
    if (muted) return;
    var ctx = ac(); if (!ctx) return;
    opts = opts || {};
    var t0 = ctx.currentTime;
    var d = dur * dScale();
    var len = Math.max(1, Math.floor(ctx.sampleRate * (d + 0.05)));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filt = ctx.createBiquadFilter();
    filt.type = opts.type || 'highpass';
    filt.frequency.setValueAtTime(opts.freq || 6000, t0);
    filt.Q.value = opts.q || 1;
    if (opts.sweepTo) {
      filt.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + d);
    }
    var g = ctx.createGain();
    var peak = (opts.gain == null ? 0.02 : opts.gain) * gScale();
    var attack = opts.attack == null ? 0.001 : opts.attack;
    var decay = opts.decay == null ? d : opts.decay * dScale();
    g.gain.setValueAtTime(0.00001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.00001, t0 + attack + decay);
    src.connect(filt);
    filt.connect(g);
    g.connect(masterGain);
    src.start(t0);
    src.stop(t0 + attack + decay + 0.05);
  }

  function delay(ms, fn) { setTimeout(fn, ms); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------- THE PENTATONIC LADDER ----------
  // C major pentatonic across 3 octaves. Every cue — input, reward, fail,
  // finale — pulls notes from this list. Consonance is structural.
  // Indices map to swipe-step climb in cellTap.
  var LADDER = [
    523.25, 587.33, 659.25, 783.99, 880.00,    // C5 D5 E5 G5 A5
    1046.50, 1174.66, 1318.51, 1567.98, 1760.00, // C6 D6 E6 G6 A6
    2093.00, 2349.32, 2637.02, 3135.96, 3520.00  // C7 D7 E7 G7 A7
  ];
  // Lower-octave mirror for negative events (still pentatonic)
  var LADDER_LOW = [
    130.81, 146.83, 164.81, 196.00, 220.00,    // C3 D3 E3 G3 A3
    261.63, 293.66, 329.63, 392.00, 440.00     // C4 D4 E4 G4 A4
  ];
  function ladderFreq(stepIndex) {
    var i = clamp(stepIndex || 0, 0, LADDER.length - 1);
    return LADDER[i];
  }

  // ---------- THE SIGNATURE VOICE: pentChime ----------
  // This IS the cellTap voice, just sustained longer for rewards.
  // Sine fundamental + half-gain octave overtone. Bell-like. Friendly.
  function pentChime(freq, dur, gain) {
    gain = gain == null ? 0.05 : gain;
    _tone(freq, dur, { type: 'sine', gain: gain, attack: 0.001, decay: dur });
    _tone(freq * 2, dur * 0.85, { type: 'sine', gain: gain * 0.5, attack: 0.001, decay: dur * 0.85 });
  }

  // ---------- THE TACTILE LAYER: snap ----------
  // The high-frequency noise click that gives every input "physicality".
  // intensity: 0..1 multiplier on top of global intensity scale.
  function snap(intensityMul) {
    var m = (intensityMul == null ? 1 : intensityMul) * snapScale();
    _noise(0.015, { type: 'highpass', freq: 6000, gain: 0.02 * m, decay: 0.012 });
  }

  // ---------- LADDER SEQUENCING ----------
  // Climb up or arpeggiate selected pentatonic indices. Used by every
  // reward and finale cue so they all feel related to cellTap.
  function pentSequence(indices, stepMs, dur, gain) {
    indices.forEach(function (idx, i) {
      delay(i * stepMs, function () {
        pentChime(LADDER[clamp(idx, 0, LADDER.length - 1)], dur, gain);
      });
    });
  }

  // ---------- THE SOFT VOICE: just the fundamental ----------
  // For hushed events — countdown, tooShort, alreadyFound.
  function pentSoft(freq, dur, gain) {
    _tone(freq, dur, { type: 'sine', gain: gain, attack: 0.001, decay: dur });
  }

  // ---------- LOW PENTATONIC: for negatives ----------
  // Stays in the same scale family so misses don't sound "wrong",
  // they sound "low and small" — friendly nudge, not punishment.
  function pentLow(idx, dur, gain) {
    var i = clamp(idx, 0, LADDER_LOW.length - 1);
    var f = LADDER_LOW[i];
    _tone(f, dur, { type: 'sine', gain: gain, attack: 0.002, decay: dur });
    _tone(f * 2, dur * 0.7, { type: 'sine', gain: gain * 0.4, attack: 0.002, decay: dur * 0.7 });
  }

  // ---------- SPARKLE: random highnotes from the ladder ----------
  // For finales and big rewards. Pulls only from upper ladder so
  // sparkles stay consonant with whatever played before.
  function sparkle(count, gain, spreadMs) {
    spreadMs = spreadMs || 30;
    for (var i = 0; i < count; i++) {
      (function () {
        var when = Math.random() * spreadMs * count;
        var idx = 8 + Math.floor(Math.random() * 7); // upper-ladder only
        delay(when, function () {
          pentSoft(LADDER[idx], 0.10, gain);
        });
      })();
    }
  }

  // =========================================================================
  // SOUND LIBRARY
  // =========================================================================

  var sounds = {

    // ---------- INPUT ----------
    // The seed. Every other sound is built from this.
    cellTap: function (step) {
      var f = ladderFreq(step);
      _tone(f, 0.07, { type: 'sine', gain: 0.05, attack: 0.001, decay: 0.06 });
      _tone(f * 2, 0.05, { type: 'sine', gain: 0.025, attack: 0.001, decay: 0.04 });
      snap(1);
    },

    swipeSubmit: function () {
      // Quick double-chime up the ladder + bigger snap. Says "released".
      pentChime(LADDER[5], 0.10, 0.06);   // C6
      delay(45, function () { pentChime(LADDER[7], 0.12, 0.07); }); // E6
      snap(1.6);
    },

    swipeClear: function () {
      // Path auto-cleared — finger lifted on nothing, or path canceled.
      // Quietest of the input cues. "Nothing happened."
      pentSoft(LADDER[2], 0.07, 0.025);   // E5
      snap(0.4);
    },

    swipeInvalid: function () {
      // Submitted word that isn't a real word (not in dictionary).
      // Distinct from `incorrect` (real word, just wrong target):
      //   - has a snap so it still feels like a deliberate release
      //   - descending low-pentatonic dyad: small nudge, friendly
      //   - lowpass puff at the end so it dissolves rather than dings
      snap(1.0);
      pentLow(3, 0.14, 0.06);             // G3
      delay(55, function () { pentLow(1, 0.16, 0.05); }); // D3
      _noise(0.08, { type: 'lowpass', freq: 800, gain: 0.03 * gScale(), decay: 0.07 });
    },

    tooShort: function () {
      // Single soft fundamental, no overtone, no snap. Barely there.
      pentSoft(LADDER[5], 0.06, 0.025);
    },

    // ---------- GUESS RESULTS ----------

    correctCommon: function () {
      // Two-note pentatonic chime, a fifth apart. The "correct" prototype.
      pentChime(LADDER[5], 0.20, 0.08);   // C6
      delay(50, function () { pentChime(LADDER[8], 0.18, 0.06); }); // G6
      snap(0.8);
    },

    correctRare: function () {
      // Three-note arpeggio + a sparkle dust at the top. Brighter.
      pentSequence([5, 7, 10], 60, 0.22, 0.09); // C6 E6 C7
      delay(220, function () { sparkle(3, 0.04, 20); });
      snap(1.0);
    },

    correctTitle: function () {
      // The "unlock". Full ascending pentatonic run + sparkle cascade.
      // Same family as cellTap climbing — just longer, taller, with overtones.
      pentSequence([0, 2, 4, 5, 7, 9, 10], 55, 0.25, 0.10);
      delay(440, function () {
        pentChime(LADDER[12], 0.55, 0.11); // E7 capstone
        sparkle(7, 0.045, 18);
      });
      _noise(0.45, { type: 'highpass', freq: 5500, gain: 0.025 * gScale(), decay: 0.42 });
      snap(1.4);
    },

    correctThree: function () {
      // Single chime, lower octave. Polite.
      pentChime(LADDER[2], 0.10, 0.05);   // E5
      snap(0.5);
    },

    incorrect: function () {
      // Low pentatonic dyad + soft lowpass puff. Stays in-key —
      // sounds small, not wrong.
      pentLow(2, 0.14, 0.05);             // E3
      pentLow(0, 0.12, 0.04);             // C3
      _noise(0.06, { type: 'lowpass', freq: 600, gain: 0.025 * gScale(), decay: 0.05 });
    },

    missInArticle: function () {
      // Two close-together low notes — "almost". Yellow-aligned.
      pentLow(4, 0.16, 0.05);             // A3
      delay(40, function () { pentLow(3, 0.16, 0.04); }); // G3
      _noise(0.08, { type: 'lowpass', freq: 1200, gain: 0.02 * gScale(), decay: 0.07 });
    },

    alreadyFound: function () {
      // Tight wood-block via bandpass-snap + single chime. Teal-aligned, informational.
      _noise(0.04, { type: 'bandpass', freq: 1500, q: 12, gain: 0.05 * gScale(), decay: 0.035 });
      pentSoft(LADDER[8], 0.05, 0.03);    // G6
    },

    // ---------- ROUND LIFECYCLE ----------

    roundStart: function () {
      // Curtain-up: lowpass noise sweep + welcoming pentatonic pair.
      _noise(0.55, {
        type: 'lowpass', freq: 200, sweepTo: 5000,
        gain: 0.05 * gScale(), decay: 0.5, attack: 0.04
      });
      delay(180, function () { pentChime(LADDER[2], 0.28, 0.07); }); // E5
      delay(330, function () { pentChime(LADDER[6], 0.32, 0.07); }); // D6
      delay(480, function () { sparkle(2, 0.03, 25); });
    },

    roundEnd: function () {
      // The big finale. Full ladder run + capstone + sparkle cascade.
      pentSequence([0, 2, 4, 5, 7, 9, 10, 12], 70, 0.20, 0.09);
      delay(8 * 70, function () {
        pentChime(LADDER[14], 0.6, 0.12); // A7 capstone
        sparkle(11, 0.045, 16);
        _noise(0.6, { type: 'highpass', freq: 5000, gain: 0.04 * gScale(), decay: 0.55 });
      });
      snap(1.2);
    },

    titleRevealAll: function () {
      // Sub-bass sine drop + upper sparkle shimmer. Rare event, big.
      // Bass slides through the lower pentatonic.
      _tone(LADDER_LOW[0], 0.7, {
        type: 'sine', gain: 0.13, attack: 0.005, decay: 0.65,
        slideTo: LADDER_LOW[0] * 0.5
      });
      _tone(LADDER_LOW[2], 0.5, {
        type: 'sine', gain: 0.05, attack: 0.005, decay: 0.45,
        slideTo: LADDER_LOW[0]
      });
      _noise(0.55, {
        type: 'lowpass', freq: 1200, sweepTo: 200,
        gain: 0.06 * gScale(), decay: 0.5
      });
      delay(140, function () { sparkle(8, 0.04, 22); });
      delay(180, function () { pentChime(LADDER[10], 0.45, 0.08); }); // C7
    },

    countdownTick: function () {
      // Just the soft voice + a whisper of snap. Metronome-quiet.
      pentSoft(LADDER[8], 0.04, 0.035);   // G6
      _noise(0.01, { type: 'highpass', freq: 7000, gain: 0.012 * gScale(), decay: 0.008 });
    },

    // ---------- SCORE & RANK ----------

    targetCardPop: function () {
      // Cork-pop: pitch jump + bandpass snap + a sparkle dust mote.
      _tone(LADDER[3], 0.10, {
        type: 'sine', gain: 0.07, attack: 0.001, decay: 0.09,
        slideTo: LADDER[10]
      });
      _noise(0.04, { type: 'bandpass', freq: 3000, q: 4, gain: 0.03 * gScale(), decay: 0.035 });
      delay(50, function () { sparkle(2, 0.025, 18); });
    },

    scoreAnnounce: function () {
      // Coin chime: two ascending bell pings up the upper ladder.
      pentChime(LADDER[8], 0.14, 0.07);   // G6
      delay(55, function () { pentChime(LADDER[11], 0.12, 0.06); }); // D7
    },

    podiumCoronation: function () {
      // Brassy stinger reimagined as pentatonic chimes — same family,
      // bigger gain, longer decay. Triumphant without leaving the world.
      pentSequence([0, 2, 5, 7, 10], 90, 0.28, 0.10);
      delay(450, function () {
        pentChime(LADDER[12], 0.55, 0.11);
        sparkle(5, 0.04, 22);
        _noise(0.35, { type: 'highpass', freq: 4500, gain: 0.03 * gScale(), decay: 0.32 });
      });
    },

    // ---------- SOLO ----------

    soloStart: function () {
      // Welcoming chime pair, sparkle dust. Same shape as roundStart but
      // shorter and more personal.
      pentChime(LADDER[5], 0.20, 0.08);   // C6
      delay(80, function () { pentChime(LADDER[8], 0.24, 0.07); }); // G6
      delay(180, function () { sparkle(2, 0.03, 22); });
      snap(0.7);
    },

    dailyPb: function () {
      // Standard finale + a dense sparkle cascade in the very top octave.
      // Says "you did the thing — and then some".
      sounds.roundEnd();
      delay(380, function () { sparkle(13, 0.05, 14); });
      delay(580, function () { pentChime(LADDER[12], 0.7, 0.10); }); // E7
      delay(720, function () { pentChime(LADDER[14], 0.7, 0.09); }); // A7
    }
  };

  // ---------- public API ----------
  window.SFX = {
    sounds: sounds,
    intensities: ['soft', 'standard', 'punchy'],
    setIntensity: function (p) {
      if (!INTENSITY_SCALE[p]) return;
      intensity = p;
      try { localStorage.setItem('wkt-sfx-intensity', p); } catch (e) {}
    },
    getIntensity: function () { return intensity; },
    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem('wkt-sfx-muted', muted ? '1' : '0'); } catch (e) {}
    },
    isMuted: function () { return muted; },
    toggleMute: function () { window.SFX.setMuted(!muted); return muted; },

    // expose primitives so designers can audition / build new cues live
    _tone: _tone,
    _noise: _noise,
    _pentChime: pentChime,
    _snap: snap,
    _sparkle: sparkle,
    _ac: ac,
    LADDER: LADDER,
    LADDER_LOW: LADDER_LOW
  };
})();
