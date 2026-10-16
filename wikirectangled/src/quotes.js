// quotes.js - Build a WikirecTangled mini round around a famous quote.
//
// The quote text becomes the hidden title phrase. Its content words (filtered
// to dictionary words 4-9 letters) become the title chips players reveal.
// Extra targets are just the title words themselves, so the round ends when
// every word of the quote has been found.

const fs = require('fs');
const path = require('path');
const { rankBatch } = require('./searchle-client');
const { isKnownRankable, isKnownUnrankable } = require('./article');
const wordlist = require('./wordlist');

const QUOTES_PATH = process.env.WIKIREC_QUOTES_PATH
  || path.join(__dirname, '..', 'data', 'quotes.json');

const RANKABLE_MIN_ZIPF = parseFloat(process.env.WIKIREC_RANKABLE_MIN_ZIPF) || 4.2;

const STOPLIST = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to', 'in',
  'on', 'at', 'by', 'for', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'am', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'this', 'that',
  'these', 'those', 'it', 'its', 'they', 'them', 'their', 'there', 'here',
  'he', 'she', 'we', 'you', 'your', 'his', 'her', 'him', 'me', 'my', 'our',
  'who', 'whom', 'whose', 'which', 'what', 'when', 'where', 'why', 'how',
  'not', 'no', 'so', 'than', 'too', 'very', 'just', 'also', 'such', 'into',
  'from', 'about', 'after', 'before', 'over', 'under', 'between', 'through',
  'during', 'while', 'because', 'although', 'though', 'since', 'until',
  'one', 'two', 'three', 'first', 'second', 'new', 'old', 'other',
  'some', 'any', 'all', 'each', 'every', 'most', 'many', 'much', 'more',
  'less', 'few', 'several', 'both', 'either', 'neither', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'now', 'then',
]);

let quotes = [];
let lastIndex = -1;

function loadQuotes() {
  try {
    const raw = fs.readFileSync(QUOTES_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.quotes)) quotes = data.quotes;
    console.log(`[Quotes] Loaded ${quotes.length} quotes from ${QUOTES_PATH}`);
  } catch (e) {
    console.log(`[Quotes] Failed to load quotes: ${e.message}`);
    quotes = [];
  }
}
loadQuotes();

function isLikelyRankable(word) {
  const freq = wordlist.getFrequencyMap();
  const z = freq.get(word);
  return typeof z === 'number' && z >= RANKABLE_MIN_ZIPF;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z]+/g) || [];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function formatRound(quote, placeableTitleWords, titleWordsRaw) {
  const text = quote.text;
  const targets = placeableTitleWords.map((w) => ({ word: w, freq: 1 }));
  return {
    title: text,
    key: text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
    plaintext: text,
    fullPlaintext: text,
    titleWords: placeableTitleWords,
    titleWordsRaw,
    targets,
  };
}

function formatCompactRound(targetWord) {
  // Compact/single-target variant: the "article" is just the target word.
  // Round ends as soon as this one word is found.
  return {
    title: targetWord,
    key: targetWord.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
    plaintext: targetWord,
    fullPlaintext: targetWord,
    titleWords: [targetWord],
    titleWordsRaw: [targetWord],
    targets: [{ word: targetWord, freq: 1 }],
  };
}

async function buildQuoteRound(trie, {
  count = 6,
  maxAttempts = 50,
  minTitleWords = 2,
  maxTotalLetters = 35,
} = {}) {
  if (!trie || trie.wordCount < 1000) {
    throw new Error('Trie too small for quote rounds');
  }
  if (quotes.length === 0) {
    throw new Error('No quotes loaded');
  }

  const order = shuffle([...quotes.keys()]);
  const seen = new Set();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const idx = order[attempt % order.length];
    if (seen.has(idx)) continue;
    seen.add(idx);
    const quote = quotes[idx];
    const rawWords = tokenize(quote.text);

    const placeable = [];
    const rawMap = [];
    for (const w of rawWords) {
      const norm = w.toLowerCase();
      if (norm.length < 4 || norm.length > 9) continue;
      if (STOPLIST.has(norm)) continue;
      if (!trie.has(norm)) continue;
      placeable.push(norm);
      rawMap.push(w);
    }

    // Deduplicate while preserving first occurrence order.
    const seenWords = new Set();
    const titleWords = [];
    const titleWordsRaw = [];
    for (let i = 0; i < placeable.length; i++) {
      const w = placeable[i];
      if (seenWords.has(w)) continue;
      seenWords.add(w);
      titleWords.push(w);
      titleWordsRaw.push(rawMap[i]);
    }

    if (titleWords.length < minTitleWords) continue;

    const totalLetters = titleWords.reduce((s, w) => s + w.length, 0);
    if (totalLetters > maxTotalLetters) continue;

    // Skip quotes containing any known-unrankable title word.
    if (titleWords.some((w) => isKnownUnrankable(w))) continue;

    // Validate remaining title words against Searchle. High-frequency words are
    // treated as rankable without a network probe.
    const toCheck = titleWords.filter((w) => !isKnownRankable(w) && !isLikelyRankable(w));
    let allRankable = true;
    if (toCheck.length > 0) {
      const checks = await Promise.all(
        toCheck.map((w) =>
          rankBatch(w, [])
            .then(() => ({ w, ok: true }))
            .catch((e) => ({ w, ok: false, err: e }))
        )
      );
      for (const { w, ok, err } of checks) {
        if (ok) continue;
        console.log(`[Quotes] skip quote: title word "${w}" not rankable (${err && err.message})`);
        allRankable = false;
        break;
      }
    }
    if (!allRankable) continue;

    lastIndex = idx;
    return formatRound(quote, titleWords, titleWordsRaw);
  }

  return null;
}

// Compact quote round for WikiWord 4x4: a single target word hidden in a small
// letter grid. The quote is only a source of words; the round title is the
// target word itself so the game ends after one find.
const COMPACT_RANKABLE_MIN_ZIPF = 3.5;

function formatCompactMultiRound(words) {
  const title = words.join(' ');
  return {
    title,
    key: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
    plaintext: title,
    fullPlaintext: title,
    titleWords: words,
    titleWordsRaw: words,
    targets: words.map((w) => ({ word: w, freq: 1 })),
  };
}

async function validateRankable(words, logPrefix) {
  if (words.some((w) => isKnownUnrankable(w))) return false;
  const toCheck = words.filter((w) => {
    if (isKnownRankable(w)) return false;
    const freq = wordlist.getFrequencyMap();
    const z = freq.get(w);
    if (typeof z === 'number' && z >= COMPACT_RANKABLE_MIN_ZIPF) return false;
    return true;
  });
  if (toCheck.length === 0) return true;
  const checks = await Promise.all(
    toCheck.map((w) =>
      rankBatch(w, [])
        .then(() => ({ w, ok: true }))
        .catch((e) => ({ w, ok: false, err: e }))
    )
  );
  for (const { w, ok, err } of checks) {
    if (ok) continue;
    console.log(`[CompactQuotes] ${logPrefix} title word "${w}" not rankable (${err && err.message})`);
    return false;
  }
  return true;
}

async function buildCompactQuoteRound(trie, {
  targetCount = 1,
  maxAttempts = 80,
  minLength = 4,
  maxLength = 10,
  maxTotalLetters = 16,
} = {}) {
  if (!trie || trie.wordCount < 1000) {
    throw new Error('Trie too small for compact quote rounds');
  }
  if (targetCount < 1) {
    throw new Error('targetCount must be at least 1');
  }

  // Primary source: Searchle's curated target-word pool from the word bank.
  const searchleTargets = wordlist.getTargetWords().filter((w) => {
    if (w.length < minLength || w.length > maxLength) return false;
    if (w.length > maxTotalLetters) return false;
    if (STOPLIST.has(w)) return false;
    if (!trie.has(w)) return false;
    return true;
  });

  if (searchleTargets.length >= targetCount) {
    const order = shuffle([...searchleTargets.keys()]);
    const seenStarts = new Set();
    for (let attempt = 0; attempt < maxAttempts && attempt < order.length; attempt++) {
      const startIdx = order[attempt];
      const selected = searchleTargets.slice(startIdx, startIdx + targetCount);
      if (selected.length < targetCount) continue;
      const key = selected.join(',');
      if (seenStarts.has(key)) continue;
      seenStarts.add(key);
      const totalLetters = selected.reduce((s, w) => s + w.length, 0);
      if (totalLetters > maxTotalLetters) continue;
      if (!(await validateRankable(selected, 'target-list'))) continue;
      if (targetCount === 1) return formatCompactRound(selected[0]);
      return formatCompactMultiRound(selected);
    }
    console.log(`[CompactQuotes] Searchle target pool exhausted for compact round; falling back to quotes`);
  }

  if (quotes.length === 0) {
    throw new Error('No quotes loaded and Searchle target pool unavailable');
  }

  // Fallback: quote-derived compact round.
  const order = shuffle([...quotes.keys()]);
  const seen = new Set();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const idx = order[attempt % order.length];
    if (seen.has(idx)) continue;
    seen.add(idx);
    const quote = quotes[idx];
    const rawWords = tokenize(quote.text);

    const seenWords = new Set();
    const candidates = [];
    for (const raw of rawWords) {
      const norm = raw.toLowerCase();
      if (norm.length < minLength || norm.length > maxLength) continue;
      if (norm.length > maxTotalLetters) continue;
      if (STOPLIST.has(norm)) continue;
      if (!trie.has(norm)) continue;
      if (seenWords.has(norm)) continue;
      seenWords.add(norm);
      candidates.push(norm);
    }

    if (candidates.length < targetCount) continue;

    candidates.sort((a, b) => b.length - a.length || a.localeCompare(b));
    const selected = candidates.slice(0, targetCount);
    const totalLetters = selected.reduce((s, w) => s + w.length, 0);
    if (totalLetters > maxTotalLetters) continue;

    if (!(await validateRankable(selected, 'quote'))) continue;

    if (targetCount === 1) {
      return formatCompactRound(selected[0]);
    }

    const rawMap = selected.map((w) => w);
    return formatRound(quote, selected, rawMap);
  }

  return null;
}

module.exports = { buildQuoteRound, buildCompactQuoteRound, loadQuotes };
