// generate-cosmetics-image.js — Creates a PNG infographic of all cosmetics for Discord
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// ─── Data ──────────────────────────────────────────────────
const RARITY_COLORS = {
  common: '#9d9d9d',
  uncommon: '#4fc34f',
  rare: '#4a9eff',
  epic: '#b44aff',
  legendary: '#ffab00',
  ultra: '#ff4444',
  aux: '#00ffcc'
};

const RARITY_BG = {
  common: '#2a2a2a',
  uncommon: '#1a2e1a',
  rare: '#1a2040',
  epic: '#251a40',
  legendary: '#302000',
  ultra: '#301010',
  aux: '#002a22'
};

const CATEGORY_ICONS = {
  word_color: '🔤',
  word_glow: '✦',
  profile_border: '🔲',
  profile_glow: '✨',
  name_glow: '💫',
  name_color: '🏷️',
  title: '👑',
  win_effect: '🎆'
};

const CATEGORY_NAMES = {
  word_color: 'WORD COLORS',
  word_glow: 'WORD GLOWS',
  profile_border: 'BORDERS',
  profile_glow: 'GLOWS',
  name_glow: 'NAME GLOWS',
  name_color: 'NAME COLORS',
  title: 'TITLES',
  win_effect: 'WIN EFFECTS'
};

const CATEGORY_DESC = {
  word_color: 'Changes the color of your guessed words',
  word_glow: 'Adds a glow effect around your guessed words',
  profile_border: 'Adds a border ring around your profile picture',
  profile_glow: 'Adds a glowing aura around your profile picture',
  name_glow: 'Adds a glow effect behind your username',
  name_color: 'Changes the color of your displayed name',
  title: 'Shows a custom title under your name',
  win_effect: 'Plays a particle animation when you win a game'
};

// Load cosmetics catalog
const { COSMETICS_CATALOG, COSMETIC_SETS } = require('./src/cosmetics');

// Group by category
const byCategory = {};
for (const item of COSMETICS_CATALOG) {
  if (!byCategory[item.category]) byCategory[item.category] = [];
  byCategory[item.category].push(item);
}
// Sort each category by sort order
for (const cat of Object.keys(byCategory)) {
  byCategory[cat].sort((a, b) => a.sort - b.sort);
}

const categories = ['word_color', 'word_glow', 'profile_border', 'profile_glow', 'name_glow', 'name_color', 'title', 'win_effect'];

// ─── Glow simulation helpers ─────────────────────────────────
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

function drawGlowText(ctx, text, x, y, fontSize, css) {
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const layers = parseTextShadow(css.textShadow);

  // Draw glow layers (blur > 0) from outermost to innermost
  const glowLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
  glowLayers.sort((a, b) => b.blur - a.blur);
  for (const gl of glowLayers) {
    ctx.save();
    ctx.shadowOffsetX = gl.ox;
    ctx.shadowOffsetY = gl.oy;
    ctx.shadowBlur = gl.blur * 1.5;
    ctx.shadowColor = gl.color;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillText(text, x, y);
    ctx.restore();
    // Draw again to intensify
    ctx.save();
    ctx.shadowOffsetX = gl.ox;
    ctx.shadowOffsetY = gl.oy;
    ctx.shadowBlur = gl.blur;
    ctx.shadowColor = gl.color;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // Draw outline layers (blur === 0, typically 8-direction black outline)
  const outlineLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur === 0);
  for (const ol of outlineLayers) {
    ctx.fillStyle = ol.color;
    ctx.fillText(text, x + ol.ox, y + ol.oy);
  }

  // Draw main text
  ctx.fillStyle = css.color || '#fff';
  ctx.fillText(text, x, y);

  // Clear shadow state
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

// ─── Layout constants ──────────────────────────────────────
const IMG_WIDTH = 1300;
const PADDING = 30;
const HEADER_HEIGHT = 160;
const CATEGORY_HEADER_H = 50;
const ROW_HEIGHT = 36;
const TABLE_HEADER_H = 30;
const CATEGORY_GAP = 20;
const FOOTER_HEIGHT = 180;

// Column positions for each table
const COL_NAME = 40;
const COL_CODE = 310;
const COL_RARITY = 490;
const COL_PRICE = 640;
const COL_PREVIEW = 800;
const TABLE_WIDTH = IMG_WIDTH - PADDING * 2;

// ─── Measure total height ──────────────────────────────────
function formatPrice(cost) {
  if (cost >= 1000000000) return (cost / 1000000000).toFixed(1) + 'B';
  if (cost >= 1000000) return (cost / 1000000).toFixed(cost % 1000000 === 0 ? 0 : 1) + 'M';
  if (cost >= 1000) return (cost / 1000).toFixed(cost % 1000 === 0 ? 0 : 1) + 'K';
  return cost.toString();
}

let totalHeight = HEADER_HEIGHT;
for (const cat of categories) {
  const items = byCategory[cat] || [];
  totalHeight += CATEGORY_HEADER_H + TABLE_HEADER_H + items.length * ROW_HEIGHT + CATEGORY_GAP + 10;
}
totalHeight += FOOTER_HEIGHT;

// ─── Create canvas ─────────────────────────────────────────
const canvas = createCanvas(IMG_WIDTH, totalHeight);
const ctx = canvas.getContext('2d');

// ─── Background ────────────────────────────────────────────
// Dark gradient background
const bgGrad = ctx.createLinearGradient(0, 0, 0, totalHeight);
bgGrad.addColorStop(0, '#0d0d1a');
bgGrad.addColorStop(0.5, '#111122');
bgGrad.addColorStop(1, '#0d0d1a');
ctx.fillStyle = bgGrad;
ctx.fillRect(0, 0, IMG_WIDTH, totalHeight);

// Subtle border
ctx.strokeStyle = '#333355';
ctx.lineWidth = 2;
ctx.strokeRect(1, 1, IMG_WIDTH - 2, totalHeight - 2);

// ─── Helper functions ──────────────────────────────────────
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawPill(x, y, text, bgColor, textColor, fontSize) {
  ctx.font = `bold ${fontSize || 11}px Arial`;
  const metrics = ctx.measureText(text);
  const pw = metrics.width + 12;
  const ph = (fontSize || 11) + 8;
  roundRect(x, y, pw, ph, ph / 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.fillStyle = textColor || '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + ph / 2 + 1);
  return pw;
}

// ─── Header ────────────────────────────────────────────────
let y = PADDING;

// Title
ctx.font = 'bold 36px Arial';
ctx.fillStyle = '#ffffff';
ctx.textAlign = 'center';
ctx.textBaseline = 'top';
ctx.fillText('WORD EMPIRES — COSMETICS GUIDE', IMG_WIDTH / 2, y);
y += 48;

// Subtitle
ctx.font = '16px Arial';
ctx.fillStyle = '#8888aa';
ctx.fillText('Customize your profile with colors, glows, borders, titles & win effects!', IMG_WIDTH / 2, y);
y += 30;

// Commands box
const cmdBoxY = y;
const cmdBoxH = 52;
roundRect(PADDING + 50, cmdBoxY, IMG_WIDTH - PADDING * 2 - 100, cmdBoxH, 8);
ctx.fillStyle = '#1a1a30';
ctx.fill();
ctx.strokeStyle = '#333366';
ctx.lineWidth = 1;
ctx.stroke();

ctx.font = 'bold 13px Arial';
ctx.fillStyle = '#aaaacc';
ctx.textAlign = 'center';
ctx.fillText('!shop [category]  ·  !buyc [name]  ·  !equip [name]  ·  !unequip [category]  ·  !mycos  ·  !sets  ·  !buyset', IMG_WIDTH / 2, cmdBoxY + 14);
ctx.font = '12px Arial';
ctx.fillStyle = '#666688';
ctx.fillText('Categories: wc · wg · pb · pg · ng · nc · tt · we      Example: !buyc crimson   (auto-equips on purchase)', IMG_WIDTH / 2, cmdBoxY + 34);

y = cmdBoxY + cmdBoxH + 18;

// ─── Category sections ─────────────────────────────────────
for (const cat of categories) {
  const items = byCategory[cat] || [];
  const catName = CATEGORY_NAMES[cat];
  const catDesc = CATEGORY_DESC[cat];

  // Category header bar
  roundRect(PADDING, y, TABLE_WIDTH, CATEGORY_HEADER_H, 8);
  const catGrad = ctx.createLinearGradient(PADDING, y, PADDING + TABLE_WIDTH, y);
  catGrad.addColorStop(0, '#1a1a35');
  catGrad.addColorStop(1, '#151528');
  ctx.fillStyle = catGrad;
  ctx.fill();
  ctx.strokeStyle = '#333366';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Category name
  ctx.font = 'bold 18px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${catName}`, PADDING + 16, y + CATEGORY_HEADER_H / 2);

  // Item count pill
  const countText = `${items.length} items`;
  ctx.font = 'bold 11px Arial';
  const nameW = ctx.measureText(catName).width;
  ctx.font = 'bold 18px Arial';

  drawPill(PADDING + 16 + ctx.measureText(catName).width + 14, y + CATEGORY_HEADER_H / 2 - 10, countText, '#333366', '#8888bb');

  // Description
  ctx.font = '13px Arial';
  ctx.fillStyle = '#8888aa';
  ctx.textAlign = 'right';
  ctx.fillText(catDesc, PADDING + TABLE_WIDTH - 16, y + CATEGORY_HEADER_H / 2);

  y += CATEGORY_HEADER_H + 4;

  // Table header
  roundRect(PADDING, y, TABLE_WIDTH, TABLE_HEADER_H, 0);
  ctx.fillStyle = '#16162a';
  ctx.fill();

  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = '#666688';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('NAME (use in commands)', PADDING + COL_NAME, y + TABLE_HEADER_H / 2);
  ctx.fillText('ALT CODE', PADDING + COL_CODE, y + TABLE_HEADER_H / 2);
  ctx.fillText('RARITY', PADDING + COL_RARITY, y + TABLE_HEADER_H / 2);
  ctx.fillText('PRICE', PADDING + COL_PRICE, y + TABLE_HEADER_H / 2);
  ctx.fillText('PREVIEW', PADDING + COL_PREVIEW, y + TABLE_HEADER_H / 2);

  y += TABLE_HEADER_H;

  // Table rows
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rowY = y;
    const mid = rowY + ROW_HEIGHT / 2;

    // Alternating row background
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(PADDING, rowY, TABLE_WIDTH, ROW_HEIGHT);
    }

    // Left color accent stripe
    ctx.fillStyle = RARITY_COLORS[item.rarity] + '40';
    ctx.fillRect(PADDING, rowY, 3, ROW_HEIGHT);

    // ─── Enhanced color swatch with glow simulation ───
    if (cat === 'word_color' || cat === 'name_color') {
      // Color categories: circle with dark ring + glow halo
      const swatchColor = item.css && item.css.color ? item.css.color : '#fff';
      // Glow halo
      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = swatchColor;
      ctx.beginPath();
      ctx.arc(PADDING + 22, mid, 7, 0, Math.PI * 2);
      ctx.fillStyle = swatchColor;
      ctx.fill();
      ctx.restore();
      // Dark ring
      ctx.beginPath();
      ctx.arc(PADDING + 22, mid, 8, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#111';
      ctx.stroke();
      // Clear shadow
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    } else if (cat === 'word_glow' || cat === 'name_glow' || cat === 'profile_glow') {
      // Glow categories: glowing circle with the glow color
      let glowColor = '#ffffff';
      if (item.css && item.css.textShadow) {
        const layers = parseTextShadow(item.css.textShadow);
        const glowLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
        if (glowLayers.length > 0) glowColor = glowLayers[0].color;
      } else if (item.css && item.css.boxShadow) {
        const layers = parseTextShadow(item.css.boxShadow);
        const glowLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
        if (glowLayers.length > 0) glowColor = glowLayers[0].color;
      }
      // Glow halo
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = glowColor;
      ctx.beginPath();
      ctx.arc(PADDING + 22, mid, 6, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      // Inner circle
      ctx.beginPath();
      ctx.arc(PADDING + 22, mid, 5, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    } else if (cat === 'profile_border') {
      // Border categories: circle with visible border ring
      let borderColor = '#ffffff';
      if (item.css && item.css.border) {
        const m = item.css.border.match(/solid\s+(.*)/);
        if (m) borderColor = m[1].trim();
      }
      ctx.beginPath();
      ctx.arc(PADDING + 22, mid, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80,80,100,0.5)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = borderColor;
      ctx.stroke();
      // Subtle glow
      ctx.save();
      ctx.shadowBlur = 6;
      ctx.shadowColor = borderColor;
      ctx.beginPath();
      ctx.arc(PADDING + 22, mid, 7, 0, Math.PI * 2);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    } else if (cat === 'win_effect' && item.css && item.css.colors) {
      // Mini color dots for win effects (keep as-is)
      const colors = item.css.colors.slice(0, 4);
      for (let d = 0; d < colors.length; d++) {
        ctx.fillStyle = colors[d];
        ctx.beginPath();
        ctx.arc(PADDING + 12 + d * 10, mid, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (cat === 'title' && item.css && item.css.titleColor) {
      const swatchColor = item.css.titleColor;
      ctx.save();
      ctx.shadowBlur = 6;
      ctx.shadowColor = swatchColor;
      ctx.beginPath();
      ctx.arc(PADDING + 22, mid, 7, 0, Math.PI * 2);
      ctx.fillStyle = swatchColor;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(PADDING + 22, mid, 8, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#111';
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }

    // Name + animated indicator
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = '#ddddee';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.name, PADDING + COL_NAME, mid);
    // Animated indicator: cyan sparkle after name
    if (item.css && item.css.animation) {
      const nameWidth = ctx.measureText(item.name).width;
      ctx.fillStyle = '#00ffcc';
      ctx.font = 'bold 12px Arial';
      ctx.fillText(' \u2726', PADDING + COL_NAME + nameWidth, mid);
    }

    // Code (monospace)
    ctx.font = '12px Courier New';
    ctx.fillStyle = '#88aacc';
    ctx.fillText(item.id, PADDING + COL_CODE, mid);

    // Rarity pill
    const rarColor = RARITY_COLORS[item.rarity];
    const rarBg = rarColor + '25';
    drawPill(PADDING + COL_RARITY, mid - 9, item.rarity.toUpperCase(), rarBg, rarColor, 10);

    // Set tag (if part of a set)
    if (item.setId) {
      const setDef = COSMETIC_SETS[item.setId];
      const setTag = setDef ? setDef.name : item.setId;
      drawPill(PADDING + COL_PRICE + 120, mid - 9, '\u{1F9E9} ' + setTag, '#333366', '#aaaacc', 9);
    }

    // Price
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = item.giftSet ? '#e53e3e' : '#ffd700';
    ctx.textAlign = 'left';
    const priceText = item.giftSet ? 'GIFT SET' : formatPrice(item.cost) + ' coins';
    ctx.fillText(priceText, PADDING + COL_PRICE, mid);

    // ─── PREVIEW column ───
    const prevX = PADDING + COL_PREVIEW;
    const prevW = 120;
    const prevH = ROW_HEIGHT - 8;
    const prevY = rowY + 4;

    if (cat === 'word_color' || cat === 'name_color' || cat === 'word_glow' || cat === 'name_glow' || cat === 'title') {
      // Text preview: "AW" on dark chip
      roundRect(prevX, prevY, prevW, prevH, 4);
      ctx.fillStyle = '#0d0d18';
      ctx.fill();
      ctx.strokeStyle = '#222244';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      const previewText = cat === 'title' ? (item.css.title || item.name).substring(0, 8) : 'AW';
      const previewCss = {};
      if (cat === 'title') {
        previewCss.color = item.css.titleColor || '#fff';
        previewCss.textShadow = item.css.titleGlow || '';
      } else {
        previewCss.color = item.css.color || '#fff';
        previewCss.textShadow = item.css.textShadow || '';
      }

      // Clip to preview area
      ctx.save();
      ctx.beginPath();
      ctx.rect(prevX, prevY, prevW, prevH);
      ctx.clip();
      drawGlowText(ctx, previewText, prevX + prevW / 2, prevY + prevH / 2, 14, previewCss);
      ctx.restore();

      // Animated lightning indicator
      if (item.css && item.css.animation) {
        ctx.font = 'bold 10px Arial';
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u26A1', prevX + prevW + 14, mid);
      }
    } else if (cat === 'profile_border') {
      // Circle preview with border
      roundRect(prevX, prevY, prevW, prevH, 4);
      ctx.fillStyle = '#0d0d18';
      ctx.fill();

      let borderColor = '#ffffff';
      let borderWidth = 2;
      if (item.css && item.css.border) {
        const m = item.css.border.match(/(\d+)px\s+solid\s+(.*)/);
        if (m) { borderWidth = Math.min(+m[1], 3); borderColor = m[2].trim(); }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(prevX, prevY, prevW, prevH);
      ctx.clip();
      // Glow ring
      if (item.css && item.css.boxShadow) {
        const layers = parseTextShadow(item.css.boxShadow);
        const glowLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
        glowLayers.sort((a, b) => b.blur - a.blur);
        for (const gl of glowLayers) {
          ctx.save();
          ctx.shadowBlur = gl.blur * 1.2;
          ctx.shadowColor = gl.color;
          ctx.beginPath();
          ctx.arc(prevX + prevW / 2, prevY + prevH / 2, 8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.01)';
          ctx.fill();
          ctx.restore();
        }
      }
      // Circle fill
      ctx.beginPath();
      ctx.arc(prevX + prevW / 2, prevY + prevH / 2, 8 - borderWidth, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80,80,100,0.5)';
      ctx.fill();
      // Border ring
      ctx.beginPath();
      ctx.arc(prevX + prevW / 2, prevY + prevH / 2, 8 - borderWidth / 2, 0, Math.PI * 2);
      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = borderColor;
      ctx.stroke();
      ctx.restore();

      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';

      if (item.css && item.css.animation) {
        ctx.font = 'bold 10px Arial';
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u26A1', prevX + prevW + 14, mid);
      }
    } else if (cat === 'profile_glow') {
      // Glow circle preview
      roundRect(prevX, prevY, prevW, prevH, 4);
      ctx.fillStyle = '#0d0d18';
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.rect(prevX, prevY, prevW, prevH);
      ctx.clip();
      // Draw glow from boxShadow
      if (item.css && item.css.boxShadow) {
        const layers = parseTextShadow(item.css.boxShadow);
        const glowLayers = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
        glowLayers.sort((a, b) => b.blur - a.blur);
        for (const gl of glowLayers) {
          ctx.save();
          ctx.shadowBlur = gl.blur * 1.5;
          ctx.shadowColor = gl.color;
          ctx.beginPath();
          ctx.arc(prevX + prevW / 2, prevY + prevH / 2, 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.01)';
          ctx.fill();
          ctx.restore();
        }
      }
      // Inner circle
      ctx.beginPath();
      ctx.arc(prevX + prevW / 2, prevY + prevH / 2, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(100,100,130,0.6)';
      ctx.fill();
      ctx.restore();

      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';

      if (item.css && item.css.animation) {
        ctx.font = 'bold 10px Arial';
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u26A1', prevX + prevW + 14, mid);
      }
    } else if (cat === 'win_effect' && item.css && item.css.colors) {
      // Win effect: small color scatter dots
      roundRect(prevX, prevY, prevW, prevH, 4);
      ctx.fillStyle = '#0d0d18';
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.rect(prevX, prevY, prevW, prevH);
      ctx.clip();
      const colors = item.css.colors;
      const cx = prevX + prevW / 2;
      const cy = prevY + prevH / 2;
      // Simple seeded scatter
      const rng = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
      const rand = rng(42 + i);
      for (let d = 0; d < 12; d++) {
        const angle = rand() * Math.PI * 2;
        const dist = 3 + rand() * 10;
        const dx = cx + Math.cos(angle) * dist;
        const dy = cy + Math.sin(angle) * dist;
        ctx.beginPath();
        ctx.arc(dx, dy, 1.5 + rand() * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = colors[d % colors.length];
        ctx.globalAlpha = 0.6 + rand() * 0.4;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      if (item.css && item.css.animation) {
        ctx.font = 'bold 10px Arial';
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u26A1', prevX + prevW + 14, mid);
      }
    }

    y += ROW_HEIGHT;
  }

  // Bottom border for table
  ctx.strokeStyle = '#222244';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(PADDING + TABLE_WIDTH, y);
  ctx.stroke();

  y += CATEGORY_GAP;
}

// ─── Footer ────────────────────────────────────────────────
y += 10;

// Rarity legend
roundRect(PADDING + 50, y, IMG_WIDTH - PADDING * 2 - 100, 42, 8);
ctx.fillStyle = '#1a1a30';
ctx.fill();
ctx.strokeStyle = '#333355';
ctx.lineWidth = 1;
ctx.stroke();

ctx.font = 'bold 12px Arial';
ctx.fillStyle = '#666688';
ctx.textAlign = 'left';
ctx.fillText('RARITY TIERS:', PADDING + 68, y + 16);

let rx = PADDING + 180;
for (const [rarity, color] of Object.entries(RARITY_COLORS)) {
  const pw = drawPill(rx, y + 8, rarity.toUpperCase(), color + '30', color, 11);
  rx += pw + 10;
}

ctx.font = '12px Arial';
ctx.fillStyle = '#666688';
ctx.textAlign = 'center';
ctx.fillText('Higher rarity = better visual effects & animations', IMG_WIDTH / 2, y + 34);

y += 55;

// How it works box
roundRect(PADDING + 50, y, IMG_WIDTH - PADDING * 2 - 100, 78, 8);
ctx.fillStyle = '#1a1a30';
ctx.fill();
ctx.strokeStyle = '#333355';
ctx.lineWidth = 1;
ctx.stroke();

ctx.font = 'bold 14px Arial';
ctx.fillStyle = '#ffffff';
ctx.textAlign = 'center';
ctx.fillText('HOW TO USE', IMG_WIDTH / 2, y + 16);

ctx.font = '13px Arial';
ctx.fillStyle = '#aaaacc';
const steps = [
  '1. Earn coins by playing word games',
  '2. Browse the shop:  !shop wc  (or pb, pg, ng, nc, tt, we)',
  '3. Buy an item:  !buyc crimson  (use the NAME from the table below)',
  '4. Done! Auto-equipped on purchase.  View your items:  !mycos'
];
for (let i = 0; i < steps.length; i++) {
  ctx.fillText(steps[i], IMG_WIDTH / 2, y + 34 + i * 15);
}

y += 92;

// Credit line
ctx.font = '11px Arial';
ctx.fillStyle = '#444466';
ctx.textAlign = 'center';
ctx.fillText('You can equip one item per category  ·  Cosmetics are visible across all Word Tycoon games', IMG_WIDTH / 2, y);

// ─── Save ──────────────────────────────────────────────────
const outPath = path.join(__dirname, 'cosmetics-guide.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);
console.log(`Saved cosmetics guide to: ${outPath}`);
console.log(`Image size: ${IMG_WIDTH}x${totalHeight}px, File size: ${(buffer.length / 1024).toFixed(1)} KB`);
