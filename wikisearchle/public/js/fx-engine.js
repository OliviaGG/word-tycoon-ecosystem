/* FX engine for WikiSearchle. Self-contained, no dependencies.
   Exposes window.FX with: tumbleWord, unlockTitleWord, popRankCard,
   finale, podiumCoronation, setVariation, setMuted, playSound, toast. */
(function () {
  'use strict';

  var reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Sound (WebAudio, lazy) ────────────────────────────────────
  var audioCtx = null;
  var muted = false;
  function ac() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, dur, opts) {
    if (muted) return;
    var ctx = ac(); if (!ctx) return;
    opts = opts || {};
    var t0 = ctx.currentTime + (opts.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    var peak = (opts.gain != null ? opts.gain : 0.18);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  function noise(dur, opts) {
    if (muted) return;
    var ctx = ac(); if (!ctx) return;
    opts = opts || {};
    var bufSize = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var filt = ctx.createBiquadFilter();
    filt.type = opts.filter || 'highpass';
    filt.frequency.value = opts.cutoff || 1200;
    var gain = ctx.createGain();
    gain.gain.value = (opts.gain != null ? opts.gain : 0.06);
    src.connect(filt).connect(gain).connect(ctx.destination);
    src.start();
  }

  var sounds = {
    tumble: function () {
      tone(880, 0.12, { type: 'triangle', gain: 0.10 });
      tone(1320, 0.18, { type: 'sine', gain: 0.07, delay: 0.06 });
    },
    unlock: function () {
      tone(523, 0.08, { type: 'square', gain: 0.06 });
      tone(659, 0.08, { type: 'square', gain: 0.06, delay: 0.07 });
      tone(880, 0.20, { type: 'triangle', gain: 0.10, delay: 0.14 });
    },
    rank: function () {
      tone(180, 0.18, { type: 'sawtooth', gain: 0.07, slideTo: 720 });
      noise(0.08, { gain: 0.05, cutoff: 2400 });
    },
    podium: function () {
      tone(440, 0.25, { type: 'sine', gain: 0.10, slideTo: 660 });
    },
    finale: function () {
      [392, 494, 587, 784].forEach(function (f, i) {
        tone(f, 0.55, { type: 'triangle', gain: 0.12, delay: i * 0.09 });
      });
      noise(0.6, { gain: 0.04, cutoff: 800, filter: 'lowpass' });
      // a few sparkles
      for (var i = 0; i < 6; i++) {
        tone(1500 + Math.random() * 1800, 0.18, { type: 'sine', gain: 0.04, delay: 0.4 + Math.random() * 0.6 });
      }
    },
  };

  // ── Particle helpers ──────────────────────────────────────────
  function getLayer() {
    var stage = document.getElementById('gameArea');
    var layer = stage && stage.querySelector('.particle-layer');
    return layer;
  }
  function localPos(targetEl) {
    var stage = document.getElementById('gameArea');
    if (!stage || !targetEl) return { x: 0, y: 0, w: 0, h: 0 };
    var sb = stage.getBoundingClientRect();
    var tb = targetEl.getBoundingClientRect();
    return {
      x: tb.left - sb.left,
      y: tb.top - sb.top,
      w: tb.width,
      h: tb.height,
    };
  }
  function spark(x, y, opts) {
    var layer = getLayer(); if (!layer) return;
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'particle spark';
    if (opts.color) {
      el.style.background = opts.color;
      el.style.boxShadow = '0 0 8px ' + opts.color + ', 0 0 14px ' + opts.color;
    }
    if (opts.size) {
      el.style.width = opts.size + 'px';
      el.style.height = opts.size + 'px';
    }
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    layer.appendChild(el);
    var dur = (opts.dur || 800) + Math.random() * 200;
    var dx = opts.dx != null ? opts.dx : (Math.random() * 80 - 40);
    var dy = opts.dy != null ? opts.dy : (Math.random() * -60 - 20);
    var rot = (Math.random() * 360 - 180);
    el.animate(
      [
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + (dy + 30) + 'px) scale(0.2) rotate(' + rot + 'deg)', opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(0.22,1,0.36,1)' }
    ).onfinish = function () { el.remove(); };
  }
  function burstFromRect(r, count, opts) {
    opts = opts || {};
    var cx = r.x + r.w / 2;
    var cy = r.y + r.h / 2;
    for (var i = 0; i < count; i++) {
      var ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      var rad = (opts.radius || 30) + Math.random() * 20;
      var dx = Math.cos(ang) * rad;
      var dy = Math.sin(ang) * rad;
      spark(cx, cy, {
        dx: dx, dy: dy,
        color: opts.color,
        size: opts.size,
        dur: opts.dur,
      });
    }
  }

  // ── Toast ─────────────────────────────────────────────────────
  function toast(text) {
    var stage = document.getElementById('gameArea'); if (!stage) return;
    var el = stage.querySelector('.fx-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'fx-toast';
      stage.appendChild(el);
    }
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ── Variations ────────────────────────────────────────────────
  var variation = {
    word: 'tumble',     // tumble | scramble | spotlight
    title: 'unlock',    // unlock | shockwave | uppercut
    rank: 'pop',        // pop | comet | ring
    finale: 'letters',  // letters | confetti | spotlight
  };
  function setVariation(group, name) { variation[group] = name; }
  function setMuted(m) { muted = !!m; }
  function isMuted() { return muted; }

  // ── Effect 1: word found in article ───────────────────────────
  function tumbleWord(wordEl) {
    if (!wordEl || reducedMotion) return;
    var raw = wordEl.dataset.word || wordEl.textContent || '';
    wordEl.classList.remove('redacted');
    wordEl.classList.add('revealed', 'fx-active');
    wordEl.innerHTML = '';
    var spans = [];
    for (var i = 0; i < raw.length; i++) {
      var s = document.createElement('span');
      s.className = 'fx-letter';
      s.textContent = raw[i];
      var rot = (Math.random() * 360 - 180);
      s.style.setProperty('--tumble-rot', rot + 'deg');
      var delay = i * 50;
      if (variation.word === 'tumble') {
        s.style.animation = 'letterTumble 720ms cubic-bezier(0.34, 1.56, 0.64, 1) ' + delay + 'ms both';
      } else if (variation.word === 'scramble') {
        s.style.animation = 'letterScramble 600ms ease ' + delay + 'ms';
      } else { // spotlight
        s.style.animation = 'letterSpotlight 700ms ease ' + delay + 'ms';
      }
      wordEl.appendChild(s);
      spans.push(s);
    }
    // underglow line
    var ug = document.createElement('span');
    ug.className = 'fx-underglow';
    wordEl.appendChild(ug);


    sounds.tumble();
    setTimeout(function () { wordEl.classList.remove('fx-active'); }, 1600);
  }

  // ── Effect 2: title word unlocked ─────────────────────────────
  function unlockTitleWord(twEl) {
    if (!twEl || reducedMotion) return;
    twEl.classList.remove('hidden');
    twEl.classList.add('revealed', 'fx-unlock');
    var r = localPos(twEl);
    var cx = r.x + r.w / 2;
    var cy = r.y + r.h / 2;
    if (variation.title === 'unlock') {
      // ring of orange sparks, expanding outward
      for (var i = 0; i < 14; i++) {
        var ang = (i / 14) * Math.PI * 2;
        spark(cx, cy, {
          dx: Math.cos(ang) * (60 + Math.random() * 20),
          dy: Math.sin(ang) * (60 + Math.random() * 20),
          color: '#ff7a1f',
          size: 5,
          dur: 900,
        });
      }
    } else if (variation.title === 'shockwave') {
      // expanding ring element
      var ring = document.createElement('div');
      ring.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:8px;height:8px;border-radius:50%;border:2px solid #ff7a1f;transform:translate(-50%,-50%);pointer-events:none;';
      var layer = getLayer(); if (layer) {
        layer.appendChild(ring);
        ring.animate([
          { width: '8px', height: '8px', opacity: 1, borderWidth: '2px' },
          { width: '180px', height: '180px', opacity: 0, borderWidth: '1px' },
        ], { duration: 800, easing: 'cubic-bezier(0.22,1,0.36,1)' }).onfinish = function () { ring.remove(); };
      }
    } else { // uppercut
      // upward spark fountain
      for (var j = 0; j < 12; j++) {
        spark(cx + (Math.random() * r.w - r.w / 2), cy + r.h / 2, {
          dx: (Math.random() * 30 - 15),
          dy: -50 - Math.random() * 50,
          color: '#ffaa66', size: 4, dur: 800,
        });
      }
    }
    sounds.unlock();
    setTimeout(function () { twEl.classList.remove('fx-unlock'); }, 1000);
  }

  // ── Effect 3: top-3 ranked card pop ───────────────────────────
  function popRankCard(cardEl, opts) {
    if (!cardEl || reducedMotion) return;
    opts = opts || {};
    var clz = variation.rank === 'pop' ? 'fx-rank-pop'
           : variation.rank === 'comet' ? 'fx-rank-comet'
           : 'fx-rank-ring';
    cardEl.classList.remove('fx-rank-pop', 'fx-rank-comet', 'fx-rank-ring');
    void cardEl.offsetWidth;
    cardEl.classList.add(clz);

    var r = localPos(cardEl);
    var cx = r.x + 32; // rank pill is on the left
    var cy = r.y + r.h / 2;
    if (variation.rank === 'pop') {
      // shower outward from rank pill
      burstFromRect({ x: cx - 12, y: cy - 12, w: 24, h: 24 }, 10, {
        color: '#ffaa66', radius: 30, size: 4, dur: 700,
      });
    }
    sounds.rank();
    setTimeout(function () {
      cardEl.classList.remove('fx-rank-pop', 'fx-rank-comet', 'fx-rank-ring');
    }, 600);
  }

  // ── Effect 4: round-win finale ────────────────────────────────
  function finale(titleBlockEl, opts) {
    if (!titleBlockEl || reducedMotion) return;
    opts = opts || {};
    titleBlockEl.classList.add('fx-finale');
    sounds.finale();

    if (variation.finale === 'letters') {
      // explode each title word into individually-dropping letters
      var words = titleBlockEl.querySelectorAll('.t-word');
      var globalIdx = 0;
      words.forEach(function (tw) {
        var txt = tw.querySelector('.w-text');
        var raw = tw.dataset.full || (txt && txt.textContent) || '';
        if (!txt) return;
        // store original
        if (!tw.dataset.full) tw.dataset.full = raw;
        txt.innerHTML = '';
        tw.classList.remove('hidden');
        tw.classList.add('revealed');
        for (var i = 0; i < raw.length; i++) {
          var s = document.createElement('span');
          s.className = 'fx-finale-letter';
          s.textContent = raw[i];
          s.style.animationDelay = (globalIdx * 70) + 'ms';
          txt.appendChild(s);
          globalIdx++;
        }
      });
    } else if (variation.finale === 'confetti') {
      // confetti rain over the whole stage
      var stage = document.getElementById('gameArea');
      if (!stage) return;
      var sb = stage.getBoundingClientRect();
      var colors = ['#ff6600', '#ffaa66', '#4ade80', '#fde047', '#7c8cff', '#ff6bd6'];
      for (var c = 0; c < 70; c++) {
        var p = document.createElement('div');
        p.className = 'fx-confetti-piece';
        p.style.left = (sb.left + Math.random() * sb.width) + 'px';
        p.style.top = (sb.top - 20) + 'px';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
        document.body.appendChild(p);
        var fall = sb.height + 80 + Math.random() * 120;
        var sway = (Math.random() * 80 - 40);
        var rot = Math.random() * 720 - 360;
        p.animate([
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
          { transform: 'translate(' + sway + 'px,' + fall + 'px) rotate(' + rot + 'deg)', opacity: 0.2 },
        ], { duration: 1800 + Math.random() * 1400, easing: 'cubic-bezier(0.4,0.05,0.9,0.6)' })
        .onfinish = (function (el) { return function () { el.remove(); }; })(p);
      }
    } else { // spotlight sweep
      var stage = document.getElementById('gameArea');
      if (!stage) return;
      var sweep = document.createElement('div');
      sweep.className = 'fx-spotlight';
      stage.appendChild(sweep);
      setTimeout(function () { sweep.remove(); }, 1500);
    }

    // also coronate the podium
    setTimeout(function () { podiumCoronation(); }, 250);
    toast('ROUND WIN');
  }

  function podiumCoronation() {
    if (reducedMotion) return;
    var sb = document.querySelector('.scoreboard');
    if (!sb) return;
    sb.classList.remove('fx-coronation'); void sb.offsetWidth;
    sb.classList.add('fx-coronation');
    sounds.podium();
    // golden sparkles on the gold card
    var gold = sb.querySelector('.tp-card.gold');
    if (gold) {
      var r = localPos(gold);
      for (var i = 0; i < 18; i++) {
        var ang = Math.random() * Math.PI * 2;
        var rad = 30 + Math.random() * 50;
        spark(r.x + r.w / 2, r.y + r.h / 2, {
          dx: Math.cos(ang) * rad,
          dy: Math.sin(ang) * rad - 10,
          color: ['#fff4c2', '#f4c730', '#ffaa66'][Math.floor(Math.random() * 3)],
          size: 4 + Math.random() * 3, dur: 1100,
        });
      }
    }
    setTimeout(function () { sb.classList.remove('fx-coronation'); }, 1700);
  }

  // ── Public API ────────────────────────────────────────────────
  window.FX = {
    tumbleWord: tumbleWord,
    unlockTitleWord: unlockTitleWord,
    popRankCard: popRankCard,
    finale: finale,
    podiumCoronation: podiumCoronation,
    setVariation: setVariation,
    setMuted: setMuted,
    isMuted: isMuted,
    toast: toast,
    sounds: sounds,
    spark: spark,
  };
})();
