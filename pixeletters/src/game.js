const { PIXEL_FONT } = require('./pixelfont');
const { getRandomWord } = require('./wordlist');
const db = require('./database');

let currentGame = null;
let io = null;
let autoRestartTimer = null;
let onNewGameCallback = null;
let beforeNewGameCallback = null;
let stateAugmenter = null;
let durabilityHooks = null;
function setDurabilityHooks(hooks) { durabilityHooks = hooks; }

// Directions for PLUS mode reveal
const DIRECTIONS = ['down', 'up', 'left', 'right'];

function pickDirection() {
  return DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
}

// Simple seeded PRNG (mulberry32) for deterministic daily directions
function seededRng(seed) {
  let t = seed | 0;
  return function() {
    t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

function initialize(socketIO) {
  io = socketIO;
  const durable = durabilityHooks?.restore();
  if (durable) {
    currentGame = durable;
    if (currentGame.status !== 'active') scheduleAutoRestart();
    return;
  }

  const saved = db.getGameState();
  if (saved && saved.status === 'active') {
    let extraData;
    try {
      extraData = saved.revealed_rows; // parsed by db layer
    } catch (e) {
      extraData = null;
    }

    currentGame = {
      word: saved.word,
      wordLength: saved.word_length,
      maxGuesses: saved.max_guesses,
      guesses: saved.guesses,
      // Per-letter direction arrows (for PLUS mode)
      directions: extraData?.directions || buildDirections(saved.word_length),
      status: 'active',
      startedAt: saved.started_at,
      isDaily: extraData?.isDaily === true,
      dailyDate: extraData?.dailyDate || null,
      mode: db.getAllSettings().game_mode || 'standard'
    };
    durabilityHooks?.saveNew(currentGame);
    console.log(`[Game] Restored active game: ${saved.word_length}-letter word, ${saved.guesses.length} guesses so far`);
  } else {
    startNewGame();
  }
}

function buildDirections(wordLength, dailyDate) {
  const dirs = [];
  if (dailyDate) {
    // Seeded directions so all daily players get the same reveal pattern
    const rng = seededRng(hashString('pixeletters-daily-' + dailyDate));
    for (let i = 0; i < wordLength; i++) {
      dirs.push(DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]);
    }
  } else {
    for (let i = 0; i < wordLength; i++) {
      dirs.push(pickDirection());
    }
  }
  return dirs;
}

function startNewGame(wordLength, opts) {
  const previous = currentGame;
  try {
  // Allow server.js to inject daily word via before-hook
  const hookOpts = (!opts && beforeNewGameCallback) ? beforeNewGameCallback(wordLength) : null;
  const options = opts || hookOpts || {};
  const settings = db.getAllSettings();
  const len = wordLength || parseInt(settings.word_length) || 5;
  const rawMax = parseInt(settings.max_guesses);
  const maxGuesses = isNaN(rawMax) ? 5 : rawMax; // 0 = unlimited

  const word = options.word || getRandomWord(len);
  if (!word) {
    console.error(`[Game] No words available for length ${len}`);
    return null;
  }

  currentGame = {
    word: word,
    wordLength: len,
    maxGuesses: maxGuesses,
    guesses: [],
    directions: buildDirections(len, options.dailyDate || null),
    status: 'active',
    isDaily: !!options.isDaily,
    dailyDate: options.isDaily ? options.dailyDate : null,
    startedAt: new Date().toISOString(),
    mode: settings.game_mode || 'standard'
  };

  durabilityHooks?.saveNew(currentGame);
  if (autoRestartTimer) { clearTimeout(autoRestartTimer); autoRestartTimer = null; }
  try { saveState(); } catch (error) { console.error('[LegacyState] ' + error.message); }
  console.log(`[Game] New ${len}-letter game started, max ${maxGuesses} guesses`);
  broadcastGameState();
  if (onNewGameCallback) onNewGameCallback();
  return currentGame;
  } catch (error) { if (!durabilityHooks?.isAccepted(currentGame)) currentGame = previous; throw error; }
}

function processGuess(word, platform, platformUserId, username, displayName, profilePic, linkedDiscord, isFanClub, perks) {
  if (!currentGame || currentGame.status !== 'active') {
    return { error: 'No active game' };
  }

  if (typeof word !== 'string' || word.length > 64) return { error: 'Invalid guess' };
  const guess = word.toUpperCase().trim();

  if (guess.length !== currentGame.wordLength) {
    return { error: `Guess must be ${currentGame.wordLength} letters` };
  }

  if (!/^[A-Z]+$/.test(guess)) {
    return { error: 'Letters only' };
  }

  if (currentGame.guesses.some(g => g.word === guess)) {
    return { error: 'Already guessed' };
  }

  try { durabilityHooks?.ensure(currentGame); }
  catch (error) { return { error: error.code === 'DAILY_CHANGED' ? error.message : 'Progress storage unavailable; please retry' }; }
  const before = { ...currentGame, guesses: [...currentGame.guesses] };
  if (!durabilityHooks) {
    db.getOrCreateUserStats(platform, platformUserId, username, displayName);
    db.recordGuess(platform, platformUserId);
  }

  // Build pixel feedback for this guess
  const pixelFeedback = buildPixelFeedback(guess, currentGame.guesses.length);

  const guessEntry = {
    word: guess,
    username: username,
    displayName: displayName || username,
    platform: platform,
    platformUserId: platformUserId,
    profilePic: profilePic || null,
    linkedDiscord: linkedDiscord || null,
    isFanClub: !!isFanClub || !!(perks && perks.isFanClub),
    isSuperfan: !!(perks && perks.isSuperfan),
    isDonor: !!(perks && perks.isDonor),
    pixelFeedback: pixelFeedback,
    timestamp: new Date().toISOString()
  };

  currentGame.guesses.push(guessEntry);

  // Check win/lose
  let result = { guess: guessEntry, gameOver: false };

  if (guess === currentGame.word) {
    currentGame.status = 'won';
    result.gameOver = true;
    result.won = true;
    result.word = currentGame.word;
    result.winner = { username, displayName, platform, platformUserId, profilePic: profilePic || null, linkedDiscord: linkedDiscord || null };

    const uniquePlayers = new Map();
    for (const g of currentGame.guesses) {
      const key = g.linkedDiscord ? `discord:${g.linkedDiscord}` : `${g.platform}:${g.platformUserId}`;
      if (!uniquePlayers.has(key)) uniquePlayers.set(key, g);
    }
    for (const [key, g] of uniquePlayers) {
      const isWinner = (g.linkedDiscord && g.linkedDiscord === linkedDiscord)
        || (g.platformUserId === platformUserId && g.platform === platform);
      if (!durabilityHooks) db.recordGamePlayed(g.platform, g.platformUserId, isWinner);
    }

    if (!durabilityHooks) endGame('won', platform, platformUserId, username);

  } else if (currentGame.maxGuesses > 0 && currentGame.guesses.length >= currentGame.maxGuesses) {
    currentGame.status = 'lost';
    result.gameOver = true;
    result.won = false;
    result.word = currentGame.word;

    const uniquePlayers = new Map();
    for (const g of currentGame.guesses) {
      const key = g.linkedDiscord ? `discord:${g.linkedDiscord}` : `${g.platform}:${g.platformUserId}`;
      if (!uniquePlayers.has(key)) uniquePlayers.set(key, g);
    }
    for (const g of uniquePlayers.values()) {
      if (!durabilityHooks) db.recordGamePlayed(g.platform, g.platformUserId, false);
    }

    if (!durabilityHooks) endGame('lost', null, null, null);
  }

  try { durabilityHooks?.accept(currentGame, result); }
  catch (error) {
    for (const key of Object.keys(currentGame)) delete currentGame[key]; Object.assign(currentGame, before);
    return { error: 'Progress storage unavailable; please retry' };
  }
  try { saveState(); } catch (error) { console.error('[LegacyState] ' + error.message); }
  if (result.gameOver) scheduleAutoRestart();
  broadcastGameState();
  return result;
}

/**
 * Build pixel-level feedback for a guess.
 *
 * For each letter position:
 * - If guessed letter == answer letter: all pixels are 'blue' (correct)
 * - If guessed letter != answer letter: pixels in the guessed letter's grid get colored:
 *   - Revealed row/col pixels: 'green' if answer letter also has pixel ON, 'red' if answer has pixel OFF
 *   - Only pixels that are ON in the guessed letter get green/red coloring
 *   - Unrevealed row/col pixels: 'gray' (guessed letter shape visible but no color info)
 *   - Pixels that are OFF in both revealed and unrevealed: 'off' (dark/empty)
 *
 * The guessIndex determines how many rows/columns have been revealed (0-based).
 * Guess 0 → 1 row/col revealed, Guess 1 → 2 rows/cols, etc.
 */
function buildPixelFeedback(guess, guessIndex) {
  const answer = currentGame.word;
  const settings = db.getAllSettings();
  const mode = currentGame.mode || settings.game_mode || 'standard'; // 'standard', 'plus', 'pro'
  const revealCount = guessIndex + 1; // how many rows/cols are revealed so far

  const feedback = [];

  for (let pos = 0; pos < guess.length; pos++) {
    const guessChar = guess[pos];
    const answerChar = answer[pos];
    const guessGrid = PIXEL_FONT[guessChar] || PIXEL_FONT['A'];
    const answerGrid = PIXEL_FONT[answerChar] || PIXEL_FONT['A'];
    const direction = currentGame.directions[pos];

    if (guessChar === answerChar) {
      // Correct letter - all pixels blue
      const grid = [];
      for (let row = 0; row < 7; row++) {
        const rowData = [];
        for (let col = 0; col < 5; col++) {
          if (guessGrid[row][col] === 1) {
            rowData.push('blue');
          } else {
            rowData.push('off');
          }
        }
        grid.push(rowData);
      }
      feedback.push({ correct: true, grid, direction });
    } else {
      // Wrong letter - color pixels based on reveal
      const grid = [];
      for (let row = 0; row < 7; row++) {
        const rowData = [];
        for (let col = 0; col < 5; col++) {
          const isRevealed = isPixelRevealed(row, col, direction, revealCount, mode);

          if (guessGrid[row][col] === 1) {
            // Pixel is ON in guessed letter
            if (isRevealed) {
              // Color based on answer letter
              if (answerGrid[row][col] === 1) {
                rowData.push('green'); // Answer also has this pixel
              } else {
                rowData.push('red');   // Answer doesn't have this pixel
              }
            } else {
              rowData.push('gray');    // Not yet revealed
            }
          } else {
            // Pixel is OFF in guessed letter
            if (isRevealed) {
              // We could show if answer has a pixel here, but per the game rules,
              // OFF pixels don't give information - they stay dark
              rowData.push('off');
            } else {
              rowData.push('off');
            }
          }
        }
        grid.push(rowData);
      }
      feedback.push({ correct: false, grid, direction });
    }
  }

  return feedback;
}

/**
 * Determine if a pixel at (row, col) is revealed based on direction and reveal count.
 *
 * Standard mode: always reveals rows from top, one per guess.
 * Plus mode: direction per letter determines rows vs columns.
 * Pro mode: only ONE row/col total (the latest one).
 */
function isPixelRevealed(row, col, direction, revealCount, mode) {
  if (mode === 'standard') {
    // Standard: always reveal rows from top
    return row < revealCount;
  }

  // Plus and Pro modes use directional reveal
  switch (direction) {
    case 'down':
      if (mode === 'pro') return row === revealCount - 1;
      return row < revealCount;
    case 'up':
      if (mode === 'pro') return (6 - row) === revealCount - 1;
      return (6 - row) < revealCount;
    case 'right':
      if (mode === 'pro') return col === revealCount - 1;
      return col < revealCount;
    case 'left':
      if (mode === 'pro') return (4 - col) === revealCount - 1;
      return (4 - col) < revealCount;
    default:
      return row < revealCount;
  }
}

function buildKeyboardState() {
  const keyboard = {};

  // Initialize all letters with their pixel font shape as green (default)
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const font = PIXEL_FONT[letter];
    const grid = font.map(row => row.map(px => px === 1 ? 'green' : 'off'));
    keyboard[letter] = { status: 'unused', grid };
  }

  if (!currentGame) return keyboard;

  // Process guesses to build keyboard state
  // Keyboard shows simplified colors: green (guessed, wrong) or blue (found/correct)
  for (const guess of currentGame.guesses) {
    for (let i = 0; i < guess.word.length; i++) {
      const letter = guess.word[i];
      const pf = guess.pixelFeedback[i];
      const font = PIXEL_FONT[letter];

      if (pf.correct) {
        // Correct letter - show full letter shape in blue
        const grid = font.map(row => row.map(px => px === 1 ? 'blue' : 'off'));
        keyboard[letter] = { status: 'correct', grid };
      } else if (keyboard[letter].status !== 'correct') {
        // Wrong guess - show full letter shape in green (no red/gray detail)
        const grid = font.map(row => row.map(px => px === 1 ? 'green' : 'off'));
        keyboard[letter] = { status: 'wrong', grid };
      }
    }
  }

  return keyboard;
}

function getPublicGameState() {
  if (!currentGame) return null;

  const settings = db.getAllSettings();
  const mode = currentGame.mode || settings.game_mode || 'standard';

  const state = {
    wordLength: currentGame.wordLength,
    hintStartTime: currentGame.startedAt,
    maxGuesses: currentGame.maxGuesses,
    guessCount: currentGame.guesses.length,
    directions: currentGame.directions,
    mode: mode,
    guesses: currentGame.guesses.map(g => ({
      word: g.word,
      username: g.username,
      displayName: g.displayName,
      platform: g.platform,
      platformUserId: g.platformUserId,
      profilePic: g.profilePic || null,
      linkedDiscord: g.linkedDiscord || null,
      pixelFeedback: g.pixelFeedback,
      timestamp: g.timestamp
    })),
    keyboard: buildKeyboardState(),
    isDaily: currentGame.isDaily || false,
    status: currentGame.status,
    word: currentGame.status !== 'active' ? currentGame.word : undefined,
    winner: currentGame.status === 'won' ? {
      username: currentGame.guesses[currentGame.guesses.length - 1]?.username,
      displayName: currentGame.guesses[currentGame.guesses.length - 1]?.displayName,
      platform: currentGame.guesses[currentGame.guesses.length - 1]?.platform,
      platformUserId: currentGame.guesses[currentGame.guesses.length - 1]?.platformUserId,
      profilePic: currentGame.guesses[currentGame.guesses.length - 1]?.profilePic || null,
      linkedDiscord: currentGame.guesses[currentGame.guesses.length - 1]?.linkedDiscord || null
    } : undefined,
    requireSlash: settings.require_slash === '1'
  };

  // Merge any extra fields from state augmenter (e.g. jackpot data from server.js)
  if (stateAugmenter) {
    Object.assign(state, stateAugmenter());
  }

  return state;
}

function broadcastGameState() {
  if (io) {
    io.to('public').emit('game-state', getPublicGameState());
  }
}

function saveState() {
  db.saveGameState({
    word: currentGame.word,
    word_length: currentGame.wordLength,
    max_guesses: currentGame.maxGuesses,
    guesses: currentGame.guesses,
    revealed_rows: { directions: currentGame.directions, isDaily: !!currentGame.isDaily, dailyDate: currentGame.dailyDate || null },
    status: currentGame.status,
    started_at: currentGame.startedAt,
    ended_at: currentGame.status !== 'active' ? new Date().toISOString() : null,
    winner_platform: currentGame.status === 'won'
      ? currentGame.guesses[currentGame.guesses.length - 1]?.platform : null,
    winner_user_id: currentGame.status === 'won'
      ? currentGame.guesses[currentGame.guesses.length - 1]?.platformUserId : null,
    winner_username: currentGame.status === 'won'
      ? currentGame.guesses[currentGame.guesses.length - 1]?.username : null
  });
}

function endGame(status, winnerPlatform, winnerUserId, winnerUsername) {
  db.addGameHistory({
    word: currentGame.word,
    word_length: currentGame.wordLength,
    guesses: currentGame.guesses,
    status: status,
    winner_platform: winnerPlatform,
    winner_user_id: winnerUserId,
    winner_username: winnerUsername,
    started_at: currentGame.startedAt,
    ended_at: new Date().toISOString()
  });
}

function scheduleAutoRestart() {
  const delay = parseInt(db.getSetting('auto_restart_delay') || '10') * 1000;
  console.log(`[Game] Auto restart in ${delay / 1000}s`);

  if (io) {
    io.to('public').emit('game-ending', {
      restartIn: delay / 1000,
      word: currentGame.word,
      status: currentGame.status
    });
  }

  autoRestartTimer = setTimeout(() => {
    try { startNewGame(); } catch { console.error('[MPRecovery] Auto-restart storage failed; prior round retained'); }
  }, delay);
}

function getCurrentGame() { return currentGame; }

function setOnNewGame(cb) { onNewGameCallback = cb; }
function setBeforeNewGame(cb) { beforeNewGameCallback = cb; }
function setStateAugmenter(fn) { stateAugmenter = fn; }

function forceNewGame(wordLength, opts) {
  return startNewGame(wordLength, opts);
}

function skipGame() {
  if (!currentGame || currentGame.status !== 'active') return false;
  const before = { ...currentGame, guesses: [...currentGame.guesses] };
  try { durabilityHooks?.ensure(currentGame); } catch { return false; }
  currentGame.status = 'skipped';

  if (!durabilityHooks) db.addGameHistory({
    word: currentGame.word,
    word_length: currentGame.wordLength,
    guesses: currentGame.guesses,
    status: 'skipped',
    started_at: currentGame.startedAt,
    ended_at: new Date().toISOString()
  });

  try { durabilityHooks?.accept(currentGame, { gameOver: true, skipped: true }); }
  catch { for (const key of Object.keys(currentGame)) delete currentGame[key]; Object.assign(currentGame, before); return false; }
  try { saveState(); } catch (error) { console.error('[LegacyState] ' + error.message); }
  broadcastGameState();
  scheduleAutoRestart();
  return true;
}

module.exports = {
  initialize, startNewGame, processGuess, getPublicGameState,
  broadcastGameState, getCurrentGame, forceNewGame, skipGame,
  setOnNewGame, setBeforeNewGame, setStateAugmenter, setDurabilityHooks
};
