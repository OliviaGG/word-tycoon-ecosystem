// generate-pfp.js — Creates a profile picture for Word Tycoon game
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// ─── Helper ──────────────────────────────────────────────
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

// Seeded random for consistent results
let seed = 42;
function seededRandom() {
  seed = (seed * 16807 + 0) % 2147483647;
  return (seed - 1) / 2147483646;
}

// ─── Background gradient (night sky) ─────────────────────
const bgGrad = ctx.createLinearGradient(0, 0, 0, SIZE);
bgGrad.addColorStop(0, '#020118');
bgGrad.addColorStop(0.3, '#0a0630');
bgGrad.addColorStop(0.6, '#110d3a');
bgGrad.addColorStop(1, '#0a0825');
ctx.fillStyle = bgGrad;
ctx.fillRect(0, 0, SIZE, SIZE);

// ─── Stars ───────────────────────────────────────────────
for (let i = 0; i < 80; i++) {
  const sx = seededRandom() * SIZE;
  const sy = seededRandom() * SIZE * 0.55;
  const sr = seededRandom() * 1.5 + 0.3;
  const so = seededRandom() * 0.5 + 0.2;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 255, 255, ${so})`;
  ctx.fill();
}

// ─── Moon glow (upper right) ─────────────────────────────
const moonGrad = ctx.createRadialGradient(400, 80, 10, 400, 80, 120);
moonGrad.addColorStop(0, 'rgba(255, 240, 200, 0.15)');
moonGrad.addColorStop(0.3, 'rgba(255, 220, 150, 0.06)');
moonGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
ctx.fillStyle = moonGrad;
ctx.fillRect(0, 0, SIZE, SIZE);

// Small moon disc
ctx.beginPath();
ctx.arc(400, 80, 18, 0, Math.PI * 2);
ctx.fillStyle = 'rgba(255, 240, 210, 0.25)';
ctx.fill();

// ─── Skyline helper ──────────────────────────────────────
function drawBuilding(x, w, h, baseY, color, windowColor, windowOpacity) {
  const bx = x;
  const by = baseY - h;

  // Building body
  ctx.fillStyle = color;
  ctx.fillRect(bx, by, w, h);

  // Subtle edge highlights
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.fillRect(bx, by, 2, h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fillRect(bx + w - 2, by, 2, h);

  // Windows
  const winW = Math.max(3, w * 0.12);
  const winH = Math.max(3, winW * 1.3);
  const winGapX = winW * 1.8;
  const winGapY = winH * 2.2;
  const winPad = w * 0.15;
  const cols = Math.floor((w - winPad * 2 + winGapX - winW) / winGapX);
  const rows = Math.floor((h - 20) / winGapY);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = seededRandom() > 0.35;
      if (!lit) continue;
      const wx = bx + winPad + c * winGapX;
      const wy = by + 12 + r * winGapY;
      const warmth = seededRandom();
      let wc;
      if (warmth > 0.7) {
        wc = `rgba(255, 220, 100, ${windowOpacity * (0.6 + seededRandom() * 0.4)})`;
      } else if (warmth > 0.4) {
        wc = `rgba(200, 230, 255, ${windowOpacity * (0.4 + seededRandom() * 0.3)})`;
      } else {
        wc = `rgba(${windowColor}, ${windowOpacity * (0.3 + seededRandom() * 0.4)})`;
      }
      ctx.fillStyle = wc;
      ctx.fillRect(wx, wy, winW, winH);
    }
  }
}

function drawSpire(x, baseY, h, w) {
  ctx.beginPath();
  ctx.moveTo(x, baseY - h);
  ctx.lineTo(x - w / 2, baseY);
  ctx.lineTo(x + w / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(30, 30, 60, 0.9)';
  ctx.fill();
  // Antenna light
  ctx.beginPath();
  ctx.arc(x, baseY - h, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 50, 50, 0.8)';
  ctx.fill();
}

// ─── Back skyline layer (distant, darker) ────────────────
const baseY = SIZE * 0.68;

// Distant city glow
const cityGlow = ctx.createLinearGradient(0, baseY - 200, 0, baseY);
cityGlow.addColorStop(0, 'rgba(80, 60, 140, 0)');
cityGlow.addColorStop(0.7, 'rgba(80, 60, 140, 0.05)');
cityGlow.addColorStop(1, 'rgba(100, 80, 160, 0.1)');
ctx.fillStyle = cityGlow;
ctx.fillRect(0, baseY - 200, SIZE, 200);

const backBuildings = [
  { x: -5, w: 38, h: 155 },
  { x: 30, w: 32, h: 180 },
  { x: 58, w: 45, h: 210 },
  { x: 98, w: 30, h: 170 },
  { x: 124, w: 50, h: 250, spire: true },
  { x: 170, w: 35, h: 195 },
  { x: 200, w: 55, h: 280, spire: true },
  { x: 248, w: 30, h: 200 },
  { x: 272, w: 48, h: 310, spire: true },
  { x: 315, w: 35, h: 240 },
  { x: 345, w: 52, h: 270 },
  { x: 392, w: 30, h: 190 },
  { x: 418, w: 45, h: 255, spire: true },
  { x: 458, w: 35, h: 175 },
  { x: 488, w: 40, h: 200 },
];

backBuildings.forEach(b => {
  drawBuilding(b.x, b.w, b.h, baseY, 'rgba(15, 15, 35, 0.7)', '150, 180, 255', 0.3);
  if (b.spire) drawSpire(b.x + b.w / 2, baseY - b.h, 25, 8);
});

// ─── Mid skyline layer ───────────────────────────────────
const midBaseY = SIZE * 0.72;
const midBuildings = [
  { x: -8, w: 48, h: 180 },
  { x: 36, w: 40, h: 220 },
  { x: 72, w: 55, h: 260, spire: true },
  { x: 122, w: 35, h: 200 },
  { x: 152, w: 60, h: 300, spire: true },
  { x: 208, w: 42, h: 230 },
  { x: 244, w: 56, h: 330, spire: true },
  { x: 296, w: 38, h: 250 },
  { x: 328, w: 50, h: 290 },
  { x: 374, w: 36, h: 210 },
  { x: 406, w: 55, h: 280, spire: true },
  { x: 456, w: 40, h: 235 },
  { x: 490, w: 30, h: 190 },
];

midBuildings.forEach(b => {
  drawBuilding(b.x, b.w, b.h, midBaseY, 'rgba(18, 18, 45, 0.85)', '180, 200, 255', 0.5);
  if (b.spire) drawSpire(b.x + b.w / 2, midBaseY - b.h, 30, 10);
});

// ─── Front skyline layer (closest, most detail) ──────────
const frontBaseY = SIZE * 0.78;
const frontBuildings = [
  { x: -10, w: 55, h: 160 },
  { x: 42, w: 48, h: 200 },
  { x: 85, w: 65, h: 250, spire: true },
  { x: 145, w: 40, h: 180 },
  { x: 180, w: 70, h: 280, spire: true },
  { x: 245, w: 50, h: 220 },
  { x: 290, w: 60, h: 260 },
  { x: 345, w: 45, h: 195 },
  { x: 385, w: 60, h: 240, spire: true },
  { x: 440, w: 42, h: 175 },
  { x: 478, w: 50, h: 210 },
];

frontBuildings.forEach(b => {
  drawBuilding(b.x, b.w, b.h, frontBaseY, 'rgba(12, 12, 30, 0.95)', '220, 200, 130', 0.7);
  if (b.spire) drawSpire(b.x + b.w / 2, frontBaseY - b.h, 35, 12);
});

// ─── Ground / horizon glow ───────────────────────────────
const groundGrad = ctx.createLinearGradient(0, frontBaseY - 10, 0, SIZE);
groundGrad.addColorStop(0, 'rgba(20, 15, 40, 0.9)');
groundGrad.addColorStop(0.3, 'rgba(10, 8, 25, 0.95)');
groundGrad.addColorStop(1, '#050310');
ctx.fillStyle = groundGrad;
ctx.fillRect(0, frontBaseY, SIZE, SIZE - frontBaseY);

// Warm horizon glow behind buildings
const horizonGlow = ctx.createLinearGradient(0, baseY - 40, 0, baseY + 60);
horizonGlow.addColorStop(0, 'rgba(255, 150, 50, 0)');
horizonGlow.addColorStop(0.4, 'rgba(255, 130, 60, 0.06)');
horizonGlow.addColorStop(0.7, 'rgba(200, 100, 50, 0.04)');
horizonGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
ctx.fillStyle = horizonGlow;
ctx.fillRect(0, baseY - 40, SIZE, 100);

// ─── Central glow behind text ────────────────────────────
const centerGlow = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, 180);
centerGlow.addColorStop(0, 'rgba(255, 215, 0, 0.1)');
centerGlow.addColorStop(0.4, 'rgba(255, 180, 50, 0.04)');
centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
ctx.fillStyle = centerGlow;
ctx.fillRect(0, 0, SIZE, SIZE);

// ─── "WORD" text (centered) ─────────────────────────────
const textCenterY = SIZE / 2 - 10;

ctx.font = 'bold 72px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'alphabetic';

// Shadow
ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
ctx.fillText('WORD', SIZE / 2 + 2, textCenterY - 8);

// Text with white/light gradient
const wordGrad = ctx.createLinearGradient(SIZE / 2 - 100, textCenterY - 60, SIZE / 2 + 100, textCenterY);
wordGrad.addColorStop(0, '#ffffff');
wordGrad.addColorStop(0.5, '#e8e0ff');
wordGrad.addColorStop(1, '#ffffff');
ctx.fillStyle = wordGrad;
ctx.fillText('WORD', SIZE / 2, textCenterY - 10);

// Subtle stroke
ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
ctx.lineWidth = 0.5;
ctx.strokeText('WORD', SIZE / 2, textCenterY - 10);

// ─── "TYCOON" text (centered, below WORD) ────────────────
ctx.font = 'bold 82px Arial';

// Shadow
ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
ctx.fillText('TYCOON', SIZE / 2 + 2, textCenterY + 68);

// Gold gradient
const tycoonGrad = ctx.createLinearGradient(SIZE / 2 - 140, 0, SIZE / 2 + 140, 0);
tycoonGrad.addColorStop(0, '#d4930d');
tycoonGrad.addColorStop(0.2, '#ffd700');
tycoonGrad.addColorStop(0.4, '#ffed4a');
tycoonGrad.addColorStop(0.5, '#ffd700');
tycoonGrad.addColorStop(0.6, '#ffed4a');
tycoonGrad.addColorStop(0.8, '#ffd700');
tycoonGrad.addColorStop(1, '#d4930d');
ctx.fillStyle = tycoonGrad;
ctx.fillText('TYCOON', SIZE / 2, textCenterY + 66);

// Highlight stroke
ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
ctx.lineWidth = 1;
ctx.strokeText('TYCOON', SIZE / 2, textCenterY + 66);

// ─── Decorative line under TYCOON ────────────────────────
const lineY = textCenterY + 82;
const lineGrad = ctx.createLinearGradient(SIZE / 2 - 140, 0, SIZE / 2 + 140, 0);
lineGrad.addColorStop(0, 'rgba(255, 215, 0, 0)');
lineGrad.addColorStop(0.15, 'rgba(255, 215, 0, 0.4)');
lineGrad.addColorStop(0.5, 'rgba(255, 215, 0, 0.8)');
lineGrad.addColorStop(0.85, 'rgba(255, 215, 0, 0.4)');
lineGrad.addColorStop(1, 'rgba(255, 215, 0, 0)');
ctx.strokeStyle = lineGrad;
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(SIZE / 2 - 140, lineY);
ctx.lineTo(SIZE / 2 + 140, lineY);
ctx.stroke();

// Diamond at center of line
ctx.beginPath();
ctx.moveTo(SIZE / 2, lineY - 5);
ctx.lineTo(SIZE / 2 + 5, lineY);
ctx.lineTo(SIZE / 2, lineY + 5);
ctx.lineTo(SIZE / 2 - 5, lineY);
ctx.closePath();
ctx.fillStyle = '#ffd700';
ctx.fill();

// ─── Coin particles (foreground) ─────────────────────────
const particles = [
  { x: 55, y: 75, size: 16, opacity: 0.14 },
  { x: 440, y: 55, size: 13, opacity: 0.12 },
  { x: 40, y: 420, size: 15, opacity: 0.1 },
  { x: 460, y: 440, size: 18, opacity: 0.16 },
  { x: 95, y: 460, size: 11, opacity: 0.08 },
  { x: 420, y: 120, size: 10, opacity: 0.1 },
];

particles.forEach(p => {
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 215, 0, ${p.opacity})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 215, 0, ${p.opacity + 0.08})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = `bold ${p.size}px Arial`;
  ctx.fillStyle = `rgba(255, 215, 0, ${p.opacity + 0.05})`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', p.x, p.y);
});

// ─── Outer border ────────────────────────────────────────
roundRect(ctx, 4, 4, SIZE - 8, SIZE - 8, 20);
ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
ctx.lineWidth = 2;
ctx.stroke();

roundRect(ctx, 8, 8, SIZE - 16, SIZE - 16, 18);
ctx.strokeStyle = 'rgba(255, 215, 0, 0.1)';
ctx.lineWidth = 1;
ctx.stroke();

// ─── Save ────────────────────────────────────────────────
const outPath = path.join(__dirname, 'word-tycoon-pfp.png');
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outPath, buffer);

console.log(`Saved PFP to: ${outPath}`);
console.log(`Image size: ${SIZE}x${SIZE}px, File size: ${(buffer.length / 1024).toFixed(1)} KB`);
