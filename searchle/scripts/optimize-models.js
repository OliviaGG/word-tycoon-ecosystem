#!/usr/bin/env node
// ===== Model Optimizer =====
// Prunes Word2Vec to GloVe's vocabulary and quantizes all models to Float16.
// Run once: node scripts/optimize-models.js
//
// Before:  GloVe 364MB + Word2Vec 802MB + FastText 246MB = ~1.4GB
// After:   GloVe 182MB + Word2Vec ~182MB + FastText 123MB = ~487MB

const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'data', 'models');

// ---------------------------------------------------------------------------
// Float32 → Float16 conversion
// ---------------------------------------------------------------------------
function float32ToFloat16(val) {
  if (val === 0) return 0;
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = val;
  const f = new Uint32Array(buf)[0];

  const sign = (f >> 16) & 0x8000;
  const exponent = ((f >> 23) & 0xff) - 127 + 15;
  const fraction = (f >> 13) & 0x3ff;

  if (exponent <= 0) return sign;         // flush subnormals to zero
  if (exponent >= 31) return sign | 0x7c00; // overflow → infinity
  return sign | (exponent << 10) | fraction;
}

// Build F16→F32 lookup table (for verification)
function buildLookupTable() {
  const table = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const sign = (i >> 15) & 1;
    const exp = (i >> 10) & 0x1f;
    const frac = i & 0x3ff;
    if (exp === 0) {
      table[i] = (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
    } else if (exp === 31) {
      table[i] = frac ? NaN : (sign ? -Infinity : Infinity);
    } else {
      table[i] = (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
    }
  }
  return table;
}

// ---------------------------------------------------------------------------
// Load a model's index + vectors
// ---------------------------------------------------------------------------
function loadModel(name) {
  const dir = path.join(MODELS_DIR, name);
  const indexPath = path.join(dir, 'index.json');
  const vecPath = path.join(dir, 'vectors.bin');

  console.log(`Loading ${name}...`);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const vecBuf = fs.readFileSync(vecPath);
  const aligned = new ArrayBuffer(vecBuf.length);
  new Uint8Array(aligned).set(vecBuf);
  const vectors = new Float32Array(aligned);

  console.log(`  ${index.count.toLocaleString()} words, ${index.dimensions}d, ${(vecBuf.length / 1024 / 1024).toFixed(1)}MB`);
  return { index, vectors, dir };
}

// ---------------------------------------------------------------------------
// Prune a model's vocabulary to only keep words in a reference set
// ---------------------------------------------------------------------------
function pruneToVocab(model, keepSet) {
  const { index, vectors } = model;
  const dim = index.dimensions;
  const oldCount = index.count;

  // Find which words to keep (preserve order)
  const keepIndices = [];
  const keepWords = [];
  for (let i = 0; i < index.words.length; i++) {
    if (keepSet.has(index.words[i])) {
      keepIndices.push(i);
      keepWords.push(index.words[i]);
    }
  }

  const newCount = keepWords.length;
  const newVectors = new Float32Array(newCount * dim);

  for (let j = 0; j < keepIndices.length; j++) {
    const srcOffset = keepIndices[j] * dim;
    const dstOffset = j * dim;
    for (let d = 0; d < dim; d++) {
      newVectors[dstOffset + d] = vectors[srcOffset + d];
    }
  }

  console.log(`  Pruned: ${oldCount.toLocaleString()} → ${newCount.toLocaleString()} words (${(newCount / oldCount * 100).toFixed(1)}%)`);

  return {
    index: { ...index, count: newCount, words: keepWords },
    vectors: newVectors,
    dir: model.dir
  };
}

// ---------------------------------------------------------------------------
// Quantize Float32 vectors to Float16 and save
// ---------------------------------------------------------------------------
function quantizeAndSave(model, F16_TO_F32) {
  const { index, vectors, dir } = model;
  const dim = index.dimensions;
  const count = index.count;

  // Back up originals
  const indexPath = path.join(dir, 'index.json');
  const vecPath = path.join(dir, 'vectors.bin');
  const indexBak = path.join(dir, 'index-f32.json.bak');
  const vecBak = path.join(dir, 'vectors-f32.bin.bak');

  if (!fs.existsSync(indexBak)) {
    console.log(`  Backing up originals...`);
    fs.copyFileSync(indexPath, indexBak);
    fs.copyFileSync(vecPath, vecBak);
  }

  // Convert to Float16
  console.log(`  Quantizing ${count.toLocaleString()} × ${dim}d to Float16...`);
  const f16 = new Uint16Array(count * dim);
  let maxErr = 0;

  for (let i = 0; i < vectors.length; i++) {
    const h = float32ToFloat16(vectors[i]);
    f16[i] = h;
    const err = Math.abs(vectors[i] - F16_TO_F32[h]);
    if (err > maxErr) maxErr = err;
  }

  // Write new vectors.bin
  const outBuf = Buffer.from(f16.buffer);
  fs.writeFileSync(vecPath, outBuf);

  // Write updated index.json
  const newIndex = { ...index, format: 'float16' };
  fs.writeFileSync(indexPath, JSON.stringify(newIndex));

  const oldSize = count * dim * 4;
  const newSize = count * dim * 2;
  console.log(`  ${(oldSize / 1024 / 1024).toFixed(1)}MB → ${(newSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  Max quantization error: ${maxErr.toExponential(3)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  console.log('=== Searchle Model Optimizer ===\n');

  const F16_TO_F32 = buildLookupTable();

  // Load all models
  const glove = loadModel('glove-300d');
  const word2vec = loadModel('word2vec');
  const fasttext = loadModel('fasttext');

  // Build GloVe vocab set for pruning
  const gloveVocab = new Set(glove.index.words);
  console.log(`\nGloVe vocabulary: ${gloveVocab.size.toLocaleString()} words\n`);

  // Prune Word2Vec to GloVe's vocabulary
  console.log('Pruning Word2Vec to GloVe vocabulary...');
  const prunedW2V = pruneToVocab(word2vec, gloveVocab);

  // Quantize all 3 models to Float16
  console.log('\nQuantizing GloVe...');
  quantizeAndSave(glove, F16_TO_F32);

  console.log('\nQuantizing Word2Vec (pruned)...');
  quantizeAndSave(prunedW2V, F16_TO_F32);

  console.log('\nQuantizing FastText...');
  quantizeAndSave(fasttext, F16_TO_F32);

  // Summary
  console.log('\n=== Done ===');
  console.log('Model files updated in place. Backups saved as *-f32.*.bak');
  console.log('Deploy: SCP index.json + vectors.bin for each model to the droplet.');
}

main();
