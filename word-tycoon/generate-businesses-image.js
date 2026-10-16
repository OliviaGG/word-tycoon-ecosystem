// generate-businesses-image.js — Creates a PNG infographic of all businesses & tap upgrades
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// Load business data
const { BUSINESSES, TAP_UPGRADES, getCost, getIncomePerCycle, getIncomePerSecond } = require('./src/businesses');

// ─── Layout constants ──────────────────────────────────────
const IMG_WIDTH = 1200;
const PADDING = 30;

// ─── Colors ────────────────────────────────────────────────
const TIER_COLORS = {
  library:   '#8b5cf6',
  newspaper: '#9d9d9d',
  carwash:   '#38bdf8',
  pizza:     '#fb923c',
  arcade:    '#a78bfa',
  gym:       '#ef4444',
  cinema:    '#fbbf24',
  startup:   '#22d3ee',
  bank:      '#f472b6',
  space:     '#ff4444'
};

// ─── Helpers ───────────────────────────────────────────────
function formatPrice(cost) {
  if (cost >= 1e12) return (cost / 1e12).toFixed(1) + 'T';
  if (cost >= 1e9) return (cost / 1e9).toFixed(cost % 1e9 === 0 ? 0 : 1) + 'B';
  if (cost >= 1e6) return (cost / 1e6).toFixed(cost % 1e6 === 0 ? 0 : 1) + 'M';
  if (cost >= 1e3) return (cost / 1e3).toFixed(cost % 1e3 === 0 ? 0 : 1) + 'K';
  return cost.toString();
}

function formatIPS(val) {
  if (val >= 1e6) return (val / 1e6).toFixed(1) + 'M';
  if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K';
  if (val < 1) return val.toFixed(2);
  return val.toFixed(1);
}

function roundRect(ctx, x, y, w, h, r) {
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

function drawPill(ctx, x, y, text, bgColor, textColor, fontSize) {
  ctx.font = `bold ${fontSize || 11}px Arial`;
  const metrics = ctx.measureText(text);
  const pw = metrics.width + 14;
  const ph = (fontSize || 11) + 8;
  roundRect(ctx, x, y, pw, ph, ph / 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.fillStyle = textColor || '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, y + ph / 2 + 1);
  return pw;
}

// ─── Calculate layout ──────────────────────────────────────
const businessKeys = Object.keys(BUSINESSES);
const CARD_W = (IMG_WIDTH - PADDING * 2 - 20) / 2; // 2 columns
const CARD_H = 210;
const CARD_GAP = 16;
const HEADER_HEIGHT = 170;
const SECTION_GAP = 30;
const TAP_SECTION_HEIGHT = 380;
const UPGRADE_TABLE_HEADER = 40;
const UPGRADE_ROW_H = 80;
const FOOTER_HEIGHT = 160;

const businessRows = Math.ceil(businessKeys.length / 2);
const businessSectionH = businessRows * (CARD_H + CARD_GAP) + 60;

const totalHeight = HEADER_HEIGHT + businessSectionH + SECTION_GAP + TAP_SECTION_HEIGHT + FOOTER_HEIGHT;

// ─── Create canvas ─────────────────────────────────────────
const canvas = createCanvas(IMG_WIDTH, totalHeight);
const ctx = canvas.getContext('2d');

// ─── Background ────────────────────────────────────────────
const bgGrad = ctx.createLinearGradient(0, 0, 0, totalHeight);
bgGrad.addColorStop(0, '#0a0a18');
bgGrad.addColorStop(0.3, '#0d1025');
bgGrad.addColorStop(0.7, '#0d1025');
bgGrad.addColorStop(1, '#0a0a18');
ctx.fillStyle = bgGrad;
ctx.fillRect(0, 0, IMG_WIDTH, totalHeight);

// Subtle border
ctx.strokeStyle = '#333355';
ctx.lineWidth = 2;
ctx.strokeRect(1, 1, IMG_WIDTH - 2, totalHeight - 2);

// ─── Header ────────────────────────────────────────────────
let y = PADDING;

ctx.font = 'bold 36px Arial';
ctx.fillStyle = '#ffffff';
ctx.textAlign = 'center';
ctx.textBaseline = 'top';
ctx.fillText('WORD TYCOON — BUSINESS GUIDE', IMG_WIDTH / 2, y);
y += 48;

ctx.font = '16px Arial';
ctx.fillStyle = '#8888aa';
ctx.fillText('Build your empire! Buy businesses, upgrade them, and earn passive income.', IMG_WIDTH / 2, y);
y += 30;

// Commands box
const cmdBoxH = 58;
roundRect(ctx, PADDING + 50, y, IMG_WIDTH - PADDING * 2 - 100, cmdBoxH, 8);
ctx.fillStyle = '#1a1a30';
ctx.fill();
ctx.strokeStyle = '#333366';
ctx.lineWidth = 1;
ctx.stroke();

ctx.font = 'bold 13px Arial';
ctx.fillStyle = '#aaaacc';
ctx.textAlign = 'center';
ctx.fillText('!empire  ·  !buy [name]  ·  !collect  ·  !tap  ·  !upgrade [tap|crit|multi]  ·  !taps', IMG_WIDTH / 2, y + 14);
ctx.font = '12px Arial';
ctx.fillStyle = '#666688';
ctx.fillText('Buy a business to start earning  ·  Upgrade to increase income  ·  Collect idle earnings', IMG_WIDTH / 2, y + 34);
ctx.fillText('Aliases: library/lib · news/nr · car/cw · pz · arc · fit · movie/mt · tech/ts · bk · rocket/nasa/sa', IMG_WIDTH / 2, y + 50);

y += cmdBoxH + 22;

// ─── Business Section Header ───────────────────────────────
roundRect(ctx, PADDING, y, IMG_WIDTH - PADDING * 2, 40, 8);
const secGrad = ctx.createLinearGradient(PADDING, y, PADDING + IMG_WIDTH - PADDING * 2, y);
secGrad.addColorStop(0, '#1a1a35');
secGrad.addColorStop(1, '#151528');
ctx.fillStyle = secGrad;
ctx.fill();
ctx.strokeStyle = '#333366';
ctx.lineWidth = 1;
ctx.stroke();

ctx.font = 'bold 18px Arial';
ctx.fillStyle = '#ffffff';
ctx.textAlign = 'left';
ctx.textBaseline = 'middle';
ctx.fillText('BUSINESSES', PADDING + 16, y + 20);

drawPill(ctx, PADDING + 155, y + 10, `${businessKeys.length} businesses`, '#333366', '#8888bb');

ctx.font = '13px Arial';
ctx.fillStyle = '#8888aa';
ctx.textAlign = 'right';
ctx.fillText('Buy with !buy [name] · Upgrade cost increases 1.15x per level', PADDING + IMG_WIDTH - PADDING * 2 - 16, y + 20);

y += 52;

// ─── Business Cards ────────────────────────────────────────
for (let i = 0; i < businessKeys.length; i++) {
  const key = businessKeys[i];
  const biz = BUSINESSES[key];
  const col = i % 2;
  const row = Math.floor(i / 2);

  const cx = PADDING + col * (CARD_W + CARD_GAP);
  const cy = y + row * (CARD_H + CARD_GAP);

  const tierColor = TIER_COLORS[key] || '#ffffff';

  // Card background
  roundRect(ctx, cx, cy, CARD_W, CARD_H, 10);
  ctx.fillStyle = '#12122a';
  ctx.fill();
  ctx.strokeStyle = tierColor + '50';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Top accent bar
  roundRect(ctx, cx, cy, CARD_W, 4, 0);
  ctx.fillStyle = tierColor;
  ctx.fill();

  // Tier number badge
  roundRect(ctx, cx + CARD_W - 48, cy + 12, 36, 24, 12);
  ctx.fillStyle = tierColor + '30';
  ctx.fill();
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = tierColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${i + 1}`, cx + CARD_W - 30, cy + 24);

  // Business name with emoji
  ctx.font = 'bold 22px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${biz.emoji}  ${biz.name}`, cx + 16, cy + 16);

  // Key / aliases
  ctx.font = '12px Courier New';
  ctx.fillStyle = '#88aacc';
  ctx.fillText(`${key}  (${biz.aliases.join(', ')})`, cx + 16, cy + 46);

  // Divider
  ctx.strokeStyle = '#222244';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 16, cy + 66);
  ctx.lineTo(cx + CARD_W - 16, cy + 66);
  ctx.stroke();

  // Stats grid (2 columns x 3 rows)
  const statStartY = cy + 76;
  const statColW = (CARD_W - 32) / 2;
  const statRowH = 32;

  const stats = [
    { label: 'PURCHASE COST', value: biz.baseCost === 0 ? 'FREE' : formatPrice(biz.baseCost), color: '#ffd700' },
    { label: 'UPGRADE COST (Lv1)', value: biz.baseUpgradeCost === 0 ? 'AUTO' : formatPrice(biz.baseUpgradeCost), color: '#ffd700' },
    { label: 'INCOME / CYCLE', value: `${formatPrice(biz.baseIncome)} coins`, color: '#4ade80' },
    { label: 'CYCLE TIME', value: `${biz.cycleSeconds}s`, color: '#38bdf8' },
    { label: 'INCOME / SECOND', value: `${formatIPS(biz.baseIncome / biz.cycleSeconds)}/s`, color: '#4ade80' },
    { label: 'COST MULT.', value: biz.costMultiplier === 1 ? 'N/A' : `x${biz.costMultiplier}`, color: '#f472b6' },
  ];

  for (let s = 0; s < stats.length; s++) {
    const sc = s % 2;
    const sr = Math.floor(s / 2);
    const sx = cx + 16 + sc * statColW;
    const sy = statStartY + sr * statRowH;

    ctx.font = 'bold 9px Arial';
    ctx.fillStyle = '#666688';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(stats[s].label, sx, sy);

    ctx.font = 'bold 15px Arial';
    ctx.fillStyle = stats[s].color;
    ctx.fillText(stats[s].value, sx, sy + 12);
  }

  // Special note for library
  if (biz.playtimeUpgrade) {
    const noteY = statStartY + 3 * statRowH + 4;
    roundRect(ctx, cx + 12, noteY, CARD_W - 24, 22, 6);
    ctx.fillStyle = '#1a2e1a';
    ctx.fill();
    ctx.font = 'bold 10px Arial';
    ctx.fillStyle = '#4ade80';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Auto-levels every ${biz.hoursPerLevel}h  ·  Income x${biz.levelMultiplier} per level`, cx + CARD_W / 2, noteY + 11);
  }
}

y += businessRows * (CARD_H + CARD_GAP) + SECTION_GAP;

// ─── Upgrade Cost Scaling Examples ──────────────────────────
// Small info box showing how costs scale for a sample business
roundRect(ctx, PADDING, y - 14, IMG_WIDTH - PADDING * 2, 50, 8);
ctx.fillStyle = '#1a1a30';
ctx.fill();
ctx.strokeStyle = '#333355';
ctx.lineWidth = 1;
ctx.stroke();

ctx.font = 'bold 12px Arial';
ctx.fillStyle = '#aaaacc';
ctx.textAlign = 'left';
ctx.textBaseline = 'middle';
ctx.fillText('UPGRADE COST SCALING EXAMPLE (Newspaper — base 5K, x1.15):', PADDING + 16, y - 2);

// Show levels 1-5, 10, 25, 50
const exLevels = [1, 2, 3, 5, 10, 25, 50];
let ex = PADDING + 460;
for (const lv of exLevels) {
  const cost = getCost('newspaper', lv);
  const label = `Lv${lv}: ${formatPrice(cost)}`;
  ctx.font = '11px Courier New';
  ctx.fillStyle = '#ffd700';
  ctx.textAlign = 'left';
  const pw = drawPill(ctx, ex, y - 12, label, '#ffd70015', '#ffd700', 10);
  ex += pw + 6;
}

y += 50;

// ─── Tap Upgrades Section ──────────────────────────────────
roundRect(ctx, PADDING, y, IMG_WIDTH - PADDING * 2, 40, 8);
const tapGrad = ctx.createLinearGradient(PADDING, y, PADDING + IMG_WIDTH - PADDING * 2, y);
tapGrad.addColorStop(0, '#1a1a35');
tapGrad.addColorStop(1, '#151528');
ctx.fillStyle = tapGrad;
ctx.fill();
ctx.strokeStyle = '#333366';
ctx.lineWidth = 1;
ctx.stroke();

ctx.font = 'bold 18px Arial';
ctx.fillStyle = '#ffffff';
ctx.textAlign = 'left';
ctx.textBaseline = 'middle';
ctx.fillText('TAP UPGRADES', PADDING + 16, y + 20);

drawPill(ctx, PADDING + 175, y + 10, `${Object.keys(TAP_UPGRADES).length} upgrades`, '#333366', '#8888bb');

ctx.font = '13px Arial';
ctx.fillStyle = '#8888aa';
ctx.textAlign = 'right';
ctx.fillText('Upgrade with !upgrade [tap|crit|multi] · View stats with !taps', PADDING + IMG_WIDTH - PADDING * 2 - 16, y + 20);

y += 52;

// Tap upgrade cards (3 columns)
const tapKeys = Object.keys(TAP_UPGRADES);
const TAP_CARD_W = (IMG_WIDTH - PADDING * 2 - CARD_GAP * 2) / 3;
const TAP_CARD_H = 200;
const TAP_COLORS = { tap: '#ffd700', crit: '#ef4444', multi: '#a78bfa' };
const TAP_ICONS = { tap: '👆', crit: '⚡', multi: '✨' };

for (let t = 0; t < tapKeys.length; t++) {
  const key = tapKeys[t];
  const def = TAP_UPGRADES[key];
  const color = TAP_COLORS[key];
  const tx = PADDING + t * (TAP_CARD_W + CARD_GAP);

  // Card
  roundRect(ctx, tx, y, TAP_CARD_W, TAP_CARD_H, 10);
  ctx.fillStyle = '#12122a';
  ctx.fill();
  ctx.strokeStyle = color + '50';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Top accent
  roundRect(ctx, tx, y, TAP_CARD_W, 4, 0);
  ctx.fillStyle = color;
  ctx.fill();

  // Icon + Name
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${TAP_ICONS[key]}  ${def.name}`, tx + 16, y + 16);

  // Description
  ctx.font = '13px Arial';
  ctx.fillStyle = '#aaaacc';
  ctx.fillText(def.desc, tx + 16, y + 44);

  // Divider
  ctx.strokeStyle = '#222244';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tx + 16, y + 66);
  ctx.lineTo(tx + TAP_CARD_W - 16, y + 66);
  ctx.stroke();

  // Stats
  const tapStats = [
    { label: 'BASE COST', value: formatPrice(def.baseCost), color: '#ffd700' },
    { label: 'COST MULT.', value: `x${def.costMultiplier}`, color: '#f472b6' },
    { label: 'MAX LEVEL', value: `${def.maxLevel}`, color: '#38bdf8' },
  ];

  if (def.comboMultPerLevel) {
    tapStats.push({ label: 'COMBO/LV', value: `+${(def.comboMultPerLevel * 100).toFixed(0)}%`, color: '#4ade80' });
    tapStats.push({ label: 'MAX MULT.', value: `${(1 + def.maxLevel * def.comboMultPerLevel).toFixed(1)}x`, color: '#ef4444' });
  }

  for (let s = 0; s < tapStats.length; s++) {
    const sy = y + 76 + s * 24;
    ctx.font = 'bold 9px Arial';
    ctx.fillStyle = '#666688';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(tapStats[s].label, tx + 16, sy);

    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = tapStats[s].color;
    ctx.textAlign = 'right';
    ctx.fillText(tapStats[s].value, tx + TAP_CARD_W - 16, sy);
  }

  // Cost at key levels
  const lvlExamples = key === 'multi' ? [1, 3, 5, 10] : key === 'crit' ? [1, 10, 25, 50] : [1, 10, 25, 50];
  const lvlY = y + TAP_CARD_H - 36;
  roundRect(ctx, tx + 8, lvlY, TAP_CARD_W - 16, 26, 6);
  ctx.fillStyle = '#1a1a30';
  ctx.fill();

  ctx.font = '9px Courier New';
  ctx.fillStyle = '#888899';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lvlStr = lvlExamples.map(lv => {
    const cost = Math.floor(def.baseCost * Math.pow(def.costMultiplier, lv));
    return `Lv${lv}:${formatPrice(cost)}`;
  }).join('  ');
  ctx.fillText(lvlStr, tx + TAP_CARD_W / 2, lvlY + 13);
}

y += TAP_CARD_H + SECTION_GAP;

// ─── Footer ────────────────────────────────────────────────

// How it works box
roundRect(ctx, PADDING + 50, y, IMG_WIDTH - PADDING * 2 - 100, 88, 8);
ctx.fillStyle = '#1a1a30';
ctx.fill();
ctx.strokeStyle = '#333355';
ctx.lineWidth = 1;
ctx.stroke();

ctx.font = 'bold 14px Arial';
ctx.fillStyle = '#ffffff';
ctx.textAlign = 'center';
ctx.textBaseline = 'top';
ctx.fillText('HOW BUSINESSES WORK', IMG_WIDTH / 2, y + 12);

ctx.font = '13px Arial';
ctx.fillStyle = '#aaaacc';
const steps = [
  '1. Start playing:  !play  (get a free Library!)',
  '2. Businesses earn coins automatically every cycle — even while offline',
  '3. Upgrade businesses with  !buy [name]  to increase income per cycle',
  '4. Tap for bonus coins:  !tap  ·  Upgrade taps:  !upgrade tap',
];
for (let i = 0; i < steps.length; i++) {
  ctx.fillText(steps[i], IMG_WIDTH / 2, y + 32 + i * 15);
}

y += 100;

// Credit line
ctx.font = '11px Arial';
ctx.fillStyle = '#444466';
ctx.textAlign = 'center';
ctx.fillText('Library auto-levels via finding unique words across all games  ·  All other businesses use !buy to upgrade  ·  Collect idle income with !collect', IMG_WIDTH / 2, y);

// ─── Save ──────────────────────────────────────────────────
const outPath = path.join(__dirname, 'businesses-guide.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);

// Also copy to public
const publicPath = path.join(__dirname, 'public', 'businesses-guide.png');
fs.writeFileSync(publicPath, buffer);

console.log(`Saved businesses guide to: ${outPath}`);
console.log(`Also saved to: ${publicPath}`);
console.log(`Image size: ${IMG_WIDTH}x${totalHeight}px, File size: ${(buffer.length / 1024).toFixed(1)} KB`);
