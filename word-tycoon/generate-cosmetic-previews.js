// generate-cosmetic-previews.js — Creates individual preview PNGs for each cosmetic
// Output: public/previews/{cosmetic_id}.png (400x200 split dark/light)
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const { COSMETICS_CATALOG } = require('./src/cosmetics');

const OUT_DIR = path.join(__dirname, 'public', 'previews');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const W = 400, H = 200;
const HALF = W / 2;
const DARK_BG = '#0d0d1a';
const LIGHT_BG = '#e0dfe8';

const RARITY_COLORS = {
  common: '#9d9d9d', uncommon: '#4fc34f', rare: '#4a9eff',
  epic: '#b44aff', legendary: '#ffab00', ultra: '#ff4444', aux: '#00ffcc'
};

// ─── CSS text-shadow parser ───────────────────────────────────
function parseTextShadow(str) {
  if (!str) return [];
  const layers = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= str.length; i++) {
    if (i < str.length && str[i] === '(') depth++;
    else if (i < str.length && str[i] === ')') depth--;
    else if ((i === str.length || str[i] === ',') && depth === 0) {
      layers.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  return layers;
}

function parseShadowLayer(layer) {
  // Extract numeric values and color
  const parts = layer.trim().split(/\s+/);
  let ox = 0, oy = 0, blur = 0, color = '#000';
  const nums = [];
  let colorParts = [];
  let inColor = false;
  for (const p of parts) {
    if (p.startsWith('rgba(') || p.startsWith('rgb(') || p.startsWith('#')) {
      inColor = true;
      colorParts.push(p);
    } else if (inColor) {
      colorParts.push(p);
    } else {
      nums.push(parseFloat(p) || 0);
    }
  }
  if (colorParts.length > 0) color = colorParts.join(' ');
  if (nums.length >= 2) { ox = nums[0]; oy = nums[1]; }
  if (nums.length >= 3) blur = nums[2];
  return { ox, oy, blur, color };
}

function parseColor(str) {
  str = str.trim();
  if (str.startsWith('rgba(')) {
    const m = str.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
  }
  if (str.startsWith('rgb(')) {
    const m = str.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: 1 };
  }
  if (str.startsWith('#')) {
    const hex = str.slice(1);
    if (hex.length === 3) return { r: parseInt(hex[0]+hex[0],16), g: parseInt(hex[1]+hex[1],16), b: parseInt(hex[2]+hex[2],16), a: 1 };
    if (hex.length === 6) return { r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16), a: 1 };
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

// ─── Render helpers ───────────────────────────────────────────

function drawTextWithShadows(ctx, text, cx, cy, fontSize, css) {
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const layers = parseTextShadow(css.textShadow);

  // Draw glow layers (those with blur > 0) from outermost to innermost
  const glowLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
  glowLayers.sort((a, b) => b.blur - a.blur);
  for (const gl of glowLayers) {
    ctx.save();
    ctx.shadowOffsetX = gl.ox;
    ctx.shadowOffsetY = gl.oy;
    ctx.shadowBlur = gl.blur * 1.5;
    ctx.shadowColor = gl.color;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillText(text, cx, cy);
    ctx.restore();
    // Draw again to intensify
    ctx.save();
    ctx.shadowOffsetX = gl.ox;
    ctx.shadowOffsetY = gl.oy;
    ctx.shadowBlur = gl.blur;
    ctx.shadowColor = gl.color;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  // Draw outline layers (those with blur === 0, typically the 8-direction black outline)
  const outlineLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur === 0);
  for (const ol of outlineLayers) {
    ctx.fillStyle = ol.color;
    ctx.fillText(text, cx + ol.ox, cy + ol.oy);
  }

  // Draw main text
  ctx.fillStyle = css.color || '#fff';
  ctx.fillText(text, cx, cy);
}

function drawCircleWithBorder(ctx, cx, cy, radius, css) {
  // Parse border
  let borderWidth = 3, borderColor = '#fff';
  if (css.border) {
    const m = css.border.match(/(\d+)px\s+solid\s+(.*)/);
    if (m) { borderWidth = +m[1]; borderColor = m[2].trim(); }
  }

  // Draw glow (boxShadow)
  if (css.boxShadow) {
    const layers = parseTextShadow(css.boxShadow);
    const glowLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0 && !l.color.includes('inset'));
    glowLayers.sort((a, b) => b.blur - a.blur);
    for (const gl of glowLayers) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.shadowOffsetX = gl.ox;
      ctx.shadowOffsetY = gl.oy;
      ctx.shadowBlur = gl.blur * 1.5;
      ctx.shadowColor = gl.color;
      ctx.fillStyle = 'rgba(0,0,0,0.01)';
      ctx.fill();
      ctx.restore();
    }
  }

  // Draw circle fill
  ctx.beginPath();
  ctx.arc(cx, cy, radius - borderWidth, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(80,80,100,0.5)';
  ctx.fill();

  // Draw border
  ctx.beginPath();
  ctx.arc(cx, cy, radius - borderWidth / 2, 0, Math.PI * 2);
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = borderColor;
  ctx.stroke();
}

function drawGlowCircle(ctx, cx, cy, radius, css) {
  // Parse boxShadow for glow
  if (css.boxShadow) {
    const layers = parseTextShadow(css.boxShadow);
    const glowLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
    glowLayers.sort((a, b) => b.blur - a.blur);
    for (const gl of glowLayers) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.shadowBlur = gl.blur * 1.8;
      ctx.shadowColor = gl.color;
      ctx.fillStyle = 'rgba(0,0,0,0.01)';
      ctx.fill();
      ctx.restore();
    }
  }

  // Draw circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(100,100,130,0.6)';
  ctx.fill();
}

function drawWinEffectDots(ctx, cx, cy, css) {
  const colors = css.colors || ['#fff'];
  const count = Math.min(css.particleCount || 40, 60);
  const rng = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
  const rand = rng(42);
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 10 + rand() * 60;
    const dx = cx + Math.cos(angle) * dist;
    const dy = cy + Math.sin(angle) * dist;
    const size = 1.5 + rand() * 3;
    ctx.beginPath();
    ctx.arc(dx, dy, size, 0, Math.PI * 2);
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.5 + rand() * 0.5;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─── Main generation ──────────────────────────────────────────

let generated = 0;
for (const item of COSMETICS_CATALOG) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const css = item.css || {};

  // Left half: dark bg
  ctx.fillStyle = DARK_BG;
  ctx.fillRect(0, 0, HALF, H);

  // Right half: light bg
  ctx.fillStyle = LIGHT_BG;
  ctx.fillRect(HALF, 0, HALF, H);

  // Divider line
  ctx.strokeStyle = 'rgba(128,128,128,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(HALF, 0);
  ctx.lineTo(HALF, H);
  ctx.stroke();

  const cat = item.category;
  const leftCx = HALF / 2;
  const rightCx = HALF + HALF / 2;
  const centerY = H / 2 + 6;

  if (cat === 'word_color' || cat === 'name_color') {
    const text = cat === 'word_color' ? 'HELLO' : 'Player';
    const fontSize = cat === 'word_color' ? 32 : 28;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, HALF, H); ctx.clip();
    drawTextWithShadows(ctx, text, leftCx, centerY, fontSize, css);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(HALF, 0, HALF, H); ctx.clip();
    drawTextWithShadows(ctx, text, rightCx, centerY, fontSize, css);
    ctx.restore();
  } else if (cat === 'word_glow' || cat === 'name_glow') {
    const text = cat === 'word_glow' ? 'GLOW' : 'Name';
    const fontSize = 28;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, HALF, H); ctx.clip();
    drawTextWithShadows(ctx, text, leftCx, centerY, fontSize, { ...css, color: '#fff' });
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(HALF, 0, HALF, H); ctx.clip();
    drawTextWithShadows(ctx, text, rightCx, centerY, fontSize, { ...css, color: '#222' });
    ctx.restore();
  } else if (cat === 'profile_border') {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, HALF, H); ctx.clip();
    drawCircleWithBorder(ctx, leftCx, centerY, 40, css);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(HALF, 0, HALF, H); ctx.clip();
    drawCircleWithBorder(ctx, rightCx, centerY, 40, css);
    ctx.restore();
  } else if (cat === 'profile_glow') {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, HALF, H); ctx.clip();
    drawGlowCircle(ctx, leftCx, centerY, 30, css);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(HALF, 0, HALF, H); ctx.clip();
    drawGlowCircle(ctx, rightCx, centerY, 30, css);
    ctx.restore();
  } else if (cat === 'title') {
    const titleText = `[${css.title || item.name}]`;
    const titleCss = { color: css.titleColor || '#fff', textShadow: css.titleGlow || '' };
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, HALF, H); ctx.clip();
    drawTextWithShadows(ctx, titleText, leftCx, centerY, 24, titleCss);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(HALF, 0, HALF, H); ctx.clip();
    drawTextWithShadows(ctx, titleText, rightCx, centerY, 24, titleCss);
    ctx.restore();
  } else if (cat === 'win_effect') {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, HALF, H); ctx.clip();
    drawWinEffectDots(ctx, leftCx, centerY, css);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(HALF, 0, HALF, H); ctx.clip();
    drawWinEffectDots(ctx, rightCx, centerY, css);
    ctx.restore();
  }

  // ─── Labels ───
  // Name + rarity badge
  const rarColor = RARITY_COLORS[item.rarity] || '#999';
  const rarLabel = item.rarity.toUpperCase();

  // Top-left: item name
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText(item.name, 8, 8);
  ctx.shadowBlur = 0;

  // Top-right: rarity pill
  ctx.font = 'bold 9px Arial';
  const rarW = ctx.measureText(rarLabel).width + 10;
  const rarX = W - rarW - 6;
  // Pill bg
  ctx.beginPath();
  const ph = 16;
  ctx.moveTo(rarX + ph/2, 6);
  ctx.lineTo(rarX + rarW - ph/2, 6);
  ctx.arc(rarX + rarW - ph/2, 6 + ph/2, ph/2, -Math.PI/2, Math.PI/2);
  ctx.lineTo(rarX + ph/2, 6 + ph);
  ctx.arc(rarX + ph/2, 6 + ph/2, ph/2, Math.PI/2, -Math.PI/2);
  ctx.closePath();
  ctx.fillStyle = rarColor;
  ctx.globalAlpha = 0.2;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rarColor;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = rarColor;
  ctx.textAlign = 'center';
  ctx.fillText(rarLabel, rarX + rarW/2, 6 + ph/2 - 3.5);

  // Animated badge
  if (css.animation || item.audioReactive) {
    const badge = item.audioReactive ? 'AUX' : 'ANIMATED';
    ctx.font = 'bold 8px Arial';
    const bw = ctx.measureText(badge).width + 8;
    ctx.fillStyle = 'rgba(0,255,204,0.15)';
    ctx.fillRect(8, H - 22, bw, 14);
    ctx.strokeStyle = 'rgba(0,255,204,0.5)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(8, H - 22, bw, 14);
    ctx.fillStyle = '#00ffcc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge, 12, H - 15);
  }

  // Bottom labels
  ctx.font = '9px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('DARK', leftCx, H - 4);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillText('LIGHT', rightCx, H - 4);

  // Save
  const outPath = path.join(OUT_DIR, `${item.id}.png`);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  generated++;
}

// Generate index.json
const index = {};
for (const item of COSMETICS_CATALOG) {
  index[item.id] = { name: item.name, category: item.category, rarity: item.rarity, preview: `previews/${item.id}.png` };
}
fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

console.log(`Generated ${generated} cosmetic preview PNGs in ${OUT_DIR}`);
console.log(`Generated previews/index.json with ${Object.keys(index).length} entries`);
