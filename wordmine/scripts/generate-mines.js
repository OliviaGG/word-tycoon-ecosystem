#!/usr/bin/env node
/**
 * Generate 100 themed mines for the Word Mine puzzle pool.
 * Reads dictionary + frequency from Chat Relay's word bank data.
 * Outputs data/mines.json.
 */

const fs = require('fs');
const path = require('path');
const mineEngine = require('../src/mine-engine');

// ─── Config ──────────────────────────────────────────────────────────────────

const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const DATA_DIR = path.join(RELAY_DIR, 'data', 'word-bank');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'mines.json');

const MINES_PER_CATEGORY = 10;
const MAX_ATTEMPTS = 300;
const MIN_WORD_REQUIREMENTS = {
  surface: 15,
  shallow: 8,
  medium: 4,
  deep: 1,
};

// ─── 100 Themed Mines (10 categories × 10) ──────────────────────────────────

const THEMES = [
  // Nature (1-10)
  { name: 'Crystal Cavern',    theme: 'Nature',    bias: ['c','r','y','s','t','a'] },
  { name: 'Forest Depths',     theme: 'Nature',    bias: ['f','o','r','e','s','t'] },
  { name: 'River Stone',       theme: 'Nature',    bias: ['r','i','v','e','s','t'] },
  { name: 'Mountain Pass',     theme: 'Nature',    bias: ['m','o','u','n','t','a'] },
  { name: 'Desert Bloom',      theme: 'Nature',    bias: ['d','e','s','r','b','l'] },
  { name: 'Ocean Floor',       theme: 'Nature',    bias: ['o','c','e','a','n','f'] },
  { name: 'Meadow Mist',       theme: 'Nature',    bias: ['m','e','a','d','o','w'] },
  { name: 'Pine Ridge',        theme: 'Nature',    bias: ['p','i','n','e','r','d'] },
  { name: 'Coral Reef',        theme: 'Nature',    bias: ['c','o','r','a','l','e'] },
  { name: 'Thunder Peak',      theme: 'Nature',    bias: ['t','h','u','n','d','e'] },

  // Food & Kitchen (11-20)
  { name: 'Spice Vault',       theme: 'Food',      bias: ['s','p','i','c','e','v'] },
  { name: 'Bread Oven',        theme: 'Food',      bias: ['b','r','e','a','d','o'] },
  { name: 'Sugar Mine',        theme: 'Food',      bias: ['s','u','g','a','r','m'] },
  { name: 'Herb Garden',       theme: 'Food',      bias: ['h','e','r','b','g','a'] },
  { name: 'Fruit Cellar',      theme: 'Food',      bias: ['f','r','u','i','t','c'] },
  { name: 'Cheese Cave',       theme: 'Food',      bias: ['c','h','e','s','a','v'] },
  { name: 'Salt Flat',         theme: 'Food',      bias: ['s','a','l','t','f','e'] },
  { name: 'Grain Silo',        theme: 'Food',      bias: ['g','r','a','i','n','s'] },
  { name: 'Wine Barrel',       theme: 'Food',      bias: ['w','i','n','e','b','a'] },
  { name: 'Pepper Pit',        theme: 'Food',      bias: ['p','e','r','i','t','s'] },

  // Animals (21-30)
  { name: 'Bear Den',          theme: 'Animals',   bias: ['b','e','a','r','d','n'] },
  { name: 'Eagle Nest',        theme: 'Animals',   bias: ['e','a','g','l','n','s'] },
  { name: 'Wolf Trail',        theme: 'Animals',   bias: ['w','o','l','f','t','r'] },
  { name: 'Coral Spawn',       theme: 'Animals',   bias: ['c','o','r','a','l','s'] },
  { name: 'Tiger Stripe',      theme: 'Animals',   bias: ['t','i','g','e','r','s'] },
  { name: 'Falcon Dive',       theme: 'Animals',   bias: ['f','a','l','c','o','n'] },
  { name: 'Spider Web',        theme: 'Animals',   bias: ['s','p','i','d','e','r'] },
  { name: 'Horse Ranch',       theme: 'Animals',   bias: ['h','o','r','s','e','a'] },
  { name: 'Dolphin Bay',       theme: 'Animals',   bias: ['d','o','l','p','h','i'] },
  { name: 'Beetle Burrow',     theme: 'Animals',   bias: ['b','e','t','l','u','r'] },

  // City & Industry (31-40)
  { name: 'Steel Mill',        theme: 'City',      bias: ['s','t','e','l','m','i'] },
  { name: 'Brick Lane',        theme: 'City',      bias: ['b','r','i','c','k','l'] },
  { name: 'Train Depot',       theme: 'City',      bias: ['t','r','a','i','n','d'] },
  { name: 'Clock Tower',       theme: 'City',      bias: ['c','l','o','k','t','w'] },
  { name: 'Market Square',     theme: 'City',      bias: ['m','a','r','k','e','t'] },
  { name: 'Harbor Dock',       theme: 'City',      bias: ['h','a','r','b','o','d'] },
  { name: 'Copper Pipe',       theme: 'City',      bias: ['c','o','p','e','r','i'] },
  { name: 'Stone Bridge',      theme: 'City',      bias: ['s','t','o','n','e','b'] },
  { name: 'Library Wing',      theme: 'City',      bias: ['l','i','b','r','a','w'] },
  { name: 'Forge Anvil',       theme: 'City',      bias: ['f','o','r','g','e','a'] },

  // Science (41-50)
  { name: 'Lab Reactor',       theme: 'Science',   bias: ['l','a','b','r','e','c'] },
  { name: 'Atom Core',         theme: 'Science',   bias: ['a','t','o','m','c','r'] },
  { name: 'Prism Light',       theme: 'Science',   bias: ['p','r','i','s','m','l'] },
  { name: 'Nerve Pulse',       theme: 'Science',   bias: ['n','e','r','v','p','u'] },
  { name: 'Gene Strand',       theme: 'Science',   bias: ['g','e','n','s','t','r'] },
  { name: 'Quartz Lens',       theme: 'Science',   bias: ['q','u','a','r','t','z'] },
  { name: 'Plasma Tube',       theme: 'Science',   bias: ['p','l','a','s','m','t'] },
  { name: 'Carbon Fiber',      theme: 'Science',   bias: ['c','a','r','b','o','n'] },
  { name: 'Oxide Layer',       theme: 'Science',   bias: ['o','x','i','d','e','l'] },
  { name: 'Voltage Spike',     theme: 'Science',   bias: ['v','o','l','t','a','g'] },

  // Arts & Music (51-60)
  { name: 'Paint Studio',      theme: 'Arts',      bias: ['p','a','i','n','t','s'] },
  { name: 'Bronze Cast',       theme: 'Arts',      bias: ['b','r','o','n','z','e'] },
  { name: 'Drum Circle',       theme: 'Arts',      bias: ['d','r','u','m','c','i'] },
  { name: 'Stone Chisel',      theme: 'Arts',      bias: ['s','t','o','n','e','c'] },
  { name: 'Ink Well',          theme: 'Arts',      bias: ['i','n','k','w','e','l'] },
  { name: 'Stage Light',       theme: 'Arts',      bias: ['s','t','a','g','e','l'] },
  { name: 'Verse Form',        theme: 'Arts',      bias: ['v','e','r','s','f','o'] },
  { name: 'Craft Table',       theme: 'Arts',      bias: ['c','r','a','f','t','e'] },
  { name: 'Loom Thread',       theme: 'Arts',      bias: ['l','o','m','t','h','r'] },
  { name: 'Mosaic Tile',       theme: 'Arts',      bias: ['m','o','s','a','i','c'] },

  // Sports (61-70)
  { name: 'Sprint Track',      theme: 'Sports',    bias: ['s','p','r','i','n','t'] },
  { name: 'Boxing Ring',       theme: 'Sports',    bias: ['b','o','x','i','n','g'] },
  { name: 'Surf Break',        theme: 'Sports',    bias: ['s','u','r','f','b','e'] },
  { name: 'Goal Kick',         theme: 'Sports',    bias: ['g','o','a','l','k','i'] },
  { name: 'Javelin Arc',       theme: 'Sports',    bias: ['j','a','v','e','l','i'] },
  { name: 'Paddle Court',      theme: 'Sports',    bias: ['p','a','d','l','e','c'] },
  { name: 'Hurdle Jump',       theme: 'Sports',    bias: ['h','u','r','d','l','e'] },
  { name: 'Ski Mogul',         theme: 'Sports',    bias: ['s','k','i','m','o','g'] },
  { name: 'Anchor Lift',       theme: 'Sports',    bias: ['a','n','c','h','o','r'] },
  { name: 'Fencing Lunge',     theme: 'Sports',    bias: ['f','e','n','c','i','g'] },

  // Weather (71-80)
  { name: 'Storm Surge',       theme: 'Weather',   bias: ['s','t','o','r','m','u'] },
  { name: 'Frost Bite',        theme: 'Weather',   bias: ['f','r','o','s','t','b'] },
  { name: 'Thunder Bolt',      theme: 'Weather',   bias: ['t','h','u','n','d','e'] },
  { name: 'Wind Gust',         theme: 'Weather',   bias: ['w','i','n','d','g','u'] },
  { name: 'Hail Shaft',        theme: 'Weather',   bias: ['h','a','i','l','s','f'] },
  { name: 'Mist Veil',         theme: 'Weather',   bias: ['m','i','s','t','v','e'] },
  { name: 'Blaze Heat',        theme: 'Weather',   bias: ['b','l','a','z','e','h'] },
  { name: 'Dew Point',         theme: 'Weather',   bias: ['d','e','w','p','o','i'] },
  { name: 'Sleet Cloud',       theme: 'Weather',   bias: ['s','l','e','t','c','o'] },
  { name: 'Gale Force',        theme: 'Weather',   bias: ['g','a','l','e','f','o'] },

  // Home & Workshop (81-90)
  { name: 'Attic Chest',       theme: 'Home',      bias: ['a','t','i','c','h','e'] },
  { name: 'Brick Hearth',      theme: 'Home',      bias: ['b','r','i','c','k','h'] },
  { name: 'Tool Bench',        theme: 'Home',      bias: ['t','o','l','b','e','n'] },
  { name: 'Garden Shed',       theme: 'Home',      bias: ['g','a','r','d','e','n'] },
  { name: 'Copper Kettle',     theme: 'Home',      bias: ['c','o','p','e','r','k'] },
  { name: 'Wax Candle',        theme: 'Home',      bias: ['w','a','x','c','n','d'] },
  { name: 'Quilt Patch',       theme: 'Home',      bias: ['q','u','i','l','t','p'] },
  { name: 'Iron Bolt',         theme: 'Home',      bias: ['i','r','o','n','b','l'] },
  { name: 'Fabric Loom',       theme: 'Home',      bias: ['f','a','b','r','i','c'] },
  { name: 'Dust Vault',        theme: 'Home',      bias: ['d','u','s','t','v','a'] },

  // Adventure (91-100)
  { name: 'Pirate Cove',       theme: 'Adventure', bias: ['p','i','r','a','t','e'] },
  { name: 'Dragon Lair',       theme: 'Adventure', bias: ['d','r','a','g','o','n'] },
  { name: 'Temple Ruin',       theme: 'Adventure', bias: ['t','e','m','p','l','r'] },
  { name: 'Frozen Tomb',       theme: 'Adventure', bias: ['f','r','o','z','e','n'] },
  { name: 'Jungle Trek',       theme: 'Adventure', bias: ['j','u','n','g','l','e'] },
  { name: 'Sunken Ship',       theme: 'Adventure', bias: ['s','u','n','k','e','h'] },
  { name: 'Wizard Keep',       theme: 'Adventure', bias: ['w','i','z','a','r','d'] },
  { name: 'Lava Forge',        theme: 'Adventure', bias: ['l','a','v','f','o','r'] },
  { name: 'Mystic Glyph',      theme: 'Adventure', bias: ['m','y','s','t','i','c'] },
  { name: 'Exodus Gate',       theme: 'Adventure', bias: ['e','x','o','d','u','s'] },
];

// ─── Load Word Data ──────────────────────────────────────────────────────────

function loadWordData() {
  console.log(`[Generator] Loading word data from ${DATA_DIR}...`);

  const targetsPath = path.join(DATA_DIR, 'targets.json');
  const dictPath = path.join(DATA_DIR, 'dictionary.json');
  const freqPath = path.join(DATA_DIR, 'frequency.json');

  if (!fs.existsSync(dictPath)) {
    console.error('[Generator] dictionary.json not found at', dictPath);
    process.exit(1);
  }

  // Load dictionary as flat array
  const dictRaw = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));
  const dictionaryArr = [];
  const dictionarySet = new Set();
  for (const [len, words] of Object.entries(dictRaw)) {
    const n = parseInt(len);
    if (n < 4 || n > 15) continue; // Only 4-15 letter words relevant
    for (const w of words) {
      const lw = w.toLowerCase();
      if (/^[a-z]+$/.test(lw) && !dictionarySet.has(lw)) {
        dictionaryArr.push(lw);
        dictionarySet.add(lw);
      }
    }
  }
  console.log(`[Generator] Dictionary: ${dictionaryArr.length} words (4-15 letters)`);

  // Load frequency
  let frequency = {};
  if (fs.existsSync(freqPath)) {
    const freqRaw = JSON.parse(fs.readFileSync(freqPath, 'utf-8'));
    for (const [w, z] of Object.entries(freqRaw)) {
      frequency[w.toLowerCase()] = z;
    }
    console.log(`[Generator] Frequency: ${Object.keys(frequency).length} words`);
  } else {
    console.warn('[Generator] No frequency.json found — depth classification will be limited');
  }

  return { dictionaryArr, dictionarySet, frequency };
}

// ─── Mine Generation ─────────────────────────────────────────────────────────

function generateMine(theme, index, dictionaryArr, frequency) {
  let bestResult = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { letters } = mineEngine.generateLetterSet(null, { biasLetters: theme.bias });
    const wordsByTier = mineEngine.solveMine(letters, dictionaryArr, frequency);
    const t = wordsByTier.totals;

    // Check minimum requirements
    const meetsMin = t.surface >= MIN_WORD_REQUIREMENTS.surface &&
                     t.shallow >= MIN_WORD_REQUIREMENTS.shallow &&
                     t.medium >= MIN_WORD_REQUIREMENTS.medium &&
                     t.deep >= MIN_WORD_REQUIREMENTS.deep;

    if (!meetsMin) continue;

    // Score: balanced depth distribution + total word count
    const score = t.surface + t.shallow * 2 + t.medium * 4 + t.deep * 8 + t.core * 16;

    if (score > bestScore) {
      bestScore = score;
      bestResult = { letters, wordsByTier };
    }
  }

  if (!bestResult) {
    // Fallback: take whatever we got with best score (relaxed requirements)
    console.warn(`[Generator] Mine #${index + 1} "${theme.name}" — relaxed requirements`);
    for (let attempt = 0; attempt < 100; attempt++) {
      const { letters } = mineEngine.generateLetterSet(null, { biasLetters: theme.bias });
      const wordsByTier = mineEngine.solveMine(letters, dictionaryArr, frequency);
      const t = wordsByTier.totals;
      const score = t.surface + t.shallow * 2 + t.medium * 4 + t.deep * 8 + t.core * 16;
      if (score > bestScore) {
        bestScore = score;
        bestResult = { letters, wordsByTier };
      }
    }
  }

  if (!bestResult) {
    console.error(`[Generator] FAILED to generate mine #${index + 1} "${theme.name}"`);
    return null;
  }

  // Optimize bonus letter assignment
  const { initialIndices, bonusOrder } = mineEngine.optimizeBonusAssignment(
    bestResult.letters, bestResult.wordsByTier, null
  );

  return {
    id: index + 1,
    name: theme.name,
    theme: theme.theme,
    letters: bestResult.letters,
    initialIndices,
    bonusOrder,
    // Don't store wordsByTier in pool — server re-solves on serve (anti-cheat for MP, fresh for SP)
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const startTime = Date.now();
  console.log('========================================');
  console.log('  Word Mine — Mine Pool Generator');
  console.log('========================================\n');

  const { dictionaryArr, dictionarySet, frequency } = loadWordData();

  const mines = [];
  const stats = { surface: 0, shallow: 0, medium: 0, deep: 0, core: 0, total: 0 };

  for (let i = 0; i < THEMES.length; i++) {
    const theme = THEMES[i];
    process.stdout.write(`[${String(i + 1).padStart(3)}/${THEMES.length}] ${theme.name.padEnd(20)} `);

    const mine = generateMine(theme, i, dictionaryArr, frequency);
    if (!mine) {
      console.log('FAILED');
      continue;
    }

    // Verify: solve to get stats for logging
    const wordsByTier = mineEngine.solveMine(mine.letters, dictionaryArr, frequency);
    const t = wordsByTier.totals;

    stats.surface += t.surface;
    stats.shallow += t.shallow;
    stats.medium += t.medium;
    stats.deep += t.deep;
    stats.core += t.core;
    stats.total += t.total;

    const letters9 = mine.initialIndices.map(idx => mine.letters[idx]);
    const letters3 = mine.bonusOrder.map(idx => mine.letters[idx]);

    console.log(
      `[${letters9.join('')}]+[${letters3.join('')}] ` +
      `S:${t.surface} Sh:${t.shallow} M:${t.medium} D:${t.deep} C:${t.core} = ${t.total}`
    );

    mines.push(mine);
  }

  // Write output
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(mines, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n========================================');
  console.log(`Generated ${mines.length} mines in ${elapsed}s`);
  console.log(`Averages per mine:`);
  console.log(`  Surface: ${(stats.surface / mines.length).toFixed(0)}`);
  console.log(`  Shallow: ${(stats.shallow / mines.length).toFixed(0)}`);
  console.log(`  Medium:  ${(stats.medium / mines.length).toFixed(0)}`);
  console.log(`  Deep:    ${(stats.deep / mines.length).toFixed(0)}`);
  console.log(`  Core:    ${(stats.core / mines.length).toFixed(0)}`);
  console.log(`  Total:   ${(stats.total / mines.length).toFixed(0)}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log('========================================');
}

main();
