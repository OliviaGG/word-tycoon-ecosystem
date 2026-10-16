// ===== Single Player Manager =====
// Server-side source of truth for Searchle solo game selection and pool metadata.

const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const rankingEngine = require('./ranking-engine');
const { loadCuratedTargets } = require('./curated-targets');

const { resolveRelayOrShared } = require('./shared-resolver');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const POOL_DIR = path.join(DATA_DIR, 'sp-pool');
const WIN_HISTORY_PATH = path.join(DATA_DIR, 'sp-win-history.json');
const POOL_INDEX_PATH = path.join(DATA_DIR, 'sp-pool-index.json');

const DIFFICULTIES = new Set(['very-common', 'common', 'normal', 'rare', 'very-rare']);
const DIFFICULTY_ALIASES = {
  'very-easy': 'very-common',
  easy: 'common',
  medium: 'normal',
  hard: 'rare',
  'very-hard': 'very-rare',
};
const DIFFICULTY_ZIPF = {
  'rare': { min: 3.0, max: 4.5 },
  'very-rare': { min: -Infinity, max: 3.0 },
};
const WHITELIST_CONFIG = {
  'very-common': {
    file: process.env.SEARCHLE_VERY_EASY_TARGETS || resolveRelayOrShared('data/word-bank/searchle-very-easy-targets.json'),
    fallbackZipfMin: 5.5,
  },
  'common': {
    file: process.env.SEARCHLE_EASY_TARGETS || resolveRelayOrShared('data/word-bank/searchle-easy-targets.json'),
    fallbackZipfMin: 4.5,
  },
};
const _difficultyWhitelistCache = new Map();

function normalizeDifficulty(raw) {
  const value = String(raw || 'normal').toLowerCase().trim();
  const normalized = DIFFICULTY_ALIASES[value] || value;
  return DIFFICULTIES.has(normalized) ? normalized : 'normal';
}

function _loadDifficultyWhitelist(difficulty) {
  const normalized = normalizeDifficulty(difficulty);
  if (_difficultyWhitelistCache.has(normalized)) return _difficultyWhitelistCache.get(normalized);

  const cfg = WHITELIST_CONFIG[normalized];
  if (!cfg) {
    _difficultyWhitelistCache.set(normalized, new Set());
    return _difficultyWhitelistCache.get(normalized);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(cfg.file, 'utf-8'));
    if (Array.isArray(raw) && raw.length > 0) {
      const words = normalized === 'common' ? [...raw, ...loadCuratedTargets()] : raw;
      const set = new Set(words.map(w => String(w || '').toLowerCase().trim()).filter(Boolean));
      _difficultyWhitelistCache.set(normalized, set);
      console.log(`[SP Pool] Loaded ${normalized} whitelist: ${set.size} words from ${cfg.file}`);
      return set;
    }
  } catch (err) {
    console.warn(`[SP Pool] ${normalized} whitelist load failed: ${err.message}`);
  }

  _difficultyWhitelistCache.set(normalized, new Set());
  return _difficultyWhitelistCache.get(normalized);
}

function _filterEntriesByDifficulty(entries, difficulty) {
  const normalized = normalizeDifficulty(difficulty);
  if (normalized === 'normal' || entries.length === 0) return entries;

  let filtered = [];
  const whitelistCfg = WHITELIST_CONFIG[normalized];
  if (whitelistCfg) {
    const whitelist = _loadDifficultyWhitelist(normalized);
    if (whitelist.size > 0) {
      filtered = entries.filter(entry => whitelist.has(String(entry.word || '').toLowerCase()));
    } else if (typeof rankingEngine.getZipf === 'function') {
      filtered = entries.filter(entry => {
        const z = rankingEngine.getZipf(entry.word);
        return Number.isFinite(z) && z >= whitelistCfg.fallbackZipfMin;
      });
    }
  } else if (DIFFICULTY_ZIPF[normalized] && typeof rankingEngine.getZipf === 'function') {
    const range = DIFFICULTY_ZIPF[normalized];
    filtered = entries.filter(entry => {
      const z = rankingEngine.getZipf(entry.word);
      return Number.isFinite(z) && z >= range.min && z < range.max;
    });
  }

  if (filtered.length > 0) return filtered;
  console.warn(`[SP Pool] difficulty="${normalized}" yielded 0 games from ${entries.length}; using full solo pool`);
  return entries;
}

let _storageBlocked = false;
function atomicWriteSync(filePath, data) {
  if (_storageBlocked) throw Error('Solo storage requires recovery');
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw Error('Unsafe solo storage');
  }
  const tmp = filePath + '.' + crypto.randomUUID() + '.tmp';
  let fd, renamed = false;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, filePath); renamed = true;
    if (process.platform !== 'win32') {
      const dirFd = fs.openSync(path.dirname(filePath), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    }
  } catch (error) {
    if (renamed) _storageBlocked = true;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function ensureDir() {
  if (!fs.existsSync(POOL_DIR)) fs.mkdirSync(POOL_DIR, { recursive: true });
}

function _parsePoolFilename(filename) {
  const match = filename && filename.match(/^pool_(\d+)_(.+)\.json$/);
  if (!match) return null;
  return {
    filename,
    gameId: match[1],
    timestamp: parseInt(match[1], 10),
    word: match[2],
  };
}

function _getPoolFiles() {
  try {
    return fs.readdirSync(POOL_DIR).filter(f => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

function _getPoolEntries() {
  return _getPoolFiles().map(_parsePoolFilename).filter(Boolean);
}

function getPoolInfo() {
  return { total: _getPoolFiles().length };
}

// ---------------------------------------------------------------------------
// Pool Index — sequential word numbers (1, 2, 3, ...)
// Auto-generated on first access by scanning existing pool files.
// ---------------------------------------------------------------------------
let _poolIndex = null; // { nextNumber, words, weeklyNumbers, nextWeeklyNumber, vacantNumbers, weeklyAssignments }

function _loadPoolIndex() {
  if (_poolIndex) return _poolIndex;

  try {
    if (fs.existsSync(POOL_INDEX_PATH)) {
      const data = JSON.parse(fs.readFileSync(POOL_INDEX_PATH, 'utf-8'));
      if (data && data.words && typeof data.nextNumber === 'number') {
        if (!data.weeklyNumbers) data.weeklyNumbers = {};
        if (!data.nextWeeklyNumber) data.nextWeeklyNumber = 1;
        if (!data.vacantNumbers) data.vacantNumbers = [];
        if (!data.weeklyAssignments) data.weeklyAssignments = {};
        if (!data.dailyAssignments) data.dailyAssignments = {};
        _poolIndex = data;
        console.log(`[SP Pool] Loaded index: ${Object.keys(data.words).length} words, next #${data.nextNumber}, ${Object.keys(data.weeklyNumbers).length} weekly`);
        return _poolIndex;
      }
    }
  } catch {}

  console.log('[SP Pool] Building index from existing pool files...');
  const entries = _getPoolEntries().sort((a, b) => a.timestamp - b.timestamp);

  const words = {};
  let num = 1;
  for (const entry of entries) {
    if (!words[entry.word]) {
      words[entry.word] = num++;
    }
  }

  _poolIndex = { nextNumber: num, words, weeklyNumbers: {}, nextWeeklyNumber: 1, vacantNumbers: [], weeklyAssignments: {}, dailyAssignments: {} };
  _savePoolIndex();
  console.log(`[SP Pool] Built index: ${Object.keys(words).length} words, next #${num}`);
  return _poolIndex;
}

function _savePoolIndex() {
  if (!_poolIndex) return;
  try {
    atomicWriteSync(POOL_INDEX_PATH, _poolIndex);
  } catch (err) {
    console.error('[SP Pool] Failed to save index:', err.message);
  }
}

function getWordNumber(word) {
  const idx = _loadPoolIndex();
  return idx.words[word] || null;
}

function getPoolIndex() {
  return _loadPoolIndex();
}

// ---------------------------------------------------------------------------
// Weekly Number Assignment — separate numbering for weekly words
// When a word becomes weekly, its pool number is freed as vacant.
// ---------------------------------------------------------------------------
function assignWeeklyNumber(word) {
  const idx = _loadPoolIndex();
  if (idx.weeklyNumbers[word]) return idx.weeklyNumbers[word];

  const weeklyNum = idx.nextWeeklyNumber++;
  idx.weeklyNumbers[word] = weeklyNum;

  if (idx.words[word]) {
    idx.vacantNumbers.push(idx.words[word]);
    idx.vacantNumbers.sort((a, b) => a - b);
    delete idx.words[word];
    console.log(`[SP Pool] Word "${word}" moved from pool #${idx.vacantNumbers[idx.vacantNumbers.length - 1]} to Weekly #${weeklyNum}`);
  } else {
    console.log(`[SP Pool] Word "${word}" assigned Weekly #${weeklyNum}`);
  }

  _savePoolIndex();
  return weeklyNum;
}

function getWeeklyNumber(word) {
  const idx = _loadPoolIndex();
  return idx.weeklyNumbers[word] || null;
}

function getGameMetaByWord(word) {
  const filename = findPoolFileByWord(word);
  if (!filename) return null;
  const entry = _parsePoolFilename(filename);
  if (!entry) return null;

  const weeklyNumber = getWeeklyNumber(word);
  const isWeekly = !!weeklyNumber;
  const wordNumber = isWeekly ? null : getWordNumber(word);
  const gameKey = isWeekly ? `weekly:${weeklyNumber}` : `game:${wordNumber || entry.gameId}`;

  return {
    gameId: entry.gameId,
    gameKey,
    filename: entry.filename,
    word,
    wordNumber,
    weeklyNumber: weeklyNumber || null,
    isWeekly,
  };
}

function getGameMetaById(gameId) {
  const filename = findPoolFileByGameId(gameId);
  if (!filename) return null;
  const entry = _parsePoolFilename(filename);
  return entry ? getGameMetaByWord(entry.word) : null;
}

function pickPoolFile(playedWords) {
  const files = _getPoolFiles();
  if (files.length === 0) return null;

  const playedSet = new Set(playedWords || []);
  const available = files.filter(f => {
    const match = f.match(/^pool_\d+_(.+)\.json$/);
    return match && !playedSet.has(match[1]);
  });

  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function pickPoolGame(playedGameKeys, playedWords, difficulty = 'normal') {
  const idx = _loadPoolIndex();
  const weeklyWords = new Set(Object.keys(idx.weeklyNumbers || {}));
  const playedSet = new Set(playedGameKeys || []);
  const playedWordSet = new Set((playedWords || []).map(w => String(w || '').toLowerCase()));

  const available = _filterEntriesByDifficulty(_getPoolEntries().filter(entry => {
    if (weeklyWords.has(entry.word)) return false;
    if (playedWordSet.has(String(entry.word || '').toLowerCase())) return false;
    const wordNumber = idx.words[entry.word];
    const gameKey = `game:${wordNumber || entry.gameId}`;
    return !playedSet.has(gameKey);
  }), difficulty);

  if (available.length === 0) return null;
  const picked = available[Math.floor(Math.random() * available.length)];
  return getGameMetaByWord(picked.word);
}

// ---------------------------------------------------------------------------
// Save to Pool (called by multiplayer game-manager)
// Stores the full rankings Map — every embedding-vocab word with a rank.
// (Previously trimmed to top 100k; that made low-similarity-but-real-English
// guesses like "porky" show as 9999999 → "invalid" on replays. Storage grew
// ~3.4× as a result. Pool files created before this change still carry the
// old 100k cap and would need to be recomputed to fix retroactively.)
// ---------------------------------------------------------------------------

function saveToPool(targetWord, rankings) {
  ensureDir();
  const files = _getPoolFiles();
  if (files.some(f => f.includes(`_${targetWord}.json`))) return null;

  const filename = `pool_${Date.now()}_${targetWord}.json`;
  const filepath = path.join(POOL_DIR, filename);
  try {
    let fullObj;
    let totalWords;
    if (rankings instanceof Map) {
      fullObj = {};
      for (const [word, rank] of rankings) fullObj[word] = rank;
      totalWords = rankings.size;
    } else {
      fullObj = rankings._obj || rankings;
      totalWords = rankings.size || Object.keys(fullObj).length;
    }

    atomicWriteSync(filepath, {
      targetWord,
      rankings: fullObj,
      totalRankedWords: totalWords,
    });

    const idx = _loadPoolIndex();
    if (!idx.words[targetWord]) {
      if (idx.vacantNumbers.length > 0) {
        idx.words[targetWord] = idx.vacantNumbers.shift();
      } else {
        idx.words[targetWord] = idx.nextNumber++;
      }
      _savePoolIndex();
    }

    const wordNumber = idx.words[targetWord];
    console.log(`[SP Pool] Saved "${targetWord}" #${wordNumber} to pool → ${filename} (${Object.keys(fullObj).length} entries, ${totalWords} total)`);
    return { word: targetWord, wordNumber };
  } catch (err) {
    console.error('[SP Pool] Failed to save to pool:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Win History
// ---------------------------------------------------------------------------
let _winHistoryCache = null;

function loadWinHistory() {
  if (_storageBlocked) throw Error('Solo storage requires recovery');
  if (_winHistoryCache) return _winHistoryCache;
  try {
    if (!fs.existsSync(WIN_HISTORY_PATH)) {
      _winHistoryCache = [];
      return [];
    }
    const stat = fs.lstatSync(WIN_HISTORY_PATH);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error('Unsafe solo history');
    const data = JSON.parse(fs.readFileSync(WIN_HISTORY_PATH, 'utf-8'));
    if (!Array.isArray(data) || data.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw Error('Invalid solo history');
    _winHistoryCache = data;
    return _winHistoryCache;
  } catch (error) {
    throw Error('Solo history unavailable', { cause: error });
  }
}

function recordWin(entry) {
  const history = loadWinHistory();
  if (entry.completionId) {
    if (!/^[a-f0-9]{64}$/.test(entry.completionId)) throw Error('Invalid solo completion ID');
    const existing = history.find(win => win.completionId === entry.completionId);
    if (existing) {
      if (existing.userId !== entry.userId || existing.word !== entry.word) throw Error('Solo history receipt reused');
      return { completionId: entry.completionId };
    }
  }
  const row = { ...entry, timestamp: entry.timestamp || new Date().toISOString() };
  const next = [...history, row];
  atomicWriteSync(WIN_HISTORY_PATH, next);
  _winHistoryCache = next;
  return { completionId: entry.completionId || null };
}

function findPoolFileByWord(word) {
  const suffix = `_${word}.json`;
  return _getPoolFiles().find(f => f.endsWith(suffix)) || null;
}

function findPoolFileByGameId(gameId) {
  const wanted = String(gameId || '');
  for (const entry of _getPoolEntries()) {
    if (entry.gameId === wanted) return entry.filename;
  }
  return null;
}

function getWeeklyPoolFile(weekStart) {
  const idx = _loadPoolIndex();

  if (idx.weeklyAssignments[weekStart]) {
    const word = idx.weeklyAssignments[weekStart];
    const filename = findPoolFileByWord(word);
    if (filename) return { filename, word };
  }

  const files = _getPoolFiles();
  if (files.length === 0) return null;

  let hash = 0;
  for (let i = 0; i < weekStart.length; i++) {
    hash = ((hash << 5) - hash + weekStart.charCodeAt(i)) | 0;
  }
  const fileIdx = Math.abs(hash) % files.length;
  const filename = files[fileIdx];
  const match = filename.match(/^pool_\d+_(.+)\.json$/);
  if (!match) return null;

  idx.weeklyAssignments[weekStart] = match[1];
  _savePoolIndex();

  return { filename, word: match[1] };
}

// ---------------------------------------------------------------------------
// Daily puzzle — one shared word per calendar day.
//
// Same recipe as the weekly (hash the date string, index into the pool file
// list, then pin the result in the index so the puzzle can never move
// mid-day), with a different hash seed so the daily and the weekly don't
// land on the same word. Because the mapping is deterministic AND pinned,
// "yesterday's daily" is always recoverable for the archive.
const DAILY_EPOCH = '2026-08-01';   // Daily #1. Do not change — renumbers history.

// 'YYYY-MM-DD' in the fleet's canonical daily timezone. Do not use UTC here:
// Pacific/Mountain players would otherwise roll into tomorrow's puzzle early.
function getDailyDateString(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const out = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${out.year}-${out.month}-${out.day}`;
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
}

function getDailyNumber(dayStart) {
  const then = Date.parse(dayStart + 'T00:00:00Z');
  const epoch = Date.parse(DAILY_EPOCH + 'T00:00:00Z');
  if (!Number.isFinite(then) || !Number.isFinite(epoch)) return null;
  const n = Math.floor((then - epoch) / 86400000) + 1;
  return n > 0 ? n : null;
}

// Resolve (and pin) the pool file backing a given day.
//
// `avoidWord` (the current weekly) is applied only when the day is first
// assigned — an existing pin always wins, because a past daily must never
// change once players have seen it. A pinned daily can therefore coincide
// with a *later* weekly; that is harmless (same word, two entry points) and
// far cheaper than rewriting history.
//
// Returns null when the pool is empty.
function getDailyPoolFile(dayStart, avoidWord = null) {
  const idx = _loadPoolIndex();
  if (!idx.dailyAssignments) idx.dailyAssignments = {};

  const pinned = idx.dailyAssignments[dayStart];
  if (pinned) {
    const filename = findPoolFileByWord(pinned);
    if (filename) return { filename, word: pinned };
  }

  const files = _getPoolFiles();
  if (files.length === 0) return null;

  let hash = 0;
  const seed = 'daily:' + dayStart;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const start = Math.abs(hash) % files.length;

  for (let attempt = 0; attempt < files.length; attempt++) {
    const filename = files[(start + attempt) % files.length];
    const match = filename.match(/^pool_\d+_(.+)\.json$/);
    if (!match) continue;
    if (avoidWord && match[1] === avoidWord) continue;
    idx.dailyAssignments[dayStart] = match[1];
    _savePoolIndex();
    return { filename, word: match[1] };
  }
  return null;
}

// Past dailies, newest first, for the (Donor-gated) archive. Only days on or
// after DAILY_EPOCH exist, and today is excluded — it lives on its own card.
// Never returns the answer word.
function listDailyArchive(limit = 30, todayStr = getDailyDateString(), avoidWord = null) {
  const out = [];
  const today = Date.parse(todayStr + 'T00:00:00Z');
  if (!Number.isFinite(today)) return out;

  for (let back = 1; back <= limit; back++) {
    const dayStart = new Date(today - back * 86400000).toISOString().slice(0, 10);
    const dailyNumber = getDailyNumber(dayStart);
    if (!dailyNumber) break;                       // walked past DAILY_EPOCH
    const pick = getDailyPoolFile(dayStart, avoidWord);
    if (!pick) continue;
    const meta = getGameMetaByWord(pick.word);
    if (!meta) continue;
    out.push({ date: dayStart, dailyNumber, gameId: meta.gameId, length: pick.word.length });
  }
  return out;
}

// Past weeklies, newest first. Never returns the answer word.
function listWeeklyArchive(limit = 60, currentWeeklyWord = null) {
  const idx = _loadPoolIndex();
  const out = [];
  for (const [word, weeklyNumber] of Object.entries(idx.weeklyNumbers || {})) {
    if (currentWeeklyWord && word === currentWeeklyWord) continue;
    const meta = getGameMetaByWord(word);
    if (!meta) continue;
    out.push({ weeklyNumber, gameId: meta.gameId, length: word.length });
  }
  out.sort((a, b) => b.weeklyNumber - a.weeklyNumber);
  return out.slice(0, limit);
}

const _poolPayloadCache = new Map();

function loadPoolGameById(gameId) {
  const wanted = String(gameId || '');
  if (_poolPayloadCache.has(wanted)) return _poolPayloadCache.get(wanted);

  const meta = getGameMetaById(wanted);
  if (!meta) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, meta.filename), 'utf-8'));
    const rankingsObj = raw.rankings || {};
    const payload = {
      ...meta,
      targetWord: raw.targetWord,
      rankings: new Map(Object.entries(rankingsObj)),
      totalRankedWords: raw.totalRankedWords || Object.keys(rankingsObj).length,
    };
    _poolPayloadCache.set(wanted, payload);
    return payload;
  } catch (err) {
    console.error(`[SP Pool] Failed to load game ${wanted}:`, err.message);
    return null;
  }
}

function getPoolBrowserGames(currentWeeklyWord, difficulty = 'normal') {
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const includeWeekly = normalizedDifficulty === 'normal';
  const entries = _getPoolEntries();
  const visibleEntries = _filterEntriesByDifficulty(entries, normalizedDifficulty);
  const visibleWords = new Set(visibleEntries.map(entry => entry.word));
  const games = [];
  for (const entry of entries) {
    const isCurrent = includeWeekly && currentWeeklyWord && entry.word === currentWeeklyWord;
    if (!isCurrent && !visibleWords.has(entry.word)) continue;

    const meta = getGameMetaByWord(entry.word);
    if (!meta) continue;
    if (meta.weeklyNumber && !includeWeekly) continue;
    // Only the current weekly word should appear as weekly in the browser
    games.push({
      gameId: meta.gameId,
      gameKey: isCurrent ? meta.gameKey : `game:${meta.wordNumber || meta.gameId}`,
      word: entry.word,
      wordNumber: isCurrent ? meta.weeklyNumber : (meta.wordNumber || meta.weeklyNumber),
      weeklyNumber: meta.weeklyNumber || null,
      isWeekly: isCurrent,
      isArchivedWeekly: !!meta.weeklyNumber && !isCurrent,
    });
  }
  return games;
}

module.exports = {
  getStorageStatus: () => ({ blocked: _storageBlocked }),
  ensureDir,
  getPoolInfo,
  normalizeDifficulty,
  pickPoolFile,
  pickPoolGame,
  findPoolFileByWord,
  findPoolFileByGameId,
  getWeeklyPoolFile,
  saveToPool,
  loadWinHistory,
  recordWin,
  getWordNumber,
  getWeeklyNumber,
  assignWeeklyNumber,
  getPoolIndex,
  getGameMetaByWord,
  getGameMetaById,
  loadPoolGameById,
  getPoolBrowserGames,
  getDailyDateString,
  getDailyNumber,
  getDailyPoolFile,
  listDailyArchive,
  listWeeklyArchive,
};
