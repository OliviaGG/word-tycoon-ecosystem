#!/usr/bin/env node
// ===== SP Pool Rebuilder =====
// Recomputes rankings for ALL existing pool files using current ranking engine
// settings (including singular-only filtering).
//
// Run from project root:  node scripts/rebuild-pools.js
// On droplet:             cd /opt/searchle && node scripts/rebuild-pools.js

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'server', 'config'));
const rankingEngine = require(path.join(ROOT, 'server', 'ranking-engine'));

const POOL_DIR = path.join(ROOT, 'data', 'sp-pool');
const POOL_MAX_RANK = 100000;

// Initialize ranking engine (loads all 3 models)
console.log('Loading embedding models...');
const t0 = Date.now();
rankingEngine.init({
  modelsDir: path.join(ROOT, config.modelsDir),
  vocabPath: path.join(ROOT, config.vocabPath),
  activeModels: config.activeModels,
  modelWeights: config.modelWeights,
  rrfK: config.rrfK,
});
console.log(`Models loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

function getPoolFiles() {
  return fs.readdirSync(POOL_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('pool_'))
    .sort();
}

async function main() {
  const files = getPoolFiles();
  console.log(`Found ${files.length} pool files to rebuild.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const match = filename.match(/^pool_\d+_(.+)\.json$/);
    if (!match) {
      console.log(`[${i + 1}/${files.length}] SKIP: ${filename} (bad format)`);
      failed++;
      continue;
    }

    const targetWord = match[1];

    if (!rankingEngine.isValidTarget(targetWord)) {
      console.log(`[${i + 1}/${files.length}] SKIP: "${targetWord}" (not in any model vocabulary)`);
      failed++;
      continue;
    }

    const t1 = Date.now();
    const rankings = await rankingEngine.computeRankings(targetWord, config);
    const elapsed = Date.now() - t1;

    // Trim to top 100k
    const trimmed = {};
    let kept = 0;
    for (const [word, rank] of rankings) {
      if (rank <= POOL_MAX_RANK) {
        trimmed[word] = rank;
        kept++;
      }
    }

    const filepath = path.join(POOL_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify({
      targetWord,
      rankings: trimmed,
      totalRankedWords: rankings.size,
    }));

    console.log(`[${i + 1}/${files.length}] "${targetWord}" — ${elapsed}ms — ${kept.toLocaleString()} entries (${rankings.size.toLocaleString()} total)`);
    success++;
  }

  console.log(`\nDone! Rebuilt ${success}/${files.length} pool files. ${failed} skipped.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
