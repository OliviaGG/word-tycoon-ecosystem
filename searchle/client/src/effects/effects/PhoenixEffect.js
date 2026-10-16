// ===== Phoenix Effect =====
// Fire particles rising from the bottom with glowing trails.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makePhoenixParticle(colors, w, h) {
  const cx = w / 2;
  return {
    x: cx + rand(-30, 30), y: h + rand(0, 20),
    vx: rand(-2, 2), vy: rand(-8, -3),
    size: rand(3, 8), color: pick(colors),
    life: 1, decay: rand(0.008, 0.02), gravity: -0.05,
    trail: []
  };
}

export const phoenix = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 80); i++) {
      const p = makePhoenixParticle(cfg.colors, w, h);
      p.delay = rand(0, 1500);
      p.born = Date.now();
      ps.push(p);
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    const now = Date.now();
    // Continuously spawn phoenix particles during first 70% of duration
    if (elapsed < dur * 0.7 && ps.length < 100) {
      const p = makePhoenixParticle(effectConfig.colors, w, h);
      p.delay = 0;
      p.born = now;
      ps.push(p);
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
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

  draw(ps, ctx, canvas) {
    const now = Date.now();
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (now - p.born < p.delay) continue;
      // Fire trail
      for (let t = 0; t < p.trail.length; t++) {
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
