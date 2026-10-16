'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

for (const useFallback of [false, true]) {
  test(`actual online loader includes supplemental nouns with ${useFallback ? 'fallback bank' : 'relay bank'} and preserves exclusions`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-online-'));
    try {
      const data = path.join(dir, 'data'), relay = path.join(dir, 'relay');
      fs.mkdirSync(data, { recursive: true });
      fs.mkdirSync(path.join(relay, 'data/word-bank'), { recursive: true });
      fs.mkdirSync(path.join(relay, 'src'), { recursive: true });
      const put = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
      put(path.join(data, 'target-words.json'), ['house']);
      put(path.join(data, 'curated-public-targets.json'), { version: 1, words: ['carpet', 'apple', 'blocked', 'cats'] });
      put(path.join(relay, 'data/word-bank/searchle-easy-targets.json'), ['house']);
      put(path.join(relay, 'data/word-bank/dictionary.json'), { 4: ['cats'], 5: ['house', 'apple'], 6: ['carpet'], 7: ['blocked'] });
      fs.writeFileSync(path.join(relay, 'src/game-word-policy.js'), "exports.isWordBlockedForGame = (_game, _kind, word) => word === 'blocked';");
      const root = path.resolve(__dirname, '..');
      const script = `
        const assert = require('node:assert/strict');
        const root = process.argv[1];
        const ranker = require(root + '/server/ranking-engine');
        const vocabulary = ['house','carpet','apple','blocked','cats','cat'];
        ranker.getActiveVocabSet = () => new Set(vocabulary);
        ranker.getAllModels = () => [{wordIndex:new Map(vocabulary.map((word,i)=>[word,i]))}];
        global.fetch = async () => ${useFallback ? "{throw Error('offline');}" : "({ok:true,json:async()=>({'5':['house']})})"};
        const manager = require(root + '/server/game-manager');
        (async () => {
          await manager.loadTargetWords();
          manager.filterTargetWords();
          assert.deepEqual(manager.getTargetWordPool(), ['house','carpet']);
          assert.deepEqual(manager.getPublicTargetPool(), ['house','carpet']);
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `;
      const result = spawnSync(process.execPath, ['-e', script, root], { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, DATA_DIR: data, CHAT_RELAY_DIR: relay,
          SEARCHLE_EASY_TARGETS: path.join(relay, 'data/word-bank/searchle-easy-targets.json'),
          SEARCHLE_CURATED_PUBLIC_TARGETS: path.join(data, 'curated-public-targets.json'),
          SEARCHLE_BANK_DICT_PATH: path.join(relay, 'data/word-bank/dictionary.json') } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
