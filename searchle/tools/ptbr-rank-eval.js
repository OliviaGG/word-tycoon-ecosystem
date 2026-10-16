const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PTBR_DIR = path.join(ROOT, 'data', 'pt-br');
const MODELS_DIR = path.join(PTBR_DIR, 'models');
const DEFAULT_PROBES = path.join(PTBR_DIR, 'eval', 'searchle-ranking-probes.json');
const DEFAULT_OUT = path.join(PTBR_DIR, 'eval', 'ranking-eval-report.json');

const DEFAULT_MODEL_ORDER = [
  'fasttext-cc-pt-gated',
  'numberbatch-pt-gated',
  'nilc-glove-300d-gated',
];
let rrfK = 60;

function usage() {
  console.log('Usage:');
  console.log('  node tools/ptbr-rank-eval.js run [--probes=data/pt-br/eval/searchle-ranking-probes.json]');
  console.log('       [--models=fasttext-cc-pt-gated,numberbatch-pt-gated,nilc-glove-300d-gated]');
  console.log('       [--out=data/pt-br/eval/ranking-eval-report.json]');
  console.log('       [--rrf-k=60]');
}

function parseOptions(argv) {
  const args = [];
  const opts = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq === -1) opts[arg.slice(2)] = true;
    else opts[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return { args, opts };
}

function resolveRoot(filePath) {
  return path.resolve(ROOT, filePath);
}

function normalizeWord(word) {
  return String(word || '').trim().toLowerCase().normalize('NFC');
}

function loadProbes(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(raw)) throw new Error('Probe file must be an array.');
  return raw.map((probe, index) => {
    const target = normalizeWord(probe.target);
    const expected = [...new Set((probe.expected || []).map(normalizeWord).filter(Boolean))];
    if (!target || expected.length === 0) {
      throw new Error(`Invalid probe at index ${index}.`);
    }
    return { target, expected };
  });
}

function loadModel(modelName) {
  const dir = path.join(MODELS_DIR, modelName);
  const indexPath = path.join(dir, 'index.json');
  const vectorsPath = path.join(dir, 'vectors.bin');
  if (!fs.existsSync(indexPath) || !fs.existsSync(vectorsPath)) return null;

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const bytes = fs.readFileSync(vectorsPath);
  const aligned = new ArrayBuffer(bytes.length);
  new Uint8Array(aligned).set(bytes);
  const vectors = new Float32Array(aligned);
  const wordIndex = new Map();
  for (let i = 0; i < index.words.length; i++) wordIndex.set(index.words[i], i);

  const magnitudes = new Float32Array(index.count);
  for (let i = 0; i < index.count; i++) {
    const offset = i * index.dimensions;
    let sum = 0;
    for (let d = 0; d < index.dimensions; d++) {
      const value = vectors[offset + d];
      sum += value * value;
    }
    magnitudes[i] = Math.sqrt(sum);
  }

  return {
    name: modelName,
    dimensions: index.dimensions,
    count: index.count,
    words: index.words,
    wordIndex,
    vectors,
    magnitudes,
  };
}

function cosineAt(model, aIndex, bIndex) {
  const dims = model.dimensions;
  const aOffset = aIndex * dims;
  const bOffset = bIndex * dims;
  let dot = 0;
  for (let d = 0; d < dims; d++) {
    dot += model.vectors[aOffset + d] * model.vectors[bOffset + d];
  }
  const denom = model.magnitudes[aIndex] * model.magnitudes[bIndex];
  return denom ? dot / denom : -Infinity;
}

function rankModel(model, target) {
  const targetIndex = model.wordIndex.get(target);
  if (targetIndex === undefined) return null;

  const scores = new Array(model.count);
  for (let i = 0; i < model.count; i++) {
    scores[i] = { word: model.words[i], score: cosineAt(model, targetIndex, i) };
  }
  scores.sort((a, b) => b.score - a.score);

  const ranks = new Map();
  for (let i = 0; i < scores.length; i++) ranks.set(scores[i].word, i + 1);
  return { ranks, total: scores.length, top: scores.slice(0, 25).map(item => item.word) };
}

function comboName(models, weights) {
  return models.map((model, index) => {
    const weight = weights[index];
    return weight === 1 ? model : `${model}@${weight}`;
  }).join('+');
}

function defaultCombos(availableModels) {
  const available = new Set(availableModels);
  const combos = [];
  const weights = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
  const add = (models, weights) => {
    if (models.every(name => available.has(name))) combos.push({ name: comboName(models, weights), models, weights });
  };

  for (const model of availableModels) add([model], [1]);

  const ft = 'fasttext-cc-pt-gated';
  const nb = 'numberbatch-pt-gated';
  const nilc = 'nilc-glove-300d-gated';

  for (const pair of [[ft, nb], [ft, nilc], [nb, nilc]]) {
    for (const w of weights) add(pair, [1, w]);
  }

  for (const nbWeight of weights) {
    for (const nilcWeight of weights) {
      add([ft, nb, nilc], [1, nbWeight, nilcWeight]);
    }
  }

  return combos;
}

function combineRankings(modelRankings, combo) {
  if (combo.models.length === 1) {
    const only = modelRankings.get(combo.models[0]);
    if (!only) return null;
    return only;
  }

  const scores = new Map();
  let total = 0;
  for (let i = 0; i < combo.models.length; i++) {
    const ranking = modelRankings.get(combo.models[i]);
    if (!ranking) continue;
    total = Math.max(total, ranking.total);
    const weight = combo.weights[i] || 1;
    for (const [word, rank] of ranking.ranks) {
      scores.set(word, (scores.get(word) || 0) + weight / (rrfK + rank));
    }
  }
  if (!scores.size) return null;

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const ranks = new Map();
  for (let i = 0; i < sorted.length; i++) ranks.set(sorted[i][0], i + 1);
  return { ranks, total: sorted.length || total, top: sorted.slice(0, 25).map(item => item[0]) };
}

function logRankScore(rank, total) {
  if (!rank) return 0;
  return Math.max(0, 1 - Math.log(rank) / Math.log(total + 1));
}

function evaluateCombo(probes, perTargetRankings, combo) {
  const details = [];
  let targetCoverage = 0;
  let expectedTotal = 0;
  let expectedCovered = 0;
  let reciprocal = 0;
  let logScore = 0;
  const ranks = [];
  const hits = { at10: 0, at25: 0, at50: 0, at100: 0, at500: 0 };

  for (const probe of probes) {
    const combined = combineRankings(perTargetRankings.get(probe.target) || new Map(), combo);
    if (!combined) {
      details.push({ target: probe.target, missingTarget: true, expected: probe.expected.map(word => ({ word, rank: null })) });
      expectedTotal += probe.expected.length;
      continue;
    }
    targetCoverage++;

    const expected = [];
    for (const word of probe.expected) {
      expectedTotal++;
      const rank = combined.ranks.get(word) || null;
      expected.push({ word, rank });
      if (!rank) continue;
      expectedCovered++;
      ranks.push(rank);
      reciprocal += 1 / rank;
      logScore += logRankScore(rank, combined.total);
      if (rank <= 10) hits.at10++;
      if (rank <= 25) hits.at25++;
      if (rank <= 50) hits.at50++;
      if (rank <= 100) hits.at100++;
      if (rank <= 500) hits.at500++;
    }
    details.push({ target: probe.target, top: combined.top.slice(0, 10), expected });
  }

  ranks.sort((a, b) => a - b);
  const denom = expectedTotal || 1;
  const medianRank = ranks.length ? ranks[Math.floor(ranks.length / 2)] : null;
  const meanRank = ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null;
  const hit50 = hits.at50 / denom;
  const hit100 = hits.at100 / denom;
  const hit500 = hits.at500 / denom;
  const coverage = expectedCovered / denom;
  const qualityScore = 100 * (
    0.25 * (hits.at10 / denom)
    + 0.20 * (hits.at25 / denom)
    + 0.20 * hit50
    + 0.15 * hit100
    + 0.15 * (logScore / denom)
    + 0.05 * coverage
  );

  return {
    name: combo.name,
    models: combo.models,
    weights: combo.weights,
    qualityScore: Number(qualityScore.toFixed(2)),
    targetCoverage: `${targetCoverage}/${probes.length}`,
    expectedCoverage: `${expectedCovered}/${expectedTotal}`,
    hitRate: {
      at10: Number((hits.at10 / denom).toFixed(3)),
      at25: Number((hits.at25 / denom).toFixed(3)),
      at50: Number(hit50.toFixed(3)),
      at100: Number(hit100.toFixed(3)),
      at500: Number(hit500.toFixed(3)),
    },
    mrr: Number((reciprocal / denom).toFixed(4)),
    meanLogRankScore: Number((logScore / denom).toFixed(4)),
    medianRank,
    meanRank: meanRank === null ? null : Number(meanRank.toFixed(1)),
    details,
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function run(rawOpts) {
  const probesPath = resolveRoot(rawOpts.probes || DEFAULT_PROBES);
  const outPath = resolveRoot(rawOpts.out || DEFAULT_OUT);
  const requestedModels = rawOpts.models
    ? String(rawOpts.models).split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_MODEL_ORDER;
  rrfK = Number.isFinite(Number(rawOpts['rrf-k'])) ? Number(rawOpts['rrf-k']) : 60;

  const probes = loadProbes(probesPath);
  const models = new Map();
  for (const modelName of requestedModels) {
    const model = loadModel(modelName);
    if (!model) {
      console.warn(`Skipping missing model: ${modelName}`);
      continue;
    }
    console.log(`Loaded ${modelName}: ${model.count.toLocaleString()} words`);
    models.set(modelName, model);
  }
  if (!models.size) throw new Error('No built models available for evaluation.');

  const availableModelNames = [...models.keys()];
  const combos = defaultCombos(availableModelNames);
  const perTargetRankings = new Map();

  for (const probe of probes) {
    const perModel = new Map();
    console.log(`Ranking "${probe.target}"...`);
    for (const [modelName, model] of models) {
      const ranking = rankModel(model, probe.target);
      if (!ranking) {
        console.warn(`  ${modelName}: target missing`);
        continue;
      }
      perModel.set(modelName, ranking);
    }
    perTargetRankings.set(probe.target, perModel);
  }

  const results = combos
    .map(combo => evaluateCombo(probes, perTargetRankings, combo))
    .sort((a, b) => b.qualityScore - a.qualityScore || b.hitRate.at50 - a.hitRate.at50);

  const report = {
    generatedAt: new Date().toISOString(),
    probesPath: path.relative(ROOT, probesPath),
    probeCount: probes.length,
    expectedPairCount: probes.reduce((sum, probe) => sum + probe.expected.length, 0),
    modelCount: models.size,
    models: availableModelNames.map(name => ({ name, words: models.get(name).count })),
    scoring: {
      rrfK,
      note: 'Quality score is a weighted Searchle-playability metric: high ranks for expected human guesses matter more than raw coverage.',
    },
    results,
  };

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log('\nTop combinations');
  for (const result of results.slice(0, 12)) {
    console.log(`${result.qualityScore.toFixed(2).padStart(6)}  ${result.name.padEnd(80)} hit@50=${result.hitRate.at50.toFixed(3)} hit@100=${result.hitRate.at100.toFixed(3)} median=${result.medianRank}`);
  }
  console.log(`\nWrote ${path.relative(ROOT, outPath)}`);
}

async function main() {
  const { args, opts } = parseOptions(process.argv.slice(2));
  const command = args[0] || 'run';
  if (command === 'help' || command === '--help' || opts.help) {
    usage();
    return;
  }
  if (command !== 'run') throw new Error(`Unknown command: ${command}`);
  await run(opts);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
