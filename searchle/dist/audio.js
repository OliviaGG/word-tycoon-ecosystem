// Searchle sound system — Web Audio synthesis engine.
// All 60 sounds (5 packs × 12 events) are procedurally generated.
// No samples, no network — each function schedules oscillators + noise + envelopes.

(() => {
  let ctx, master, reverbInput, synthwaveBus;

  function init() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setMaster(v) { if (master) master.gain.value = Math.pow(v, 1.5); }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Cached noise buffer — re-used to avoid reallocating on every shot.
  let noiseBuf;
  function getNoise(dur) {
    const need = Math.ceil(ctx.sampleRate * Math.max(dur, 2));
    if (!noiseBuf || noiseBuf.length < need) {
      noiseBuf = ctx.createBuffer(1, need, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Generic oscillator with quick attack + exponential decay envelope.
  // freq can be a number, or a function (osc, startTime) for sweeps.
  function osc(type, freq, t, dur, peak, attack, dest) {
    attack = attack ?? 0.004;
    dest = dest || master;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    if (typeof freq === 'function') freq(o, t);
    else o.frequency.setValueAtTime(freq, t);
    o.connect(g).connect(dest);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
    return { o, g };
  }

  // Sustained tone with explicit ADSR-ish shape (for pads / longer notes).
  function pad(type, freq, t, attack, hold, release, peak, dest) {
    dest = dest || master;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    if (typeof freq === 'function') freq(o, t);
    else o.frequency.setValueAtTime(freq, t);
    o.connect(g).connect(dest);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.start(t);
    o.stop(t + attack + hold + release + 0.05);
    return { o, g };
  }

  function noise(t, dur, peak, type, freq, q, dest) {
    dest = dest || master;
    const src = ctx.createBufferSource();
    src.buffer = getNoise(dur + 0.1);
    let node = src;
    if (type) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t);
      if (q != null) f.Q.value = q;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    node.connect(g).connect(dest);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.1);
    return { src, g };
  }

  // Filter-swept noise — different start/end frequencies on a bandpass.
  function sweepNoise(t, dur, peak, type, fStart, fEnd, q, dest) {
    dest = dest || master;
    const src = ctx.createBufferSource();
    src.buffer = getNoise(dur + 0.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(fStart, t);
    f.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    if (q != null) f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(dest);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  // Bell — additive synthesis of inharmonic partials.
  function bell(t, baseM, peak, dur, dest) {
    const partials = [
      { ratio: 1.0, gain: 1.0, decay: 1.0 },
      { ratio: 2.01, gain: 0.5, decay: 0.7 },
      { ratio: 3.0, gain: 0.3, decay: 0.45 },
      { ratio: 4.2, gain: 0.18, decay: 0.3 },
    ];
    const base = mtof(baseM);
    partials.forEach((p) => {
      osc('sine', base * p.ratio, t, dur * p.decay, peak * p.gain, 0.001, dest);
    });
  }

  // Saw with lowpass filter sweep + envelope.
  function sweepSaw(t, m, dur, peak, fStart, fEnd, q, dest) {
    dest = dest || master;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = mtof(m);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(fStart, t);
    f.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    f.Q.value = q ?? 4;
    o.connect(f).connect(g).connect(dest);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function getReverb() {
    if (reverbInput) return reverbInput;
    const len = ctx.sampleRate * 1.6;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    conv.connect(wet).connect(master);
    reverbInput = conv;
    return conv;
  }

  // Synthwave bus: parallel dry + wet send into reverb.
  function getSynthwaveBus() {
    if (synthwaveBus) return synthwaveBus;
    const input = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    input.connect(dry).connect(master);
    input.connect(wet).connect(getReverb());
    synthwaveBus = input;
    return input;
  }

  // ====================== PACK 1: POLISHED GAME SHOW ======================
  const gameshow = {
    'guess-cold': (t) => {
      osc('sine', mtof(60), t, 0.13, 0.28);
      osc('triangle', mtof(72), t, 0.06, 0.07);
    },
    'guess-warm': (t) => {
      osc('sine', mtof(60), t, 0.13, 0.26);
      osc('triangle', mtof(72), t, 0.06, 0.06);
      osc('sine', mtof(65), t + 0.13, 0.16, 0.30);
      osc('triangle', mtof(77), t + 0.13, 0.08, 0.07);
    },
    'guess-hot': (t) => {
      [60, 64, 67, 72].forEach((m) => {
        osc('sawtooth', mtof(m), t, 0.32, 0.09);
        osc('square', mtof(m), t, 0.18, 0.025);
      });
      noise(t + 0.05, 0.42, 0.05, 'bandpass', 700, 3.5);
    },
    'guess-blazing': (t) => {
      [60, 64, 67].forEach((m) => {
        osc('sawtooth', mtof(m), t, 0.5, 0.12);
        osc('triangle', mtof(m + 12), t, 0.45, 0.05);
      });
      osc((o, t0) => {
        o.frequency.setValueAtTime(mtof(67), t0);
        o.frequency.exponentialRampToValueAtTime(mtof(86), t0 + 0.5);
      }, null, t + 0.12, 0.48, 0.16);
      noise(t, 0.6, 0.05, 'bandpass', 800, 2.5);
    },
    'target-found': (t) => {
      // Arpeggio entrance
      [60, 64, 67, 72, 76, 79].forEach((m, i) => {
        const tt = t + i * 0.075;
        osc('sawtooth', mtof(m), tt, 0.22, 0.11);
        osc('triangle', mtof(m), tt, 0.18, 0.07);
      });
      // Sustained chord
      [60, 64, 67, 72, 79].forEach((m) => {
        pad('sawtooth', mtof(m), t + 0.55, 0.02, 0.7, 0.7, 0.07);
        pad('triangle', mtof(m + 12), t + 0.55, 0.02, 0.7, 0.7, 0.04);
      });
      // Cymbal crash
      noise(t + 0.55, 1.6, 0.18, 'highpass', 4500);
      noise(t + 0.55, 1.3, 0.07, 'bandpass', 8000, 0.8);
      // Crowd
      sweepNoise(t + 0.3, 1.7, 0.06, 'bandpass', 600, 1200, 1.8);
    },
    'xp-award': (t) => {
      bell(t, 84, 0.18, 0.16);
      bell(t + 0.08, 79, 0.16, 0.28);
    },
    'xp-tier-bonus': (t) => {
      [79, 84, 88].forEach((m, i) => bell(t + i * 0.18, m, 0.20, 0.5));
    },
    'round-start': (t) => {
      sweepNoise(t, 0.45, 0.09, 'bandpass', 400, 1200, 1.2);
      [60, 65, 72].forEach((m, i) => {
        const tt = t + 0.05 + i * 0.18;
        osc('sawtooth', mtof(m), tt, 0.35, 0.13);
        osc('sawtooth', mtof(m + 7), tt, 0.35, 0.07);
      });
      osc('sawtooth', mtof(72), t + 0.60, 0.30, 0.18);
      osc('sawtooth', mtof(79), t + 0.60, 0.30, 0.12);
    },
    'round-timeout': (t) => {
      osc('sawtooth', mtof(65), t, 0.30, 0.13);
      osc('triangle', mtof(65 + 12), t, 0.30, 0.06);
      osc('sawtooth', mtof(60), t + 0.32, 0.40, 0.13);
      osc('triangle', mtof(60 + 12), t + 0.32, 0.40, 0.06);
    },
    'ui-click': (t) => {
      noise(t, 0.035, 0.18, 'highpass', 2200);
      osc('triangle', mtof(74), t, 0.03, 0.05);
    },
    'drawer-toggle': (t) => {
      sweepNoise(t, 0.13, 0.06, 'bandpass', 2000, 3500, 0.7);
      noise(t + 0.13, 0.035, 0.16, 'highpass', 1800);
    },
    'guess-bump': (t) => {
      for (const ts of [t, t + 0.07]) {
        noise(ts, 0.05, 0.22, 'bandpass', 4200, 2);
        osc('triangle', mtof(76), ts, 0.04, 0.08);
      }
    },
  };

  // ====================== PACK 2: COZY ASMR ======================
  const asmr = {
    'guess-cold': (t) => {
      osc('sine', mtof(55), t, 0.11, 0.30);
      noise(t, 0.025, 0.05, 'lowpass', 350);
    },
    'guess-warm': (t) => {
      [55, 60].forEach((m, i) => {
        osc('sine', mtof(m), t + i * 0.10, 0.11, 0.28);
        noise(t + i * 0.10, 0.025, 0.04, 'lowpass', 350);
      });
    },
    'guess-hot': (t) => {
      [62, 67, 71].forEach((m, i) => {
        osc('triangle', mtof(m), t + i * 0.10, 0.26, 0.17);
        osc('sine', mtof(m + 12), t + i * 0.10, 0.22, 0.06);
      });
    },
    'guess-blazing': (t) => {
      [62, 67, 71, 74, 79].forEach((m, i) => {
        osc('triangle', mtof(m), t + i * 0.07, 0.30, 0.16);
        osc('sine', mtof(m + 12), t + i * 0.07, 0.26, 0.06);
      });
      [86, 88, 91].forEach((m, i) => {
        osc('sine', mtof(m), t + 0.30 + i * 0.05, 0.30, 0.05);
      });
    },
    'target-found': (t) => {
      const chimes = [76, 79, 81, 83, 86, 88, 91, 95, 98];
      chimes.forEach((m, i) => {
        osc('sine', mtof(m), t + i * 0.07, 0.8 + Math.random() * 0.3, 0.06 + Math.random() * 0.03);
      });
      [55, 62, 67, 71].forEach((m) => {
        pad('triangle', mtof(m), t + 0.25, 0.25, 1.0, 0.6, 0.05);
      });
      bell(t + 1.0, 67, 0.12, 1.0);
    },
    'xp-award': (t) => {
      osc('sine', mtof(72), t, 0.22, 0.28);
      osc('sine', mtof(84), t, 0.16, 0.07);
    },
    'xp-tier-bonus': (t) => {
      [67, 72, 76].forEach((m, i) => {
        osc('sine', mtof(m), t + i * 0.18, 0.30, 0.26);
        osc('sine', mtof(m + 12), t + i * 0.18, 0.24, 0.07);
      });
      [88, 91].forEach((m, i) => {
        osc('sine', mtof(m), t + 0.42 + i * 0.05, 0.28, 0.05);
      });
    },
    'round-start': (t) => {
      noise(t, 0.18, 0.05, 'bandpass', 1800, 1);
      [60, 64, 67].forEach((m, i) => {
        osc('triangle', mtof(m), t + 0.10 + i * 0.30, 0.40, 0.11, 0.05);
      });
    },
    'round-timeout': (t) => {
      osc('triangle', mtof(55), t, 0.70, 0.16, 0.05);
      osc('sine', mtof(67), t, 0.70, 0.05, 0.05);
    },
    'ui-click': (t) => {
      noise(t, 0.025, 0.12, 'bandpass', 1500, 2);
      osc('sine', mtof(70), t, 0.03, 0.07);
    },
    'drawer-toggle': (t) => {
      sweepNoise(t, 0.18, 0.07, 'bandpass', 600, 1400, 0.9);
    },
    'guess-bump': (t) => {
      osc('triangle', mtof(48), t, 0.10, 0.22);
      noise(t, 0.05, 0.04, 'lowpass', 500);
    },
  };

  // ====================== PACK 3: MINIMAL / MODERN APP ======================
  const minimal = {
    'guess-cold': (t) => {
      noise(t, 0.06, 0.11, 'lowpass', 700);
      osc('sine', mtof(60), t, 0.06, 0.07);
    },
    'guess-warm': (t) => {
      noise(t, 0.05, 0.10, 'lowpass', 700);
      osc('sine', mtof(60), t, 0.05, 0.06);
      noise(t + 0.10, 0.05, 0.10, 'lowpass', 1100);
      osc('sine', mtof(65), t + 0.10, 0.05, 0.06);
    },
    'guess-hot': (t) => {
      noise(t, 0.05, 0.12, 'lowpass', 1500);
      osc('sine', mtof(67), t, 0.07, 0.08);
      sweepNoise(t + 0.05, 0.25, 0.04, 'bandpass', 1500, 4000, 1);
    },
    'guess-blazing': (t) => {
      bell(t, 84, 0.16, 0.5);
      osc('sine', mtof(91), t + 0.08, 0.35, 0.04);
    },
    'target-found': (t) => {
      [72, 76, 79].forEach((m, i) => {
        osc('sine', mtof(m), t + i * 0.22, 0.55, 0.12);
        osc('sine', mtof(m + 12), t + i * 0.22, 0.40, 0.05);
      });
      [60, 67, 72].forEach((m) => {
        pad('triangle', mtof(m), t + 0.35, 0.20, 0.5, 0.5, 0.06);
      });
    },
    'xp-award': (t) => {
      osc('sine', mtof(84), t, 0.18, 0.16);
      osc('sine', mtof(91), t, 0.12, 0.05);
    },
    'xp-tier-bonus': (t) => {
      osc('sine', mtof(84), t, 0.40, 0.16);
      osc('sine', mtof(96), t, 0.30, 0.09);
      osc('sine', mtof(91), t + 0.08, 0.32, 0.07);
    },
    'round-start': (t) => {
      sweepNoise(t, 0.45, 0.06, 'bandpass', 500, 1500, 0.6);
      [48, 55].forEach((m) => {
        pad('triangle', mtof(m), t + 0.18, 0.18, 0.30, 0.30, 0.07);
      });
    },
    'round-timeout': (t) => {
      [60, 55, 48].forEach((m, i) => {
        pad('triangle', mtof(m), t + i * 0.14, 0.05, 0.10, 0.30, 0.07);
      });
    },
    'ui-click': (t) => {
      noise(t, 0.025, 0.10, 'highpass', 1500);
    },
    'drawer-toggle': (t) => {
      sweepNoise(t, 0.10, 0.05, 'bandpass', 1500, 3000, 0.7);
      noise(t + 0.08, 0.025, 0.09, 'highpass', 1500);
    },
    'guess-bump': (t) => {
      noise(t, 0.025, 0.10, 'bandpass', 1500, 1.5);
      noise(t + 0.06, 0.025, 0.10, 'bandpass', 1500, 1.5);
    },
  };

  // ====================== PACK 4: ARCADE / 8-BIT ======================
  const arcade = {
    'guess-cold': (t) => osc('square', mtof(55), t, 0.09, 0.14),
    'guess-warm': (t) => {
      osc('square', mtof(60), t, 0.09, 0.14);
      osc('square', mtof(65), t + 0.11, 0.09, 0.14);
    },
    'guess-hot': (t) => {
      [60, 64, 67, 72].forEach((m, i) => {
        osc('square', mtof(m), t + i * 0.07, 0.07, 0.14);
      });
    },
    'guess-blazing': (t) => {
      osc((o, t0) => {
        o.frequency.setValueAtTime(mtof(60), t0);
        o.frequency.exponentialRampToValueAtTime(mtof(84), t0 + 0.45);
      }, null, t, 0.50, 0.16);
      osc('square', mtof(91), t + 0.48, 0.10, 0.12);
    },
    'target-found': (t) => {
      // Original chiptune fanfare — not Nintendo's.
      const m = [
        [72, 0.12], [76, 0.12], [79, 0.12], [84, 0.24],
        [79, 0.12], [84, 0.40],
      ];
      let tt = t;
      m.forEach(([note, d]) => {
        osc('square', mtof(note), tt, d * 0.92, 0.16);
        osc('triangle', mtof(note - 12), tt, d * 0.92, 0.10);
        tt += d;
      });
    },
    'xp-award': (t) => {
      osc('square', mtof(83), t, 0.08, 0.14);
      osc('square', mtof(90), t + 0.08, 0.16, 0.14);
    },
    'xp-tier-bonus': (t) => {
      [79, 83, 86, 88, 91].forEach((m, i) => {
        osc('square', mtof(m), t + i * 0.10, 0.08, 0.14);
      });
    },
    'round-start': (t) => {
      [67, 72, 79].forEach((m, i) => {
        osc('square', mtof(m), t + i * 0.22, 0.18, 0.14);
      });
    },
    'round-timeout': (t) => {
      [64, 62, 60, 57].forEach((m, i) => {
        osc('square', mtof(m), t + i * 0.18, 0.18, 0.14);
        osc('triangle', mtof(m - 12), t + i * 0.18, 0.18, 0.08);
      });
    },
    'ui-click': (t) => osc('square', mtof(84), t, 0.04, 0.14),
    'drawer-toggle': (t) => {
      osc('square', mtof(72), t, 0.05, 0.12);
      noise(t + 0.05, 0.05, 0.08, 'highpass', 4000);
      osc('square', mtof(79), t + 0.10, 0.05, 0.12);
    },
    'guess-bump': (t) => {
      osc('triangle', mtof(48), t, 0.06, 0.18);
      noise(t, 0.03, 0.10, 'highpass', 3000);
    },
  };

  // ====================== PACK 5: FUTURISTIC / SYNTHWAVE ======================
  const synthwave = {
    'guess-cold': (t) => {
      const d = getSynthwaveBus();
      osc('sine', mtof(72), t, 0.12, 0.16, 0.002, d);
      osc('triangle', mtof(84), t, 0.08, 0.05, 0.002, d);
    },
    'guess-warm': (t) => {
      const d = getSynthwaveBus();
      osc('sine', mtof(72), t, 0.10, 0.14, 0.002, d);
      osc('sine', mtof(77), t + 0.12, 0.16, 0.17, 0.002, d);
    },
    'guess-hot': (t) => {
      const d = getSynthwaveBus();
      sweepSaw(t, 72, 0.40, 0.13, 400, 4000, 8, d);
      sweepNoise(t + 0.05, 0.30, 0.04, 'highpass', 2000, 6000, 1, d);
    },
    'guess-blazing': (t) => {
      const d = getSynthwaveBus();
      osc((o, t0) => {
        o.frequency.setValueAtTime(mtof(60), t0);
        o.frequency.exponentialRampToValueAtTime(mtof(96), t0 + 0.4);
      }, null, t, 0.45, 0.13, 0.002, d);
      sweepNoise(t + 0.30, 0.25, 0.06, 'highpass', 6000, 9000, 1, d);
    },
    'target-found': (t) => {
      const d = getSynthwaveBus();
      [60, 64, 67, 72, 76].forEach((m) => {
        sweepSaw(t, m, 1.8, 0.07, 500, 7000, 3, d);
      });
      // Reverse-cymbal wash (rising noise)
      const src = ctx.createBufferSource();
      src.buffer = getNoise(1.0);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 4500;
      const g = ctx.createGain();
      src.connect(f).connect(g).connect(d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      src.start(t); src.stop(t + 1.05);
      noise(t + 0.8, 0.5, 0.18, 'highpass', 3000, null, d);
    },
    'xp-award': (t) => {
      const d = getSynthwaveBus();
      osc('sine', mtof(88), t, 0.26, 0.14, 0.002, d);
      osc('sine', mtof(95), t, 0.20, 0.06, 0.002, d);
    },
    'xp-tier-bonus': (t) => {
      const d = getSynthwaveBus();
      [84, 88, 91].forEach((m, i) => {
        osc('sine', mtof(m), t + i * 0.18, 0.40, 0.14, 0.002, d);
        osc('sine', mtof(m + 12), t + i * 0.18, 0.30, 0.06, 0.002, d);
      });
    },
    'round-start': (t) => {
      const d = getSynthwaveBus();
      [48, 55, 60].forEach((m) => {
        const o = ctx.createOscillator();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        f.type = 'lowpass';
        f.frequency.setValueAtTime(400, t);
        f.frequency.exponentialRampToValueAtTime(3500, t + 0.7);
        o.connect(f).connect(g).connect(d);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.07, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
        o.start(t); o.stop(t + 1.0);
      });
      for (let i = 0; i < 6; i++) {
        const m = 72 + Math.floor(Math.random() * 12);
        osc('square', mtof(m), t + 0.25 + Math.random() * 0.5, 0.04, 0.05, 0.002, d);
      }
    },
    'round-timeout': (t) => {
      const d = getSynthwaveBus();
      sweepSaw(t, 48, 0.75, 0.12, 3000, 180, 2, d);
    },
    'ui-click': (t) => {
      const d = getSynthwaveBus();
      noise(t, 0.03, 0.10, 'bandpass', 2200, 2, d);
      osc('triangle', mtof(84), t, 0.04, 0.06, 0.002, d);
    },
    'drawer-toggle': (t) => {
      const d = getSynthwaveBus();
      sweepNoise(t, 0.18, 0.09, 'bandpass', 800, 3000, 3.5, d);
      osc('triangle', mtof(84), t + 0.14, 0.04, 0.07, 0.002, d);
    },
    'guess-bump': (t) => {
      const d = getSynthwaveBus();
      osc('square', mtof(76), t, 0.04, 0.10, 0.002, d);
      osc('square', mtof(79), t + 0.08, 0.04, 0.10, 0.002, d);
    },
  };

  // ====================== SYNTHWAVE VARIANT BUSES ======================
  // Each variant routes through its own dry+wet send so reverb mix is part
  // of the variant's identity (Outrun=wet, Glitch=dry, Vapor=drowned).
  function makeBus(dryGain, wetGain) {
    const input = ctx.createGain();
    const dry = ctx.createGain(); dry.gain.value = dryGain;
    const wet = ctx.createGain(); wet.gain.value = wetGain;
    input.connect(dry).connect(master);
    input.connect(wet).connect(getReverb());
    return input;
  }
  let busOutrun, busGlitch, busVapor;
  const getOutrun = () => busOutrun || (busOutrun = makeBus(0.7, 0.75));
  const getGlitch = () => busGlitch || (busGlitch = makeBus(1.0, 0.15));
  const getVapor  = () => busVapor  || (busVapor  = makeBus(0.5, 0.95));

  // Detuned saw stack — the foundational Outrun timbre.
  function fatSaw(t, m, dur, peak, detuneCents, dest) {
    [-detuneCents, 0, detuneCents].forEach((dt) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      o.detune.value = dt;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(2200, t);
      f.frequency.exponentialRampToValueAtTime(800, t + dur);
      f.Q.value = 2;
      o.connect(f).connect(g).connect(dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak * 0.45, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }

  // Bitcrushed square — short attack, noise grit, no tail. Glitch territory.
  function crush(t, m, dur, peak, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = mtof(m);
    // Pitch jitter for grit
    o.detune.setValueAtTime(0, t);
    o.detune.linearRampToValueAtTime(15, t + dur * 0.3);
    o.detune.linearRampToValueAtTime(-10, t + dur * 0.6);
    o.detune.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    // Tremolo gate for "bitcrush" feel
    for (let tt = t + 0.01; tt < t + dur; tt += 0.012) {
      g.gain.linearRampToValueAtTime(peak * (0.4 + Math.random() * 0.6), tt);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
    noise(t, dur * 0.4, peak * 0.18, 'highpass', 2500, null, dest);
  }

  // Slow-attack chorus pad — Vapor's signature.
  function dreamPad(t, m, dur, peak, dest) {
    [0, 0.5, -0.5].forEach((semi, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = mtof(m) * Math.pow(2, semi / 12);
      // LFO for chorus
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 4 + i * 0.7;
      lfoGain.gain.value = 2.5;
      lfo.connect(lfoGain).connect(o.detune);
      o.connect(g).connect(dest);
      const attack = dur * 0.35;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak * 0.6, t + attack);
      g.gain.setValueAtTime(peak * 0.6, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
      lfo.start(t); lfo.stop(t + dur + 0.05);
    });
  }

  // ============ VARIANT B: SYNTHWAVE OUTRUN ============
  // 1986 analog — fat detuned saws, big plate reverb, deeper register.
  const synthwave_outrun = {
    'guess-cold': (t) => {
      const d = getOutrun();
      fatSaw(t, 48, 0.22, 0.20, 8, d);
    },
    'guess-warm': (t) => {
      const d = getOutrun();
      fatSaw(t, 48, 0.22, 0.18, 8, d);
      fatSaw(t + 0.16, 53, 0.28, 0.22, 8, d);
    },
    'guess-hot': (t) => {
      const d = getOutrun();
      [48, 55, 60].forEach((m, i) => fatSaw(t + i * 0.10, m, 0.32, 0.20, 10, d));
    },
    'guess-blazing': (t) => {
      const d = getOutrun();
      // Big DX7-style brass stab
      [48, 55, 60, 64, 67].forEach((m) => fatSaw(t, m, 0.55, 0.16, 12, d));
      osc((o, t0) => {
        o.frequency.setValueAtTime(mtof(72), t0);
        o.frequency.exponentialRampToValueAtTime(mtof(84), t0 + 0.45);
      }, null, t + 0.05, 0.50, 0.10, 0.002, d);
    },
    'target-found': (t) => {
      const d = getOutrun();
      // Cinematic outrun chord progression
      [[36, 0], [43, 0], [48, 0], [52, 0], [55, 0]].forEach(([m, dt]) => {
        fatSaw(t + dt, m, 2.0, 0.18, 14, d);
      });
      // Lead arpeggio over the top
      [72, 76, 79, 83, 84, 88].forEach((m, i) => {
        osc('triangle', mtof(m), t + 0.3 + i * 0.10, 0.4, 0.14, 0.005, d);
      });
      // Gated reverb-style crash
      noise(t, 1.5, 0.16, 'highpass', 5000, null, d);
    },
    'xp-award': (t) => {
      const d = getOutrun();
      bell(t, 72, 0.24, 0.5, d);
    },
    'xp-tier-bonus': (t) => {
      const d = getOutrun();
      [72, 76, 79].forEach((m, i) => bell(t + i * 0.18, m, 0.22, 0.6, d));
    },
    'round-start': (t) => {
      const d = getOutrun();
      // Slow filter rise into chord drop
      sweepNoise(t, 0.7, 0.10, 'bandpass', 400, 2200, 1.5, d);
      [36, 43, 48].forEach((m) => fatSaw(t + 0.5, m, 0.6, 0.20, 12, d));
    },
    'round-timeout': (t) => {
      const d = getOutrun();
      fatSaw(t, 36, 0.9, 0.20, 14, d);
      osc('triangle', mtof(48), t, 0.9, 0.10, 0.05, d);
    },
    'ui-click': (t) => {
      const d = getOutrun();
      osc('triangle', mtof(72), t, 0.05, 0.10, 0.002, d);
      noise(t, 0.025, 0.06, 'bandpass', 1800, 2, d);
    },
    'drawer-toggle': (t) => {
      const d = getOutrun();
      sweepSaw(t, 60, 0.25, 0.10, 600, 3000, 5, d);
    },
    'guess-bump': (t) => {
      const d = getOutrun();
      fatSaw(t, 55, 0.12, 0.14, 8, d);
      fatSaw(t + 0.08, 55, 0.12, 0.14, 8, d);
    },
  };

  // ============ VARIANT C: SYNTHWAVE GLITCH ============
  // Cyberpunk overlay — bitcrushed squares, sharp pitch ramps, dry & aggressive.
  const synthwave_glitch = {
    'guess-cold': (t) => {
      const d = getGlitch();
      crush(t, 72, 0.10, 0.16, d);
    },
    'guess-warm': (t) => {
      const d = getGlitch();
      crush(t, 72, 0.08, 0.14, d);
      crush(t + 0.10, 77, 0.10, 0.16, d);
    },
    'guess-hot': (t) => {
      const d = getGlitch();
      // Stutter-glitch — same note 3 times then jump up
      [72, 72, 72, 79].forEach((m, i) => crush(t + i * 0.05, m, 0.05, 0.16, d));
      sweepNoise(t + 0.20, 0.20, 0.08, 'highpass', 3000, 8000, 2, d);
    },
    'guess-blazing': (t) => {
      const d = getGlitch();
      // Pitch ramp + glitch breaks
      osc((o, t0) => {
        o.frequency.setValueAtTime(mtof(60), t0);
        o.frequency.exponentialRampToValueAtTime(mtof(96), t0 + 0.4);
      }, null, t, 0.40, 0.14, 0.002, d);
      [0.10, 0.20, 0.30].forEach((dt) => {
        noise(t + dt, 0.025, 0.20, 'highpass', 4000, null, d);
      });
      crush(t + 0.42, 96, 0.10, 0.18, d);
    },
    'target-found': (t) => {
      const d = getGlitch();
      // Stutter intro
      [0, 0.06, 0.12, 0.18].forEach((dt) => {
        crush(t + dt, 84, 0.04, 0.18, d);
      });
      // Glitch-cut chord
      [60, 67, 72, 79].forEach((m) => {
        for (let i = 0; i < 6; i++) {
          osc('sawtooth', mtof(m), t + 0.25 + i * 0.08, 0.05, 0.10, 0.001, d);
        }
      });
      // Sweep-up payoff
      sweepSaw(t + 0.8, 60, 0.9, 0.18, 200, 8000, 6, d);
      noise(t + 0.8, 1.0, 0.12, 'highpass', 6000, null, d);
      // Stab cap
      [72, 79, 84].forEach((m) => crush(t + 1.6, m, 0.30, 0.18, d));
    },
    'xp-award': (t) => {
      const d = getGlitch();
      crush(t, 88, 0.08, 0.16, d);
      crush(t + 0.06, 95, 0.10, 0.16, d);
    },
    'xp-tier-bonus': (t) => {
      const d = getGlitch();
      [84, 88, 91, 95, 96].forEach((m, i) => crush(t + i * 0.06, m, 0.06, 0.16, d));
    },
    'round-start': (t) => {
      const d = getGlitch();
      // Boot-up glitch scatter
      for (let i = 0; i < 8; i++) {
        const m = 60 + Math.floor(Math.random() * 24);
        crush(t + i * 0.05, m, 0.04, 0.10, d);
      }
      sweepSaw(t + 0.40, 48, 0.5, 0.16, 200, 4000, 5, d);
    },
    'round-timeout': (t) => {
      const d = getGlitch();
      // Glitchy power-off — bitcrushed descending
      [60, 60, 55, 55, 48, 48, 36].forEach((m, i) => {
        crush(t + i * 0.10, m, 0.07, 0.14, d);
      });
    },
    'ui-click': (t) => {
      const d = getGlitch();
      noise(t, 0.02, 0.14, 'highpass', 3500, null, d);
      crush(t, 84, 0.03, 0.10, d);
    },
    'drawer-toggle': (t) => {
      const d = getGlitch();
      sweepNoise(t, 0.10, 0.10, 'bandpass', 1500, 5000, 4, d);
      crush(t + 0.08, 79, 0.05, 0.12, d);
    },
    'guess-bump': (t) => {
      const d = getGlitch();
      crush(t, 67, 0.04, 0.14, d);
      crush(t + 0.06, 67, 0.04, 0.14, d);
    },
  };

  // ============ VARIANT D: SYNTHWAVE VAPOR ============
  // Vaporwave — slowed, washed, dreamy. Soft attacks, big reverb, chorused.
  const synthwave_vapor = {
    'guess-cold': (t) => {
      const d = getVapor();
      dreamPad(t, 72, 0.45, 0.18, d);
    },
    'guess-warm': (t) => {
      const d = getVapor();
      dreamPad(t, 72, 0.50, 0.16, d);
      dreamPad(t + 0.20, 77, 0.55, 0.18, d);
    },
    'guess-hot': (t) => {
      const d = getVapor();
      [72, 76, 79].forEach((m, i) => dreamPad(t + i * 0.18, m, 0.6, 0.16, d));
    },
    'guess-blazing': (t) => {
      const d = getVapor();
      [72, 76, 79, 83, 86].forEach((m, i) => dreamPad(t + i * 0.10, m, 0.7, 0.14, d));
      // Soft shimmer chime
      bell(t + 0.4, 88, 0.16, 0.8, d);
    },
    'target-found': (t) => {
      const d = getVapor();
      // Slow chord wash — Mac DeMarco / vaporwave
      [55, 60, 64, 67, 72].forEach((m) => dreamPad(t, m, 2.0, 0.14, d));
      // Sparkle bells trickling in
      [88, 91, 96, 91, 88].forEach((m, i) => {
        bell(t + 0.3 + i * 0.25, m, 0.10, 0.8, d);
      });
      // Tape stop at end — pitch droop
      osc((o, t0) => {
        o.frequency.setValueAtTime(mtof(67), t0);
        o.frequency.exponentialRampToValueAtTime(mtof(55), t0 + 0.4);
      }, null, t + 1.5, 0.5, 0.08, 0.05, d);
    },
    'xp-award': (t) => {
      const d = getVapor();
      bell(t, 79, 0.18, 0.8, d);
    },
    'xp-tier-bonus': (t) => {
      const d = getVapor();
      [76, 79, 83].forEach((m, i) => bell(t + i * 0.22, m, 0.18, 1.0, d));
    },
    'round-start': (t) => {
      const d = getVapor();
      // Slow swell into nothing — like a tape playing the wrong way
      dreamPad(t, 48, 1.1, 0.16, d);
      dreamPad(t + 0.3, 55, 0.9, 0.14, d);
      bell(t + 0.7, 76, 0.10, 0.8, d);
    },
    'round-timeout': (t) => {
      const d = getVapor();
      // Tape-stop droop
      osc((o, t0) => {
        o.frequency.setValueAtTime(mtof(60), t0);
        o.frequency.exponentialRampToValueAtTime(mtof(40), t0 + 0.75);
      }, null, t, 0.85, 0.14, 0.02, d);
      dreamPad(t, 40, 1.0, 0.10, d);
    },
    'ui-click': (t) => {
      const d = getVapor();
      osc('sine', mtof(84), t, 0.10, 0.07, 0.005, d);
    },
    'drawer-toggle': (t) => {
      const d = getVapor();
      sweepNoise(t, 0.25, 0.05, 'bandpass', 600, 2000, 1.2, d);
      osc('sine', mtof(79), t + 0.15, 0.10, 0.05, 0.01, d);
    },
    'guess-bump': (t) => {
      const d = getVapor();
      osc('sine', mtof(67), t, 0.10, 0.10, 0.005, d);
      osc('sine', mtof(67), t + 0.08, 0.10, 0.10, 0.005, d);
    },
  };

  const PACKS = {
    gameshow, asmr, minimal, arcade, synthwave,
    'synthwave-outrun': synthwave_outrun,
    'synthwave-glitch': synthwave_glitch,
    'synthwave-vapor': synthwave_vapor,
  };

  function play(packId, soundId) {
    init(); resume();
    const fn = PACKS[packId] && PACKS[packId][soundId];
    if (!fn) return false;
    fn(ctx.currentTime + 0.02);
    return true;
  }

  // Demo sequence — a simulated round.
  const DEMO_SEQUENCE = [
    ['round-start', 1100],
    ['guess-cold', 550],
    ['guess-warm', 650],
    ['guess-bump', 500],
    ['guess-hot', 700],
    ['xp-award', 450],
    ['guess-blazing', 800],
    ['xp-tier-bonus', 800],
    ['target-found', 2600],
  ];

  let demoCancel = false;
  function cancelDemo() { demoCancel = true; }
  async function playDemo(packId, onStep) {
    init(); resume();
    demoCancel = false;
    for (const [id, wait] of DEMO_SEQUENCE) {
      if (demoCancel) break;
      onStep && onStep(id);
      play(packId, id);
      await new Promise((r) => setTimeout(r, wait));
    }
    onStep && onStep(null);
  }

  // Compare one sound across all 5 packs.
  async function compareSound(soundId, onStep) {
    init(); resume();
    demoCancel = false;
    const order = ['gameshow', 'asmr', 'minimal', 'arcade', 'synthwave'];
    for (const p of order) {
      if (demoCancel) break;
      onStep && onStep(p);
      play(p, soundId);
      await new Promise((r) => setTimeout(r, 1400));
    }
    onStep && onStep(null);
  }

  window.SearchleAudio = {
    init, resume, setMaster, play, playDemo, compareSound, cancelDemo,
    DEMO_SEQUENCE,
  };
})();
