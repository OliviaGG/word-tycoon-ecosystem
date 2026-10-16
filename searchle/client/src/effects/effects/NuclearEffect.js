// ===== Nuclear Effect =====
// Central explosion with shockwave rings, white flash, and radiating particles.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeNuclearParticle(colors, w, h) {
  const cx = w / 2, cy = h / 2;
  const angle = rand(0, Math.PI * 2);
  const speed = rand(3, 15);
  return {
    x: cx, y: cy,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    size: rand(2, 6), color: pick(colors),
    life: 1, decay: rand(0.005, 0.015), gravity: 0.04
  };
}

export const nuclear = {
  init(cfg, w, h) {
    const ps = [];
    // Shockwave rings
    ps.push({
      type: 'ring', cx: w / 2, cy: h / 2,
      radius: 0, maxRadius: Math.max(w, h),
      speed: 14, opacity: 1, width: 10
    });
    ps.push({
      type: 'ring', cx: w / 2, cy: h / 2,
      radius: 0, maxRadius: Math.max(w, h),
      speed: 10, opacity: 0.7, width: 6,
      delay: 200, born: Date.now()
    });
    // Flash
    ps.push({ type: 'flash', opacity: 1 });
    // Particles
    for (let i = 0; i < (cfg.particleCount || 150); i++) {
      const p = makeNuclearParticle(cfg.colors, w, h);
      p.type = 'particle';
      p.delay = rand(0, 500);
      p.born = Date.now();
      ps.push(p);
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    const now = Date.now();
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
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

  draw(ps, ctx, canvas) {
    const now = Date.now();
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
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
