'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createSearchRecovery } = require('../server/round-recovery');
const { acceptSearchGuess } = require('../server/accept-search-guess');
const { createGameActionJournal } = require('../../Chat Relay/src/game-action-journal');
function fixture(t, filename, directory) {
  const root = directory || fs.mkdtempSync(path.join(os.tmpdir(), 'search-manager-'));
  if (!directory) t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (filename === 'game-manager.js') fs.writeFileSync(path.join(root, 'target-words.json'), JSON.stringify(['care', 'race', 'lace']));
  const failures = { write: false }, timers = [], queued = new Map();
  const ranks = new Map([['care', 1], ['race', 2], ['lace', 3], ['case', 20]]);
  const ranking = { isValidTarget: () => true, getActiveModelNames: () => [], computeRankings: async () => new Map(ranks) };
  const language = { normalizeLanguageId: value => value || 'en', normalizeGuessText: value => value, getRankingOptions: () => ({}), getTargetPool: () => ['care', 'race'] };
  const dependencies = { './ranking-engine': ranking, './language-profiles': language,
    './curated-targets': { loadCuratedTargets: () => [], mergeTargets: require('../server/curated-targets').mergeTargets },
    './round-recovery': require('../server/round-recovery'),
    './guess-processor': { toSingular: value => value, toAmerican: value => value, resolveRank: (word, entries) => entries.get(word) || 10001 },
    './sp-manager': { saveToPool: () => null }, './shared-resolver': { requireRelayOrShared: () => ({ isWordBlockedForGame: () => false }), resolveRelayOrShared: file => path.join(root, file) } };
  const fsImpl = new Proxy(fs, { get(target, key) { if (key === 'renameSync') return (...args) => { if (failures.write) throw Error('Synthetic storage failure'); return target.renameSync(...args); }; return target[key]; } });
  const context = { module: { exports: {} }, process: { env: { DATA_DIR: root } }, __dirname: path.join(__dirname, '../server'), require: name => dependencies[name] || require(name),
    console: { log() {}, warn() {}, error() {} }, Date, Map, Set, Buffer, URL, AbortSignal,
    fetch: async () => ({ ok: false }), setTimeout: fn => { const timer = { fn, unref() {} }; timers.push(timer); return timer; }, clearTimeout() {}, setInterval: () => ({ unref() {} }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server', filename), 'utf8'), context);
  const manager = context.module.exports, privateManager = filename.includes('session');
  const sdk = { isStatsEligible: (platform, id) => !['bot', 'system'].includes(platform) && !id.startsWith('guest'),
    reservePlayerReward(...args) { queued.set(args[7].eventId, args[7]); return { payload: args[7] }; }, deliverPlayerReward: async () => ({ ok: true }) };
  const recovery = createSearchRecovery({ createJournal: createGameActionJournal, directory: path.join(root, 'actions'), sdk,
    journalOptions: { fsImpl }, getMetadata: target => privateManager ? { handle: target.handle } : manager.snapshotMetadata(),
    setMetadata: (_target, value) => { if (!privateManager) manager.restoreMetadata(value); } });
  t.after(() => recovery.stop()); manager.setRecovery(recovery);
  const io = { to: () => ({ emit() {} }) }, config = { winRank: 1, autoRestartDelay: 8000 };
  return { root, manager, recovery, failures, queued, ranking, io, config, player: id => ({ platform: 'web', platformUserId: id, id, displayName: id }) };
}
test('private classic completion retains XP winner, finder, every payout and snapshot after restart', async t => {
  const f = fixture(t, 'session-manager.js'), session = await f.manager.getOrCreateSession({ handle: 'synthetic', config: f.config, targetWords: ['care'] });
  const accept = (word, rank, id) => acceptSearchGuess({ recovery: f.recovery, game: session, session, guess: { word, rank, user: f.player(id) }, word, config: f.config, sessionManager: f.manager, frenzy: 1 });
  accept('race', 2, 'grinder'); accept('lace', 3, 'grinder'); const result = accept('care', 1, 'finder');
  assert.equal(result.completion.winner.platformUserId, 'grinder'); assert.equal(result.completion.targetFinder.platformUserId, 'finder');
  assert.equal(result.completion.winnerPayout, 170000); assert.equal(f.queued.size, 2); assert.equal(session.winner.platformUserId, 'grinder');
  const reload = fixture(t, 'session-manager.js', f.root), restored = reload.manager.getSession('synthetic');
  assert.equal(restored.isWon, true); assert.equal(restored.playerScores.get('web:grinder').xp, 170000);
  assert.equal(reload.recovery.current(restored).completion.winnerPayout, 170000);
  assert.equal(await reload.manager.getOrCreateSession({ handle: 'synthetic', config: f.config, targetWords: ['care'] }), restored);
});
test('private failed acceptance restores slots, finds, last-winner and visible XP', async t => {
  const f = fixture(t, 'session-manager.js'), session = await f.manager.getOrCreateSession({ handle: 'synthetic', config: f.config, targetWords: ['care'] });
  f.failures.write = true;
  assert.throws(() => acceptSearchGuess({ recovery: f.recovery, game: session, session, guess: { word: 'care', rank: 1, user: f.player('finder') }, word: 'care', config: f.config, sessionManager: f.manager }), /Synthetic/);
  assert.equal(session.guesses.length, 0); assert.equal(session.playerScores.size, 0); assert.equal(session.paidTopWords.size, 0);
  assert.equal(session.isWon, false); assert.equal(session.lastWinner, null); assert.equal(f.queued.size, 0);
});
test('private retirement during ranking preparation cannot resurrect a room', async t => {
  const f = fixture(t, 'session-manager.js'), session = await f.manager.getOrCreateSession({ handle: 'synthetic', config: f.config, targetWords: ['care'] });
  let resolve; f.ranking.computeRankings = () => new Promise(done => { resolve = done; });
  const pending = f.manager.startNextSessionRound(session, f.config, ['care']);
  f.manager.endSession('synthetic'); resolve(new Map([['care', 1]])); await assert.rejects(pending, /changed/);
  assert.equal(f.manager.getSession('synthetic'), null); assert.equal(f.recovery.load('session:synthetic').meta.ended, true);
});
test('public number completion and history roll back on failed save then restore exactly once', t => {
  const f = fixture(t, 'number-game-manager.js'), game = f.manager.getGame(), input = String(game.targetNumber);
  f.failures.write = true; assert.throws(() => f.manager.processGuess({ message: input, user: f.player('finder') }), /Synthetic/);
  assert.equal(game.guesses.length, 0); assert.equal(game.playerScores.size, 0); assert.equal(f.manager.getGameState().winHistory.length, 0);
  f.failures.write = false; const result = f.manager.processGuess({ message: input, user: f.player('finder') });
  assert.equal(result.type, 'win'); assert.equal(f.manager.getGameState().winHistory.length, 1); assert.equal(f.queued.size, 0);
  const reload = fixture(t, 'number-game-manager.js', f.root);
  assert.equal(reload.manager.getGameState().isWon, true); assert.equal(reload.manager.getGameState().winHistory.length, 1);
  assert.equal(reload.manager.processGuess({ message: input, user: f.player('finder') }).type, 'ignored');
  assert.equal(reload.manager.getGameState().winHistory.length, 1);
});
test('private number failed guess and retirement retain ownership until accepted', t => {
  const f = fixture(t, 'number-session-manager.js'), session = f.manager.getOrCreateSession({ handle: 'synthetic' });
  f.failures.write = true; assert.throws(() => f.manager.processGuess(session, { message: String(session.targetNumber), user: f.player('finder') }), /Synthetic/);
  assert.equal(session.guesses.length, 0); assert.equal(session.isWon, false);
  assert.throws(() => f.manager.endSession('synthetic'), /Synthetic/); assert.equal(f.manager.getSession('synthetic'), session);
  f.failures.write = false; assert.equal(f.manager.processGuess(session, { message: String(session.targetNumber), user: f.player('finder') }).type, 'win');
  const reload = fixture(t, 'number-session-manager.js', f.root); assert.equal(reload.manager.getSession('synthetic').isWon, true);
  assert.equal(f.queued.size, 0); f.manager.endSession('synthetic');
  assert.throws(() => f.manager.startNextSessionRound(session), /Obsolete/);
});

test('private retirement cancels an unpublished room without deleting a newer creation lock', async t => {
  const f = fixture(t, 'session-manager.js');
  const releases = [];
  f.ranking.computeRankings = () => new Promise(resolve => releases.push(resolve));
  const request = { handle: 'synthetic', config: f.config, targetWords: ['care'] };
  const old = f.manager.getOrCreateSession(request);
  assert.equal(f.manager.endSession('synthetic'), true);
  const next = f.manager.getOrCreateSession(request);
  releases[0](new Map([['care', 1]]));
  await assert.rejects(old, /changed/);
  const follower = f.manager.getOrCreateSession(request);
  assert.equal(releases.length, 2);
  releases[1](new Map([['care', 1]]));
  const session = await next;
  assert.equal(await follower, session);
  assert.equal(f.manager.getSession('synthetic'), session);
  assert.equal(f.recovery.journal.scopes().length, 1);
});

test('concurrent private preparations cannot exceed the durable session cap', async t => {
  const f = fixture(t, 'session-manager.js');
  const results = await Promise.allSettled(Array.from({ length: 498 }, (_, index) =>
    f.manager.getOrCreateSession({ handle: 'synthetic_' + index, config: f.config, targetWords: ['care'] })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 497);
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /capacity/);
  assert.equal(f.manager.listSessions().length, 497);
  assert.equal(f.recovery.journal.scopes().length, 497);
});
test('public classic accepted scoring, winner, frenzy and original daily period survive restart', async t => {
  const f = fixture(t, 'game-manager.js'); await f.manager.loadTargetWords(); await f.manager.startGameWithWord('care', f.config, f.io);
  const game = f.manager.getGame();
  const accept = (word, rank, id) => acceptSearchGuess({ recovery: f.recovery, game, guess: { word, rank, user: f.player(id) }, word, config: f.config, gameManager: f.manager, frenzy: 2, period: '2026-10-02' });
  accept('race', 2, 'grinder'); accept('lace', 3, 'grinder'); const finished = accept('care', 1, 'finder');
  assert.equal(finished.completion.winnerPayout, 340000); assert.equal(finished.completion.winner.platformUserId, 'grinder');
  assert.equal(f.queued.size, 2); const winner = [...f.queued.values()].find(value => value.event === 'mp-daily-win');
  assert.equal(winner.rewardPeriod, '2026-10-02');
  const reload = fixture(t, 'game-manager.js', f.root); await reload.manager.loadTargetWords();
  assert.equal(await reload.manager.loadGame(f.config, { getPlayerCosmetics: async () => ({}) }, f.io), true);
  assert.equal(reload.manager.getGame().isWon, true); assert.equal(reload.manager.getGame().paidTopWords.size, 3);
  assert.equal(reload.recovery.current(reload.manager.getGame()).completion.winnerPayout, 340000);
  assert.equal(reload.manager.getGameState().recentGames.length, 1);
});

test('corrupt private number collections reject instead of replacing accepted progress with random rounds', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-number-corrupt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const valid = { handle: 'synthetic', targetNumber: 42, guesses: [], startTime: new Date().toISOString(), isWon: false };
  for (const payload of [{}, { sessions: [{}] }, { sessions: [{ ...valid, targetNumber: null }] }, { sessions: [valid, valid] }]) {
    fs.writeFileSync(path.join(root, 'number-session-state.json'), JSON.stringify(payload));
    assert.throws(() => fixture(t, 'number-session-manager.js', root), /need recovery/);
  }
});

test('corrupt public number files fail closed instead of silently starting a fresh target', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-number-public-corrupt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const payload of [null, [], {}, { game: { targetNumber: 42, isWon: false, guesses: [] } }]) {
    fs.writeFileSync(path.join(root, 'number-game-state.json'), JSON.stringify(payload));
    assert.throws(() => fixture(t, 'number-game-manager.js', root), /need|needs recovery/);
  }
});
test('pending public migration keeps its file until acceptance and reconstructs legacy podium once', async t => {
  const f = fixture(t, 'game-manager.js'); await f.manager.loadTargetWords(); await f.manager.startGameWithWord('care', f.config, f.io);
  const previous = f.manager.getGame(), pending = path.join(f.root, 'pending-game.json');
  fs.writeFileSync(pending, JSON.stringify({ targetWord: 'race', startTime: new Date().toISOString(), isWon: false,
    guesses: [{ word: 'lace', rank: 3, user: f.player('grinder') }], guessedWords: ['lace'] }));
  f.failures.write = true;
  await assert.rejects(f.manager.loadPendingGame(f.config, { getPlayerCosmetics: async () => ({}) }, f.io), /Synthetic/);
  assert.equal(f.manager.getGame(), previous); assert.equal(fs.existsSync(pending), true);
  f.failures.write = false; assert.equal(await f.manager.loadPendingGame(f.config, { getPlayerCosmetics: async () => ({}) }, f.io), true);
  assert.equal(fs.existsSync(pending), false); assert.equal(f.manager.getPodium()[0].xp, 80000);
  assert.equal(f.queued.size, 0); assert.equal(f.recovery.load('public').state.targetWord, 'race');
});
test('late preloading cannot overwrite an explicitly selected replacement', async t => {
  const f = fixture(t, 'game-manager.js'); await f.manager.loadTargetWords(); await f.manager.startGameWithWord('care', f.config, f.io);
  let release; const original = f.ranking.computeRankings; f.ranking.computeRankings = () => new Promise(resolve => { release = resolve; });
  f.manager.preloadNextGame(f.config); f.ranking.computeRankings = original;
  await f.manager.startGameWithWord('race', f.config, f.io); release(new Map([['care', 1]])); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.manager.getGame().targetWord, 'race'); assert.equal(f.recovery.load('public').state.targetWord, 'race');
});
