// ===== Fireworks Effect =====
// Shells launch upward and explode into colorful sparks.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeFireworkShell(colors, w, h) {
  const tx = rand(w * 0.2, w * 0.8);
  const ty = rand(h * 0.1, h * 0.4);
  return {
    type: 'shell', x: tx, y: h + 10, targetY: ty,
    vy: rand(-12, -8), color: pick(colors), exploded: false, trail: []
  };
}

function makeFireworkSpark(x, y, color) {
  const angle = rand(0, Math.PI * 2);
  const speed = rand(1, 7);
  return {
    type: 'spark', x: x, y: y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    color: color, size: rand(2, 4), life: 1, decay: rand(0.015, 0.03),
    gravity: 0.06
  };
}

// Module-level state for shell timing
let _lastShellTime = 0;

export const fireworks = {
  init(cfg, w, h) {
    const ps = [];
    const shellCount = Math.min(cfg.particleCount || 60, 8);
    for (let i = 0; i < shellCount; i++) {
      const shell = makeFireworkShell(cfg.colors, w, h);
      shell.delay = i * 400;
      shell.born = Date.now();
      ps.push(shell);
    }
    _lastShellTime = Date.now();
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    const now = Date.now();
    // Launch new shells periodically during first 70% of duration
    if (elapsed < dur * 0.7 && now - _lastShellTime > 600) {
      const shell = makeFireworkShell(effectConfig.colors, w, h);
      shell.delay = 0;
      shell.born = now;
      ps.push(shell);
      _lastShellTime = now;
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (p.type === 'shell') {
        if (now - p.born < (p.delay || 0)) continue;
        p.y += p.vy;
        p.vy += 0.15;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 8) p.trail.shift();
        if (p.y <= p.targetY || p.vy >= 0) {
          // Explode
          for (let j = 0; j < 30; j++) {
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

  draw(ps, ctx, canvas) {
    const now = Date.now();
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.type === 'shell') {
        // Draw trail
        for (let t = 0; t < p.trail.length; t++) {
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
