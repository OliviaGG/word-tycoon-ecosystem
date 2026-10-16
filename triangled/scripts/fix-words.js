/**
 * One-off script: replace duplicate and filler words across the 30-day batch,
 * then re-pack each affected grid. Images are NOT touched.
 */
const fs = require('fs');
const path = require('path');
const { packGrid, validateTheme } = require('../src/puzzle-generator');
const { TriangleGrid, TOTAL_CELLS } = require('../src/grid');

const PUZZLES_DIR = path.join(__dirname, '..', 'data', 'puzzles');

// ── Per-puzzle replacement maps ──────────────────────────────────────
// Format: { oldWord: newWord } — must be same length.
// Special key '_spangram' replaces the spangram itself.
const REPLACEMENTS = {
  '2026-04-16': { glyph: 'rinse' },

  '2026-04-17': { jab: 'tea', puddle: 'candle', umbrella: 'slippers' },

  '2026-04-18': { yew: 'pot', bloom: 'mulch', water: 'herbs', tulip: 'peony' },

  '2026-04-19': { gum: 'rye', spring: 'basket' },

  '2026-04-20': { mineral: 'express' },

  '2026-04-21': { oar: 'fog' },

  '2026-04-22': { flower: 'jungle' },

  '2026-04-23': { blanket: 'thermos' },

  '2026-04-24': { bow: 'dew', petal: 'pansy', fresh: 'vivid', lily: 'iris', spring: 'vernal' },

  '2026-04-25': { kit: 'oat', coffee: 'pastry' },

  '2026-04-26': { myriad: 'oriole' },

  '2026-04-27': {
    _spangram: 'landscape',
    seeds: 'weeds', water: 'spade', sprout: 'barrel'
  },

  '2026-04-29': { alchemy: 'balance' },

  '2026-04-30': { alchemy: 'crochet' },

  '2026-05-01': { thorn: 'shade' },

  '2026-05-02': { coil: 'hike', route: 'cabin', journey: 'retreat' },

  '2026-05-03': { tulip: 'aster', bloom: 'poppy', fjord: 'sprig' },

  '2026-05-06': {
    fig: 'nap', relax: 'quiet', breathe: 'restore',
    stretch: 'workout', coffee: 'stroll'
  },

  '2026-05-07': {
    cedar: 'steam', puddle: 'splash', cloud: 'foggy',
    shower: 'squall', drizzle: 'rainbow', umbrella: 'overcast'
  },

  '2026-05-08': { latch: 'alley', bloom: 'plaza', garden: 'gazebo' },

  '2026-05-09': { ace: 'dye', sewing: 'mosaic' },

  '2026-05-10': { mineral: 'bouquet', flower: 'warmth' },

  '2026-05-11': {
    _spangram: 'travelers',
    traffic: 'highway', subway: 'bridge', bicycle: 'scooter',
    carpool: 'shuttle', route: 'crowd', birch: 'pedal'
  },

  '2026-05-12': { myriad: 'pickle', salad: 'pasta', fruit: 'bagel' },

  '2026-05-13': {
    scalp: 'spray', tulip: 'peony', petal: 'lilac',
    bloom: 'flora', daisy: 'lupin', fresh: 'crisp',
    rose: 'vine', garden: 'meadow'
  },

  '2026-05-14': { ace: 'hat', water: 'flask' },

  '2026-05-15': { balm: 'lamp', tidy: 'pens', plant: 'chair' }
};

// ── Apply replacements and re-pack ───────────────────────────────────

let changed = 0;
let failed = 0;

for (const [date, swaps] of Object.entries(REPLACEMENTS)) {
  const jsonPath = path.join(PUZZLES_DIR, `${date}.json`);
  if (!fs.existsSync(jsonPath)) {
    console.warn(`[SKIP] ${date}: JSON not found`);
    continue;
  }

  const record = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const opt = record.puzzleOptions?.[0];
  if (!opt) {
    console.warn(`[SKIP] ${date}: no puzzle option`);
    continue;
  }

  let spangram = opt.spangram;
  let words = [...opt.words];
  const changes = [];

  // Apply spangram change
  if (swaps._spangram) {
    if (swaps._spangram.length !== spangram.length) {
      console.error(`[ERROR] ${date}: spangram length mismatch: ${spangram}(${spangram.length}) → ${swaps._spangram}(${swaps._spangram.length})`);
      failed++;
      continue;
    }
    changes.push(`spangram: ${spangram} → ${swaps._spangram}`);
    spangram = swaps._spangram;
  }

  // Apply word swaps
  for (const [oldW, newW] of Object.entries(swaps)) {
    if (oldW === '_spangram') continue;
    if (oldW.length !== newW.length) {
      console.error(`[ERROR] ${date}: length mismatch: ${oldW}(${oldW.length}) → ${newW}(${newW.length})`);
      failed++;
      continue;
    }
    const idx = words.indexOf(oldW);
    if (idx === -1) {
      console.warn(`  [WARN] ${date}: "${oldW}" not found in words, skipping`);
      continue;
    }
    words[idx] = newW;
    changes.push(`${oldW} → ${newW}`);
  }

  if (changes.length === 0) continue;

  // Verify total letter count
  const total = spangram.length + words.reduce((s, w) => s + w.length, 0);
  if (total !== TOTAL_CELLS) {
    console.error(`[ERROR] ${date}: total letters ${total} after swap, need ${TOTAL_CELLS}`);
    failed++;
    continue;
  }

  // Validate
  const testTheme = { theme: opt.theme, spangram, words };
  const validation = validateTheme(testTheme);
  if (!validation.valid) {
    console.error(`[ERROR] ${date}: validation failed after swap:`, validation.errors);
    failed++;
    continue;
  }

  // Re-pack grid (try up to 5000 attempts — triangle packing is hard)
  const packResult = packGrid(spangram, words, 5000);
  if (!packResult.success) {
    console.error(`[FAIL] ${date}: could not re-pack grid after swaps: ${changes.join(', ')}`);
    failed++;
    continue;
  }

  // Update the record
  opt.spangram = spangram;
  opt.words = words;
  opt.gridString = packResult.grid.toFlatString();
  opt.wordPaths = {};
  for (const [word, wordPath] of Object.entries(packResult.wordPaths)) {
    opt.wordPaths[word] = wordPath;
  }
  opt.ascii = packResult.grid.toAscii();

  // Also update the top-level puzzle reference
  if (record.puzzle) {
    record.puzzle.spangram = spangram;
    record.puzzle.words = words;
    record.puzzle.gridString = opt.gridString;
    record.puzzle.wordPaths = opt.wordPaths;
    record.puzzle.ascii = opt.ascii;
  }

  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2));
  console.log(`[OK] ${date}: ${changes.join(', ')}`);
  changed++;
}

console.log(`\nDone: ${changed} puzzles updated, ${failed} failed`);

// Final duplicate check
const wordMap = {};
for (let d = new Date('2026-04-16'); d <= new Date('2026-05-15'); d.setDate(d.getDate() + 1)) {
  const key = d.toISOString().slice(0, 10);
  const p = path.join(PUZZLES_DIR, `${key}.json`);
  if (!fs.existsSync(p)) continue;
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const opt = data.puzzleOptions?.[0];
  if (!opt) continue;
  const allWords = [opt.spangram, ...opt.words];
  for (const w of allWords) {
    if (!wordMap[w]) wordMap[w] = [];
    wordMap[w].push(key);
  }
}
const dupes = Object.entries(wordMap).filter(([, uses]) => uses.length > 1);
if (dupes.length > 0) {
  console.log(`\nRemaining duplicates (${dupes.length}):`);
  for (const [word, dates] of dupes.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${word} (${dates.length}x): ${dates.join(', ')}`);
  }
} else {
  console.log('\nNo remaining duplicate words!');
}
