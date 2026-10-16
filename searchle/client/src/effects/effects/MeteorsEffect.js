// ===== Meteors Effect =====
// Streaking meteors with glowing trails racing across the screen.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeMeteor(colors, w, h) {
  const startX = rand(-50, w + 50);
  const angle = rand(0.3, 0.8);
  return {
    x: startX, y: -20,
    vx: Math.cos(angle) * rand(6, 14), vy: Math.sin(angle) * rand(6, 14),
    size: rand(3, 6), color: pick(colors), tailLen: rand(30, 80),
    trail: [], life: 1, decay: rand(0.005, 0.012)
  };
}

// Module-level state for meteor timing
let _lastMeteor = 0;

export const meteors = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 12); i++) {
      const p = makeMeteor(cfg.colors, w, h);
      p.delay = i * 200;
      p.born = Date.now();
      ps.push(p);
    }
    _lastMeteor = Date.now();
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    const now = Date.now();
    // Spawn new meteors periodically during first 70% of duration
    if (elapsed < dur * 0.7 && now - _lastMeteor > 300 && ps.length < 20) {
      const p = makeMeteor(effectConfig.colors, w, h);
      p.delay = 0;
      p.born = now;
      ps.push(p);
      _lastMeteor = now;
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (now - p.born < (p.delay || 0)) continue;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 15) p.trail.shift();
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0 || p.y > h + 30 || p.x > w + 50) ps.splice(i, 1);
    }
  },

  draw(ps, ctx, canvas) {
    const now = Date.now();
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (now - p.born < (p.delay || 0)) continue;
      // Trail
      for (let t = 0; t < p.trail.length; t++) {
        const tAlpha = (t / p.trail.length) * p.life * 0.6;
        const tSize = p.size * (t / p.trail.length);
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
