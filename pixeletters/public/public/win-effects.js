// win-effects.js — Shared particle-based win effect system for all word games
// Include via <script src="/win-effects.js"></script> or copy to each game's public/

(function () {
  'use strict';

  var canvas, ctx, particles, animFrame, startTime, duration, effectConfig;

  function createCanvas() {
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;pointer-events:none;';
    var vp = window.__gameViewport || { width: window.innerWidth, height: window.innerHeight };
    canvas.width = vp.width;
    canvas.height = vp.height;
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    return canvas;
  }

  function removeCanvas() {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null;
    ctx = null;
    particles = null;
  }

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ─── Particle types ───────────────────────────────────────

  function makeConfettiParticle(colors, w, h) {
    return {
      x: rand(0, w), y: rand(-h * 0.3, -20),
      vx: rand(-3, 3), vy: rand(2, 6),
      size: rand(6, 12), rotation: rand(0, 360), rotSpeed: rand(-8, 8),
      color: pick(colors), shape: pick(['rect', 'circle']),
      gravity: 0.08, drag: 0.99, wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.02, 0.06),
      opacity: 1
    };
  }

  function makeSparkleParticle(colors, w, h) {
    var cx = w / 2, cy = h / 2;
    var angle = rand(0, Math.PI * 2);
    var speed = rand(2, 8);
    return {
      x: cx + rand(-100, 100), y: cy + rand(-100, 100),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: rand(2, 5), color: pick(colors),
      life: 1, decay: rand(0.008, 0.02), twinkle: rand(0, Math.PI * 2),
      gravity: 0.02
    };
  }

  function makeHeartParticle(colors, w, h) {
    return {
      x: rand(0, w), y: h + rand(10, 60),
      vx: rand(-1, 1), vy: rand(-4, -2),
      size: rand(10, 22), color: pick(colors),
      rotation: rand(-20, 20), wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.02, 0.05),
      opacity: 1, fadeStart: 0.7
    };
  }

  function makeFireworkShell(colors, w, h) {
    var tx = rand(w * 0.2, w * 0.8);
    var ty = rand(h * 0.1, h * 0.4);
    return { type: 'shell', x: tx, y: h + 10, targetY: ty, vy: rand(-12, -8), color: pick(colors), exploded: false, trail: [] };
  }

  function makeFireworkSpark(x, y, color) {
    var angle = rand(0, Math.PI * 2);
    var speed = rand(1, 7);
    return {
      type: 'spark', x: x, y: y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      color: color, size: rand(2, 4), life: 1, decay: rand(0.015, 0.03),
      gravity: 0.06
    };
  }

  function makeLightningBolt(w, h) {
    var x = rand(w * 0.1, w * 0.9);
    var points = [{ x: x, y: 0 }];
    var y = 0;
    while (y < h) {
      y += rand(20, 60);
      x += rand(-40, 40);
      points.push({ x: x, y: Math.min(y, h) });
    }
    return { points: points, opacity: 1, width: rand(2, 5), glow: rand(15, 30), delay: rand(0, 1500), born: Date.now() };
  }

  function makeSnowflake(colors, w) {
    return {
      x: rand(-20, w + 20), y: rand(-40, -10),
      vx: rand(-0.5, 0.5), vy: rand(1, 3),
      size: rand(3, 8), color: pick(colors),
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.01, 0.04), wobbleAmp: rand(0.3, 1),
      opacity: rand(0.5, 1), rotation: rand(0, 360), rotSpeed: rand(-2, 2)
    };
  }

  function makeMeteor(colors, w, h) {
    var startX = rand(-50, w + 50);
    var angle = rand(0.3, 0.8);
    return {
      x: startX, y: -20,
      vx: Math.cos(angle) * rand(6, 14), vy: Math.sin(angle) * rand(6, 14),
      size: rand(3, 6), color: pick(colors), tailLen: rand(30, 80),
      trail: [], life: 1, decay: rand(0.005, 0.012)
    };
  }

  function makePetal(colors, w) {
    return {
      x: rand(-20, w + 20), y: rand(-40, -10),
      vx: rand(-1.5, 1.5), vy: rand(1, 2.5),
      size: rand(6, 14), color: pick(colors),
      rotation: rand(0, 360), rotSpeed: rand(-3, 3),
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(0.02, 0.05), wobbleAmp: rand(0.5, 1.5),
      opacity: rand(0.6, 1)
    };
  }

  function makeAuroraWave(colors, w, h, i) {
    return {
      color: pick(colors), y: h * rand(0.15, 0.6),
      amplitude: rand(30, 80), frequency: rand(0.003, 0.008),
      speed: rand(0.5, 1.5), phase: i * 1.2,
      opacity: rand(0.15, 0.35), height: rand(60, 140),
      w: w
    };
  }

  function makeGalaxyParticle(colors, w, h) {
    var cx = w / 2, cy = h / 2;
    var angle = rand(0, Math.PI * 2);
    var dist = rand(5, 200);
    return {
      x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist,
      angle: angle, dist: dist, speed: rand(0.01, 0.04),
      size: rand(1, 4), color: pick(colors),
      vr: rand(0.5, 2), life: 1, decay: rand(0.002, 0.008),
      cx: cx, cy: cy
    };
  }

  function makePhoenixParticle(colors, w, h) {
    var cx = w / 2;
    return {
      x: cx + rand(-30, 30), y: h + rand(0, 20),
      vx: rand(-2, 2), vy: rand(-8, -3),
      size: rand(3, 8), color: pick(colors),
      life: 1, decay: rand(0.008, 0.02), gravity: -0.05,
      trail: []
    };
  }

  function makeNuclearRing(w, h) {
    return { cx: w / 2, cy: h / 2, radius: 0, maxRadius: Math.max(w, h), speed: 12, opacity: 1, width: 8 };
  }

  function makeNuclearParticle(colors, w, h) {
    var cx = w / 2, cy = h / 2;
    var angle = rand(0, Math.PI * 2);
    var speed = rand(3, 15);
    return {
      x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: rand(2, 6), color: pick(colors),
      life: 1, decay: rand(0.005, 0.015), gravity: 0.04
    };
  }

  // ─── Draw helpers ─────────────────────────────────────────

  function drawHeart(cx, cy, size, color, opacity, rotation) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.beginPath();
    var s = size / 2;
    ctx.moveTo(0, s * 0.4);
    ctx.bezierCurveTo(-s, -s * 0.4, -s * 1.4, s * 0.4, 0, s * 1.2);
    ctx.bezierCurveTo(s * 1.4, s * 0.4, s, -s * 0.4, 0, s * 0.4);
    ctx.fill();
    ctx.restore();
  }

  function drawStar(cx, cy, size, color, opacity) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
      ctx.lineTo(cx + Math.cos(a + 0.3) * size * 0.3, cy + Math.sin(a + 0.3) * size * 0.3);
    }
    ctx.fill();
    ctx.restore();
  }

  function drawPetal(cx, cy, size, color, opacity, rotation) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.4, size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─── Effect renderers ────────────────────────────────────

  var effects = {};

  effects.confetti = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 80); i++) ps.push(makeConfettiParticle(cfg.colors, w, h));
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      // Continuously spawn new confetti during first 70% of duration
      if (elapsed < dur * 0.7 && ps.length < 120) {
        var spawnRate = Math.max(1, Math.floor((effectConfig.particleCount || 80) / 30));
        for (var s = 0; s < spawnRate; s++) {
          ps.push(makeConfettiParticle(effectConfig.colors, w, h));
        }
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        p.wobble += p.wobbleSpeed;
        p.vx += Math.sin(p.wobble) * 0.1;
        p.vy += p.gravity;
        p.vx *= p.drag;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        if (elapsed > dur * 0.7) p.opacity = Math.max(0, p.opacity - 0.015);
        if (p.y > h + 30 || p.opacity <= 0) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  };

  effects.sparkles = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 40); i++) ps.push(makeSparkleParticle(cfg.colors, w, h));
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      // Continuously spawn sparkles during first 75% of duration
      if (elapsed < dur * 0.75 && ps.length < 60) {
        for (var s = 0; s < 2; s++) {
          ps.push(makeSparkleParticle(effectConfig.colors, w, h));
        }
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.twinkle += 0.15;
        p.life -= p.decay;
        if (p.life <= 0) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        var alpha = p.life * (0.5 + 0.5 * Math.sin(p.twinkle));
        drawStar(p.x, p.y, p.size * 2, p.color, alpha);
      }
    }
  };

  effects.hearts = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 30); i++) ps.push(makeHeartParticle(cfg.colors, w, h));
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      // Continuously spawn hearts during first 65% of duration
      if (elapsed < dur * 0.65 && ps.length < 40) {
        ps.push(makeHeartParticle(effectConfig.colors, w, h));
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        p.wobble += p.wobbleSpeed;
        p.x += p.vx + Math.sin(p.wobble) * 0.5;
        p.y += p.vy;
        p.rotation += Math.sin(p.wobble) * 0.5;
        var progress = elapsed / dur;
        if (progress > p.fadeStart) {
          p.opacity = Math.max(0, 1 - (progress - p.fadeStart) / (1 - p.fadeStart));
        }
        if (p.y < -40 || p.opacity <= 0) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        drawHeart(p.x, p.y, p.size, p.color, p.opacity, p.rotation);
      }
    }
  };

  effects.fireworks = {
    _lastShellTime: 0,
    init: function (cfg, w, h) {
      var ps = [];
      var shellCount = Math.min(cfg.particleCount || 60, 8);
      for (var i = 0; i < shellCount; i++) {
        var shell = makeFireworkShell(cfg.colors, w, h);
        shell.delay = i * 400;
        shell.born = Date.now();
        ps.push(shell);
      }
      effects.fireworks._lastShellTime = Date.now();
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      var now = Date.now();
      // Launch new shells periodically during first 70% of duration
      if (elapsed < dur * 0.7 && now - effects.fireworks._lastShellTime > 600) {
        var shell = makeFireworkShell(effectConfig.colors, w, h);
        shell.delay = 0;
        shell.born = now;
        ps.push(shell);
        effects.fireworks._lastShellTime = now;
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        if (p.type === 'shell') {
          if (now - p.born < (p.delay || 0)) continue;
          p.y += p.vy;
          p.vy += 0.15;
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 8) p.trail.shift();
          if (p.y <= p.targetY || p.vy >= 0) {
            // Explode
            for (var j = 0; j < 30; j++) {
              ps.push(makeFireworkSpark(p.x, p.y, p.color));
            }
            ps.splice(i, 1);
          }
        } else if (p.type === 'spark') {
          p.vy += p.gravity;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.98;
          p.life -= p.decay;
          if (p.life <= 0) ps.splice(i, 1);
        }
      }
    },
    draw: function (ps) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (p.type === 'shell') {
          // Draw trail
          for (var t = 0; t < p.trail.length; t++) {
            ctx.globalAlpha = (t / p.trail.length) * 0.6;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.trail[t].x, p.trail[t].y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'spark') {
          ctx.globalAlpha = p.life;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      ctx.globalAlpha = 1;
    }
  };

  effects.lightning = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 8); i++) {
        ps.push(makeLightningBolt(w, h));
      }
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      var now = Date.now();
      // Spawn new bolts periodically during first 80% of duration
      if (elapsed < dur * 0.8 && ps.length < 4) {
        var bolt = makeLightningBolt(w || canvas.width, h || canvas.height);
        bolt.delay = 0;
        bolt.born = now;
        ps.push(bolt);
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        var age = now - p.born;
        if (age < p.delay) continue;
        var liveAge = age - p.delay;
        if (liveAge < 100) {
          p.opacity = 1;
        } else if (liveAge < 200) {
          p.opacity = 0.3;
        } else if (liveAge < 300) {
          p.opacity = 0.8;
        } else {
          p.opacity = Math.max(0, 1 - (liveAge - 300) / 400);
        }
        if (p.opacity <= 0) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      var now = Date.now();
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (now - p.born < p.delay) continue;
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = p.width;
        ctx.shadowColor = '#a5f3fc';
        ctx.shadowBlur = p.glow;
        ctx.beginPath();
        ctx.moveTo(p.points[0].x, p.points[0].y);
        for (var j = 1; j < p.points.length; j++) {
          ctx.lineTo(p.points[j].x, p.points[j].y);
        }
        ctx.stroke();
        // Bright core
        ctx.lineWidth = Math.max(1, p.width - 2);
        ctx.shadowBlur = p.glow * 2;
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  effects.snowfall = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 60); i++) {
        var p = makeSnowflake(cfg.colors, w);
        p.y = rand(-h, -10); // stagger start positions
        ps.push(p);
      }
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      // Continuously spawn snowflakes during first 70% of duration
      if (elapsed < dur * 0.7 && ps.length < 80) {
        ps.push(makeSnowflake(effectConfig.colors, w));
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        p.wobble += p.wobbleSpeed;
        p.x += p.vx + Math.sin(p.wobble) * p.wobbleAmp;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        if (elapsed > dur * 0.75) p.opacity = Math.max(0, p.opacity - 0.01);
        if (p.y > h + 20 || p.opacity <= 0) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        // Simple snowflake: 6-pointed star
        for (var s = 0; s < 6; s++) {
          var a = (s / 6) * Math.PI * 2;
          ctx.fillRect(-0.5, 0, 1, p.size);
          ctx.save();
          ctx.rotate(a);
          ctx.fillRect(-0.5, 0, 1, p.size);
          ctx.restore();
        }
        ctx.restore();
      }
    }
  };

  effects.meteors = {
    _lastMeteor: 0,
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 12); i++) {
        var p = makeMeteor(cfg.colors, w, h);
        p.delay = i * 200;
        p.born = Date.now();
        ps.push(p);
      }
      effects.meteors._lastMeteor = Date.now();
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      var now = Date.now();
      // Spawn new meteors periodically during first 70% of duration
      if (elapsed < dur * 0.7 && now - effects.meteors._lastMeteor > 300 && ps.length < 20) {
        var p = makeMeteor(effectConfig.colors, w, h);
        p.delay = 0;
        p.born = now;
        ps.push(p);
        effects.meteors._lastMeteor = now;
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        if (now - p.born < (p.delay || 0)) continue;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 15) p.trail.shift();
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0 || p.y > h + 30 || p.x > w + 50) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      var now = Date.now();
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (now - p.born < (p.delay || 0)) continue;
        // Trail
        for (var t = 0; t < p.trail.length; t++) {
          var tAlpha = (t / p.trail.length) * p.life * 0.6;
          var tSize = p.size * (t / p.trail.length);
          ctx.globalAlpha = tAlpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.trail[t].x, p.trail[t].y, tSize, 0, Math.PI * 2);
          ctx.fill();
        }
        // Head
        ctx.globalAlpha = p.life;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }
  };

  effects.cherry_blossom = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 50); i++) {
        var p = makePetal(cfg.colors, w);
        p.y = rand(-h * 0.5, -10);
        ps.push(p);
      }
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      // Continuously spawn petals during first 65% of duration
      if (elapsed < dur * 0.65 && ps.length < 60) {
        ps.push(makePetal(effectConfig.colors, w));
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        p.wobble += p.wobbleSpeed;
        p.x += p.vx + Math.sin(p.wobble) * p.wobbleAmp;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        if (elapsed > dur * 0.7) p.opacity = Math.max(0, p.opacity - 0.01);
        if (p.y > h + 30 || p.opacity <= 0) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        drawPetal(p.x, p.y, p.size, p.color, p.opacity, p.rotation);
      }
    }
  };

  effects.aurora = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 6); i++) {
        ps.push(makeAuroraWave(cfg.colors, w, h, i));
      }
      return ps;
    },
    update: function (ps, dt, elapsed, dur) {
      for (var i = 0; i < ps.length; i++) {
        ps[i].phase += ps[i].speed * 0.01;
        if (elapsed > dur * 0.6) {
          ps[i].opacity = Math.max(0, ps[i].opacity - 0.003);
        }
      }
      for (var j = ps.length - 1; j >= 0; j--) {
        if (ps[j].opacity <= 0) ps.splice(j, 1);
      }
    },
    draw: function (ps) {
      for (var i = 0; i < ps.length; i++) {
        var w = ps[i];
        ctx.save();
        ctx.globalAlpha = w.opacity;
        var grad = ctx.createLinearGradient(0, w.y - w.height / 2, 0, w.y + w.height / 2);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.5, w.color);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.shadowColor = w.color;
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.moveTo(0, w.y);
        for (var x = 0; x <= w.w; x += 4) {
          var yOff = Math.sin(x * w.frequency + w.phase) * w.amplitude;
          ctx.lineTo(x, w.y + yOff);
        }
        ctx.lineTo(w.w, w.y + w.height);
        ctx.lineTo(0, w.y + w.height);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  };

  effects.galaxy_burst = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 100); i++) {
        ps.push(makeGalaxyParticle(cfg.colors, w, h));
      }
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      // Continuously spawn galaxy particles during first 60% of duration
      if (elapsed < dur * 0.6 && ps.length < 120) {
        for (var s = 0; s < 3; s++) {
          ps.push(makeGalaxyParticle(effectConfig.colors, w, h));
        }
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        p.angle += p.speed;
        p.dist += p.vr;
        p.x = p.cx + Math.cos(p.angle) * p.dist;
        p.y = p.cy + Math.sin(p.angle) * p.dist;
        p.life -= p.decay;
        if (p.life <= 0) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  };

  effects.phoenix = {
    init: function (cfg, w, h) {
      var ps = [];
      for (var i = 0; i < (cfg.particleCount || 80); i++) {
        var p = makePhoenixParticle(cfg.colors, w, h);
        p.delay = rand(0, 1500);
        p.born = Date.now();
        ps.push(p);
      }
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      var now = Date.now();
      // Continuously spawn phoenix particles during first 70% of duration
      if (elapsed < dur * 0.7 && ps.length < 100) {
        var p = makePhoenixParticle(effectConfig.colors, w, h);
        p.delay = 0;
        p.born = now;
        ps.push(p);
      }
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        if (now - p.born < p.delay) continue;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 10) p.trail.shift();
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.life -= p.decay;
        if (p.life <= 0) ps.splice(i, 1);
      }
    },
    draw: function (ps) {
      var now = Date.now();
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (now - p.born < p.delay) continue;
        // Fire trail
        for (var t = 0; t < p.trail.length; t++) {
          ctx.globalAlpha = (t / p.trail.length) * p.life * 0.5;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.trail[t].x, p.trail[t].y, p.size * (t / p.trail.length), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }
  };

  effects.nuclear = {
    init: function (cfg, w, h) {
      var ps = [];
      // Shockwave rings
      ps.push({ type: 'ring', cx: w / 2, cy: h / 2, radius: 0, maxRadius: Math.max(w, h), speed: 14, opacity: 1, width: 10 });
      ps.push({ type: 'ring', cx: w / 2, cy: h / 2, radius: 0, maxRadius: Math.max(w, h), speed: 10, opacity: 0.7, width: 6, delay: 200, born: Date.now() });
      // Flash
      ps.push({ type: 'flash', opacity: 1 });
      // Particles
      for (var i = 0; i < (cfg.particleCount || 150); i++) {
        var p = makeNuclearParticle(cfg.colors, w, h);
        p.type = 'particle';
        p.delay = rand(0, 500);
        p.born = Date.now();
        ps.push(p);
      }
      return ps;
    },
    update: function (ps, dt, elapsed, dur, w, h) {
      var now = Date.now();
      for (var i = ps.length - 1; i >= 0; i--) {
        var p = ps[i];
        if (p.type === 'flash') {
          p.opacity = Math.max(0, 1 - elapsed / 600);
          if (p.opacity <= 0) ps.splice(i, 1);
        } else if (p.type === 'ring') {
          if (p.delay && now - p.born < p.delay) continue;
          p.radius += p.speed;
          p.opacity = Math.max(0, 1 - p.radius / p.maxRadius);
          if (p.opacity <= 0) ps.splice(i, 1);
        } else if (p.type === 'particle') {
          if (now - p.born < (p.delay || 0)) continue;
          p.vy += p.gravity;
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.98;
          p.life -= p.decay;
          if (p.life <= 0) ps.splice(i, 1);
        }
      }
    },
    draw: function (ps) {
      var now = Date.now();
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (p.type === 'flash') {
          ctx.save();
          ctx.globalAlpha = p.opacity * 0.7;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.restore();
        } else if (p.type === 'ring') {
          if (p.delay && now - p.born < p.delay) continue;
          ctx.save();
          ctx.globalAlpha = p.opacity;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = p.width * p.opacity;
          ctx.shadowColor = '#ffff00';
          ctx.shadowBlur = 20;
          ctx.beginPath();
          ctx.arc(p.cx, p.cy, p.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (p.type === 'particle') {
          if (now - p.born < (p.delay || 0)) continue;
          ctx.globalAlpha = p.life;
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  };

  // ─── Main animation loop ─────────────────────────────────

  function animate() {
    if (!canvas || !ctx || !particles) return;

    var now = Date.now();
    var elapsed = now - startTime;
    var dt = 16; // approximate frame time

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var effectType = particles._effectType;
    var handler = effects[effectType];
    if (handler) {
      handler.update(particles, dt, elapsed, duration, canvas.width, canvas.height);
      handler.draw(particles);
    }

    if (elapsed < duration) {
      animFrame = requestAnimationFrame(animate);
    } else {
      removeCanvas();
    }
  }

  // ─── Public API ───────────────────────────────────────────

  window.playWinEffect = function (config) {
    if (!config || !config.effect) return;
    var effectType = config.effect;
    if (!effects[effectType]) return;

    // Clean up any existing effect
    removeCanvas();

    createCanvas();
    var w = canvas.width;
    var h = canvas.height;

    effectConfig = config; // Store config for respawning particles
    duration = config.duration || 3000;
    startTime = Date.now();
    particles = effects[effectType].init(config, w, h);
    particles._effectType = effectType;

    animFrame = requestAnimationFrame(animate);

    // Safety timeout
    setTimeout(function () { removeCanvas(); }, duration + 1000);
  };

  // Allow checking if win effects system is loaded
  window.WIN_EFFECTS_LOADED = true;

})();
