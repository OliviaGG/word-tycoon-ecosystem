const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

const BLOCKED_WORDS_PATH_CANDIDATES = [
  path.join(DATA_DIR, 'blocked-words.json'),
  path.join(
    process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay'),
    'data',
    'blocked-words.json'
  )
];
const BLOCKED_WORDS_PATH = BLOCKED_WORDS_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || BLOCKED_WORDS_PATH_CANDIDATES[0];

let blockedConfig = { exact: [], partial: [], patterns: [] };
let exactSet = new Set();
let partialList = [];
let regexList = [];

const CHAR_SUBS = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '+': 't',
  '(': 'c',
  '|': 'l'
};

function loadBlockedWords() {
  try {
    const raw = JSON.parse(fs.readFileSync(BLOCKED_WORDS_PATH, 'utf8'));
    blockedConfig = {
      exact: Array.isArray(raw.exact) ? raw.exact : [],
      partial: Array.isArray(raw.partial) ? raw.partial : [],
      patterns: Array.isArray(raw.patterns) ? raw.patterns : []
    };
  } catch (error) {
    blockedConfig = { exact: [], partial: [], patterns: [] };
  }

  exactSet = new Set(blockedConfig.exact.map(normalizeProbe));
  partialList = blockedConfig.partial.map(normalizeProbe).filter(Boolean);
  regexList = blockedConfig.patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern, 'i');
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeProbe(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split('')
    .map((char) => CHAR_SUBS[char] || char)
    .join('')
    .replace(/[^a-z0-9$]+/g, '');
}

function sanitizeUsername(value, maxLength = 20) {
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(1, Number(maxLength)) : 20;
  return String(value || '')
    .replace(/[<>"'`]/g, '')
    .replace(/[^a-zA-Z0-9_\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function findBlockedTerm(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!normalized) return null;

  const tokens = normalized
    .split(/[\s_-]+/)
    .map(normalizeProbe)
    .filter(Boolean);
  for (const token of tokens) {
    if (exactSet.has(token)) return token;
  }

  const compact = normalizeProbe(normalized);
  if (!compact) return null;

  for (const fragment of partialList) {
    if (compact.includes(fragment)) return fragment;
  }

  for (const pattern of regexList) {
    if (pattern.test(compact)) return pattern.source;
  }

  return null;
}

function validateUsername(value, options = {}) {
  const maxLength = options.maxLength || 20;
  const minLength = options.minLength || 1;
  const sanitized = sanitizeUsername(value, maxLength);

  if (!sanitized) {
    return {
      ok: false,
      valid: false,
      sanitized: '',
      code: 'empty',
      message: minLength > 1 ? `Username must be at least ${minLength} characters.` : 'Enter a username.'
    };
  }

  if (sanitized.length < minLength) {
    return {
      ok: false,
      valid: false,
      sanitized,
      code: 'too_short',
      message: `Username must be at least ${minLength} characters.`
    };
  }

  const blockedBy = findBlockedTerm(sanitized);
  if (blockedBy) {
    return {
      ok: false,
      valid: false,
      sanitized,
      code: 'blocked',
      blockedBy,
      message: 'That username is not allowed.'
    };
  }

  return {
    ok: true,
    valid: true,
    sanitized
  };
}

function pickSafeName(candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const maxLength = options.maxLength || 20;
  const minLength = options.minLength || 1;

  for (const candidate of list) {
    if (candidate == null || String(candidate).trim() === '') continue;
    const validation = validateUsername(candidate, { maxLength, minLength });
    if (validation.valid) return validation.sanitized;
  }

  return '';
}

loadBlockedWords();

module.exports = {
  BLOCKED_WORDS_PATH,
  sanitizeUsername,
  validateUsername,
  pickSafeName,
  loadBlockedWords
};
