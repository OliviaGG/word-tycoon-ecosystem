#!/usr/bin/env node
// ===== SP Pool Filler =====
// Generates precomputed pool files locally using your CPU.
// Run from project root:  node scripts/fill-pool.js
// Then SCP the files to droplet:
//   scp data/sp-pool/*.json root@64.23.145.183:/opt/searchle/data/sp-pool/

const path = require('path');
const fs = require('fs');

// Resolve paths relative to project root
const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'server', 'config'));
const rankingEngine = require(path.join(ROOT, 'server', 'ranking-engine'));
const { toSingular, toAmerican } = require(path.join(ROOT, 'server', 'guess-processor'));

const POOL_DIR = path.join(ROOT, 'data', 'sp-pool');
const TARGETS_PATH = path.join(ROOT, 'data', 'target-words.json');
const POOL_TARGET = 100;

// Ensure pool directory exists
if (!fs.existsSync(POOL_DIR)) fs.mkdirSync(POOL_DIR, { recursive: true });

// Load and filter target words
let targetWords = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf-8'));
const before = targetWords.length;
targetWords = targetWords.filter(w => toAmerican(toSingular(w)) === w);
console.log(`Loaded ${before} target words, ${targetWords.length} after filtering`);

// Initialize ranking engine (loads all 3 models — takes ~30s)
console.log('Loading embedding models...');
rankingEngine.init({
  modelsDir: path.join(ROOT, config.modelsDir),
  vocabPath: path.join(ROOT, config.vocabPath),
  activeModels: config.activeModels,
  modelWeights: config.modelWeights,
  rrfK: config.rrfK,
});

function getPoolCount() {
  return fs.readdirSync(POOL_DIR).filter(f => f.endsWith('.json')).length;
}

function pickTargetWord() {
  const word = targetWords[Math.floor(Math.random() * targetWords.length)];
  if (!rankingEngine.isValidTarget(word)) return pickTargetWord();
  return word;
}

function serializeRankings(rankings) {
  const obj = {};
  for (const [word, rank] of rankings) {
    obj[word] = rank;
  }
  return obj;
}

async function main() {
  const existing = getPoolCount();
  const needed = POOL_TARGET - existing;

  if (needed <= 0) {
    console.log(`Pool already has ${existing} games (target: ${POOL_TARGET}). Nothing to do.`);
    process.exit(0);
  }

  console.log(`\nPool has ${existing}/${POOL_TARGET} games. Computing ${needed} more...\n`);

  for (let i = 0; i < needed; i++) {
    const targetWord = pickTargetWord();
    const t0 = Date.now();
    const rankings = await rankingEngine.computeRankings(targetWord, config);
    const elapsed = Date.now() - t0;

    const filename = `pool_${Date.now()}_${targetWord}.json`;
    const filepath = path.join(POOL_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify({
      targetWord,
      rankings: serializeRankings(rankings),
      totalRankedWords: rankings.size,
    }));

    const current = existing + i + 1;
    console.log(`[${current}/${POOL_TARGET}] "${targetWord}" — ${elapsed}ms → ${filename}`);
  }

  console.log(`\nDone! Pool now has ${getPoolCount()} games.`);
  console.log(`\nUpload to droplet:`);
  console.log(`  scp "C:/Searchle 3.0/data/sp-pool/"*.json root@64.23.145.183:/opt/searchle/data/sp-pool/`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
