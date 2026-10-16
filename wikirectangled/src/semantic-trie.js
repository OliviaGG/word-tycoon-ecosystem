// semantic-trie.js — build a per-round trie from Searchle's semantic
// neighborhood of the title words.
//
// Replaces the article-body approach (topic-trie.js). Instead of mining
// words that happen to appear in the Wikipedia lead/body, we ask Searchle
// "what words are semantically closest to each title word?" and use those.
// This decouples grid richness from article length — a stub article and
// a 50KB article yield equally rich topic pools.
//
// Strategy per round:
//   1. For each title word, call rankTop(word, TOP_N).
//   2. Union the topRanked sets across title words, dedupe.
//   3. Intersect with the base trie (so we only keep real English words).
//   4. Always include the title words themselves.
//   5. If the resulting set is smaller than MIN_SEMANTIC_TRIE_SIZE, keep it
//      marked as undersized but do not widen completion back to the base trie.
//
// Per-call failures are individually tolerated — if one title word fails
// to rank but others succeed, we still proceed with the partial pool.

const { Trie } = require('./trie');

const TOP_N_DEFAULT = 750;
const MIN_SEMANTIC_TRIE_SIZE = 100;
// Zipf cutoff for the topic pool. Words below this are dropped from
// classification (they stay findable in the grid via base trie, just
// don't count toward common/rare/ultra tiers). 3.5 keeps familiar
// topic vocabulary, drops specialist jargon.
const MIN_TOPIC_ZIPF_DEFAULT = 3.5;

/**
 * @param {Object} opts
 * @param {string[]} opts.titleWords   Lowercase title words
 * @param {Object}   opts.baseTrie     Global trie from wordlist.getTrie()
 * @param {Function} opts.rankTop      searchleClient.rankTop(target, n)
 * @param {number}   [opts.topN=750]   Words to fetch per title word
 * @returns {Promise<{ trie, fellBack, size, source, perWord }>}
 */
async function buildSemanticTrie({ titleWords, baseTrie, rankTop, topN = TOP_N_DEFAULT, frequencyMap = null, minZipf = MIN_TOPIC_ZIPF_DEFAULT }) {
  if (!baseTrie || typeof baseTrie.has !== 'function') {
    throw new Error('buildSemanticTrie: baseTrie missing or invalid');
  }
  if (typeof rankTop !== 'function') {
    throw new Error('buildSemanticTrie: rankTop function required');
  }

  const semanticWords = new Set();
  const perWord = {};
  const cleanedTitleWords = (titleWords || [])
    .map((w) => String(w || '').toLowerCase().replace(/[^a-z]/g, ''))
    .filter((w) => w.length >= 3);

  // Fetch per title word in parallel — Searchle caches per target so
  // repeat queries are ~free.
  const results = await Promise.all(cleanedTitleWords.map(async (w) => {
    try {
      const { topRanked } = await rankTop(w, topN);
      perWord[w] = { ok: true, count: topRanked.length };
      return topRanked.map((r) => String(r.word || '').toLowerCase());
    } catch (e) {
      perWord[w] = { ok: false, error: e.message };
      return [];
    }
  }));

  for (const words of results) {
    for (const w of words) {
      // Intersect with base trie so we only keep real English words.
      // (Searchle's rank list may include lemmas / inflections the base
      // trie doesn't carry; trust the base trie as ground truth.)
      if (!/^[a-z]{3,}$/.test(w)) continue;
      if (!baseTrie.has(w)) continue;
      // Zipf gate — drop words below the topic-familiarity threshold so
      // the grid biases toward vocabulary players can plausibly think of.
      if (frequencyMap) {
        const z = frequencyMap.get(w);
        if (typeof z !== 'number' || z < minZipf) continue;
      }
      semanticWords.add(w);
    }
  }

  // Always include the title words themselves (proper nouns may not be
  // in the base trie; we still need them placeable + findable).
  for (const w of cleanedTitleWords) semanticWords.add(w);

  const semanticTrie = new Trie();
  for (const w of semanticWords) semanticTrie.insert(w);
  if (semanticWords.size < MIN_SEMANTIC_TRIE_SIZE) {
    return {
      trie: semanticTrie,
      fellBack: true,
      size: semanticTrie.wordCount,
      source: 'semantic-small',
      perWord,
    };
  }

  return {
    trie: semanticTrie,
    fellBack: false,
    size: semanticTrie.wordCount,
    source: 'semantic',
    perWord,
  };
}

module.exports = { buildSemanticTrie, TOP_N_DEFAULT, MIN_SEMANTIC_TRIE_SIZE, MIN_TOPIC_ZIPF_DEFAULT };
