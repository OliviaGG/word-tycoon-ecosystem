'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function withFixture(run) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-difficulty-'));
  try {
    const data = path.join(fixture, 'data');
    const relay = path.join(fixture, 'relay');
    const bank = path.join(relay, 'data', 'word-bank');
    fs.mkdirSync(path.join(data, 'sp-pool'), { recursive: true });
    fs.mkdirSync(bank, { recursive: true });
    fs.mkdirSync(path.join(relay, 'src'), { recursive: true });
    const put = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
    // carpet has a generated solo puzzle and dictionary/model membership, but
    // belongs to neither legacy shared target bank nor difficulty whitelist.
    put(path.join(bank, 'targets.json'), { 5: ['house', 'stone'], 9: ['astronomy'] });
    put(path.join(bank, 'searchle-easy-targets.json'), ['house', 'stone']);
    put(path.join(bank, 'searchle-very-easy-targets.json'), ['house']);
    put(path.join(bank, 'dictionary.json'), { 5: ['house', 'stone'], 6: ['carpet'], 9: ['astronomy'] });
    put(path.join(data, 'target-words.json'), ['house', 'stone', 'astronomy']);
    put(path.join(data, 'curated-public-targets.json'), { version: 1, words: ['carpet'] });
    fs.writeFileSync(path.join(relay, 'src', 'game-word-policy.js'), 'exports.isWordBlockedForGame = () => false;');
    const words = ['house', 'stone', 'astronomy', 'carpet'];
    for (const [i, word] of words.entries()) {
      put(path.join(data, 'sp-pool', `pool_${1000 + i}_${word}.json`), {
        targetWord: word, rankings: { [word]: 1 }, totalRankedWords: 1,
      });
    }
    put(path.join(data, 'sp-pool-index.json'), {
      nextNumber: 5, words: { house: 1, stone: 2, astronomy: 3, carpet: 4 },
      weeklyNumbers: {}, nextWeeklyNumber: 1, vacantNumbers: [], weeklyAssignments: {}, dailyAssignments: {},
    });
    for (const [name, values] of Object.entries({ normal: ['casa', 'tapete', 'estrela'], common: ['tapete'], 'very-common': ['casa'] })) {
      put(path.join(data, `pt-${name}.json`), values);
    }
    const preserved = ['targets.json', 'searchle-easy-targets.json', 'searchle-very-easy-targets.json'].map(file => path.join(bank, file));
    preserved.push(path.join(data, 'sp-pool-index.json'));
    const originals = new Map(preserved.map(file => [file, fs.readFileSync(file)]));
    run({ data, relay, bank, words, root: path.resolve(__dirname, '..') });
    for (const [file, bytes] of originals) assert.deepEqual(fs.readFileSync(file), bytes, `selection modified ${file}`);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function runModuleScript(fixture, script) {
  const result = spawnSync(process.execPath, ['-e', script, fixture.root, fixture.data, fixture.bank], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, DATA_DIR: fixture.data, CHAT_RELAY_DIR: fixture.relay,
      SEARCHLE_EASY_TARGETS: path.join(fixture.bank, 'searchle-easy-targets.json'),
      SEARCHLE_VERY_EASY_TARGETS: path.join(fixture.bank, 'searchle-very-easy-targets.json'),
      SEARCHLE_CURATED_PUBLIC_TARGETS: path.join(fixture.data, 'curated-public-targets.json'),
      SEARCHLE_BANK_DICT_PATH: path.join(fixture.bank, 'dictionary.json') },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('actual solo browser admits supplemental carpet in common and preserves very-common', () => {
  withFixture(fixture => runModuleScript(fixture, `
    const assert = require('node:assert/strict');
    const root = process.argv[1];
    const manager = require(root + '/server/sp-manager');
    const words = difficulty => manager.getPoolBrowserGames(null, difficulty).map(game => game.word);
    assert.deepEqual(words('common'), ['house','stone','carpet']);
    assert.deepEqual(words('easy'), ['house','stone','carpet']);
    assert.deepEqual(words('very-common'), ['house']);
    assert.deepEqual(words('very-easy'), ['house']);
    assert.deepEqual(words('normal'), ['house','stone','astronomy','carpet']);
    assert.equal(manager.getGameMetaByWord('carpet').gameKey, 'game:4');
  `));
});

test('actual English streamer common picks supplement while Portuguese difficulty pools stay separate', () => {
  withFixture(fixture => runModuleScript(fixture, `
    const assert = require('node:assert/strict');
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
    const { createRequire } = require('node:module');
    const [root, data, bank] = process.argv.slice(1);
    const ranker = require(root + '/server/ranking-engine');
    const vocabulary = ['house','stone','astronomy','carpet'];
    ranker.getActiveVocabSet = () => new Set(vocabulary);
    ranker.getAllModels = () => [{wordIndex:new Map(vocabulary.map((word,i)=>[word,i]))}];
    const validated = [];
    ranker.isValidTarget = (word, options) => { validated.push({word, options}); return true; };
    ranker.computeRankings = () => { throw Error('Difficulty selection must not compute embeddings'); };
    const config = require(root + '/server/config');
    config.languageProfiles = { 'pt-br': { activeModels:['fixture-pt-model'], targetPools: {
      normal:path.join(data,'pt-normal.json'), common:path.join(data,'pt-common.json'),
      'very-common':path.join(data,'pt-very-common.json') } } };
    global.fetch = async () => ({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(bank,'targets.json'),'utf8'))});
    const manager = require(root + '/server/game-manager');
    (async () => {
      await manager.loadTargetWords();
      manager.filterTargetWords();
      assert.deepEqual(manager.getTargetWordPool(), ['house','stone','astronomy','carpet']);
      // Export the private picker from the complete actual module in an isolated
      // VM; leave source untouched and suppress unrelated startup maintenance.
      const filename = path.join(root,'server/session-manager.js');
      const moduleBox = {exports:{}};
      const deterministicMath = Object.create(Math);
      deterministicMath.random = () => 0.99999;
      const timer = () => ({unref(){}});
      vm.runInNewContext(fs.readFileSync(filename,'utf8') + '\\nmodule.exports.__pickSessionTarget = _pickSessionTarget;', {
        module:moduleBox,exports:moduleBox.exports,require:createRequire(filename),
        __filename:filename,__dirname:path.dirname(filename),process,console,Buffer,
        Math:deterministicMath,setTimeout:timer,clearTimeout(){},setInterval:timer,clearInterval(){},fetch:global.fetch,
      }, {filename});
      const pick = moduleBox.exports.__pickSessionTarget;
      const pool = manager.getTargetWordPool();
      assert.equal(pick(pool,'common',{recentTargets:[]},'en'), 'carpet');
      assert.equal(pick(pool,'very-common',{recentTargets:[]},'en'), 'house');
      assert.equal(pick(pool,'common',{recentTargets:[]},'pt-br'), 'tapete');
      assert.equal(pick(pool,'very-common',{recentTargets:[]},'pt-br'), 'casa');
      assert.equal(validated[0].options, null);
      assert.deepEqual(validated[2].options.modelNames, ['fixture-pt-model']);
      assert.deepEqual(validated.map(entry=>entry.word), ['carpet','house','tapete','casa']);
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `));
});
