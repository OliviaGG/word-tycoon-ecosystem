// ===== Lightning Effect =====
// Electric bolts flash from top to bottom with glow and flicker.
// Ported from Searchle 2.0 to 3.0

function rand(min, max) { return Math.random() * (max - min) + min; }

function makeLightningBolt(w, h) {
  let x = rand(w * 0.1, w * 0.9);
  const points = [{ x: x, y: 0 }];
  let y = 0;
  while (y < h) {
    y += rand(20, 60);
    x += rand(-40, 40);
    points.push({ x: x, y: Math.min(y, h) });
  }
  return {
    points: points, opacity: 1, width: rand(2, 5),
    glow: rand(15, 30), delay: rand(0, 1500), born: Date.now()
  };
}

export const lightning = {
  init(cfg, w, h) {
    const ps = [];
    for (let i = 0; i < (cfg.particleCount || 8); i++) {
      ps.push(makeLightningBolt(w, h));
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    const now = Date.now();
    // Spawn new bolts periodically during first 80% of duration
    if (elapsed < dur * 0.8 && ps.length < 4) {
      const bolt = makeLightningBolt(w, h);
      bolt.delay = 0;
      bolt.born = now;
      ps.push(bolt);
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      const age = now - p.born;
      if (age < p.delay) continue;
      const liveAge = age - p.delay;
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

  draw(ps, ctx, canvas) {
    const now = Date.now();
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (now - p.born < p.delay) continue;
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = p.width;
      ctx.shadowColor = '#a5f3fc';
      ctx.shadowBlur = p.glow;
      ctx.beginPath();
      ctx.moveTo(p.points[0].x, p.points[0].y);
      for (let j = 1; j < p.points.length; j++) {
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
