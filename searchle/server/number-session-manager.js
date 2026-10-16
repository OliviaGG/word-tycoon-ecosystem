const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const SAVE_PATH = path.join(DATA_DIR, 'number-session-state.json');

const MIN_NUMBER = 1;
const MAX_NUMBER = 1_000_000;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SESSIONS = 497;
const SAVE_DEBOUNCE_MS = 2000;

const RANK_REWARDS = {
  1: 100000,
  2: 90000,
  3: 80000,
  4: 70000,
  5: 60000,
  6: 50000,
  7: 40000,
  8: 30000,
  9: 20000,
  10: 10000,
};
const BASE_GUESS_XP = 200;
const MAX_CLIMB_BONUS = 8000;

const sessions = new Map();
let recovery = null;
function setRecovery(value) {
  recovery = value;
  sessions.clear();
  const migrated = recovery.load('public')?.meta.numberSessionsMigrated;
  if (!migrated) {
    init();
    for (const session of sessions.values()) {
      if (!recovery.load('session:' + session.handle)) recovery.start(session, 'session:' + session.handle, { handle: session.handle }, true);
    }
  }
  sessions.clear();
  for (const scope of recovery.journal.scopes().filter(key => key.startsWith('session:'))) {
    const handle = scope.slice(8);
    if (!/^[a-z0-9_-]{1,32}$/.test(handle)) throw Error('Invalid accepted Number Searchle handle');
    const record = recovery.load(scope);
    if (record.meta.ended) continue;
    const session = makeFreshSession(handle, null);
    recovery.adopt(session, record); sessions.set(handle, session);
  }
}
let _saveTimer = null;

function formatNumber(value) {
  return Number(value).toLocaleString('en-US');
}

function nowIso() {
  return new Date().toISOString();
}

function randomTarget() {
  return Math.floor(Math.random() * MAX_NUMBER) + MIN_NUMBER;
}

function isWinningGuess(numericValue, targetNumber) {
  if (!Number.isFinite(numericValue) || !Number.isFinite(targetNumber) || targetNumber <= 0) return false;
  return Math.abs(numericValue - targetNumber) <= (targetNumber * 0.05);
}

function numberSideForValue(numericValue, targetNumber) {
  if (!Number.isFinite(numericValue) || !Number.isFinite(targetNumber)) return null;
  if (numericValue < targetNumber) return 'below';
  if (numericValue > targetNumber) return 'above';
  return 'target';
}

function normalizeStoredGuess(guess, targetNumber) {
  if (!guess || typeof guess !== 'object') return guess;
  const numericValue = Number.isFinite(guess.numericValue)
    ? guess.numericValue
    : parseGuess(guess.valueKey || guess.word || '');
  if (!Number.isFinite(numericValue)) return guess;
  return {
    ...guess,
    numericValue,
    valueKey: guess.valueKey || String(numericValue),
    numberSide: guess.numberSide || numberSideForValue(numericValue, targetNumber),
  };
}

function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function proximityPoints(rank) {
  if (!Number.isFinite(rank)) return 0;
  if (rank <= 10) return 15000;
  if (rank <= 100) return 5000;
  if (rank <= 1000) return 2000;
  if (rank <= 10000) return 750;
  if (rank <= 100000) return 300;
  if (rank <= 500000) return 100;
  return 0;
}

function climbBonus(currentBest, newRank) {
  if (!Number.isFinite(newRank) || newRank < 11 || newRank > 10000) return 0;
  const oldBest = (Number.isFinite(currentBest) && currentBest <= 10001) ? currentBest : 10001;
  if (newRank >= oldBest) return 0;
  const fractionClosed = 1 - (newRank / oldBest);
  return Math.floor(MAX_CLIMB_BONUS * fractionClosed);
}

function computeRankAward(rank, alreadyTaken, currentBestNonTop10) {
  const baseAward = BASE_GUESS_XP + proximityPoints(rank);
  if (rank >= 1 && rank <= 10) {
    if (!alreadyTaken) return Math.max(baseAward, RANK_REWARDS[rank]);
    return baseAward;
  }
  return baseAward + climbBonus(currentBestNonTop10, rank);
}

function identityKeyFor(user) {
  if (!user) return null;
  if (user.linkedDiscord) return 'discord:' + user.linkedDiscord;
  const platform = user.platform || 'web';
  const platformUserId = user.platformUserId || user.id;
  if (!platformUserId) return null;
  return platform + ':' + platformUserId;
}

function normalizeUser(user, platform) {
  const src = user && typeof user === 'object' ? user : {};
  const srcPlatform = String(platform || src.platform || 'web').toLowerCase();
  const srcId = String(src.platformUserId || src.id || src.userId || '').trim();
  const displayName = String(src.displayName || src.username || 'Player').trim() || 'Player';
  const username = String(src.username || displayName).trim() || displayName;
  const linkedDiscord = src.linkedDiscord
    ? String(src.linkedDiscord)
    : (srcPlatform === 'discord' && srcId ? srcId : null);
  return {
    ...src,
    id: srcId || src.id || displayName.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'player',
    platform: srcPlatform,
    platformUserId: srcId || src.platformUserId || src.id || null,
    displayName,
    username,
    linkedDiscord,
    profilePic: src.profilePic || null,
    cosmetics: src.cosmetics || null,
  };
}

function parseGuess(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = Number.parseInt(digits, 10);
  if (!Number.isFinite(value) || value < MIN_NUMBER || value > MAX_NUMBER) return null;
  return value;
}

function makeFreshSession(handle, sessionId) {
  return {
    handle,
    sessionId: sessionId || null,
    targetNumber: randomTarget(),
    guesses: [],
    guessedValues: new Set(),
    startTime: nowIso(),
    isWon: false,
    winner: null,
    lastWinner: {
      user: null,
      word: null,
      guessCount: 0,
      targetFinder: null,
      podium: [],
    },
    playerScores: new Map(),
    paidTopRanks: new Set(),
    bestNonTop10Rank: Infinity,
    lastActivityAt: Date.now(),
  };
}

function getPodium(session, limit = 7) {
  if (!session || !session.playerScores) return [];
  const all = [...session.playerScores.values()];
  all.sort((a, b) => b.xp - a.xp);
  return all.slice(0, limit).map((entry, idx) => ({
    rank: idx + 1,
    identityKey: entry.identityKey,
    displayName: entry.displayName,
    profilePic: entry.profilePic,
    platform: entry.platform,
    platformUserId: entry.platformUserId,
    linkedDiscord: entry.linkedDiscord,
    cosmetics: entry.cosmetics || null,
    xp: entry.xp,
  }));
}

function buildSessionState(session) {
  if (!session) return null;
  return {
    targetWord: session.isWon ? formatNumber(session.targetNumber) : null,
    guesses: session.guesses,
    totalRankedWords: MAX_NUMBER,
    startTime: session.startTime,
    isWon: session.isWon,
    winner: session.winner,
    lastWinner: session.lastWinner,
    podium: getPodium(session, 7),
    isSession: true,
    sessionHandle: session.handle,
    isDaily: false,
    jackpotEnabled: false,
    completion: recovery?.current(session)?.completion || null,
  };
}

function calculateSessionPot(session) {
  const guesses = session.guesses.length;
  const seconds = (Date.now() - new Date(session.startTime).getTime()) / 1000;
  let guessBonus = guesses <= 1000 ? guesses * 10 : 10000 * Math.pow(guesses / 1000, 1.5);
  let timeBonus = seconds <= 600 ? (seconds / 600) * 10000 : 10000 * Math.pow(seconds / 600, 1.5);
  const activityPot = Math.max(3000, Math.round(guessBonus + timeBonus));
  const leader = getPodium(session, 1)[0];
  const leaderXp = leader ? leader.xp : 0;
  return Math.max(activityPot, leaderXp);
}

function awardForGuess(session, rank, user) {
  const key = identityKeyFor(user);
  if (!key || !session) return { pts: 0, total: 0 };

  const isTopRank = rank >= 1 && rank <= 10;
  const slotTaken = isTopRank ? session.paidTopRanks.has(rank) : false;
  const currentBest = session.bestNonTop10Rank;
  const pts = computeRankAward(rank, slotTaken, currentBest);
  if (pts <= 0) {
    const existing = session.playerScores.get(key);
    return { pts: 0, total: existing ? existing.xp : 0 };
  }

  if (isTopRank && !slotTaken) session.paidTopRanks.add(rank);
  if (rank >= 11 && rank <= 10000 && rank < currentBest) {
    session.bestNonTop10Rank = rank;
  }

  let entry = session.playerScores.get(key);
  if (!entry) {
    entry = {
      identityKey: key,
      displayName: user.displayName,
      profilePic: user.profilePic || null,
      platform: user.platform || 'web',
      platformUserId: user.platformUserId || user.id || null,
      linkedDiscord: user.linkedDiscord || null,
      cosmetics: user.cosmetics || null,
      xp: 0,
    };
    session.playerScores.set(key, entry);
  } else {
    entry.displayName = user.displayName || entry.displayName;
    entry.profilePic = user.profilePic || entry.profilePic;
    entry.platform = user.platform || entry.platform;
    entry.platformUserId = user.platformUserId || user.id || entry.platformUserId;
    entry.linkedDiscord = user.linkedDiscord || entry.linkedDiscord;
    if (user.cosmetics) entry.cosmetics = user.cosmetics;
  }

  entry.xp += pts;
  return { pts, total: entry.xp };
}

function getWinnerFromScores(session, targetFinder) {
  const scoringPlayers = [...session.playerScores.values()];
  const targetFinderKey = identityKeyFor(targetFinder);
  let topEntry = null;
  for (const player of scoringPlayers) {
    if (!topEntry) {
      topEntry = player;
      continue;
    }
    if (player.xp > topEntry.xp) {
      topEntry = player;
      continue;
    }
    if (player.xp === topEntry.xp && player.identityKey === targetFinderKey) {
      topEntry = player;
    }
  }
  const winner = topEntry ? {
    displayName: topEntry.displayName,
    username: topEntry.displayName,
    profilePic: topEntry.profilePic || null,
    platform: topEntry.platform,
    platformUserId: topEntry.platformUserId,
    linkedDiscord: topEntry.linkedDiscord || null,
    cosmetics: topEntry.cosmetics || null,
  } : targetFinder;
  return { winner, scoringPlayers };
}

function setSessionWinner(session, guess, word) {
  session.isWon = true;
  const { winner } = getWinnerFromScores(session, guess.user);
  session.winner = winner;
  const guessCount = session.guesses.length;
  const durationSeconds = session.startTime
    ? Math.max(0, Math.round((Date.now() - new Date(session.startTime).getTime()) / 1000))
    : null;
  const podiumSnap = getPodium(session, 7);
  session.lastWinner = {
    user: winner,
    word,
    guessCount,
    targetFinder: guess.user,
    podium: podiumSnap,
  };
  session.lastActivityAt = Date.now();
  scheduleSave();
  return { guessCount, durationSeconds, pot: calculateSessionPot(session) };
}

function startNextSessionRound(session) {
  if (sessions.get(session.handle) !== session) throw Error('Obsolete Number Searchle session');
  const candidate = { ...makeFreshSession(session.handle, session.sessionId), lastWinner: session.lastWinner };
  if (recovery) {
    const record = recovery.start(candidate, 'session:' + session.handle, { handle: session.handle });
    Object.assign(session, candidate); recovery.adopt(session, record);
  } else Object.assign(session, candidate);
  scheduleSave();
  return session;
}

function _trimSessions() {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (!session || (now - (session.lastActivityAt || now)) > SESSION_TTL_MS) {
      endSession(key);
    }
  }
  if (sessions.size <= MAX_SESSIONS) return;
  const sorted = [...sessions.entries()].sort((a, b) => (a[1].lastActivityAt || 0) - (b[1].lastActivityAt || 0));
  while (sessions.size > MAX_SESSIONS && sorted.length) {
    const [key] = sorted.shift();
    endSession(key);
  }
}

function _serializeSession(session) {
  return {
    handle: session.handle,
    sessionId: session.sessionId || null,
    targetNumber: session.targetNumber,
    guesses: session.guesses,
    guessedValues: [...session.guessedValues],
    startTime: session.startTime,
    isWon: !!session.isWon,
    winner: session.winner || null,
    lastWinner: session.lastWinner || null,
    playerScores: [...session.playerScores.values()],
    paidTopRanks: [...session.paidTopRanks],
    bestNonTop10Rank: Number.isFinite(session.bestNonTop10Rank) ? session.bestNonTop10Rank : null,
    lastActivityAt: session.lastActivityAt || Date.now(),
  };
}

function _restoreSession(saved) {
  if (!saved || typeof saved.handle !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(saved.handle)
      || !Number.isInteger(saved.targetNumber) || saved.targetNumber < MIN_NUMBER || saved.targetNumber > MAX_NUMBER
      || !Array.isArray(saved.guesses) || saved.guesses.length > 10000
      || !Number.isFinite(Date.parse(saved.startTime)) || typeof saved.isWon !== 'boolean') {
    throw Error('Invalid legacy Number Searchle session');
  }
  const session = makeFreshSession(saved.handle, saved.sessionId || null);
  session.targetNumber = saved.targetNumber;
  session.guesses = Array.isArray(saved.guesses)
    ? saved.guesses
        .map((guess) => normalizeStoredGuess(guess, session.targetNumber))
        .filter(Boolean)
    : [];
  session.guessedValues = new Set(Array.isArray(saved.guessedValues) ? saved.guessedValues : []);
  session.startTime = saved.startTime || nowIso();
  session.isWon = !!saved.isWon;
  session.winner = saved.winner || null;
  session.lastWinner = saved.lastWinner || session.lastWinner;
  session.playerScores = new Map();
  for (const entry of Array.isArray(saved.playerScores) ? saved.playerScores : []) {
    if (!entry || !entry.identityKey) continue;
    session.playerScores.set(entry.identityKey, entry);
  }
  session.paidTopRanks = new Set(Array.isArray(saved.paidTopRanks) ? saved.paidTopRanks : []);
  session.bestNonTop10Rank = Number.isFinite(saved.bestNonTop10Rank) ? saved.bestNonTop10Rank : Infinity;
  session.lastActivityAt = Number.isFinite(saved.lastActivityAt) ? saved.lastActivityAt : Date.now();
  return session;
}

function _saveNow() {
  try {
    _trimSessions();
    const payload = {
      sessions: [...sessions.values()].map(_serializeSession),
    };
    atomicWriteSync(SAVE_PATH, payload);
  } catch (err) {
    console.error('[NumberSession] Failed to save:', err.message);
  }
}

function scheduleSave() {
  if (recovery?.isRunning()) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    _saveNow();
  }, SAVE_DEBOUNCE_MS);
}

function init() {
  try {
    if (!fs.existsSync(SAVE_PATH)) return;
    const stat = fs.lstatSync(SAVE_PATH);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 12 * 1024 * 1024) throw Error('Invalid legacy Number Searchle collection');
    const raw = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
    if (!raw || !Array.isArray(raw.sessions) || raw.sessions.length > MAX_SESSIONS) throw Error('Invalid legacy Number Searchle collection');
    for (const saved of raw.sessions) {
      const restored = _restoreSession(saved);
      if (sessions.has(restored.handle)) throw Error('Duplicate legacy Number Searchle session');
      sessions.set(restored.handle, restored);
    }
    _trimSessions();
  } catch (err) {
    throw new Error('Number Searchle sessions need recovery', { cause: err });
  }
}

function getOrCreateSession({ handle, sessionId }) {
  const key = String(handle || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(key)) throw new Error('Invalid Number Searchle handle');
  _trimSessions();
  let session = sessions.get(key);
  if (!session) {
    session = makeFreshSession(key, sessionId || null);
    if (sessions.size >= MAX_SESSIONS) throw Error('Number Searchle session capacity reached');
    if (recovery) recovery.start(session, 'session:' + key, { handle: key });
    sessions.set(key, session);
    scheduleSave();
  } else if (sessionId && !session.sessionId) {
    session.sessionId = sessionId;
    scheduleSave();
  }
  session.lastActivityAt = Date.now();
  return session;
}

function getSession(handle) {
  if (!handle) return null;
  _trimSessions();
  return sessions.get(String(handle).toLowerCase()) || null;
}

function endSession(handle) {
  if (!handle) return false;
  const key = String(handle).toLowerCase();
  const had = sessions.has(key);
  if (had && recovery) recovery.retire('session:' + key);
  sessions.delete(key);
  if (had) scheduleSave();
  return had;
}

function listSessions() {
  return [...sessions.values()].map((session) => ({
    handle: session.handle,
    sessionId: session.sessionId,
    targetWord: session.isWon ? formatNumber(session.targetNumber) : null,
    guessCount: session.guesses.length,
    isWon: session.isWon,
    startTime: session.startTime,
  }));
}

function processGuessUncommitted(session, msg) {
  session.lastActivityAt = Date.now();
  if (session.isWon) return { type: 'ignored' };

  const numericValue = parseGuess(msg && msg.message);
  if (!numericValue) return { type: 'invalid' };

  const user = normalizeUser(msg && msg.user, msg && msg.platform);
  const valueKey = String(numericValue);
  const display = formatNumber(numericValue);
  const existingIdx = session.guesses.findIndex((guess) => guess && guess.valueKey === valueKey);

  if (existingIdx !== -1) {
    const bumped = session.guesses.splice(existingIdx, 1)[0];
    bumped.timestamp = nowIso();
    bumped.lastBumper = user;
    session.guesses.push(bumped);
    scheduleSave();
    return { type: 'bump', word: display, bumper: user };
  }

  const rank = Math.abs(numericValue - session.targetNumber) + 1;
  const award = awardForGuess(session, rank, user);
  const guess = {
    word: display,
    valueKey,
    numericValue,
    numberSide: numberSideForValue(numericValue, session.targetNumber),
    rank,
    timestamp: nowIso(),
    user,
  };
  session.guesses.push(guess);
  session.guessedValues.add(valueKey);

  if (isWinningGuess(numericValue, session.targetNumber)) {
    const meta = setSessionWinner(session, guess, formatNumber(session.targetNumber));
    return {
      type: 'win',
      guess,
      award,
      word: formatNumber(session.targetNumber),
      meta,
      podium: getPodium(session, 7),
      topPlayers: getPodium(session, 10).map((entry) => ({
        displayName: entry.displayName,
        profilePic: entry.profilePic,
        platform: entry.platform,
        platformUserId: entry.platformUserId,
        linkedDiscord: entry.linkedDiscord,
        cosmetics: entry.cosmetics || null,
        points: entry.xp,
      })),
    };
  }

  scheduleSave();
  return {
    type: 'new',
    guess,
    award,
    podium: award.pts > 0 ? getPodium(session, 7) : null,
  };
}

function processGuess(session, msg) {
  if (sessions.get(session.handle) !== session) return { type: 'ignored' };
  if (!recovery) return processGuessUncommitted(session, msg);
  let completion;
  const accepted = recovery.run(session, () => {
    const result = processGuessUncommitted(session, msg);
    if (result.type === 'win') {
      const at = Date.now();
      completion = { ...result, at, nextRoundAt: at + 8000, payouts: [] };
    }
    return result;
  }, { completion: () => completion });
  scheduleSave();
  return accepted.result;
}

module.exports = {
  setRecovery, allSessions: () => [...sessions.values()],
  init,
  getOrCreateSession,
  getSession,
  endSession,
  listSessions,
  buildSessionState,
  setSessionWinner,
  startNextSessionRound,
  awardForGuess,
  getPodium,
  processGuess,
  scheduleSave,
};
