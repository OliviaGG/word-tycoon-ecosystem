#!/usr/bin/env node
'use strict';
// Generate new curated targets locally using the canonical production engines.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validatePool, assertLocalRoot } = require('./expand-solo-pool.cjs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function makePlan(selection, snapshot, now = Date.now()) {
  if (!Array.isArray(selection.words) || !selection.words.length || new Set(selection.words).size !== selection.words.length)
    throw Error('Expected unique reviewed targets');
  const won = new Set(selection.wonWords || []);
  const existing = new Set(snapshot.poolFiles.map(file => file.replace(/^pool_\d+_/, '').replace(/\.json$/, '')));
  const additions = [], alreadySolo = [];
  for (const [position, word] of selection.words.entries()) {
    if (!/^[a-z]{4,}$/.test(word) || won.has(word)) throw Error('Invalid or already won target');
    if (existing.has(word)) { alreadySolo.push(word); continue; }
    additions.push({ word, filename: `pool_${now + position}_${word}.json`,
      historicalNumber: snapshot.poolIndex.words[word] || null });
  }
  return { version: 1, createdAt: new Date(now).toISOString(), curatedWords: selection.words,
    baselinePlayable: snapshot.poolFiles.length, additions, alreadySolo };
}

async function main() {
  const mode = process.argv[2] || 'generate';
  const args = Object.fromEntries(process.argv.slice(3).map(value => {
    const index = value.indexOf('=');
    if (!value.startsWith('--') || index < 3) throw Error('Use named --key=value arguments');
    return [value.slice(2, index), value.slice(index + 1)];
  }));
  if (!args['snapshot-root'] || !args.selection || !['plan', 'generate', 'verify'].includes(mode))
    throw Error('Use plan|generate|verify --snapshot-root=... --selection=...');
  const root = path.resolve(args['snapshot-root']);
  assertLocalRoot(root);
  process.env.DATA_DIR = path.join(root, 'data');
  process.env.CHAT_RELAY_DIR = path.join(root, 'relay');
  process.env.SEARCHLE_RANKING_CACHE_MAX = '1';
  const snapshotFile = path.join(root, 'production-snapshot.json');
  const snapshot = read(snapshotFile), selection = read(args.selection);
  if (selection.sourceSnapshotSha256 !== sha(snapshotFile)) throw Error('Selection snapshot differs');
  for (const [relative, expected] of Object.entries(snapshot.files)) {
    if (sha(path.join(root, relative)) !== expected) throw Error(`Snapshot input changed: ${relative}`);
  }
  const output = path.join(root, 'generated');
  const planFile = path.join(output, 'addition-plan.json');
  let plan;
  if (fs.existsSync(planFile)) {
    plan = read(planFile);
    if (plan.selectionSha256 !== sha(args.selection) || plan.sourceSnapshotSha256 !== sha(snapshotFile))
      throw Error('Existing plan has different selection/source');
  } else {
    plan = { ...makePlan(selection, snapshot), selectionSha256: sha(args.selection), sourceSnapshotSha256: sha(snapshotFile) };
    write(planFile, plan);
  }
  console.log(JSON.stringify({ mode, curated: plan.curatedWords.length, missingSolo: plan.additions.length, alreadySolo: plan.alreadySolo.length }));
  if (mode === 'plan') return;
  const started = Date.now();
  const configSource = require(path.join(root, 'server/config.js'));
  const config = { ...configSource, languageProfiles: {}, modelsDir: path.join(root, configSource.modelsDir),
    vocabPath: path.join(root, configSource.vocabPath), gate: { ...configSource.gate,
      frequencyPath: path.join(root, 'relay/data/word-bank/frequency.json'),
      keepAlwaysCoveragePath: path.join(root, 'relay/data/wikipedia-coverage.json'),
      keepAlwaysTargetsPath: path.join(root, 'data/target-words.json'),
      keepAlwaysBankDictPath: path.join(root, 'relay/data/word-bank/dictionary.json') } };
  const frequency = read(config.gate.frequencyPath);
  const ranker = mode === 'generate' ? require(path.join(root, 'server/ranking-engine.js')) : null;
  if (ranker) await ranker.init(config);
  const results = [], quality = [];
  for (const [index, item] of plan.additions.entries()) {
    const file = path.join(output, 'sp-pool', item.filename);
    if (!fs.existsSync(file)) {
      if (!ranker || !ranker.isValidTarget(item.word)) throw Error(`Missing or unrankable target: ${item.word}`);
      const rankings = await ranker.computeRankings(item.word, config);
      const payload = { targetWord: item.word, rankings: Object.fromEntries(rankings), totalRankedWords: rankings.size };
      validatePool(payload, item.word);
      write(file, payload);
    }
    const payload = read(file);
    const rankedWords = validatePool(payload, item.word);
    const result = { ...item, sha256: sha(file), bytes: fs.statSync(file).size, rankedWords };
    results.push(result);
    const neighbors = Object.entries(payload.rankings).filter(([word, rank]) => rank > 1 && rank <= 80
      && /^[a-z]{3,}$/.test(word) && (frequency[word] || 0) >= 2.5).slice(0, 20)
      .map(([word, rank]) => ({ word, rank, zipf: frequency[word] }));
    quality.push({ word: item.word, zipf: frequency[item.word], neighbors });
    write(path.join(output, 'generation-progress.json'), { completed: results.length, total: plan.additions.length, results });
    if ((index + 1) % 25 === 0) console.log(JSON.stringify({ completed: index + 1, total: plan.additions.length,
      elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
  }
  write(path.join(output, 'quality-neighbors.json'), quality);
  const manifest = { version: 1, verifiedAt: new Date().toISOString(), curatedWords: plan.curatedWords,
    alreadySolo: plan.alreadySolo, sourceSnapshotSha256: sha(snapshotFile), selectionSha256: sha(args.selection),
    generatorSha256: sha(__filename), additions: results, totalBytes: results.reduce((sum, result) => sum + result.bytes, 0) };
  write(path.join(output, 'addition-manifest.json'), manifest);
  console.log(JSON.stringify({ completed: results.length, totalBytes: manifest.totalBytes, elapsedMs: Date.now() - started }));
}
module.exports = { makePlan };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
