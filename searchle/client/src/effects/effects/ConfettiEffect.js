// ===== Confetti Effect =====
// Colorful confetti pieces falling from above with wobble and rotation.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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

export const confetti = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 80); i++) {
      ps.push(makeConfettiParticle(cfg.colors, w, h));
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    // Continuously spawn new confetti during first 70% of duration
    if (elapsed < dur * 0.7 && ps.length < 120) {
      const spawnRate = Math.max(1, Math.floor((effectConfig.particleCount || 80) / 30));
      for (let s = 0; s < spawnRate; s++) {
        ps.push(makeConfettiParticle(effectConfig.colors, w, h));
      }
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
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

  draw(ps, ctx, canvas) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
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
