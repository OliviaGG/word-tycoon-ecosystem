#!/usr/bin/env node
'use strict';

// Generate additive English solo puzzles from a verified production snapshot.
// Run this offline on a workstation, never against a live DATA_DIR.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const rootArgument = process.argv.find(argument => argument.startsWith('--snapshot-root='));
const ROOT = path.resolve(rootArgument ? rootArgument.slice('--snapshot-root='.length) : path.join(__dirname, '..'));
const OUTPUT = path.join(ROOT, 'generated');
const PLAN = path.join(OUTPUT, 'addition-plan.json');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data)); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function assertLocalRoot(root) {
  if (/^\/opt(?:\/|$)/.test(root.replace(/\\/g, '/'))) throw Error('Refusing a production source root');
  if (process.platform !== 'win32' || !/^[A-Z]:[\\/]/i.test(root)) throw Error('Generation requires a local Windows snapshot');
  if (process.env.DATA_DIR && path.resolve(process.env.DATA_DIR) !== path.join(root, 'data')) throw Error('Refusing external DATA_DIR');
}
function dualMeaningBlock(source) {
  const match = source.match(/const SEARCHLE_DUAL_MEANING_BLOCK = new Set\(\[([\s\S]*?)\]\);/);
  if (!match) throw Error('Canonical dual-meaning exclusion list is missing');
  const uncommented = match[1].replace(/\/\/[^\r\n]*/g, '');
  return new Set([...uncommented.matchAll(/['"]([a-z]+)['"]/g)].map(m => m[1]));
}
function selectTargets({ easy, bank, existing, blocked, isBlocked, normalize, modelHas }) {
  const selected = [], rejected = [];
  const seen = new Set();
  for (const raw of easy) {
    const word = String(raw || '').toLowerCase().trim();
    if (seen.has(word)) continue;
    seen.add(word);
    let reason = null;
    if (!/^[a-z]{4,}$/.test(word)) reason = 'length-or-characters';
    else if (existing.has(word)) reason = 'already-playable';
    else if (!bank.has(word)) reason = 'absent-canonical-bank';
    else if (blocked.has(word) || isBlocked(word)) reason = 'intentional-exclusion';
    else if (normalize(word) !== word) reason = 'noncanonical-morphology';
    else if (!modelHas(word)) reason = 'missing-model-vector';
    if (reason) rejected.push({ word, reason });
    else selected.push(word);
  }
  return { selected, rejected };
}
function validatePool(raw, expected) {
  if (!raw || raw.targetWord !== expected || !/^[a-z]{4,}$/.test(expected)) throw Error('Pool target mismatch');
  const entries = Object.entries(raw.rankings || {});
  if (!Number.isSafeInteger(raw.totalRankedWords) || entries.length !== raw.totalRankedWords || entries.length < 100000) throw Error('Incomplete full ranking payload');
  if (raw.rankings[expected] !== 1) throw Error('Answer must occupy rank one');
  const ranks = new Set();
  for (const [word, rank] of entries) {
    if (!word || !Number.isSafeInteger(rank) || rank < 1 || rank > entries.length || ranks.has(rank)) throw Error('Invalid or duplicate rank');
    ranks.add(rank);
  }
  return entries.length;
}
function verifySnapshot(snapshot, metadataOnly = false) {
  for (const [relative, expected] of Object.entries(snapshot.files)) {
    if (metadataOnly && (relative.endsWith('/vectors.bin') || relative.endsWith('/wikipedia-coverage.json'))) continue;
    const file = path.join(ROOT, relative);
    if (!fs.existsSync(file) || sha256(file) !== expected) throw Error(`Canonical snapshot mismatch: ${relative}`);
  }
}
function loadInputs(snapshot) {
  process.env.CHAT_RELAY_DIR = path.join(ROOT, 'relay');
  process.env.DATA_DIR = path.join(ROOT, 'data');
  process.env.SEARCHLE_RANKING_CACHE_MAX = '1';
  const { toAmerican, toSingular } = require(path.join(ROOT, 'server/guess-processor.js'));
  const policy = require(path.join(ROOT, 'relay/src/game-word-policy.js'));
  const policyData = readJson(path.join(ROOT, 'relay/data/blocked-words.json'));
  if (!Array.isArray(policyData.exact)) throw Error('Canonical blocked-word policy is unavailable');
  const blocked = dualMeaningBlock(fs.readFileSync(path.join(ROOT, 'server/game-manager.js'), 'utf8'));
  const bank = new Set(Object.values(readJson(path.join(ROOT, 'relay/data/word-bank/targets.json'))).flat());
  const existing = new Set(snapshot.poolFiles.map(file => file.replace(/^pool_\d+_/, '').replace(/\.json$/, '')));
  const easy = readJson(path.join(ROOT, 'relay/data/word-bank/searchle-easy-targets.json'));
  const indexes = ['numberbatch', 'fasttext'].map(name => readJson(path.join(ROOT, `data/models/${name}/index.json`)).words);
  const modelWords = new Set(indexes.flat());
  // The canonical morphology helpers depend on active vocabulary and model
  // ordering. For selection only, supply those exact indexes without vectors.
  const ranker = require(path.join(ROOT, 'server/ranking-engine.js'));
  const savedVocab = ranker.getActiveVocabSet, savedModels = ranker.getAllModels;
  const normalizations = new Map();
  try {
    ranker.getActiveVocabSet = () => modelWords;
    const indexModels = indexes.map(words => ({ wordIndex: new Map(words.map((w, i) => [w, i])) }));
    ranker.getAllModels = () => indexModels;
    for (const word of easy) normalizations.set(word, toAmerican(toSingular(word)));
  } finally { ranker.getActiveVocabSet = savedVocab; ranker.getAllModels = savedModels; }
  return { easy, bank, existing, blocked,
    isBlocked: word => policy.isWordBlockedForGame('searchle', 'target', word),
    normalize: word => normalizations.get(word), modelHas: word => modelWords.has(word) };
}
function makePlan(snapshot) {
  const { selected, rejected } = selectTargets(loadInputs(snapshot));
  const veryEasy = new Set(readJson(path.join(ROOT, 'relay/data/word-bank/searchle-very-easy-targets.json')));
  const base = Date.now();
  const indexed = selected.filter(word => snapshot.poolIndex.words[word]);
  for (const word of selected.filter(word => !snapshot.poolIndex.words[word])) rejected.push({ word, reason: 'deferred-new-index-number' });
  const additions = indexed.map((word, i) => ({ word, filename: `pool_${base + i}_${word}.json`,
    historicalNumber: snapshot.poolIndex.words[word] || null, veryEasy: veryEasy.has(word) }));
  return { version: 1, createdAt: new Date().toISOString(), sourceSnapshotSha256: sha256(path.join(ROOT, 'production-snapshot.json')),
    baselinePlayable: snapshot.poolFiles.length, additions, rejected };
}
function runtimeConfig() {
  const config = require(path.join(ROOT, 'server/config.js'));
  return { ...config, languageProfiles: {}, modelsDir: path.join(ROOT, config.modelsDir), vocabPath: path.join(ROOT, config.vocabPath),
    gate: { ...config.gate, frequencyPath: path.join(ROOT, 'relay/data/word-bank/frequency.json'),
      keepAlwaysCoveragePath: path.join(ROOT, 'relay/data/wikipedia-coverage.json'),
      keepAlwaysTargetsPath: path.join(ROOT, 'data/target-words.json'),
      keepAlwaysBankDictPath: path.join(ROOT, 'relay/data/word-bank/dictionary.json') } };
}
async function main() {
  assertLocalRoot(ROOT);
  // Set these before loading a saved plan as well as during first-time
  // selection. Otherwise resumed generation retains the live 256-map cache.
  process.env.CHAT_RELAY_DIR = path.join(ROOT, 'relay');
  process.env.DATA_DIR = path.join(ROOT, 'data');
  process.env.SEARCHLE_RANKING_CACHE_MAX = '1';
  const mode = process.argv[2] || 'plan';
  if (process.argv.some(argument => argument.startsWith('--output'))) throw Error('Output is fixed to the isolated snapshot generated directory');
  const limit = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
  const snapshot = readJson(path.join(ROOT, 'production-snapshot.json'));
  verifySnapshot(snapshot, mode === 'plan');
  let plan;
  if (fs.existsSync(PLAN)) {
    plan = readJson(PLAN);
    if (plan.sourceSnapshotSha256 !== sha256(path.join(ROOT, 'production-snapshot.json'))) throw Error('Plan uses a different snapshot');
  } else { plan = makePlan(snapshot); atomicJson(PLAN, plan); }
  console.log(JSON.stringify({ mode, baseline: plan.baselinePlayable, planned: plan.additions.length, veryEasy: plan.additions.filter(a => a.veryEasy).length,
    historicalNumbers: plan.additions.filter(a => a.historicalNumber).length, rejectionCounts: Object.fromEntries([...new Set(plan.rejected.map(r => r.reason))].map(reason => [reason, plan.rejected.filter(r => r.reason === reason).length])) }));
  if (mode === 'plan') return;
  const results = [];
  const started = Date.now();
  if (mode === 'generate') {
    const ranker = require(path.join(ROOT, 'server/ranking-engine.js'));
    const config = runtimeConfig();
    await ranker.init(config);
    for (const item of plan.additions.slice(0, limit)) {
      const file = path.join(OUTPUT, 'sp-pool', item.filename);
      const begin = Date.now();
      if (!fs.existsSync(file)) {
        if (!ranker.isValidTarget(item.word)) throw Error(`Unrankable target: ${item.word}`);
        const rankings = await ranker.computeRankings(item.word, config);
        const payload = { targetWord: item.word, rankings: Object.fromEntries(rankings), totalRankedWords: rankings.size };
        validatePool(payload, item.word);
        atomicJson(file, payload);
      }
      const entries = validatePool(readJson(file), item.word);
      const result = { ...item, sha256: sha256(file), bytes: fs.statSync(file).size, rankedWords: entries, elapsedMs: Date.now() - begin };
      results.push(result);
      atomicJson(path.join(OUTPUT, 'generation-progress.json'), { startedAt: new Date(started).toISOString(), completed: results.length, planned: Math.min(limit, plan.additions.length), results });
      console.log(`[${results.length}/${Math.min(limit, plan.additions.length)}] ${item.word}: ${result.elapsedMs}ms, ${entries} ranks, ${result.bytes} bytes`);
    }
  } else if (mode === 'verify') {
    for (const item of plan.additions) {
      const file = path.join(OUTPUT, 'sp-pool', item.filename);
      if (!fs.existsSync(file)) throw Error(`Missing planned file: ${item.filename}`);
      const entries = validatePool(readJson(file), item.word);
      results.push({ ...item, sha256: sha256(file), bytes: fs.statSync(file).size, rankedWords: entries });
    }
  } else throw Error(`Unknown operation: ${mode}`);
  const manifest = { version: 1, verifiedAt: new Date().toISOString(), sourceSnapshotSha256: plan.sourceSnapshotSha256,
    generatorSha256: sha256(__filename),
    baselinePlayable: plan.baselinePlayable, additions: results, totalBytes: results.reduce((sum, r) => sum + r.bytes, 0),
    existingFilesOverwritten: 0, indexModified: false, dailyAssignmentsModified: false, weeklyAssignmentsModified: false };
  atomicJson(path.join(OUTPUT, mode === 'verify' ? 'addition-manifest.json' : 'generation-summary.json'), manifest);
  console.log(JSON.stringify({ completed: results.length, elapsedMs: Date.now() - started, bytes: manifest.totalBytes }));
}
module.exports = { selectTargets, validatePool, dualMeaningBlock, assertLocalRoot };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
