// ===== Semantic Isolation Scanner =====
// Loads all 3 embedding models and computes the "isolation score" for every
// target word. Isolation = how low the cosine similarity of the nearest
// neighbor is. Words with low max-similarity are semantically isolated
// and make for hard/unfun Searchle rounds.

const path = require('path');
const fs = require('fs');

const MODELS_DIR = path.resolve(__dirname, '../data/models');
const TARGETS_PATH = path.resolve(__dirname, '../data/target-words.json');

// Float16 → Float32 lookup table
const F16_TO_F32 = new Float32Array(65536);
(function buildF16Table() {
  for (let i = 0; i < 65536; i++) {
    const sign = (i >> 15) & 1;
    const exp = (i >> 10) & 0x1f;
    const frac = i & 0x3ff;
    if (exp === 0) {
      F16_TO_F32[i] = (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
    } else if (exp === 31) {
      F16_TO_F32[i] = frac ? NaN : (sign ? -Infinity : Infinity);
    } else {
      F16_TO_F32[i] = (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
    }
  }
})();

function loadModel(modelName) {
  const modelDir = path.join(MODELS_DIR, modelName);
  const indexPath = path.join(modelDir, 'index.json');
  const vecPath = path.join(modelDir, 'vectors.bin');

  console.log(`Loading ${modelName}...`);
  const t0 = Date.now();

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const { dimensions, count, words, format } = index;
  const isFloat16 = format === 'float16';

  const vecBuffer = fs.readFileSync(vecPath);
  const aligned = new ArrayBuffer(vecBuffer.length);
  new Uint8Array(aligned).set(vecBuffer);

  let vectors;
  if (isFloat16) {
    vectors = new Uint16Array(aligned);
  } else {
    vectors = new Float32Array(aligned);
  }

  // Pre-compute magnitudes
  const magnitudes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const offset = i * dimensions;
    let sum = 0;
    if (isFloat16) {
      for (let d = 0; d < dimensions; d++) {
        const v = F16_TO_F32[vectors[offset + d]];
        sum += v * v;
      }
    } else {
      for (let d = 0; d < dimensions; d++) {
        const v = vectors[offset + d];
        sum += v * v;
      }
    }
    magnitudes[i] = Math.sqrt(sum);
  }

  const wordIndex = new Map();
  for (let i = 0; i < words.length; i++) {
    wordIndex.set(words[i], i);
  }

  console.log(`  Loaded ${modelName}: ${count.toLocaleString()} words, ${dimensions}d, ${isFloat16 ? 'float16' : 'float32'} (${Date.now() - t0}ms)`);
  return { name: modelName, dimensions, count, words, wordIndex, vectors, magnitudes, isFloat16 };
}

// For a target word, compute the max cosine similarity to any other word
// Returns { maxSim, top5: [{word, sim}] }
function computeIsolation(targetWord, model) {
  const targetIdx = model.wordIndex.get(targetWord);
  if (targetIdx === undefined) return null;

  const dim = model.dimensions;
  const targetOffset = targetIdx * dim;
  const targetMag = model.magnitudes[targetIdx];
  const count = model.count;

  // Pre-convert target vector for float16
  let targetF32;
  if (model.isFloat16) {
    targetF32 = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
      targetF32[d] = F16_TO_F32[model.vectors[targetOffset + d]];
    }
  }

  // Track top 5 nearest neighbors
  const top5 = [
    { word: '', sim: -2 },
    { word: '', sim: -2 },
    { word: '', sim: -2 },
    { word: '', sim: -2 },
    { word: '', sim: -2 },
  ];
  let minTopSim = -2;

  for (let i = 0; i < count; i++) {
    if (i === targetIdx) continue;

    const offset = i * dim;
    let dot = 0;

    if (model.isFloat16) {
      for (let d = 0; d < dim; d++) {
        dot += targetF32[d] * F16_TO_F32[model.vectors[offset + d]];
      }
    } else {
      for (let d = 0; d < dim; d++) {
        dot += model.vectors[targetOffset + d] * model.vectors[offset + d];
      }
    }

    const sim = dot / (targetMag * model.magnitudes[i]);

    if (sim > minTopSim) {
      // Find the slot with the min sim and replace it
      let minIdx = 0;
      for (let j = 1; j < 5; j++) {
        if (top5[j].sim < top5[minIdx].sim) minIdx = j;
      }
      top5[minIdx] = { word: model.words[i], sim };
      // Recalculate min
      minTopSim = top5[0].sim;
      for (let j = 1; j < 5; j++) {
        if (top5[j].sim < minTopSim) minTopSim = top5[j].sim;
      }
    }
  }

  top5.sort((a, b) => b.sim - a.sim);
  return { maxSim: top5[0].sim, top5 };
}

async function main() {
  const targets = JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf-8'));
  console.log(`${targets.length} target words loaded\n`);

  // Load models one at a time to save memory, store results
  const modelNames = process.argv[2] === '--old'
    ? ['glove-300d', 'word2vec', 'fasttext']
    : ['numberbatch', 'fasttext'];
  const results = new Map(); // word → { sims: [maxSim per model], neighbors: [[top5 per model]] }

  for (const target of targets) {
    results.set(target, { sims: [], neighbors: [], modelsMissing: 0 });
  }

  for (const modelName of modelNames) {
    const model = loadModel(modelName);
    console.log(`\nScanning ${targets.length} targets against ${modelName}...`);

    const t0 = Date.now();
    let done = 0;

    for (const target of targets) {
      const result = computeIsolation(target, model);
      const entry = results.get(target);

      if (result) {
        entry.sims.push(result.maxSim);
        entry.neighbors.push(result.top5.slice(0, 3).map(n => n.word));
      } else {
        entry.modelsMissing++;
        entry.sims.push(0); // penalty for not being in model
      }

      done++;
      if (done % 200 === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / elapsed;
        const eta = Math.round((targets.length - done) / rate);
        process.stdout.write(`  ${done}/${targets.length} (${rate.toFixed(1)}/s, ETA ${eta}s)\r`);
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Done: ${targets.length} words in ${elapsed}s`);

    // Free model memory
    model.vectors = null;
    model.magnitudes = null;
    model.words = null;
    model.wordIndex = null;
    if (global.gc) global.gc();
  }

  // Compute average isolation score across models
  const isolation = [];
  for (const [word, data] of results) {
    const avgMaxSim = data.sims.reduce((a, b) => a + b, 0) / data.sims.length;
    isolation.push({
      word,
      avgMaxSim,
      perModel: data.sims,
      modelsMissing: data.modelsMissing,
      neighbors: data.neighbors
    });
  }

  // Sort by most isolated (lowest avg max similarity)
  isolation.sort((a, b) => a.avgMaxSim - b.avgMaxSim);

  // Load frequency data for display
  let freq = {};
  try {
    freq = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../Chat Relay/data/word-bank/frequency.json'), 'utf-8'));
  } catch (e) {
    try {
      freq = JSON.parse(fs.readFileSync('C:/Chat Relay/data/word-bank/frequency.json', 'utf-8'));
    } catch (e2) {
      console.log('Warning: could not load frequency.json');
    }
  }

  // Output results
  console.log('\n\n========================================');
  console.log('SEMANTIC ISOLATION RESULTS');
  console.log('========================================');
  console.log(`Total words analyzed: ${isolation.length}`);
  console.log(`Avg max-sim across all words: ${(isolation.reduce((a, b) => a + b.avgMaxSim, 0) / isolation.length).toFixed(4)}`);

  console.log('\n--- TOP 150 MOST ISOLATED (hardest) ---');
  for (let i = 0; i < Math.min(150, isolation.length); i++) {
    const w = isolation[i];
    const z = freq[w.word] ? freq[w.word].toFixed(2) : 'N/A';
    const models = w.perModel.map(s => s.toFixed(3)).join(', ');
    const nn = w.neighbors.flat().slice(0, 5).join(', ');
    console.log(`${(i + 1).toString().padStart(3)}. ${w.word.padEnd(18)} avgSim=${w.avgMaxSim.toFixed(4)}  [${models}]  Zipf=${z}  neighbors: ${nn}`);
  }

  console.log('\n--- TOP 50 LEAST ISOLATED (easiest) ---');
  for (let i = isolation.length - 50; i < isolation.length; i++) {
    const w = isolation[i];
    const z = freq[w.word] ? freq[w.word].toFixed(2) : 'N/A';
    console.log(`${(i + 1).toString().padStart(4)}. ${w.word.padEnd(18)} avgSim=${w.avgMaxSim.toFixed(4)}  Zipf=${z}`);
  }

  // Save full results to JSON
  const suffix = process.argv[2] === '--old' ? '-old' : '-new';
  const outputPath = path.resolve(__dirname, '../data/isolation-results' + suffix + '.json');
  fs.writeFileSync(outputPath, JSON.stringify(isolation.map(w => ({
    word: w.word,
    avgMaxSim: Math.round(w.avgMaxSim * 10000) / 10000,
    perModel: w.perModel.map(s => Math.round(s * 1000) / 1000),
    modelsMissing: w.modelsMissing
  })), null, 2));
  console.log(`\nFull results saved to ${outputPath}`);

  // Stats
  const thresholds = [0.5, 0.55, 0.6, 0.65, 0.7];
  console.log('\n--- THRESHOLD ANALYSIS ---');
  for (const thresh of thresholds) {
    const below = isolation.filter(w => w.avgMaxSim < thresh).length;
    console.log(`avgMaxSim < ${thresh}: ${below} words`);
  }
}

main().catch(console.error);
