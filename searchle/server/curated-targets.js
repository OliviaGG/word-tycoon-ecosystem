'use strict';

// Subtextle-only additions keep other games' seeded word banks unchanged.
const fs = require('fs');
const path = require('path');
const { resolveRelayOrShared } = require('./shared-resolver');
const DEFAULT_PATH = process.env.SEARCHLE_CURATED_PUBLIC_TARGETS
  || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'curated-public-targets.json');
const DICTIONARY_PATH = process.env.SEARCHLE_BANK_DICT_PATH
  || resolveRelayOrShared('data/word-bank/dictionary.json');

function validateCatalog(catalog, dictionary) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.words))
    throw Error('Invalid curated target catalog');
  const seen = new Set();
  for (const word of catalog.words) {
    if (typeof word !== 'string' || !/^[a-z]{4,}$/.test(word) || seen.has(word))
      throw Error('Curated targets must be unique canonical English words');
    if (!dictionary.has(word)) throw Error('Curated target is outside the English dictionary');
    seen.add(word);
  }
  return [...seen];
}

function readCuratedTargets(file = DEFAULT_PATH, dictionaryFile = DICTIONARY_PATH) {
  if (!fs.existsSync(file)) return [];
  const dictionary = JSON.parse(fs.readFileSync(dictionaryFile, 'utf8'));
  return validateCatalog(JSON.parse(fs.readFileSync(file, 'utf8')),
    new Set(Object.values(dictionary).filter(Array.isArray).flat()));
}

function loadCuratedTargets() {
  try { return readCuratedTargets(); }
  catch (error) {
    console.warn('[CuratedTargets] Supplemental targets unavailable:', error.message);
    return [];
  }
}

function mergeTargets(original, additions, isAllowed = () => true) {
  const merged = original.slice();
  const seen = new Set(merged);
  for (const word of additions) {
    if (!seen.has(word) && isAllowed(word)) { seen.add(word); merged.push(word); }
  }
  return merged;
}

module.exports = { validateCatalog, readCuratedTargets, loadCuratedTargets, mergeTargets };
