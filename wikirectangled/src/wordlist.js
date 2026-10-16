// wordlist.js - Dictionary + frequency loader.
//
// Source priority:
//   1. Chat Relay word-bank API at CHAT_RELAY_URL  (canonical, matches RecTangled)
//   2. Local data/dictionary.txt + data/frequency.json (offline fallback)
//
// If neither is available the trie stays empty — server.js refuses to open a round
// without at least a few thousand words.

const path = require('path');
const fs = require('fs');
const { Trie } = require('./trie');

const WORD_BANK_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const DATA_DIR = path.join(__dirname, '..', 'data');

let trie = null;
let frequencyMap = new Map();
let targetWords = [];

async function loadFromWordBank() {
  trie = new Trie();
  const dictFetches = [];
  for (let len = 3; len <= 15; len++) {
    dictFetches.push(
      fetch(`${WORD_BANK_URL}/api/word-bank/dictionary/${len}`)
        .then((res) => res.json())
        .then((words) => {
          if (Array.isArray(words)) words.forEach((w) => trie.insert(w.toLowerCase()));
        })
        .catch((e) => {
          console.log(`[WordList] dictionary length ${len} fetch failed: ${e.message}`);
        })
    );
  }
  await Promise.all(dictFetches);
  console.log(`[WordList] Loaded ${trie.wordCount} words from Word Bank`);

  try {
    const freqRes = await fetch(`${WORD_BANK_URL}/api/word-bank/frequency`);
    if (freqRes.ok) {
      const freqData = await freqRes.json();
      for (const [word, score] of Object.entries(freqData)) {
        frequencyMap.set(word.toLowerCase(), score);
      }
      console.log(`[WordList] Loaded ${frequencyMap.size} word frequencies from Word Bank`);
    }
  } catch (e) {
    console.log(`[WordList] Frequency fetch failed: ${e.message}`);
  }

  try {
    const targetsRes = await fetch(`${WORD_BANK_URL}/api/word-bank/targets`);
    if (targetsRes.ok) {
      const targetsData = await targetsRes.json();
      targetWords = [];
      for (const words of Object.values(targetsData)) {
        if (Array.isArray(words)) {
          for (const w of words) {
            const clean = String(w || '').toLowerCase();
            if (clean.length >= 3 && /^[a-z]+$/.test(clean)) targetWords.push(clean);
          }
        }
      }
      console.log(`[WordList] Loaded ${targetWords.length} target words from Word Bank`);
    }
  } catch (e) {
    console.log(`[WordList] Targets fetch failed: ${e.message}`);
  }
}

function loadFromLocal() {
  trie = new Trie();
  // Two accepted formats:
  //   data/dictionary.json — WikiSearchle/Chat-Relay format: { "3": ["aah",...], "4": [...] }
  //   data/dictionary.txt  — plain newline-delimited list
  const jsonPath = path.join(DATA_DIR, 'dictionary.json');
  const txtPath = path.join(DATA_DIR, 'dictionary.txt');
  if (fs.existsSync(jsonPath)) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    for (const words of Object.values(raw)) {
      if (!Array.isArray(words)) continue;
      for (const w of words) {
        const clean = String(w || '').toLowerCase();
        if (clean.length >= 3 && /^[a-z]+$/.test(clean)) trie.insert(clean);
      }
    }
  } else if (fs.existsSync(txtPath)) {
    const text = fs.readFileSync(txtPath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const w = line.trim().toLowerCase();
      if (w.length >= 3 && /^[a-z]+$/.test(w)) trie.insert(w);
    }
  } else {
    console.log(`[WordList] No local dictionary at ${jsonPath} or ${txtPath}`);
    return false;
  }
  console.log(`[WordList] Loaded ${trie.wordCount} words from local dictionary`);

  const freqPath = path.join(DATA_DIR, 'frequency.json');
  if (fs.existsSync(freqPath)) {
    try {
      const freqData = JSON.parse(fs.readFileSync(freqPath, 'utf-8'));
      for (const [word, score] of Object.entries(freqData)) {
        frequencyMap.set(word.toLowerCase(), score);
      }
      console.log(`[WordList] Loaded ${frequencyMap.size} word frequencies from local file`);
    } catch (e) {
      console.log(`[WordList] Local frequency parse failed: ${e.message}`);
    }
  }

  const targetsPath = path.join(DATA_DIR, 'target-words.json');
  if (fs.existsSync(targetsPath)) {
    try {
      const targetsData = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));
      targetWords = [];
      for (const words of Object.values(targetsData)) {
        if (Array.isArray(words)) {
          for (const w of words) {
            const clean = String(w || '').toLowerCase();
            if (clean.length >= 3 && /^[a-z]+$/.test(clean)) targetWords.push(clean);
          }
        }
      }
      console.log(`[WordList] Loaded ${targetWords.length} target words from local file`);
    } catch (e) {
      console.log(`[WordList] Local targets parse failed: ${e.message}`);
    }
  }
  return true;
}

async function init() {
  trie = new Trie();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[WordList] Fetching from Word Bank (attempt ${attempt}/3)...`);
      await loadFromWordBank();
      if (trie.wordCount > 0) return;
      // Word Bank reachable but empty — no point retrying, fall through to local.
      console.log('[WordList] Word Bank reachable but returned 0 words; will use local dictionary');
      break;
    } catch (err) {
      console.log(`[WordList] Word Bank fetch failed (${attempt}/3): ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.log('[WordList] Falling back to local dictionary');
  loadFromLocal();
}

function getTrie() { return trie; }
function isValidWord(word) { return trie ? trie.has(word.toLowerCase()) : false; }
function getFrequencyMap() { return frequencyMap; }
function hasFrequency(word) { return frequencyMap.has(word.toLowerCase()); }
function getWordCount() { return trie ? trie.wordCount : 0; }
function getAllWords() { return trie ? trie.collectWords() : []; }
function getTargetWords() { return targetWords.slice(); }

module.exports = { init, getTrie, isValidWord, getFrequencyMap, hasFrequency, getWordCount, getAllWords, getTargetWords };
