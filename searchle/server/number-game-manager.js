const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const SAVE_PATH = path.join(DATA_DIR, 'number-game-state.json');
const HISTORY_LIMIT = 20;
const MIN_NUMBER = 1;
const MAX_NUMBER = 1_000_000;

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
const TARGET_REWARD = RANK_REWARDS[1];
const BASE_GUESS_XP = 200;
const MAX_CLIMB_BONUS = 8000;

let game = null;
let recovery = null;
function getGame() { return ensureGame(); }
function snapshotMetadata() { return { lastWinner, winHistory, winCounts, totalGames, totalGuesses }; }
function restoreMetadata(value) { ({ lastWinner, winHistory, winCounts, totalGames, totalGuesses } = value); }
function setRecovery(value) {
  recovery = value;
  const record = recovery.load('public');
  if (record) { game = makeFreshGame(); recovery.adopt(game, record); }
  else { loadState(); if (!game) game = makeFreshGame(); recovery.start(game, 'public', snapshotMetadata(), true); }
}
let lastWinner = {
  user: null,
  word: null,
  guessCount: 0,
  targetFinder: null,
  podium: [],
};
let winHistory = [];
let winCounts = {};
let totalGames = 0;
let totalGuesses = 0;

function atomicWriteSync(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function formatNumber(value) {
  return Number(value).toLocaleString('en-US');
}

function randomTarget() {
  return Math.floor(Math.random() * MAX_NUMBER) + MIN_NUMBER;
}

function nowIso() {
  return new Date().toISOString();
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

function makeFreshGame() {
  return {
    targetNumber: randomTarget(),
    guesses: [],
    guessedValues: new Set(),
    startTime: nowIso(),
    isWon: false,
    winner: null,
    playerScores: new Map(),
    paidTopRanks: new Set(),
    bestNonTop10Rank: Infinity,
  };
}

function buildSaveData() {
  return {
    game: game ? {
      targetNumber: game.targetNumber,
      guesses: game.guesses,
      guessedValues: [...game.guessedValues],
      startTime: game.startTime,
      isWon: game.isWon,
      winner: game.winner,
      playerScores: [...game.playerScores.values()],
      paidTopRanks: [...game.paidTopRanks],
      bestNonTop10Rank: Number.isFinite(game.bestNonTop10Rank) ? game.bestNonTop10Rank : null,
    } : null,
    lastWinner,
    winHistory,
    winCounts,
    totalGames,
    totalGuesses,
  };
}

function saveState() {
  if (recovery?.isRunning()) return;
  try {
    atomicWriteSync(SAVE_PATH, buildSaveData());
  } catch (err) {
    console.error('[NumberGame] Failed to save state:', err.message);
  }
}

function loadState() {
  try {
    if (!fs.existsSync(SAVE_PATH)) return false;
    const stat = fs.lstatSync(SAVE_PATH);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 12 * 1024 * 1024) throw Error('Unsafe legacy Number Searchle round');
    const raw = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid legacy Number Searchle round');

    lastWinner = raw.lastWinner && typeof raw.lastWinner === 'object'
      ? raw.lastWinner
      : lastWinner;
    winHistory = Array.isArray(raw.winHistory) ? raw.winHistory : [];
    winCounts = raw.winCounts && typeof raw.winCounts === 'object' ? raw.winCounts : {};
    totalGames = Number.isFinite(raw.totalGames) ? raw.totalGames : winHistory.length;
    totalGuesses = Number.isFinite(raw.totalGuesses)
      ? raw.totalGuesses
      : winHistory.reduce((sum, entry) => sum + (entry.guessCount || 0), 0);

    const savedGame = raw.game;
    if (
      savedGame &&
      Number.isInteger(savedGame.targetNumber) &&
      savedGame.targetNumber >= MIN_NUMBER &&
      savedGame.targetNumber <= MAX_NUMBER &&
      typeof savedGame.isWon === 'boolean' &&
      Array.isArray(savedGame.guesses) && savedGame.guesses.length <= 10000 &&
      Number.isFinite(Date.parse(savedGame.startTime))
    ) {
      game = {
        targetNumber: savedGame.targetNumber,
        guesses: Array.isArray(savedGame.guesses)
          ? savedGame.guesses
              .map((guess) => normalizeStoredGuess(guess, savedGame.targetNumber))
              .filter(Boolean)
          : [],
        guessedValues: new Set(Array.isArray(savedGame.guessedValues) ? savedGame.guessedValues : []),
        startTime: savedGame.startTime || nowIso(),
        isWon: savedGame.isWon,
        winner: savedGame.winner || null,
        playerScores: new Map(),
        paidTopRanks: new Set(Array.isArray(savedGame.paidTopRanks) ? savedGame.paidTopRanks : []),
        bestNonTop10Rank: Number.isFinite(savedGame.bestNonTop10Rank) ? savedGame.bestNonTop10Rank : Infinity,
      };

      for (const entry of Array.isArray(savedGame.playerScores) ? savedGame.playerScores : []) {
        if (!entry || !entry.identityKey) continue;
        game.playerScores.set(entry.identityKey, entry);
      }
      return true;
    }
    throw Error('Invalid legacy Number Searchle round');
  } catch (err) {
    throw new Error('Number Searchle storage needs recovery', { cause: err });
  }
}

function ensureGame() {
  if (!game) game = makeFreshGame();
  return game;
}

function getPodium(limit = 7) {
  ensureGame();
  const all = [...game.playerScores.values()];
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

function getTopPlayers(limit = 10) {
  return getPodium(limit).map((entry) => ({
    displayName: entry.displayName,
    profilePic: entry.profilePic,
    platform: entry.platform,
    platformUserId: entry.platformUserId,
    linkedDiscord: entry.linkedDiscord,
    cosmetics: entry.cosmetics || null,
    points: entry.xp,
  }));
}

function getAllScoringPlayers() {
  ensureGame();
  return [...game.playerScores.values()];
}

function incrementWinCounts(user) {
  const keys = new Set();
  if (user.linkedDiscord) keys.add(user.linkedDiscord);
  if (user.platformUserId) keys.add(user.platformUserId);
  if (user.id) keys.add(user.id);
  for (const key of keys) {
    winCounts[key] = (winCounts[key] || 0) + 1;
  }
}

function recordWinLocally(winner, targetFinder, guessCount) {
  const entry = {
    user: winner,
    word: formatNumber(game.targetNumber),
    guessCount,
    timestamp: nowIso(),
    targetFinder,
  };
  winHistory.push(entry);
  if (winHistory.length > HISTORY_LIMIT) {
    winHistory = winHistory.slice(-HISTORY_LIMIT);
  }
  totalGames += 1;
  totalGuesses += guessCount || 0;
  incrementWinCounts(winner);
}

function awardForGuess(rank, user) {
  ensureGame();
  const key = identityKeyFor(user);
  if (!key) return { pts: 0, total: 0 };

  const isTopRank = rank >= 1 && rank <= 10;
  const slotTaken = isTopRank ? game.paidTopRanks.has(rank) : false;
  const currentBest = game.bestNonTop10Rank;
  const pts = computeRankAward(rank, slotTaken, currentBest);
  if (pts <= 0) {
    const existing = game.playerScores.get(key);
    return { pts: 0, total: existing ? existing.xp : 0 };
  }

  if (isTopRank && !slotTaken) {
    game.paidTopRanks.add(rank);
  }
  if (rank >= 11 && rank <= 10000 && rank < currentBest) {
    game.bestNonTop10Rank = rank;
  }

  let entry = game.playerScores.get(key);
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
    game.playerScores.set(key, entry);
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

function parseGuess(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = Number.parseInt(digits, 10);
  if (!Number.isFinite(value) || value < MIN_NUMBER || value > MAX_NUMBER) return null;
  return value;
}

function getWinnerFromScores(targetFinder) {
  const scoringPlayers = getAllScoringPlayers();
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

function updateLastWinner(winner, targetFinder, guessCount) {
  lastWinner = {
    user: winner,
    word: formatNumber(game.targetNumber),
    guessCount,
    targetFinder,
    podium: getPodium(7),
  };
}

function startNewGame() {
  const candidate = makeFreshGame();
  if (recovery) recovery.start(candidate, 'public', snapshotMetadata());
  game = candidate;
  saveState();
  return game;
}

function init() {
  loadState();
  if (!game) startNewGame();
}

function getGameState() {
  ensureGame();
  return {
    targetWord: game.isWon ? formatNumber(game.targetNumber) : null,
    guesses: game.guesses,
    totalRankedWords: MAX_NUMBER,
    startTime: game.startTime,
    isWon: game.isWon,
    winner: game.winner,
    lastWinner,
    winHistory,
    recentGames: winHistory,
    totalMPGames: totalGames,
    avgGuesses: totalGames > 0 ? Math.round(totalGuesses / totalGames) : 0,
    winCounts,
    eloLeaderboard: [],
    jackpotEnabled: false,
    completion: recovery?.current(game)?.completion || null,
  };
}

function processGuessUncommitted(msg) {
  ensureGame();
  if (game.isWon) return { type: 'ignored' };

  const numericValue = parseGuess(msg && msg.message);
  if (!numericValue) return { type: 'invalid' };

  const user = normalizeUser(msg && msg.user, msg && msg.platform);
  const valueKey = String(numericValue);
  const display = formatNumber(numericValue);
  const existingIdx = game.guesses.findIndex((guess) => guess && guess.valueKey === valueKey);

  if (existingIdx !== -1) {
    const bumped = game.guesses.splice(existingIdx, 1)[0];
    bumped.timestamp = nowIso();
    bumped.lastBumper = user;
    game.guesses.push(bumped);
    saveState();
    return { type: 'bump', word: display, bumper: user };
  }

  const rank = Math.abs(numericValue - game.targetNumber) + 1;
  const award = awardForGuess(rank, user);
  const guess = {
    word: display,
    valueKey,
    numericValue,
    numberSide: numberSideForValue(numericValue, game.targetNumber),
    rank,
    timestamp: nowIso(),
    user,
  };

  game.guesses.push(guess);
  game.guessedValues.add(valueKey);

  if (isWinningGuess(numericValue, game.targetNumber)) {
    game.isWon = true;
    const { winner, scoringPlayers } = getWinnerFromScores(user);
    game.winner = winner;
    const guessCount = game.guesses.length;
    const durationSeconds = game.startTime
      ? Math.max(0, Math.round((Date.now() - new Date(game.startTime).getTime()) / 1000))
      : null;
    updateLastWinner(winner, user, guessCount);
    recordWinLocally(winner, user, guessCount);
    const winnerKey = identityKeyFor(winner);
    const winningScore = scoringPlayers.find((player) => player.identityKey === winnerKey);
    const pot = winningScore ? winningScore.xp : TARGET_REWARD;
    saveState();
    return {
      type: 'win',
      guess,
      award,
      winner,
      targetFinder: user,
      targetWord: formatNumber(game.targetNumber),
      guessCount,
      durationSeconds,
      pot,
      podium: getPodium(7),
      topPlayers: getTopPlayers(10),
    };
  }

  saveState();
  return {
    type: 'new',
    guess,
    award,
    podium: award.pts > 0 ? getPodium(7) : null,
  };
}

function processGuess(msg, restartDelay = 8000) {
  ensureGame();
  if (!recovery) return processGuessUncommitted(msg);
  let completion;
  const accepted = recovery.run(game, () => {
    const result = processGuessUncommitted(msg);
    if (result.type === 'win') {
      const at = Date.now();
      completion = { ...result, at, nextRoundAt: at + restartDelay, payouts: [] };
    }
    return result;
  }, { completion: () => completion });
  saveState();
  return accepted.result;
}

function updateUserCosmetics(platform, platformUserId, equipped) {
  ensureGame();
  let changed = false;
  for (const guess of game.guesses) {
    if (!guess || !guess.user) continue;
    if (guess.user.platform === platform && guess.user.platformUserId === platformUserId) {
      guess.user.cosmetics = equipped || {};
      changed = true;
    }
    if (guess.lastBumper && guess.lastBumper.platform === platform && guess.lastBumper.platformUserId === platformUserId) {
      guess.lastBumper.cosmetics = equipped || {};
      changed = true;
    }
  }
  if (lastWinner && lastWinner.user && lastWinner.user.platform === platform && lastWinner.user.platformUserId === platformUserId) {
    lastWinner.user.cosmetics = equipped || {};
    changed = true;
  }
  if (lastWinner && lastWinner.targetFinder && lastWinner.targetFinder.platform === platform && lastWinner.targetFinder.platformUserId === platformUserId) {
    lastWinner.targetFinder.cosmetics = equipped || {};
    changed = true;
  }
  if (lastWinner && Array.isArray(lastWinner.podium)) {
    for (const player of lastWinner.podium) {
      if (player && player.platform === platform && player.platformUserId === platformUserId) {
        player.cosmetics = equipped || {};
        changed = true;
      }
    }
  }
  for (const player of game.playerScores.values()) {
    if (player.platform === platform && player.platformUserId === platformUserId) {
      player.cosmetics = equipped || {};
      changed = true;
    }
  }
  if (changed) saveState();
  return changed;
}

module.exports = {
  setRecovery, getGame, snapshotMetadata, restoreMetadata,
  init,
  startNewGame,
  processGuess,
  getGameState,
  getPodium,
  getTopPlayers,
  updateUserCosmetics,
  constants: {
    min: MIN_NUMBER,
    max: MAX_NUMBER,
  },
};
