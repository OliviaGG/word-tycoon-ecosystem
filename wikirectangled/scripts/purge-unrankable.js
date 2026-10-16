// Purge articles from wikipedia-coverage.json whose any title word is not
// rankable by Searchle. Validates the unique set of title-word norms across
// the entire pool first (~tens of thousands of unique words) so we only hit
// Searchle once per word, not per article.
require('dotenv').config({ path: '/opt/wikirectangled/.env' });
const fs = require('fs');
const { rankBatch } = require('/opt/wikirectangled/src/searchle-client');

const PATH = '/opt/chat-relay/data/wikipedia-coverage.json';
const THROTTLE_MS = 50; // local Searchle, generous

(async () => {
  const coverage = JSON.parse(fs.readFileSync(PATH, 'utf8'));
  const pages = coverage.pages || {};
  const keys = Object.keys(pages);
  console.log('Articles in pool:', keys.length);

  // Collect unique title-word norms across the whole pool.
  const uniqueWords = new Set();
  let articlesWithoutNorms = 0;
  for (const k of keys) {
    const e = pages[k];
    const norms = (e && e.titleWordNorms) || [];
    if (!norms.length) { articlesWithoutNorms++; continue; }
    for (const n of norms) if (n) uniqueWords.add(n);
  }
  console.log('Unique title-word norms:', uniqueWords.size);
  console.log('Articles missing titleWordNorms:', articlesWithoutNorms);

  // Validate each unique word.
  const wordStatus = new Map(); // word -> 'ok' | 'bad'
  let i = 0;
  let okCount = 0, badCount = 0;
  for (const w of uniqueWords) {
    i++;
    try {
      await rankBatch(w, []);
      wordStatus.set(w, 'ok');
      okCount++;
    } catch (e) {
      wordStatus.set(w, 'bad');
      badCount++;
    }
    if (i % 500 === 0) {
      console.log(' ', i, '/', uniqueWords.size, 'validated —', badCount, 'bad so far');
    }
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }
  console.log('Done validating words: ok =', okCount, 'bad =', badCount);

  // Iterate articles, mark bad ones.
  const removed = [];
  const kept = {};
  for (const k of keys) {
    const e = pages[k];
    const norms = (e && e.titleWordNorms) || [];
    let badWord = null;
    for (const n of norms) {
      if (wordStatus.get(n) === 'bad') { badWord = n; break; }
    }
    if (badWord) {
      removed.push({ key: k, badWord });
    } else {
      kept[k] = e;
    }
  }
  console.log('Articles removed:', removed.length, 'kept:', Object.keys(kept).length);
  if (removed.length) {
    console.log('First 10 removals:');
    for (const r of removed.slice(0, 10)) console.log(' ', r.key, '←', r.badWord);
  }

  const TS = Math.floor(Date.now() / 1000);
  fs.writeFileSync('/tmp/wikipedia-coverage.json.bak-purge-' + TS, fs.readFileSync(PATH));
  coverage.pages = kept;
  coverage.stats.searchlePurgeAt = new Date().toISOString();
  coverage.stats.searchlePurgeRemoved = removed.length;
  coverage.stats.totalPages = Object.keys(kept).length;
  coverage.stats.updatedAt = new Date().toISOString();
  fs.writeFileSync(PATH, JSON.stringify(coverage));
  console.log('totalPages now:', coverage.stats.totalPages);

  // Also save the bad-word list for future batch-validation.
  fs.writeFileSync(
    '/opt/chat-relay/data/searchle-unrankable-words.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), words: [...wordStatus.entries()].filter(([, v]) => v === 'bad').map(([w]) => w) })
  );
  console.log('Wrote /opt/chat-relay/data/searchle-unrankable-words.json');
})();
