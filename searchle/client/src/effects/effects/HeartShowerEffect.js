// ===== Heart Shower Effect =====
// Fan-club "Heart Me" win effect. Renders the actual fanclub-heart.png
// (cartoon crowned heart sprite) as falling/rising hearts during a win
// celebration. Mirrors HeartsEffect's motion (rise from bottom + gentle
// wobble) but draws the PNG image instead of canvas-bezier hearts so
// the visual matches what the grid-mode chip burst already shows.
//
// The PNG is loaded once on first init() and cached — subsequent wins
// reuse the loaded HTMLImageElement. If the image fails to load, the
// effect falls back to rendering an empty step (no canvas hearts) so
// we never see a broken-image icon; the grid-mode trail is the
// authoritative heart visual anyway.

const HEART_IMG_URL = 'https://wordtycoon.live/cosmetics/fanclub-heart.png?v=3';

let _img = null;
let _imgLoaded = false;
let _imgFailed = false;

function _ensureImage() {
  if (_img || _imgFailed) return;
  _img = new Image();
  _img.crossOrigin = 'anonymous';
  _img.onload = () => { _imgLoaded = true; };
  _img.onerror = () => {
    _imgFailed = true;
    _img = null;
    console.warn('[HeartShowerEffect] fanclub-heart.png failed to load');
  };
  _img.src = HEART_IMG_URL;
}

function rand(min, max) { return Math.random() * (max - min) + min; }

function makeHeartParticle(w, h) {
  return {
    x: rand(0, w),
    y: h + rand(10, 60),
    vx: rand(-1, 1),
    vy: rand(-4, -2),
    size: rand(36, 64),
    rotation: rand(-15, 15),
    rotSpeed: rand(-0.5, 0.5),
    wobble: rand(0, Math.PI * 2),
    wobbleSpeed: rand(0.02, 0.05),
    opacity: 1,
    fadeStart: 0.7,
  };
}

export const heart_shower = {
  init(cfg, w, h) {
    _ensureImage();
    const ps = [];
    const count = cfg.particleCount || 50;
    for (let i = 0; i < count; i++) {
      ps.push(makeHeartParticle(w, h));
    }
    return ps;
  },

  update(ps, dt, elapsed, dur, w, h, effectConfig) {
    // Keep topping up particles during the first ~65% of duration so
    // the shower feels continuous rather than puffing out early.
    if (elapsed < dur * 0.65 && ps.length < 70) {
      ps.push(makeHeartParticle(w, h));
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * 0.5;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      const progress = elapsed / dur;
      if (progress > p.fadeStart) {
        p.opacity = Math.max(0, 1 - (progress - p.fadeStart) / (1 - p.fadeStart));
      }
      if (p.y < -80 || p.opacity <= 0) ps.splice(i, 1);
    }
  },

  draw(ps, ctx, canvas) {
    // No image yet → nothing to render this frame. The image arrives
    // asynchronously; once _imgLoaded flips true, subsequent draws fill in.
    if (!_imgLoaded || !_img) return;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      // PNG is square; draw centered at translated origin.
      ctx.drawImage(_img, -p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  },
};
