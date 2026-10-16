// generate-guide-images.js — Creates comprehensive PNG guides for the game
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// ─── Shared helpers ────────────────────────────────────────────
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

function drawBg(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0a0a1a');
  g.addColorStop(0.3, '#0f0f24');
  g.addColorStop(0.7, '#0f0f24');
  g.addColorStop(1, '#0a0a1a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (let i = 0; i < w; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
  for (let i = 0; i < h; i += 40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
  // Border
  ctx.strokeStyle = '#333355';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
}

function drawPill(ctx, x, y, text, bgColor, textColor, fontSize) {
  fontSize = fontSize || 11;
  ctx.font = `bold ${fontSize}px Arial`;
  const m = ctx.measureText(text);
  const pw = m.width + 14;
  const ph = fontSize + 10;
  roundRect(ctx, x, y, pw, ph, ph / 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.fillStyle = textColor || '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, y + ph / 2 + 1);
  return pw;
}

function formatPrice(cost) {
  if (cost >= 1e12) return (cost / 1e12).toFixed(1) + 'T';
  if (cost >= 1e9) return (cost / 1e9).toFixed(cost % 1e9 === 0 ? 0 : 1) + 'B';
  if (cost >= 1e6) return (cost / 1e6).toFixed(cost % 1e6 === 0 ? 0 : 1) + 'M';
  if (cost >= 1e3) return (cost / 1e3).toFixed(cost % 1e3 === 0 ? 0 : 1) + 'K';
  return cost.toString();
}

function drawSectionHeader(ctx, x, y, w, title, accent) {
  roundRect(ctx, x, y, w, 42, 10);
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, accent + '30');
  g.addColorStop(1, accent + '10');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = accent + '60';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Accent stripe
  roundRect(ctx, x, y, 5, 42, 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.font = 'bold 18px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, x + 18, y + 21);
  return y + 42;
}

function drawFooter(ctx, y, w) {
  ctx.font = '12px Arial';
  ctx.fillStyle = '#444466';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Word Tycoon  |  Type !help in chat for commands  |  Play on TikTok, YouTube, Twitch & Discord', w / 2, y);
}

// ─── Glow simulation helpers ──────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════
// 1. COMMANDS GUIDE
// ═══════════════════════════════════════════════════════════════
function generateCommandsGuide() {
  const W = 1400;
  const PAD = 30;
  const CW = W - PAD * 2;

  const sections = [
    {
      title: 'GETTING STARTED',
      accent: '#4CAF50',
      icon: '🎬',
      commands: [
        { cmd: '!play', usage: '!play', desc: 'Start playing — get a free Library instantly', category: 'core' },
        { cmd: '!help', usage: '!help', desc: 'Show all available commands with descriptions', category: 'core' },
        { cmd: '!discord', usage: '!discord [username]', desc: 'Get a Discord server invite to play from Discord', category: 'core' },
        { cmd: '!verify', usage: '!verify [code]', desc: 'Link your Discord account using code from /link', category: 'core' },
      ]
    },
    {
      title: 'EARNING COINS — TAPPING',
      accent: '#f59e0b',
      icon: '👆',
      commands: [
        { cmd: '!tap', usage: '!tap', desc: 'Manual tap to earn coins (1 tap per second cooldown)', category: 'tap' },
        { cmd: '!taps', usage: '!taps', desc: 'View your tap stats: total taps, tap power, crit multiplier, multi-tap', category: 'tap' },
        { cmd: '!coins', usage: '!coins', desc: 'Show your current coin balance', category: 'tap' },
        { cmd: '!combo', usage: '!combo', desc: 'Show your current combo streak and multiplier', category: 'tap' },
      ]
    },
    {
      title: 'BUSINESS EMPIRE',
      accent: '#3b82f6',
      icon: '🏢',
      commands: [
        { cmd: '!empire', usage: '!empire', desc: 'View all your owned businesses and their income rates', category: 'biz' },
        { cmd: '!buy', usage: '!buy [name]', desc: 'Buy or upgrade a business (e.g. !buy pizza, !buy startup)', category: 'biz' },
        { cmd: '!buybest', usage: '!buybest', desc: 'Auto-buy the single best ROI upgrade available', category: 'biz' },
        { cmd: '!buybestmax', usage: '!buybestmax', desc: 'Spend ALL your coins on best ROI upgrades', category: 'biz' },
      ]
    },
    {
      title: 'TAP UPGRADES',
      accent: '#e040fb',
      icon: '⚡',
      commands: [
        { cmd: '!upgrade tap', usage: '!upgrade tap', desc: 'Increase coins per tap (+1/level, max 100)', category: 'upg' },
        { cmd: '!upgrade crit', usage: '!upgrade crit', desc: 'Increase combo multiplier (+4%/level, max 50) — boosts combo streak', category: 'upg' },
        { cmd: '!upgrade multi', usage: '!upgrade multi', desc: 'Increase taps per like/follow (+1/level, max 10)', category: 'upg' },
      ]
    },
    {
      title: 'COSMETICS SHOP',
      accent: '#00ffcc',
      icon: '🛍️',
      commands: [
        { cmd: '!shop', usage: '!shop', desc: 'Browse the cosmetics shop — overview of all categories', category: 'cos' },
        { cmd: '!shop [cat]', usage: '!shop [category]', desc: 'View items in a category: wc, wg, pb, pg, ng, nc, tt, we', category: 'cos' },
        { cmd: '!shop [rarity]', usage: '!shop [rarity]', desc: 'View items by rarity: common, uncommon, rare, epic, legendary, ultra, aux', category: 'cos' },
        { cmd: '!buyc', usage: '!buyc [name]', desc: 'Buy a cosmetic by exact name (auto-equips on purchase)', category: 'cos' },
        { cmd: '!equip', usage: '!equip [name]', desc: 'Equip a cosmetic you own', category: 'cos' },
        { cmd: '!unequip', usage: '!unequip [category]', desc: 'Unequip a cosmetic from a specific category', category: 'cos' },
        { cmd: '!mycos', usage: '!mycos', desc: 'View all your owned cosmetics with equipped status', category: 'cos' },
        { cmd: '!test', usage: '!test [name]', desc: 'Preview ANY cosmetic for 30 seconds (even unowned)', category: 'cos' },
        { cmd: '!untest', usage: '!untest', desc: 'Clear cosmetic preview early', category: 'cos' },
      ]
    },
    {
      title: 'COSMETIC SETS',
      accent: '#ff6ec7',
      icon: '🧩',
      commands: [
        { cmd: '!sets', usage: '!sets', desc: 'View all cosmetic sets and your completion progress', category: 'set' },
        { cmd: '!buyset', usage: '!buyset [name]', desc: 'Buy a complete set — e.g. !buyset america, !buyset canada', category: 'set' },
      ]
    }
  ];

  // Measure height
  let totalH = 30; // top padding
  totalH += 70; // title
  totalH += 50; // subtitle
  for (const sec of sections) {
    totalH += 52; // section header
    totalH += sec.commands.length * 48; // command rows
    totalH += 20; // gap
  }
  totalH += 120; // quick reference box
  totalH += 60; // footer

  const canvas = createCanvas(W, totalH);
  const ctx = canvas.getContext('2d');
  drawBg(ctx, W, totalH);

  let y = 30;

  // Title
  ctx.font = 'bold 40px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('WORD TYCOON — COMPLETE COMMAND GUIDE', W / 2, y);
  y += 50;

  ctx.font = '16px Arial';
  ctx.fillStyle = '#8888bb';
  ctx.fillText('Every command available in-game and chat relay  |  Type commands in TikTok, YouTube, Twitch, or Discord chat', W / 2, y);
  y += 40;

  // Sections
  for (const sec of sections) {
    y = drawSectionHeader(ctx, PAD, y, CW, `${sec.icon}  ${sec.title}`, sec.accent) + 4;

    for (let i = 0; i < sec.commands.length; i++) {
      const c = sec.commands[i];
      const rowY = y;
      const rowH = 44;

      // Alternating row bg
      if (i % 2 === 0) {
        roundRect(ctx, PAD + 4, rowY, CW - 8, rowH, 6);
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.fill();
      }

      // Command badge
      const badgeX = PAD + 20;
      ctx.font = 'bold 15px Courier New';
      const cmdW = ctx.measureText(c.usage).width + 20;
      roundRect(ctx, badgeX, rowY + 8, cmdW, 28, 6);
      ctx.fillStyle = sec.accent + '20';
      ctx.fill();
      ctx.strokeStyle = sec.accent + '50';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = sec.accent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.usage, badgeX + 10, rowY + 22);

      // Description
      ctx.font = '14px Arial';
      ctx.fillStyle = '#ccccdd';
      ctx.fillText(c.desc, badgeX + cmdW + 20, rowY + 22);

      y += rowH + 4;
    }
    y += 16;
  }

  // Quick Reference Box
  y += 10;
  roundRect(ctx, PAD + 80, y, CW - 160, 90, 12);
  ctx.fillStyle = '#12122a';
  ctx.fill();
  ctx.strokeStyle = '#333366';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = '#ffab00';
  ctx.textAlign = 'center';
  ctx.fillText('QUICK START', W / 2, y + 18);

  ctx.font = '14px Arial';
  ctx.fillStyle = '#aaaacc';
  ctx.fillText('1. Type !play to start (free Library)  →  2. !tap or Like stream for coins  →  3. !buybest to upgrade', W / 2, y + 42);
  ctx.fillText('4. !buybestmax to spend all coins  →  5. !shop to browse cosmetics  →  6. !discord to play from Discord', W / 2, y + 62);

  y += 100;
  drawFooter(ctx, y, W);

  const outPath = path.join(__dirname, 'guide-commands.png');
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`Commands guide: ${outPath} (${W}x${totalH}px, ${(buf.length / 1024).toFixed(0)} KB)`);
}

// ═══════════════════════════════════════════════════════════════
// 2. COSMETICS GUIDE (Enhanced with visual displays)
// ═══════════════════════════════════════════════════════════════
function generateCosmeticsGuide() {
  const { COSMETICS_CATALOG, COSMETIC_SETS } = require('./src/cosmetics');
  const W = 1500;
  const PAD = 30;
  const CW = W - PAD * 2;

  const RARITY_COLORS = {
    common: '#9d9d9d', uncommon: '#4fc34f', rare: '#4a9eff',
    epic: '#b44aff', legendary: '#ffab00', ultra: '#ff4444', aux: '#00ffcc'
  };

  const CATEGORY_INFO = {
    word_color:      { name: 'WORD COLORS',  icon: '🔤', buff: 'Tap Power',       accent: '#ef4444', desc: 'Changes the color of your guessed words' },
    word_glow:       { name: 'WORD GLOWS',   icon: '✦',  buff: 'Word Game Money', accent: '#fbbf24', desc: 'Adds a glow effect around your words' },
    profile_border:  { name: 'BORDERS',      icon: '🔲', buff: 'Biz Income',      accent: '#3b82f6', desc: 'Border ring around your profile picture' },
    profile_glow:    { name: 'GLOWS',        icon: '✨', buff: 'Offline Income',  accent: '#a855f7', desc: 'Glowing aura around your profile picture' },
    name_glow:       { name: 'NAME GLOWS',   icon: '💫', buff: 'Combo Max',       accent: '#ec4899', desc: 'Glow effect behind your username' },
    name_color:      { name: 'NAME COLORS',  icon: '🏷️', buff: 'All Coins',       accent: '#14b8a6', desc: 'Changes the color of your displayed name' },
    title:           { name: 'TITLES',       icon: '👑', buff: 'All Income',      accent: '#f97316', desc: 'Custom title displayed under your name' },
    win_effect:      { name: 'WIN EFFECTS',  icon: '🎆', buff: 'Lucky 2x',        accent: '#06b6d4', desc: 'Particle animation when you win a game' }
  };

  const categories = ['word_color', 'word_glow', 'profile_border', 'profile_glow', 'name_glow', 'name_color', 'title', 'win_effect'];

  // Group items
  const byCategory = {};
  for (const item of COSMETICS_CATALOG) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }
  for (const cat of Object.keys(byCategory)) byCategory[cat].sort((a, b) => a.sort - b.sort);

  // Measure height
  const ROW_H = 36;
  let totalH = 30 + 60 + 40; // top pad + title + subtitle
  // Rarity legend
  totalH += 50;
  // AUX section
  totalH += 70;

  for (const cat of categories) {
    const items = (byCategory[cat] || []).filter(i => !i.audioReactive);
    totalH += 52; // cat header
    totalH += 32; // table header
    totalH += items.length * ROW_H;
    totalH += 24; // gap
  }

  // AUX items section
  totalH += 52 + 32 + 8 * ROW_H + 24;
  // Sets section
  totalH += 52 + 30 + Object.keys(COSMETIC_SETS || {}).length * 44 + 24;
  totalH += 60; // footer

  const canvas = createCanvas(W, totalH);
  const ctx = canvas.getContext('2d');
  drawBg(ctx, W, totalH);

  let y = 30;

  // Title
  ctx.font = 'bold 38px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('WORD TYCOON — COMPLETE COSMETICS CATALOG', W / 2, y);
  y += 48;

  ctx.font = '15px Arial';
  ctx.fillStyle = '#8888bb';
  ctx.fillText(`${COSMETICS_CATALOG.length} cosmetics across 8 categories  |  Every item grants gameplay buffs  |  !shop [category] to browse`, W / 2, y);
  y += 32;

  // Rarity legend bar
  roundRect(ctx, PAD + 40, y, CW - 80, 38, 10);
  ctx.fillStyle = '#12122a';
  ctx.fill();
  ctx.strokeStyle = '#333355';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = '#666688';
  ctx.textAlign = 'left';
  ctx.fillText('RARITY:', PAD + 58, y + 19);
  let rx = PAD + 130;
  for (const [rarity, color] of Object.entries(RARITY_COLORS)) {
    const pw = drawPill(ctx, rx, y + 7, rarity.toUpperCase(), color + '25', color, 11);
    rx += pw + 8;
  }
  y += 48;

  // Column positions
  const COL = { swatch: PAD + 12, name: PAD + 50, rarity: PAD + 230, buff: PAD + 380, price: PAD + 600, preview: PAD + 760 };

  // Categories
  for (const cat of categories) {
    const info = CATEGORY_INFO[cat];
    const items = (byCategory[cat] || []).filter(i => !i.audioReactive);

    y = drawSectionHeader(ctx, PAD, y, CW, `${info.icon}  ${info.name}  —  Buff: ${info.buff}`, info.accent) + 4;

    // Table header
    ctx.font = 'bold 11px Arial';
    ctx.fillStyle = '#666688';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const thY = y + 16;
    ctx.fillText('COLOR', COL.swatch, thY);
    ctx.fillText('NAME', COL.name, thY);
    ctx.fillText('RARITY', COL.rarity, thY);
    ctx.fillText('BUFF', COL.buff, thY);
    ctx.fillText('PRICE', COL.price, thY);
    ctx.fillText('VISUAL PREVIEW', COL.preview, thY);
    y += 32;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowY = y;

      // Alternating bg
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.015)';
        ctx.fillRect(PAD + 4, rowY, CW - 8, ROW_H);
      }

      // Rarity accent stripe
      ctx.fillStyle = RARITY_COLORS[item.rarity] + '50';
      ctx.fillRect(PAD, rowY, 3, ROW_H);

      const mid = rowY + ROW_H / 2;

      // ─── Enhanced color swatch with glow simulation ───
      if (item.css && item.css.color && cat !== 'title' && cat !== 'win_effect') {
        const swatchColor = item.css.color;
        // Swatch on dark bg with glow halo
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(COL.swatch + 10, mid, 10, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = swatchColor;
        ctx.fillStyle = swatchColor;
        ctx.beginPath(); ctx.arc(COL.swatch + 10, mid, 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Swatch on light bg with glow halo
        ctx.fillStyle = '#ddd';
        ctx.beginPath(); ctx.arc(COL.swatch + 30, mid, 10, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.shadowBlur = 6;
        ctx.shadowColor = swatchColor;
        ctx.fillStyle = swatchColor;
        ctx.beginPath(); ctx.arc(COL.swatch + 30, mid, 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      } else if (cat === 'title' && item.css && item.css.titleColor) {
        const swatchColor = item.css.titleColor;
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(COL.swatch + 10, mid, 10, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.shadowBlur = 6;
        ctx.shadowColor = swatchColor;
        ctx.fillStyle = swatchColor;
        ctx.beginPath(); ctx.arc(COL.swatch + 10, mid, 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      } else if (cat === 'win_effect' && item.css && item.css.colors) {
        const cols = item.css.colors.slice(0, 4);
        for (let d = 0; d < cols.length; d++) {
          ctx.fillStyle = cols[d];
          ctx.beginPath(); ctx.arc(COL.swatch + 6 + d * 14, mid, 5, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Name + animated sparkle indicator
      ctx.font = 'bold 13px Arial';
      ctx.fillStyle = '#ddddee';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.name, COL.name, mid);
      if (item.css && item.css.animation) {
        const nameWidth = ctx.measureText(item.name).width;
        ctx.fillStyle = '#00ffcc';
        ctx.font = 'bold 12px Arial';
        ctx.fillText(' \u2726', COL.name + nameWidth, mid);
      }

      // Set indicator badge
      if (item.setId) {
        const setDef = COSMETIC_SETS ? COSMETIC_SETS[item.setId] : null;
        const setTag = setDef ? setDef.name : item.setId;
        ctx.font = 'bold 13px Arial';
        const nameWidth = ctx.measureText(item.name).width;
        const animOffset = (item.css && item.css.animation) ? 18 : 0;
        drawPill(ctx, COL.name + nameWidth + animOffset + 6, mid - 8, '\u{1F9E9} ' + setTag, '#333366', '#aaaacc', 8);
      }

      // Rarity pill
      const rc = RARITY_COLORS[item.rarity];
      drawPill(ctx, COL.rarity, mid - 9, item.rarity.toUpperCase(), rc + '20', rc, 10);

      // Buff
      ctx.font = '12px Arial';
      ctx.fillStyle = '#88cc88';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.buff ? item.buff.label : '\u2014', COL.buff, mid);

      // Price
      ctx.font = 'bold 13px Arial';
      ctx.fillStyle = item.giftSet ? '#e53e3e' : '#ffd700';
      ctx.textAlign = 'left';
      ctx.fillText(item.giftSet ? 'GIFT SET' : formatPrice(item.cost) + ' coins', COL.price, mid);

      // ─── Enhanced visual preview with glow simulation ───
      if (cat === 'word_color' || cat === 'name_color' || cat === 'word_glow' || cat === 'name_glow' || cat === 'title') {
        const previewText = cat === 'title' ? (item.css.title || item.name).substring(0, 8) : 'WORD';
        const previewCss = {};
        if (cat === 'title') {
          previewCss.color = item.css.titleColor || '#fff';
          previewCss.textShadow = item.css.titleGlow || '';
        } else {
          previewCss.color = item.css.color || '#fff';
          previewCss.textShadow = item.css.textShadow || '';
        }

        // Dark bg preview with glow
        roundRect(ctx, COL.preview, rowY + 3, 120, ROW_H - 6, 4);
        ctx.fillStyle = '#111118';
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.rect(COL.preview, rowY + 3, 120, ROW_H - 6);
        ctx.clip();
        drawGlowText(ctx, previewText, COL.preview + 60, mid, 14, previewCss);
        ctx.restore();

        // Light bg preview with glow
        roundRect(ctx, COL.preview + 130, rowY + 3, 120, ROW_H - 6, 4);
        ctx.fillStyle = '#e8e8ee';
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.rect(COL.preview + 130, rowY + 3, 120, ROW_H - 6);
        ctx.clip();
        drawGlowText(ctx, previewText, COL.preview + 190, mid, 14, previewCss);
        ctx.restore();

        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      } else if (cat === 'profile_border') {
        // Dark bg preview with border circle + glow
        roundRect(ctx, COL.preview, rowY + 3, 120, ROW_H - 6, 4);
        ctx.fillStyle = '#111118';
        ctx.fill();

        let borderColor = '#ffffff';
        let borderWidth = 2;
        if (item.css && item.css.border) {
          const bm = item.css.border.match(/(\d+)px\s+solid\s+(.*)/);
          if (bm) { borderWidth = Math.min(+bm[1], 3); borderColor = bm[2].trim(); }
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(COL.preview, rowY + 3, 120, ROW_H - 6);
        ctx.clip();
        // Glow ring from boxShadow
        if (item.css && item.css.boxShadow) {
          const bsLayers = parseTextShadow(item.css.boxShadow);
          const glowLayers = bsLayers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
          glowLayers.sort((a, b) => b.blur - a.blur);
          for (const gl of glowLayers) {
            ctx.save();
            ctx.shadowBlur = gl.blur * 1.2;
            ctx.shadowColor = gl.color;
            ctx.beginPath();
            ctx.arc(COL.preview + 60, mid, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.01)';
            ctx.fill();
            ctx.restore();
          }
        }
        // Circle fill
        ctx.beginPath();
        ctx.arc(COL.preview + 60, mid, 10 - borderWidth, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(80,80,100,0.5)';
        ctx.fill();
        // Border ring
        ctx.beginPath();
        ctx.arc(COL.preview + 60, mid, 10 - borderWidth / 2, 0, Math.PI * 2);
        ctx.lineWidth = borderWidth;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
        ctx.restore();

        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      } else if (cat === 'profile_glow') {
        // Dark bg preview with glow circle
        roundRect(ctx, COL.preview, rowY + 3, 120, ROW_H - 6, 4);
        ctx.fillStyle = '#111118';
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.rect(COL.preview, rowY + 3, 120, ROW_H - 6);
        ctx.clip();
        if (item.css && item.css.boxShadow) {
          const bsLayers = parseTextShadow(item.css.boxShadow);
          const glowLayers = bsLayers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
          glowLayers.sort((a, b) => b.blur - a.blur);
          for (const gl of glowLayers) {
            ctx.save();
            ctx.shadowBlur = gl.blur * 1.5;
            ctx.shadowColor = gl.color;
            ctx.beginPath();
            ctx.arc(COL.preview + 60, mid, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.01)';
            ctx.fill();
            ctx.restore();
          }
        }
        // Inner circle
        ctx.beginPath();
        ctx.arc(COL.preview + 60, mid, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100,100,130,0.6)';
        ctx.fill();
        ctx.restore();

        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      } else if (cat === 'win_effect' && item.css && item.css.colors) {
        // Win effect: small scatter preview
        roundRect(ctx, COL.preview, rowY + 3, 120, ROW_H - 6, 4);
        ctx.fillStyle = '#111118';
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.rect(COL.preview, rowY + 3, 120, ROW_H - 6);
        ctx.clip();
        const colors = item.css.colors;
        const cx = COL.preview + 60;
        const cy = mid;
        const rng = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
        const rand = rng(42 + i);
        for (let d = 0; d < 14; d++) {
          const angle = rand() * Math.PI * 2;
          const dist = 3 + rand() * 12;
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
      }

      // ─── Enhanced ANIMATED indicator ───
      if (cat === 'word_glow' || cat === 'name_glow' || cat === 'profile_glow' || cat === 'profile_border') {
        if (item.css && item.css.animation) {
          // Bright gradient background badge with sparkle
          const badgeX = COL.preview + 260;
          const badgeW = 96;
          const badgeH = ROW_H - 8;
          const badgeY = rowY + 4;

          // Get item's primary color for gradient
          let primaryColor = '#00ffcc';
          if (item.css.textShadow) {
            const layers = parseTextShadow(item.css.textShadow);
            const glowL = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
            if (glowL.length > 0) primaryColor = glowL[0].color;
          } else if (item.css.boxShadow) {
            const layers = parseTextShadow(item.css.boxShadow);
            const glowL = layers.map(l => parseShadowLayer(l)).filter(l => l.blur > 0);
            if (glowL.length > 0) primaryColor = glowL[0].color;
          }

          roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
          const animGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY);
          animGrad.addColorStop(0, primaryColor);
          animGrad.addColorStop(1, '#00ffcc');
          ctx.fillStyle = animGrad;
          ctx.globalAlpha = 0.2;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#00ffcc80';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.font = 'bold 10px Arial';
          ctx.fillStyle = '#00ffcc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('\u2726 ANIMATED', badgeX + badgeW / 2, mid);
        } else {
          roundRect(ctx, COL.preview + 260, rowY + 3, 80, ROW_H - 6, 4);
          ctx.fillStyle = '#111118';
          ctx.fill();
          ctx.font = 'bold 10px Arial';
          ctx.fillStyle = '#666688';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('STATIC', COL.preview + 300, mid);
        }
      }

      y += ROW_H;
    }
    y += 20;
  }

  // AUX Section
  const auxItems = COSMETICS_CATALOG.filter(i => i.audioReactive);
  if (auxItems.length > 0) {
    y = drawSectionHeader(ctx, PAD, y, CW, '🎵  AUDIO-REACTIVE (AUX) COSMETICS  —  25B coins each  |  Word Reward 2x + Category Buff', '#00ffcc') + 4;

    ctx.font = 'bold 11px Arial';
    ctx.fillStyle = '#666688';
    ctx.textAlign = 'left';
    const thY2 = y + 16;
    ctx.fillText('NAME', PAD + 20, thY2);
    ctx.fillText('CATEGORY', PAD + 200, thY2);
    ctx.fillText('BUFF', PAD + 380, thY2);
    ctx.fillText('SPECIAL', PAD + 600, thY2);
    y += 32;

    for (let i = 0; i < auxItems.length; i++) {
      const item = auxItems[i];
      const rowY = y;
      const mid = rowY + ROW_H / 2;

      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(0,255,204,0.02)';
        ctx.fillRect(PAD + 4, rowY, CW - 8, ROW_H);
      }

      ctx.fillStyle = '#00ffcc50';
      ctx.fillRect(PAD, rowY, 3, ROW_H);

      ctx.font = 'bold 13px Arial';
      ctx.fillStyle = '#00ffcc';
      ctx.textAlign = 'left';
      ctx.fillText(item.name, PAD + 20, mid);

      ctx.font = '12px Arial';
      ctx.fillStyle = '#aaaacc';
      const catInfo = CATEGORY_INFO[item.category];
      ctx.fillText(catInfo ? catInfo.name : item.category, PAD + 200, mid);

      ctx.fillStyle = '#88cc88';
      ctx.fillText(item.buff ? item.buff.label : '\u2014', PAD + 380, mid);

      ctx.fillStyle = '#ffab00';
      ctx.fillText('Word Reward 2x + Audio Reactive', PAD + 600, mid);

      y += ROW_H;
    }
    y += 20;
  }

  // Sets Section
  if (COSMETIC_SETS && Object.keys(COSMETIC_SETS).length > 0) {
    y = drawSectionHeader(ctx, PAD, y, CW, '🧩  COSMETIC SETS  —  Complete collections with themed items', '#ff6ec7') + 4;

    ctx.font = 'bold 11px Arial';
    ctx.fillStyle = '#666688';
    ctx.textAlign = 'left';
    ctx.fillText('SET NAME', PAD + 20, y + 16);
    ctx.fillText('RARITY', PAD + 200, y + 16);
    ctx.fillText('ITEMS', PAD + 380, y + 16);
    ctx.fillText('HOW TO GET', PAD + 500, y + 16);
    y += 30;

    let si = 0;
    for (const [setId, setDef] of Object.entries(COSMETIC_SETS)) {
      const rowY = y;
      const mid = rowY + 22;

      if (si % 2 === 0) {
        ctx.fillStyle = 'rgba(255,110,199,0.02)';
        ctx.fillRect(PAD + 4, rowY, CW - 8, 40);
      }

      ctx.font = 'bold 14px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(setDef.name || setId, PAD + 20, mid);

      const rc = RARITY_COLORS[setDef.rarity] || '#9d9d9d';
      drawPill(ctx, PAD + 200, mid - 9, (setDef.rarity || 'common').toUpperCase(), rc + '20', rc, 10);

      const setItems = COSMETICS_CATALOG.filter(i => i.setId === setId);
      ctx.font = '12px Arial';
      ctx.fillStyle = '#aaaacc';
      ctx.fillText(`${setItems.length} items (1 per category)`, PAD + 380, mid);

      ctx.fillStyle = setDef.giftSet ? '#ff6ec7' : '#ffd700';
      ctx.fillText(setDef.giftSet ? 'TikTok Gift Coins' : 'Regular Coins', PAD + 500, mid);

      y += 44;
      si++;
    }
    y += 20;
  }

  drawFooter(ctx, y, W);

  const outPath = path.join(__dirname, 'guide-cosmetics.png');
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`Cosmetics guide: ${outPath} (${W}x${totalH}px, ${(buf.length / 1024).toFixed(0)} KB)`);
}

// ═══════════════════════════════════════════════════════════════
// 3. BUSINESSES GUIDE (with visual display)
// ═══════════════════════════════════════════════════════════════
function generateBusinessesGuide() {
  const W = 1400;
  const PAD = 30;
  const CW = W - PAD * 2;

  const BUSINESSES = [
    { key: 'library', name: 'Library', emoji: '📚', cost: 0, income: 1, cycle: 1, mult: '1x', aliases: 'library, lib', special: 'FREE — Upgrades via finding unique words across all games' },
    { key: 'newspaper', name: 'Newspaper Route', emoji: '📰', cost: 5000, income: 5, cycle: 3, mult: '1.15x', aliases: 'newspaper, news, paper, nr', special: null },
    { key: 'carwash', name: 'Car Wash', emoji: '🚗', cost: 100000, income: 25, cycle: 6, mult: '1.15x', aliases: 'carwash, car, wash, cw', special: null },
    { key: 'pizza', name: 'Pizza Shop', emoji: '🍕', cost: 2000000, income: 50, cycle: 5, mult: '1.15x', aliases: 'pizza, pz', special: null },
    { key: 'arcade', name: 'Arcade', emoji: '🎮', cost: 50000000, income: 200, cycle: 8, mult: '1.15x', aliases: 'arcade, arc, game', special: null },
    { key: 'gym', name: 'Gym', emoji: '🏋️', cost: 250000000, income: 1000, cycle: 10, mult: '1.15x', aliases: 'gym, fit', special: null },
    { key: 'cinema', name: 'Movie Theater', emoji: '🎬', cost: 1000000000, income: 5000, cycle: 12, mult: '1.15x', aliases: 'cinema, movie, theater, mt', special: null },
    { key: 'startup', name: 'Tech Startup', emoji: '💻', cost: 3000000000, income: 25000, cycle: 15, mult: '1.15x', aliases: 'startup, tech, ts', special: null },
    { key: 'bank', name: 'Bank', emoji: '🏦', cost: 6000000000, income: 150000, cycle: 20, mult: '1.15x', aliases: 'bank, bk', special: null },
    { key: 'space', name: 'Space Agency', emoji: '🚀', cost: 10000000000, income: 1000000, cycle: 25, mult: '1.15x', aliases: 'space, rocket, nasa, sa', special: null },
  ];

  const UPGRADES = [
    { name: 'Tap Power', cmd: '!upgrade tap', baseCost: 1000, mult: '1.15x', max: 100, effect: '+1 coin per tap per level', icon: '👆' },
    { name: 'Critical Tap', cmd: '!upgrade crit', baseCost: 25000, mult: '1.25x', max: 50, effect: '+4% combo multiplier per level (up to 3.0x)', icon: '💥' },
    { name: 'Multi-Tap', cmd: '!upgrade multi', baseCost: 250000, mult: '1.5x', max: 10, effect: '+1 tap per like/follow per level', icon: '✊' },
  ];

  // Measure height
  let totalH = 30 + 60 + 40; // top + title + subtitle
  totalH += 52 + 10; // businesses header
  totalH += BUSINESSES.length * 120; // business cards
  totalH += 30; // gap
  totalH += 52 + 10; // upgrades header
  totalH += UPGRADES.length * 80; // upgrade cards
  totalH += 30; // gap
  totalH += 52 + 10; // income formula header
  totalH += 160; // formula section
  totalH += 30; // gap
  totalH += 52 + 10; // progression header
  totalH += 280; // progression chart
  totalH += 60; // footer

  const canvas = createCanvas(W, totalH);
  const ctx = canvas.getContext('2d');
  drawBg(ctx, W, totalH);

  let y = 30;

  // Title
  ctx.font = 'bold 40px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('WORD TYCOON — BUSINESSES & UPGRADES', W / 2, y);
  y += 50;

  ctx.font = '16px Arial';
  ctx.fillStyle = '#8888bb';
  ctx.fillText('10 businesses to build your empire  |  3 tap upgrades to boost your earning power', W / 2, y);
  y += 36;

  // Businesses
  y = drawSectionHeader(ctx, PAD, y, CW, '🏢  ALL BUSINESSES  —  !buy [name] to purchase  |  !empire to view yours', '#ffab00') + 10;

  for (let i = 0; i < BUSINESSES.length; i++) {
    const biz = BUSINESSES[i];
    const cardH = 100;
    const cardY = y;

    // Card background
    roundRect(ctx, PAD + 10, cardY, CW - 20, cardH, 12);
    const cardGrad = ctx.createLinearGradient(PAD, cardY, PAD + CW, cardY);
    const hue = (i / BUSINESSES.length) * 60 + 20; // warm gradient
    cardGrad.addColorStop(0, `hsla(${hue}, 40%, 8%, 0.9)`);
    cardGrad.addColorStop(1, `hsla(${hue}, 40%, 5%, 0.9)`);
    ctx.fillStyle = cardGrad;
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, 60%, 30%, 0.5)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Number badge
    roundRect(ctx, PAD + 20, cardY + 10, 32, 32, 16);
    ctx.fillStyle = '#ffab00';
    ctx.fill();
    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1}`, PAD + 36, cardY + 26);

    // Emoji
    ctx.font = '40px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(biz.emoji, PAD + 90, cardY + 36);

    // Business name
    ctx.font = 'bold 22px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(biz.name, PAD + 130, cardY + 28);

    // Aliases
    ctx.font = '11px Courier New';
    ctx.fillStyle = '#888899';
    ctx.fillText(`Aliases: ${biz.aliases}`, PAD + 130, cardY + 48);

    // Stats row
    const statsY = cardY + 68;

    // Cost pill
    if (biz.cost === 0) {
      drawPill(ctx, PAD + 130, statsY, 'FREE', '#22c55e30', '#22c55e', 12);
    } else {
      drawPill(ctx, PAD + 130, statsY, `Cost: ${formatPrice(biz.cost)}`, '#ffd70030', '#ffd700', 12);
    }

    // Income pill
    const ips = (biz.income / biz.cycle).toFixed(1);
    drawPill(ctx, PAD + 310, statsY, `Base: ${formatPrice(biz.income)}/cycle`, '#4CAF5030', '#4CAF50', 12);

    // Cycle pill
    drawPill(ctx, PAD + 530, statsY, `Cycle: ${biz.cycle}s`, '#3b82f630', '#3b82f6', 12);

    // Income/sec pill
    drawPill(ctx, PAD + 670, statsY, `${ips}/sec`, '#ff6ec730', '#ff6ec7', 12);

    // Cost multiplier
    drawPill(ctx, PAD + 790, statsY, `Upgrade ×${biz.mult}`, '#e040fb30', '#e040fb', 12);

    // Special note
    if (biz.special) {
      ctx.font = 'bold 11px Arial';
      ctx.fillStyle = '#ffab00';
      ctx.textAlign = 'right';
      ctx.fillText('★ ' + biz.special, PAD + CW - 30, cardY + 28);
    }

    // Income bar visualization (relative scale)
    const maxIncome = 1000000;
    const barW = Math.max(4, Math.min(400, (Math.log10(biz.income + 1) / Math.log10(maxIncome)) * 400));
    const barY = cardY + 88;
    roundRect(ctx, PAD + 130, barY, 400, 6, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    roundRect(ctx, PAD + 130, barY, barW, 6, 3);
    const barGrad = ctx.createLinearGradient(PAD + 130, barY, PAD + 130 + barW, barY);
    barGrad.addColorStop(0, '#ffab00');
    barGrad.addColorStop(1, '#ff6ec7');
    ctx.fillStyle = barGrad;
    ctx.fill();

    y += cardH + 16;
  }

  y += 20;

  // Upgrades
  y = drawSectionHeader(ctx, PAD, y, CW, '⚡  TAP UPGRADES  —  !upgrade [tap|crit|multi]', '#e040fb') + 10;

  for (let i = 0; i < UPGRADES.length; i++) {
    const upg = UPGRADES[i];
    const cardH = 64;
    const cardY = y;

    roundRect(ctx, PAD + 10, cardY, CW - 20, cardH, 10);
    ctx.fillStyle = 'rgba(224,64,251,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(224,64,251,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Icon
    ctx.font = '30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(upg.icon, PAD + 45, cardY + 28);

    // Name
    ctx.font = 'bold 18px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(upg.name, PAD + 80, cardY + 24);

    // Command
    ctx.font = 'bold 12px Courier New';
    ctx.fillStyle = '#e040fb';
    ctx.fillText(upg.cmd, PAD + 80, cardY + 44);

    // Stats
    drawPill(ctx, PAD + 300, cardY + 18, `Base: ${formatPrice(upg.baseCost)}`, '#ffd70030', '#ffd700', 11);
    drawPill(ctx, PAD + 460, cardY + 18, `Mult: ${upg.mult}`, '#e040fb30', '#e040fb', 11);
    drawPill(ctx, PAD + 590, cardY + 18, `Max Lv: ${upg.max}`, '#3b82f630', '#3b82f6', 11);

    // Effect
    ctx.font = '13px Arial';
    ctx.fillStyle = '#88cc88';
    ctx.textAlign = 'left';
    ctx.fillText(upg.effect, PAD + 730, cardY + 32);

    y += cardH + 12;
  }

  y += 20;

  // Income Formulas
  y = drawSectionHeader(ctx, PAD, y, CW, '📊  HOW INCOME WORKS', '#3b82f6') + 10;

  const formulas = [
    { label: 'Business Income', formula: 'Base Income × Level  (per cycle)', color: '#4CAF50' },
    { label: 'Library Special', formula: 'Base Income × 10^(level-1)  |  Level = Unique Words Found', color: '#ffab00' },
    { label: 'Upgrade Cost', formula: 'Base Cost × (Multiplier ^ Current Level)', color: '#e040fb' },
    { label: 'Tap Income', formula: '(1 + Tap Level) × Combo Mult × Crit Mult × Cosmetic Buffs', color: '#f59e0b' },
    { label: 'Combo Multiplier', formula: 'Up to 2x base (boosted by Name Glow cosmetics)', color: '#ec4899' },
    { label: 'Lucky 2x', formula: 'Random chance to double any coin reward (boosted by Win Effects)', color: '#06b6d4' },
  ];

  for (let i = 0; i < formulas.length; i++) {
    const f = formulas[i];
    const rowY = y + i * 24;

    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = f.color;
    ctx.textAlign = 'left';
    ctx.fillText(f.label + ':', PAD + 30, rowY + 12);

    ctx.font = '13px Courier New';
    ctx.fillStyle = '#ccccdd';
    ctx.fillText(f.formula, PAD + 230, rowY + 12);
  }

  y += formulas.length * 24 + 20;

  // Progression Chart
  y = drawSectionHeader(ctx, PAD, y, CW, '🚀  BUSINESS PROGRESSION  —  Build from Library to Space Agency', '#ff6ec7') + 10;

  // Visual progression: connected boxes
  const boxW = 110;
  const boxH = 60;
  const gap = 20;
  const startX = PAD + 20;
  const rows = 2;
  const perRow = 5;

  for (let i = 0; i < BUSINESSES.length; i++) {
    const biz = BUSINESSES[i];
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const bx = startX + col * (boxW + gap);
    const by = y + row * (boxH + 80);

    // Box
    roundRect(ctx, bx, by, boxW, boxH, 8);
    const boxGrad = ctx.createLinearGradient(bx, by, bx, by + boxH);
    boxGrad.addColorStop(0, '#1a1a35');
    boxGrad.addColorStop(1, '#111125');
    ctx.fillStyle = boxGrad;
    ctx.fill();
    ctx.strokeStyle = '#ffab0050';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Emoji
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(biz.emoji, bx + boxW / 2, by + 4);

    // Name
    ctx.font = 'bold 10px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(biz.name, bx + boxW / 2, by + 32);

    // Cost below
    ctx.font = '9px Arial';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(biz.cost === 0 ? 'FREE' : formatPrice(biz.cost), bx + boxW / 2, by + 46);

    // Arrow to next (if not last in row)
    if (col < perRow - 1 && i < BUSINESSES.length - 1) {
      ctx.strokeStyle = '#ffab0060';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + boxW + 2, by + boxH / 2);
      ctx.lineTo(bx + boxW + gap - 2, by + boxH / 2);
      ctx.stroke();
      // Arrowhead
      ctx.fillStyle = '#ffab0060';
      ctx.beginPath();
      ctx.moveTo(bx + boxW + gap - 2, by + boxH / 2);
      ctx.lineTo(bx + boxW + gap - 8, by + boxH / 2 - 4);
      ctx.lineTo(bx + boxW + gap - 8, by + boxH / 2 + 4);
      ctx.closePath();
      ctx.fill();
    }

    // Arrow down between rows
    if (col === perRow - 1 && row === 0 && i < BUSINESSES.length - 1) {
      ctx.strokeStyle = '#ffab0060';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + boxW / 2, by + boxH + 2);
      ctx.lineTo(bx + boxW / 2, by + boxH + 20);
      // Curve left
      ctx.quadraticCurveTo(bx + boxW / 2, by + boxH + 40, bx - 20, by + boxH + 40);
      ctx.lineTo(startX + 20, by + boxH + 40);
      ctx.quadraticCurveTo(startX, by + boxH + 40, startX, by + boxH + 60);
      ctx.lineTo(startX + boxW / 2, by + boxH + 78);
      ctx.stroke();
    }
  }

  y += rows * (boxH + 80) + 40;

  drawFooter(ctx, y, W);

  const outPath = path.join(__dirname, 'guide-businesses.png');
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`Businesses guide: ${outPath} (${W}x${totalH}px, ${(buf.length / 1024).toFixed(0)} KB)`);
}

// ═══════════════════════════════════════════════════════════════
// Generate all
// ═══════════════════════════════════════════════════════════════
console.log('Generating guide images...\n');
generateCommandsGuide();
generateCosmeticsGuide();
generateBusinessesGuide();
console.log('\nAll guides generated!');
