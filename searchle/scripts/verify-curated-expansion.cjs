#!/usr/bin/env node
'use strict';
// Read-only production verification. Only an isolated temporary DATA_DIR is
// written; no game creation, guesses, rewards, progress writes or restarts.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function verifyRanks(file, item) {
  const bytes = fs.readFileSync(file);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256, 'Released ranking file hash differs');
  if (item.bytes !== undefined) assert.equal(bytes.length, item.bytes, 'Released ranking byte count differs');
  const payload = JSON.parse(bytes);
  assert.equal(payload.targetWord, item.word, 'Released ranking target differs');
  const entries = Object.entries(payload.rankings || {}), size = payload.totalRankedWords;
  assert.ok(Number.isSafeInteger(size) && size >= 100000 && entries.length === size, 'Released ranking is incomplete');
  if (item.rankedWords !== undefined) assert.equal(size, item.rankedWords, 'Released ranking count differs');
  assert.equal(payload.rankings[item.word], 1, 'Released answer is not rank one');
  const seen = new Uint8Array(size + 1);
  for (const [word, rank] of entries) {
    assert.ok(word && Number.isSafeInteger(rank) && rank >= 1 && rank <= size && !seen[rank], 'Released ranks are not a complete permutation');
    seen[rank] = 1;
  }
  return size;
}

function verifyIndex(baseline, current, additions) {
  assert.ok(current && current.words, 'Solo index is unavailable');
  for (const [word, id] of Object.entries(baseline.words)) assert.equal(current.words[word], id, 'An existing solo completion ID changed');
  for (const [key, value] of Object.entries(baseline)) {
    if (key !== 'words' && key !== 'nextNumber') assert.deepEqual(current[key], value, 'A baseline solo index field or puzzle pin changed');
  }
  const oldMax = Math.max(baseline.nextNumber - 1, ...Object.values(baseline.words), ...(baseline.vacantNumbers || []));
  const assigned = new Set(Object.values(baseline.words));
  let historicalIdsRetained = 0, appendedIds = 0;
  for (const item of additions) {
    const id = current.words[item.word];
    if (Object.hasOwn(baseline.words, item.word)) {
      assert.equal(item.historicalNumber, baseline.words[item.word], 'Release historical ID differs from baseline');
      assert.equal(id, baseline.words[item.word], 'Historical solo ID was replaced');
      historicalIdsRetained++;
    } else {
      assert.ok(Number.isSafeInteger(id) && id > oldMax && !assigned.has(id), 'New solo ID reused a historical number');
      assigned.add(id); appendedIds++;
    }
  }
  assert.ok(Number.isSafeInteger(current.nextNumber) && current.nextNumber > Math.max(...Object.values(current.words)), 'Solo nextNumber is unsafe');
  assert.ok(current.nextNumber >= baseline.nextNumber + appendedIds, 'Solo nextNumber moved backwards');
  return { oldIdsRetained: Object.keys(baseline.words).length, historicalIdsRetained, appendedIds, oldMaximum: oldMax,
    dailyPinsRetained: Object.keys(baseline.dailyAssignments || {}).length,
    weeklyPinsRetained: Object.keys(baseline.weeklyAssignments || {}).length };
}

function verifyUnchangedBank(snapshot, relayRoot) {
  const verified = [];
  for (const name of ['targets.json', 'searchle-easy-targets.json', 'searchle-very-easy-targets.json']) {
    const relative = 'relay/data/word-bank/' + name;
    assert.ok(snapshot.files[relative], 'Shared bank baseline hash is missing');
    assert.equal(sha(path.join(relayRoot, 'data/word-bank', name)), snapshot.files[relative], 'A shared seeded target bank changed');
    verified.push(name);
  }
  return verified;
}

function verifyServices(before, current, expectedSubtextleRestarts = 0) {
  const byName = new Map(current.map(service => [service.name, service]));
  const unchanged = [];
  for (const previous of before) {
    const service = byName.get(previous.name);
    assert.ok(service, 'A baseline PM2 service disappeared');
    assert.equal(service.status, 'online', 'A PM2 service is not online');
    if (previous.name === 'searchle-mobile') {
      assert.notEqual(service.pid, previous.pid, 'Subtextle did not restart');
      assert.equal(service.restarts, previous.restarts + expectedSubtextleRestarts, 'Unexpected Subtextle restart count');
    } else {
      assert.equal(service.pid, previous.pid, 'An unrelated service process changed');
      assert.equal(service.restarts, previous.restarts, 'An unrelated service restarted');
      unchanged.push(service.name);
    }
  }
  assert.equal(current.length, before.length, 'PM2 service inventory changed');
  return unchanged;
}

function verifyDeployedSources(manifest, root) {
  assert.ok(manifest.version === 1 && Array.isArray(manifest.files), 'Invalid deployed source manifest');
  const verified = [];
  for (const item of manifest.files) {
    const relative = path.relative(root, path.resolve(item.target));
    assert.ok(relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Source manifest target escaped Subtextle');
    const file = path.resolve(root, relative), stats = fs.lstatSync(file);
    assert.ok(stats.isFile() && !stats.isSymbolicLink(), 'A deployed source target is not a regular file');
    assert.equal(sha(file), item.afterSha256, 'Deployed source bytes differ from reviewed release');
    assert.equal(stats.size, item.bytes, 'Deployed source size differs from reviewed release');
    verified.push(relative.replace(/\\/g, '/'));
  }
  for (const name of ['server/curated-targets.js','server/game-manager.js','server/sp-manager.js','server/session-manager.js'])
    assert.ok(verified.includes(name), 'A changed runtime module is absent from the source manifest');
  return verified;
}

async function health(port) {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, 'A game health endpoint returned an error');
  const body = await response.json();
  assert.equal(body.ok, true, 'A game health endpoint is unhealthy');
  return body;
}

async function verifyActualLoader(root, relayRoot, curatedWords, expectedPublic) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'subtextle-content-verification-'));
  const oldCwd = process.cwd(), savedLog = console.log, savedWarn = console.warn;
  try {
    // All managers resolve state to this throwaway directory. Actual sources,
    // both English vector models and curated catalog are read from production.
    process.env.DATA_DIR = sandbox;
    process.env.CHAT_RELAY_DIR = relayRoot;
    process.env.SEARCHLE_RANKING_CACHE_MAX = '1';
    process.env.SEARCHLE_CURATED_PUBLIC_TARGETS = path.join(root, 'data/curated-public-targets.json');
    process.env.SEARCHLE_EASY_TARGETS = path.join(relayRoot, 'data/word-bank/searchle-easy-targets.json');
    process.env.SEARCHLE_VERY_EASY_TARGETS = path.join(relayRoot, 'data/word-bank/searchle-very-easy-targets.json');
    process.env.SEARCHLE_BANK_DICT_PATH = path.join(relayRoot, 'data/word-bank/dictionary.json');
    for (const name of ['target-words.json', 'sp-pool-index.json']) fs.copyFileSync(path.join(root, 'data', name), path.join(sandbox, name));
    process.chdir(root);
    console.log = () => {}; console.warn = () => {};
    const original = require(path.join(root, 'server/config.js'));
    const config = { ...original, languageProfiles: {}, modelsDir: path.resolve(root, original.modelsDir),
      vocabPath: path.resolve(root, original.vocabPath), gate: { ...original.gate,
        frequencyPath: path.join(relayRoot, 'data/word-bank/frequency.json'),
        keepAlwaysCoveragePath: path.join(relayRoot, 'data/wikipedia-coverage.json'),
        keepAlwaysTargetsPath: path.join(root, 'data/target-words.json'),
        keepAlwaysBankDictPath: path.join(relayRoot, 'data/word-bank/dictionary.json') } };
    const ranker = require(path.join(root, 'server/ranking-engine.js'));
    await ranker.init(config);
    const models = ranker.getModelsInfo(config.modelsDir).activeModels;
    assert.deepEqual(models, ['numberbatch', 'fasttext'], 'Production verification did not load both English models');
    const manager = require(path.join(root, 'server/game-manager.js'));
    await manager.loadTargetWords();
    manager.filterTargetWords();
    const publicPool = manager.getPublicTargetPool();
    assert.equal(publicPool.length, expectedPublic, 'Actual public loader target count differs');
    for (const word of curatedWords) assert.ok(publicPool.includes(word) && ranker.isValidTarget(word), 'A released target is unavailable to the actual online loader');
    return { publicEligible: publicPool.length, activeModels: models, releasedTargetsEligible: curatedWords.length,
      gameCreationCalled: false, rankingComputationCalled: false };
  } finally {
    console.log = savedLog; console.warn = savedWarn; process.chdir(oldCwd);
    // Verify the resolved temporary target before any recursive cleanup.
    const resolved = fs.realpathSync(sandbox), temporaryRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temporaryRoot, 'Unsafe verification sandbox cleanup');
    assert.ok(path.basename(resolved).startsWith('subtextle-content-verification-'), 'Unsafe verification sandbox name');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function verifyWonHistory(root, baselineFile, expectedMinimum) {
  // Secrets remain in this process and are never logged or stored in reports.
  const dotenv = require(path.join(root, 'node_modules/dotenv'));
  const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  const secret = env.GAME_API_SECRET;
  assert.ok(secret, 'Permanent win-history authorization is unavailable');
  const response = await fetch((env.WORD_EMPIRES_URL || 'http://localhost:3020') + '/api/admin/game-won-words?game=searchle', {
    headers: { 'x-api-key': secret, 'x-admin-key': env.ADMIN_API_SECRET || secret }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, 'Permanent win history could not be read');
  const body = await response.json();
  assert.ok(body.ok && Array.isArray(body.words), 'Permanent win history is unavailable');
  const current = new Set(body.words.map(word => String(word).toLowerCase().trim()));
  assert.ok(current.size >= expectedMinimum, 'Permanent win-history count decreased');
  let exactBaselineWordsRetained = null;
  if (baselineFile && fs.existsSync(baselineFile)) {
    const baseline = read(baselineFile);
    assert.ok(Array.isArray(baseline), 'Invalid permanent win-history baseline');
    for (const word of baseline) assert.ok(current.has(word), 'A permanently won target disappeared from history');
    exactBaselineWordsRetained = baseline.length;
  }
  return { currentCount: current.size, minimumRetained: expectedMinimum, exactBaselineWordsRetained };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(value => {
    const equals = value.indexOf('=');
    assert.ok(value.startsWith('--') && equals > 2, 'Use named --key=value arguments');
    return [value.slice(2, equals), value.slice(equals + 1)];
  }));
  assert.ok(args.stage, 'Use --stage=/tmp/<release-dir>');
  const stage = path.resolve(args.stage), root = path.resolve(args['subtextle-root'] || '/opt/searchle');
  const relayRoot = path.resolve(args['relay-root'] || '/opt/chat-relay');
  const snapshot = read(path.join(stage, 'production-snapshot.json'));
  const before = read(path.join(stage, 'before-state.json'));
  const release = read(path.join(stage, args.manifest || 'addition-manifest.json'));
  assert.equal(release.sourceSnapshotSha256, sha(path.join(stage, 'production-snapshot.json')), 'Release and baseline snapshot differ');
  assert.ok(Array.isArray(release.curatedWords) && release.curatedWords.length === 1000 && new Set(release.curatedWords).size === 1000,
    'Release must contain exactly 1000 unique curated targets');
  assert.ok(Array.isArray(release.additions) && release.additions.length + (release.alreadySolo || []).length === 1000,
    'Release solo accounting differs from curated target count');
  const additions = release.additions;
  assert.equal(new Set(additions.map(item => item.word)).size, additions.length, 'Duplicate released solo targets');
  assert.deepEqual([...additions.map(item=>item.word), ...(release.alreadySolo || [])].sort(), release.curatedWords.slice().sort(),
    'Release solo targets differ from the curated catalog');
  const bank = verifyUnchangedBank(snapshot, relayRoot);
  const sourceManifestFile = args['source-manifest'] ? path.resolve(stage,args['source-manifest']) : path.join(stage,'source-manifest.json');
  if (args['source-manifest']) assert.ok(fs.existsSync(sourceManifestFile), 'Requested deployed source manifest is missing');
  const reviewedSources = fs.existsSync(sourceManifestFile) ? verifyDeployedSources(read(sourceManifestFile),root) : null;
  const changedInputs = new Set(['server/game-manager.js','server/sp-manager.js','server/session-manager.js','data/sp-pool-index.json']);
  for (const [relative, expected] of Object.entries(snapshot.files)) {
    if (changedInputs.has(relative)) continue;
    const actual = relative === 'won-words.json' ? path.join(stage,'won-words.json')
      : relative.startsWith('relay/') ? path.join(relayRoot,relative.slice(6)) : path.join(root,relative);
    assert.equal(sha(actual), expected, 'An unchanged canonical ranking input differs');
  }
  const catalogFile = path.join(root, 'data/curated-public-targets.json'), catalog = read(catalogFile);
  assert.equal(catalog.version, 1, 'Live curated catalog version differs');
  assert.deepEqual(catalog.words, release.curatedWords, 'Live curated catalog differs from release');
  const stagedCatalog = path.join(stage, args.catalog || 'curated-public-targets.json');
  if (fs.existsSync(stagedCatalog)) assert.equal(sha(catalogFile), sha(stagedCatalog), 'Live curated catalog bytes differ from release');
  const poolDir = path.join(root, 'data/sp-pool');
  const existing = new Set(fs.readdirSync(poolDir).filter(name => /^pool_\d+_[a-z]+\.json$/.test(name)));
  for (const file of snapshot.poolFiles) assert.ok(existing.has(file), 'A pre-existing solo puzzle file disappeared');
  const baselineWords = new Set(snapshot.poolFiles.map(name => name.replace(/^pool_\d+_/, '').replace(/\.json$/, '')));
  for (const word of release.alreadySolo || []) assert.ok(baselineWords.has(word), 'A reused solo target is absent from baseline');
  let rankedWords = null;
  for (const [i, item] of additions.entries()) {
    assert.ok(/^pool_\d+_[a-z]+\.json$/.test(item.filename) && item.filename.replace(/^pool_\d+_/, '').replace(/\.json$/, '') === item.word
      && !baselineWords.has(item.word), 'Release would replace or mislabel an existing solo puzzle');
    const count = verifyRanks(path.join(poolDir, item.filename), item);
    assert.equal(count, Number(args['ranking-size'] || 102939), 'Release ranking vocabulary differs from canonical size');
    if (rankedWords === null) rankedWords = count;
    assert.equal(count, rankedWords, 'Release ranking vocabularies differ');
    if ((i + 1) % 100 === 0) process.stderr.write(JSON.stringify({ rankingFilesVerified: i + 1, total: additions.length }) + '\n');
  }
  assert.ok(existing.size >= snapshot.poolFiles.length + additions.length, 'Solo pool file count is incomplete');
  const index = verifyIndex(snapshot.poolIndex, read(path.join(root, 'data/sp-pool-index.json')), additions);
  const won = await verifyWonHistory(root, args['won-baseline'] || path.join(stage, 'won-words.json'), snapshot.wonCount);
  const loader = await verifyActualLoader(root, relayRoot, release.curatedWords, Number(args['public-total'] || 3810));
  const [subtextle, contexto, rectangled] = await Promise.all([health(3015), health(3029), health(3031)]);
  assert.deepEqual(subtextle.models?.activeModels, ['numberbatch', 'fasttext'], 'Live Subtextle model set differs');
  assert.equal(contexto.hasRound, true, 'WikiContexto has no active round');
  assert.equal(rectangled.hasGame, true, 'WikiRectangled has no active game');
  if (before.coverageSha256) assert.equal(sha(path.join(relayRoot, 'data/wikipedia-coverage.json')), before.coverageSha256, 'Shared Wikipedia coverage changed');
  if (before.curatedPoolSha256) assert.equal(sha('/opt/wikisearchle/data/article-pool.json'), before.curatedPoolSha256, 'WikiContexto curated pool changed');
  const services = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', maxBuffer: 10000000 }))
    .map(service => ({name:service.name,pid:service.pid,status:service.pm2_env.status,restarts:service.pm2_env.restart_time}));
  // Starting a deliberately stopped PM2 service changes its PID without
  // incrementing restart_time. Running-service restarts can explicitly use 1.
  const unchangedServices = verifyServices(before.services, services, Number(args['expected-subtextle-restarts'] ?? 0));
  console.log(JSON.stringify({ ok:true, verifiedAt:new Date().toISOString(), release:{curatedTargets:1000, rankingFiles:additions.length, rankedWords,
    catalogSha256:sha(catalogFile), soloPoolFiles:existing.size, baselineSoloFiles:snapshot.poolFiles.length},
    preservedSharedBanks:bank, reviewedSources, index, wonHistory:won, actualLoader:loader,
    health:{subtextle:true,wikicontexto:true,wikirectangled:true}, unchangedServices,
    productionWrites:0, guessesSent:0, rewardsSent:0 },null,2));
}

module.exports = { verifyRanks, verifyIndex, verifyUnchangedBank, verifyServices, verifyDeployedSources };
if (require.main === module) main().catch(error => { console.error('Post-deploy verification failed: ' + error.message); process.exitCode = 1; });
