// Liquid-glass guess row. One function, three states.
//
//   { state: 'empty' }                          → faint placeholder pill, no letters
//   { state: 'active', typed: 'CR' }            → neutral pill, letters as typed, no triangle, cursor on next slot
//   { state: 'committed',
//     word, correct, present, absent,
//     wordLen, allAbsent?, displayStates?,      → solo per-letter tap-cycle classes
//     avatar?, isFanClub?,                      → MP avatar perch
//     cosmetics?,                               → cosmetic data (color/glow/etc.)
//     applyCosmetics?                           → injected fn (keeps this module backend-free)
//   } → full liquid-glass pill + triangle stats
//
// Returns the row element. Caller owns insertion + replacement.

const SVG_NS = 'http://www.w3.org/2000/svg';

function rightnessGradient(ratio) {
  const hue = Math.max(0, Math.min(120, ratio * 120));
  const top = `hsl(${hue}, 78%, 60%)`;
  const mid = `hsl(${hue}, 75%, 46%)`;
  const bot = `hsl(${hue}, 72%, 34%)`;
  return `linear-gradient(180deg, ${top} 0%, ${mid} 50%, ${bot} 100%)`;
}

export function buildStatsTriangle(correct, present, absent) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'guess-triangle');
  svg.setAttribute('viewBox', '0 0 64 56');
  svg.setAttribute('aria-label', `${correct} correct, ${present} present, ${absent} absent`);

  const wedges = [
    { cls: 'tri-wedge-correct', points: '32,2 17,28 32,37 47,28' },
    { cls: 'tri-wedge-present', points: '2,54 32,54 32,37 17,28' },
    { cls: 'tri-wedge-absent',  points: '62,54 47,28 32,37 32,54' },
  ];
  wedges.forEach(w => {
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('class', w.cls);
    p.setAttribute('points', w.points);
    svg.appendChild(p);
  });

  const spokes = document.createElementNS(SVG_NS, 'path');
  spokes.setAttribute('class', 'tri-spokes');
  spokes.setAttribute('d', 'M32,37 L17,28 M32,37 L32,54 M32,37 L47,28');
  svg.appendChild(spokes);

  const outline = document.createElementNS(SVG_NS, 'polygon');
  outline.setAttribute('class', 'tri-outline');
  outline.setAttribute('points', '32,2 2,54 62,54');
  svg.appendChild(outline);

  [
    { cls: 't-correct', x: 32, y: 22, value: correct },
    { cls: 't-present', x: 19, y: 42, value: present },
    { cls: 't-absent',  x: 45, y: 42, value: absent },
  ].forEach(l => {
    if (!l.value) return;
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('class', l.cls);
    t.setAttribute('x', l.x);
    t.setAttribute('y', l.y);
    t.textContent = l.value;
    svg.appendChild(t);
  });
  return svg;
}

function pillLayers(letters, opts = {}) {
  const base = document.createElement('div');
  base.className = 'pill-base';
  letters.appendChild(base);

  const glass = document.createElement('div');
  glass.className = 'pill-glass';
  letters.appendChild(glass);

  const spec = document.createElement('div');
  spec.className = 'pill-spec';
  letters.appendChild(spec);

  if (opts.gradient) letters.style.setProperty('--guess-gradient', opts.gradient);
}

// "Branded" avatars are WT's profile logos / game logos / app icons — they
// already have their own framing (a coloured background + central mark) so
// our chunky dark ring + white rim crusts them up. Tag these images with an
// extra class so the CSS can drop the heavy outer rings and let the logo
// design read clean.
//
// Catches:
//   /portal/assets/profile-logos/*.{png,svg,…}  ← WT branded PFPs
//                                                  (bronze-builder, neon-arcade, classic-gold, …)
//   /portal/img/logo*.{png,svg,…}              ← WT logo + favicon variant
//   /portal/img/game-*.{png,svg,…}             ← per-game placeholder logos
//   /(app-icon|favicon-N|apple-touch-icon|icon-N)(-vN)?.ext
//                                              ← word5000.com's own marks
const BRANDED_AVATAR_PATTERNS = [
  /\/portal\/assets\/profile-logos\/[-_.\w]+\.(png|svg|jpg|jpeg|webp|gif)(\?.*)?$/i,
  /\/portal\/img\/logo[-_.\w]*\.(png|svg|jpg|jpeg|webp|gif)(\?.*)?$/i,
  /\/portal\/img\/game-[-_.\w]+\.(png|svg|jpg|jpeg|webp|gif)(\?.*)?$/i,
  /\/(app-icon|favicon-\d+|apple-touch-icon|icon-\d+)(-v\d+)?\.(png|svg|jpg|jpeg|webp|gif)(\?.*)?$/i,
];
function isBrandedAvatar(url) {
  if (!url) return false;
  const s = String(url);
  return BRANDED_AVATAR_PATTERNS.some(re => re.test(s));
}

function makeAvatarEl(g) {
  const player = document.createElement('div');
  player.className = 'guess-player';
  window.PerkBadges && window.PerkBadges.apply(player, g);

  if (g.avatar) {
    const img = document.createElement('img');
    img.src = g.avatar;
    img.className = 'player-pic';
    if (isBrandedAvatar(g.avatar)) img.classList.add('player-pic--branded');
    img.alt = g.displayName || '';
    img.onerror = function () { this.replaceWith(makeFallbackAvatar(g)); };
    player.appendChild(img);
  } else {
    player.appendChild(makeFallbackAvatar(g));
  }
  return player;
}

function makeFallbackAvatar(g) {
  const PLATFORM_COLORS = {
    tiktok: '#fe2c55', youtube: '#ff0000', discord: '#5865F2',
    twitch: '#9146FF', unknown: '#888',
  };
  const fb = document.createElement('div');
  fb.className = 'player-pic-fb';
  fb.style.backgroundColor = PLATFORM_COLORS[g.platform] || PLATFORM_COLORS.unknown;
  fb.textContent = (g.displayName || '?')[0].toUpperCase();
  return fb;
}

export function renderRow(g, opts = {}) {
  const row = document.createElement('div');
  row.className = 'guess-row';

  // ── EMPTY ─────────────────────────────────────────────────────────
  if (g.state === 'empty') {
    row.classList.add('row-empty');
    const letters = document.createElement('div');
    letters.className = 'guess-letters';
    pillLayers(letters);
    const wordLen = g.wordLen || opts.wordLen || 5;
    for (let i = 0; i < wordLen; i++) {
      const tile = document.createElement('div');
      tile.className = 'letter-tile';
      letters.appendChild(tile);
    }
    row.appendChild(letters);
    return row;
  }

  // ── ACTIVE (the user is typing into this slot) ────────────────────
  if (g.state === 'active') {
    row.classList.add('row-active');
    const letters = document.createElement('div');
    letters.className = 'guess-letters';
    pillLayers(letters);

    const wordLen = g.wordLen || opts.wordLen || 5;
    const typed = (g.typed || '').toUpperCase().slice(0, wordLen);
    for (let i = 0; i < wordLen; i++) {
      const tile = document.createElement('div');
      tile.className = 'letter-tile';
      if (typed[i]) {
        tile.textContent = typed[i];
        tile.classList.add('letter-filled');
      } else if (i === typed.length) {
        tile.classList.add('letter-cursor');
      }
      letters.appendChild(tile);
    }
    row.appendChild(letters);
    return row;
  }

  // ── COMMITTED ─────────────────────────────────────────────────────
  row.classList.add('row-committed');
  const wordLen = (g.word || '').length || g.wordLen || 5;
  const correct = g.correct || 0;
  const present = g.present || 0;
  const absent = g.absent || 0;
  if (g.allAbsent || (correct === 0 && present === 0)) row.classList.add('all-absent');
  if (correct === wordLen) row.classList.add('all-correct');
  if (typeof g.guessIdx === 'number') row.dataset.guessIdx = g.guessIdx;
  // Caller passes `animate: true` for rows appearing for the first time so
  // the per-letter stamp animation runs. Existing rows on re-render get no
  // class, so they paint instantly with no blink.
  if (g.animate) row.classList.add('row-new');

  // Avatar (MP only — solo callers don't pass avatar)
  if (g.avatar !== undefined || g.displayName) {
    row.appendChild(makeAvatarEl(g));
  }

  // Pill
  const ratio = Math.max(0, Math.min(1, (correct + 0.5 * present) / wordLen));
  const letters = document.createElement('div');
  letters.className = 'guess-letters';
  pillLayers(letters, { gradient: rightnessGradient(ratio) });

  (g.word || '').split('').forEach((letter, i) => {
    const tile = document.createElement('div');
    const mark = (g.marks && g.marks[i]) ? ' ' + g.marks[i] : '';
    tile.className = 'letter-tile' + mark;
    tile.textContent = letter;
    tile.dataset.letterIdx = i;
    tile.style.setProperty('--i', i);     // stagger index for the stamp animation
    letters.appendChild(tile);
  });
  row.appendChild(letters);

  // Triangle stats
  const counts = document.createElement('div');
  counts.className = 'guess-counts';
  counts.appendChild(buildStatsTriangle(correct, present, absent));
  row.appendChild(counts);

  // Cosmetics: avatar/name/title/border apply normally; word_color is held
  // back until the winning row, where the .all-correct CSS animation reveals
  // it then fades to default black. Per-letter colours never appear — the
  // gradient pill is the sole correctness signal.
  const isWin = correct === wordLen;
  if (g.cosmetics && typeof opts.applyCosmetics === 'function') {
    const avatarEl = row.querySelector('.player-pic, .player-pic-fb');
    const cos = isWin ? g.cosmetics : { ...g.cosmetics, word_color: undefined, word_glow: undefined };
    opts.applyCosmetics({ avatarEl, avatarSize: 44, wordEl: letters }, cos);
  }
  if (isWin && g.cosmetics && g.cosmetics.word_color && g.cosmetics.word_color.color) {
    letters.style.setProperty('--cosmetic-color', g.cosmetics.word_color.color);
    // Drop the inline colour set by applyCosmetics so the CSS animation owns
    // the colour transition during the flash.
    letters.style.color = '';
  }

  return row;
}
