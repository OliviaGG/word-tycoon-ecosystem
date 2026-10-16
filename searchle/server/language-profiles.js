// ===== Searchle Language Profiles =====
// Keeps non-English mode selection out of the public multiplayer path.

const fs = require('fs');
const path = require('path');

const config = require('./config');

const DEFAULT_LANGUAGE = 'en';
const LANGUAGE_ALIASES = new Map([
  ['en', 'en'],
  ['english', 'en'],
  ['pt', 'pt-br'],
  ['ptbr', 'pt-br'],
  ['pt-br', 'pt-br'],
  ['pt_br', 'pt-br'],
  ['br', 'pt-br'],
  ['brazilian', 'pt-br'],
  ['portuguese', 'pt-br'],
  ['português', 'pt-br'],
]);

const _targetCache = new Map();

function normalizeLanguageId(rawLanguage) {
  const value = String(rawLanguage || '').trim().toLowerCase();
  return LANGUAGE_ALIASES.get(value) || DEFAULT_LANGUAGE;
}

function getLanguageProfile(rawLanguage) {
  const id = normalizeLanguageId(rawLanguage);
  if (id === DEFAULT_LANGUAGE) {
    return {
      id: DEFAULT_LANGUAGE,
      label: 'English',
      isDefault: true,
      guessPattern: config.guessPattern,
      rankingOptions: null,
    };
  }

  const profile = config.languageProfiles && config.languageProfiles[id];
  if (!profile) return getLanguageProfile(DEFAULT_LANGUAGE);

  return {
    id,
    label: profile.label || id,
    isDefault: false,
    guessPattern: profile.guessPattern || /^[\p{L}]+$/u,
    rankingOptions: {
      modelNames: Array.isArray(profile.activeModels) ? profile.activeModels : [],
      modelWeights: profile.modelWeights || null,
      rrfK: profile.rrfK || null,
      singularFilter: profile.singularFilter !== false,
    },
    targetPools: profile.targetPools || {},
  };
}

function _readTargetPool(filePath) {
  const resolved = path.resolve(filePath);
  if (_targetCache.has(resolved)) return _targetCache.get(resolved);

  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const words = Array.isArray(data)
    ? [...new Set(data.map(w => String(w || '').trim().toLocaleLowerCase('pt-BR')).filter(Boolean))]
    : [];
  _targetCache.set(resolved, words);
  return words;
}

function getTargetPool(rawLanguage, difficulty = 'normal') {
  const profile = getLanguageProfile(rawLanguage);
  if (profile.isDefault) return null;

  const pools = profile.targetPools || {};
  const key = pools[difficulty] ? difficulty : 'normal';
  const filePath = pools[key];
  if (!filePath) return [];

  try {
    return _readTargetPool(filePath);
  } catch (err) {
    console.warn(`[Language] Failed to load ${profile.id} ${key} target pool: ${err.message}`);
    return [];
  }
}

function getRankingOptions(rawLanguage) {
  return getLanguageProfile(rawLanguage).rankingOptions || null;
}

function normalizeGuessText(rawInput, rawLanguage) {
  const profile = getLanguageProfile(rawLanguage);
  const raw = String(rawInput || '').trim().normalize('NFC').toLocaleLowerCase(profile.id === 'pt-br' ? 'pt-BR' : 'en-US');
  if (!raw || raw.includes(' ') || raw.includes('\t')) return null;

  if (profile.id === 'pt-br') {
    const text = raw.replace(/[^\p{L}]/gu, '');
    if (!text || !profile.guessPattern.test(text)) return null;
    return text;
  }

  const text = raw.replace(/[^a-z]/g, '');
  if (!text || !profile.guessPattern.test(text)) return null;
  return text;
}

module.exports = {
  DEFAULT_LANGUAGE,
  normalizeLanguageId,
  getLanguageProfile,
  getTargetPool,
  getRankingOptions,
  normalizeGuessText,
};
