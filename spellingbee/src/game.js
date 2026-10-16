const EventEmitter = require('events');

// ─── Letter Rarity (English frequency-based, 7-tier) ────────────────
const LETTER_RARITY = {
  e:0,t:0,a:0,o:0,i:0,n:0,s:0,h:0,r:0,
  d:15,l:15, c:30,u:30,m:30,w:30,f:30,
  g:60,y:60,p:60, b:105,v:105,k:105,
  j:180,x:180, q:300,z:300
};
const WORD_LENGTH_BONUS = {4:75,5:150,6:300,7:500,8:800,9:1200,10:1750,11:2500};
function scoreWordFull(word, isRare, isHidden, isThreeLetter, isPangram) {
  let base = isThreeLetter ? 100 : (isHidden ? 1500 : (isRare ? 1000 : 500));
  for (const ch of word.toLowerCase()) base += (LETTER_RARITY[ch] || 0);
  const len = word.length;
  if (len >= 12) base += 3500;
  else if (len >= 4) base += (WORD_LENGTH_BONUS[len] || 0);
  if (isPangram) base += 1000;
  return base;
}

class Game extends EventEmitter {
  constructor(dictionary) {
    super();
    this.dictionary = dictionary;
    this.reset();
  }

  reset() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    delete this._remainingAtPause;
    this.letters = [];
    this.centerLetter = '';
    this.validWords = [];
    this.totalScore = 0;
    this.pangrams = [];
    this.foundWords = {};       // word -> { player, platform, avatar, score, isPangram, isRare, time }
    this.players = {};          // "platform:username" -> { displayName, platform, avatar, score, words[] }
    this.status = 'idle';       // idle | active | paused | ended
    this.startTime = null;
    this.endTime = null;
    this.timerDuration = 0;     // 0 = no timer (seconds)
    this.timerInterval = null;
    this.wordHistory = [];      // ordered list of found words for feed

    // Common/rare/hidden/3-letter word tracking (frequency-based classification)
    this.commonWords = [];      // valid words ≥4 letters with Zipf >= 3.0 (required for completion)
    this.rareWords = [];        // valid words ≥4 letters with Zipf < 3.0 (visible bonus)
    this.hiddenWords = [];      // valid words ≥4 letters with no freq data (ultra rare bonus)
    this.threeLetterWords = []; // valid 3-letter words (bonus, 1pt each)
    this.commonCount = 0;
    this.rareCount = 0;
    this.hiddenCount = 0;
    this.threeLetterCount = 0;
    this.foundCommonCount = 0;
    this.foundRareCount = 0;
    this.foundHiddenCount = 0;
    this.foundThreeLetterCount = 0;

    // Puzzle metadata
    this.puzzleId = null;
    this.puzzleName = null;
    this.puzzleTheme = null;
    this.dailyPuzzleDate = null;
    this.completionEmitted = false;
  }

  /**
   * Load a puzzle into the game (doesn't start it).
   */
  loadPuzzle(puzzle) {
    this.reset();
    this.letters = puzzle.letters;
    this.centerLetter = puzzle.centerLetter;
    this.validWords = puzzle.validWords;
    this.totalScore = puzzle.totalScore;
    this.pangrams = puzzle.pangrams;
    this.status = 'idle';
    this.emit('puzzle-loaded', this.getState());
  }

  /**
   * Load a pre-made puzzle with metadata and split words into common/rare/hidden.
   */
  loadFromPuzzle(puzzleData) {
    this.reset();
    this.letters = puzzleData.letters;
    this.centerLetter = puzzleData.centerLetter;
    this.puzzleId = puzzleData.id || null;
    this.puzzleName = puzzleData.name || null;
    this.puzzleTheme = puzzleData.theme || null;

    // Find all valid words for this puzzle
    this.validWords = this.dictionary.getValidWords(this.letters, this.centerLetter);
    this.pangrams = this.validWords.filter(w => this.dictionary.isPangram(w, this.letters));

    // Split into common, rare, and hidden (frequency-based) — must happen before totalScore
    this.splitWords();

    // Compute totalScore using 3-layer scoring
    this.totalScore = this.validWords.reduce((sum, w) => {
      const isPangram = this.dictionary.isPangram(w, this.letters);
      const isRare = this.rareWords.includes(w);
      const isHidden = this.hiddenWords.includes(w);
      const isThree = this.threeLetterWords.includes(w);
      return sum + scoreWordFull(w, isRare, isHidden, isThree, isPangram);
    }, 0);

    this.status = 'idle';
    this.emit('puzzle-loaded', this.getState());
  }

  /**
   * Split validWords into common, rare, hidden, and 3-letter using frequency data.
   * 3-letter = exactly 3 letters (bonus, 1pt each)
   * Common = ≥4 letters, has frequency data AND Zipf >= 4.0 (required for completion)
   * Rare = ≥4 letters, has frequency data AND Zipf < 4.0 (visible bonus)
   * Hidden = ≥4 letters, no frequency data (ultra rare bonus)
   */
  splitWords() {
    const ZIPF_COMMON_THRESHOLD = 4.0;
    this.commonWords = [];
    this.rareWords = [];
    this.hiddenWords = [];
    this.threeLetterWords = [];

    const freqMap = this.dictionary.getFrequencyMap();
    if (!freqMap || freqMap.size === 0) {
      // No frequency data = non-3-letter words are common (fallback)
      for (const w of this.validWords) {
        if (w.length === 3) {
          this.threeLetterWords.push(w);
        } else {
          this.commonWords.push(w);
        }
      }
    } else {
      for (const w of this.validWords) {
        if (w.length === 3) {
          this.threeLetterWords.push(w);
          continue;
        }
        const zipf = freqMap.get(w);
        if (zipf !== undefined) {
          if (zipf >= ZIPF_COMMON_THRESHOLD) {
            this.commonWords.push(w);
          } else {
            this.rareWords.push(w);
          }
        } else {
          this.hiddenWords.push(w);
        }
      }
    }

    this.commonCount = this.commonWords.length;
    this.rareCount = this.rareWords.length;
    this.hiddenCount = this.hiddenWords.length;
    this.threeLetterCount = this.threeLetterWords.length;
  }

  /**
   * Generate and load a random puzzle.
   */
  generateAndLoad() {
    const puzzle = this.dictionary.generatePuzzle();
    this.loadPuzzle(puzzle);
    this.splitWords();
    return puzzle;
  }

  /**
   * Generate and load a puzzle from specific letters.
   */
  loadCustomPuzzle(letters, centerLetter) {
    const puzzle = this.dictionary.generateFromLetters(letters, centerLetter);
    this.loadPuzzle(puzzle);
    this.splitWords();
    return puzzle;
  }

  /**
   * Start the game.
   */
  start(timerSeconds = 0) {
    if (this.letters.length !== 7) {
      return { success: false, error: 'No puzzle loaded' };
    }
    if (!Number.isFinite(timerSeconds) || timerSeconds < 0 || timerSeconds > 86400) return { success: false, error: 'Invalid timer duration' };
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = null;
    delete this._remainingAtPause;
    this.endTime = null;
    this.status = 'active';
    this.startTime = Date.now();
    this.timerDuration = timerSeconds;

    if (timerSeconds > 0) {
      this.endTime = this.startTime + timerSeconds * 1000;
      this._armTimer();
    }

    this.emit('game-started', this.getState());
    return { success: true };
  }

  pause() {
    if (this.status !== 'active') return;
    this.status = 'paused';
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      this._remainingAtPause = Math.max(0, this.endTime - Date.now());
    }
    this.emit('game-paused', this.getState());
  }

  resume() {
    if (this.status !== 'paused') return;
    this.status = 'active';
    if (Number.isFinite(this._remainingAtPause) && this._remainingAtPause >= 0) {
      if (this._remainingAtPause === 0) { delete this._remainingAtPause; this.end(); return; }
      this.endTime = Date.now() + this._remainingAtPause;
      this._armTimer();
      delete this._remainingAtPause;
    }
    this.emit('game-resumed', this.getState());
  }

  end() {
    this.status = 'ended';
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.emit('game-ended', this.getState());
  }

  /**
   * Submit a word guess from a player.
   */
  submitWord(word, playerInfo) {
    if (this.status !== 'active') {
      return { valid: false, error: 'Game is not active' };
    }

    if (typeof word !== 'string' || word.length > 128 || !playerInfo || typeof playerInfo !== 'object') return { valid: false, result: 'bad_request', error: 'Invalid guess request' };
    const normalized = word.toLowerCase().trim();

    if (normalized.length < 3) {
      return { valid: false, error: 'Too short', result: 'too_short', word: normalized };
    }

    const letterSet = new Set(this.letters);
    for (const ch of normalized) {
      if (!letterSet.has(ch)) {
        return { valid: false, error: 'Invalid letter', result: 'incorrect', word: normalized };
      }
    }

    if (!normalized.includes(this.centerLetter)) {
      return { valid: false, error: 'Missing center letter', result: 'missing_center', word: normalized };
    }

    if (!this.validWords.includes(normalized)) {
      return { valid: false, error: 'Not a valid word', result: 'incorrect', word: normalized };
    }

    if (this.foundWords[normalized]) {
      return { valid: false, error: 'Already found', result: 'already_found', word: normalized };
    }

    // Valid word! Score it (3-layer: word rarity + letter rarity + length bonus + pangram)
    const isPangram = this.dictionary.isPangram(normalized, this.letters);
    const isRare = this.rareWords.includes(normalized);
    const isHidden = this.hiddenWords.includes(normalized);
    const isThreeLetter = this.threeLetterWords.includes(normalized);
    const id = playerInfo.platformUserId || playerInfo.username;
    const existing = Object.entries(this.players).find(([, p]) => p.platform === playerInfo.platform && (p.platformUserId || p.username) === id);
    const playerKey = existing ? existing[0] : `${playerInfo.platform}:${id}`;

    let actualScore = scoreWordFull(normalized, isRare, isHidden, isThreeLetter, isPangram);

    // Record the found word
    this.foundWords[normalized] = {
      player: playerInfo.displayName || playerInfo.username,
      playerKey,
      platform: playerInfo.platform,
      platformUserId: playerInfo.platformUserId || playerInfo.username,
      avatar: playerInfo.avatar,
      linkedDiscord: playerInfo.linkedDiscord || null,
      score: actualScore,
      isPangram,
      isRare,
      isHidden,
      isThreeLetter,
      time: Date.now()
    };

    // Update player score
    if (!this.players[playerKey]) {
      this.players[playerKey] = {
        username: playerInfo.username,
        displayName: playerInfo.displayName || playerInfo.username,
        platform: playerInfo.platform,
        platformUserId: playerInfo.platformUserId || playerInfo.username,
        avatar: playerInfo.avatar,
        linkedDiscord: playerInfo.linkedDiscord || null,
        score: 0,
        words: [],
        pangrams: 0
      };
    }
    this.players[playerKey].score += actualScore;
    this.players[playerKey].words.push(normalized);
    if (isPangram) this.players[playerKey].pangrams++;

    // Track common/rare/hidden/3-letter found counts
    if (isThreeLetter) {
      this.foundThreeLetterCount++;
    } else if (isHidden) {
      this.foundHiddenCount++;
    } else if (isRare) {
      this.foundRareCount++;
    } else {
      this.foundCommonCount++;
    }

    // Add to word history
    const entry = {
      word: normalized,
      player: playerInfo.displayName || playerInfo.username,
      playerKey,
      platform: playerInfo.platform,
      platformUserId: playerInfo.platformUserId || playerInfo.username,
      avatar: playerInfo.avatar,
      linkedDiscord: playerInfo.linkedDiscord || null,
      score: actualScore,
      isPangram,
      isRare,
      isHidden,
      time: Date.now()
    };
    this.wordHistory.unshift(entry);

    // Check if all common words found (goal = common only)
    if (!this.completionEmitted && this.commonCount > 0 && this.foundCommonCount >= this.commonCount) {
      this.completionEmitted = true;
      this.emit('all-words-found', this.getState());
    }

    this.emit('word-found', entry);
    return { valid: true, result: 'correct', ...entry };
  }

  /**
   * Shuffle the display order of outer letters (visual only).
   */
  shuffleLetters() {
    const center = this.letters[0];
    const outer = this.letters.slice(1);
    for (let i = outer.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [outer[i], outer[j]] = [outer[j], outer[i]];
    }
    this.letters = [center, ...outer];
    this.emit('letters-shuffled', this.letters);
    return this.letters;
  }

  getLeaderboard() {
    const merged = {};
    for (const player of Object.values(this.players)) {
      const groupKey = player.linkedDiscord ? `discord:${player.linkedDiscord}` : `${player.platform}:${player.username}`;
      if (!merged[groupKey]) {
        merged[groupKey] = { ...player, words: [...player.words] };
      } else {
        merged[groupKey].score += player.score;
        merged[groupKey].words = merged[groupKey].words.concat(player.words);
        merged[groupKey].pangrams += player.pangrams;
        merged[groupKey].displayName = player.displayName;
        merged[groupKey].avatar = player.avatar;
      }
    }
    return Object.values(merged)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }

  getTopPlayers() {
    return this.getLeaderboard().slice(0, 3).map(p => ({
      name: p.displayName || p.username,
      displayName: p.displayName || p.username,
      score: p.score,
      profileImage: p.avatar
    }));
  }

  getRemainingTime() {
    if (!this.endTime) return null;
    const remaining = Math.max(0, this.endTime - Date.now());
    return Math.ceil(remaining / 1000);
  }

  getCurrentScore() {
    return Object.values(this.foundWords).reduce((sum, w) => sum + w.score, 0);
  }

  /**
   * Get found words split by category.
   */
  getFoundCommonWords() {
    return Object.keys(this.foundWords).filter(w => !this.foundWords[w].isRare && !this.foundWords[w].isHidden && !this.foundWords[w].isThreeLetter).sort();
  }

  getFoundRareWords() {
    return Object.keys(this.foundWords).filter(w => this.foundWords[w].isRare).sort();
  }

  getFoundHiddenWords() {
    return Object.keys(this.foundWords).filter(w => this.foundWords[w].isHidden).sort();
  }

  getFoundThreeLetterWords() {
    return Object.keys(this.foundWords).filter(w => this.foundWords[w].isThreeLetter).sort();
  }

  getState() {
    return {
      letters: this.letters,
      centerLetter: this.centerLetter,
      status: this.status,
      foundWords: this.foundWords,
      foundCount: Object.keys(this.foundWords).length,
      totalWords: this.validWords.length,
      currentScore: this.getCurrentScore(),
      totalScore: this.totalScore,
      leaderboard: this.getLeaderboard(),
      topPlayers: this.getTopPlayers(),
      wordHistory: this.wordHistory.slice(0, 50),
      remainingTime: this.getRemainingTime(),
      timerDuration: this.timerDuration,
      pangrams: this.pangrams.length,
      foundPangrams: Object.values(this.foundWords).filter(w => w.isPangram).length,
      // Common/rare/hidden/3-letter split
      commonCount: this.commonCount,
      rareCount: this.rareCount,
      hiddenCount: this.hiddenCount,
      threeLetterCount: this.threeLetterCount,
      foundCommonCount: this.foundCommonCount,
      foundRareCount: this.foundRareCount,
      foundHiddenCount: this.foundHiddenCount,
      foundThreeLetterCount: this.foundThreeLetterCount,
      foundCommonWords: this.getFoundCommonWords(),
      foundRareWords: this.getFoundRareWords(),
      foundHiddenWords: this.getFoundHiddenWords(),
      foundThreeLetterWords: this.getFoundThreeLetterWords(),
      cheatSheet: this.getCheatSheet(),
      // Puzzle metadata
      puzzleId: this.puzzleId,
      puzzleName: this.puzzleName,
      puzzleTheme: this.puzzleTheme
    };
  }

  getCheatSheet() {
    const words = Array.isArray(this.validWords) ? this.validWords : [];
    const center = String(this.centerLetter || '').toLowerCase();
    const rowLetters = [];
    const seenLetters = new Set();
    if (center) {
      rowLetters.push(center);
      seenLetters.add(center);
    }
    const outerLetters = [];
    for (const letter of this.letters || []) {
      const normalized = String(letter || '').toLowerCase();
      if (!normalized || seenLetters.has(normalized)) continue;
      seenLetters.add(normalized);
      outerLetters.push(normalized);
    }
    rowLetters.push(...outerLetters.sort());

    const lengthSet = new Set();
    const rowMap = new Map();
    const totals = {};
    const prefixCounts = {};
    const rareSet = new Set(this.rareWords || []);
    const hiddenSet = new Set(this.hiddenWords || []);
    const threeLetterSet = new Set(this.threeLetterWords || []);
    const pangramSet = new Set(this.pangrams || []);
    let totalPoints = 0;
    for (const letter of rowLetters) {
      rowMap.set(letter, { letter, isCenter: letter === center, counts: {}, total: 0 });
    }

    for (const rawWord of words) {
      const word = String(rawWord || '').toLowerCase();
      if (!word) continue;
      const first = word[0];
      const length = word.length;
      lengthSet.add(length);
      totals[length] = (totals[length] || 0) + 1;

      if (!rowMap.has(first)) {
        rowMap.set(first, { letter: first, isCenter: first === center, counts: {}, total: 0 });
      }
      const row = rowMap.get(first);
      row.counts[length] = (row.counts[length] || 0) + 1;
      row.total += 1;

      if (word.length >= 2) {
        const prefix = word.slice(0, 2);
        prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
      }
      totalPoints += scoreWordFull(
        word,
        rareSet.has(word),
        hiddenSet.has(word),
        threeLetterSet.has(word),
        pangramSet.has(word)
      );
    }

    const lengths = Array.from(lengthSet).sort((a, b) => a - b);
    return {
      letters: rowLetters,
      centerLetter: center,
      totalWords: words.length,
      totalPoints,
      lengths,
      rows: Array.from(rowMap.values()),
      totals,
      prefixes: Object.keys(prefixCounts).sort().map(prefix => ({ prefix, count: prefixCounts[prefix] }))
    };
  }

  getAdminState() {
    return {
      ...this.getState(),
      validWords: this.validWords,
      pangramWords: this.pangrams,
      commonWords: this.commonWords,
      rareWords: this.rareWords,
      hiddenWords: this.hiddenWords,
      threeLetterWords: this.threeLetterWords
    };
  }

  getSerializableState() {
    return {
      letters: this.letters,
      centerLetter: this.centerLetter,
      validWords: this.validWords,
      totalScore: this.totalScore,
      pangrams: this.pangrams,
      foundWords: this.foundWords,
      players: this.players,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      timerDuration: this.timerDuration,
      wordHistory: this.wordHistory,
      _remainingAtPause: this._remainingAtPause ?? null,
      commonWords: this.commonWords,
      rareWords: this.rareWords,
      hiddenWords: this.hiddenWords,
      threeLetterWords: this.threeLetterWords,
      commonCount: this.commonCount,
      rareCount: this.rareCount,
      hiddenCount: this.hiddenCount,
      threeLetterCount: this.threeLetterCount,
      completionEmitted: this.completionEmitted,
      foundThreeLetterCount: this.foundThreeLetterCount,
      foundCommonCount: this.foundCommonCount,
      foundRareCount: this.foundRareCount,
      foundHiddenCount: this.foundHiddenCount,
      puzzleId: this.puzzleId,
      puzzleName: this.puzzleName,
      puzzleTheme: this.puzzleTheme,
      dailyPuzzleDate: this.dailyPuzzleDate || null
    };
  }

  restoreState(saved, options = {}) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = null;
    this.letters = saved.letters || [];
    this.centerLetter = saved.centerLetter || '';
    this.validWords = saved.validWords || [];
    this.totalScore = saved.totalScore || 0;
    this.pangrams = saved.pangrams || [];
    this.foundWords = saved.foundWords || {};
    this.players = saved.players || {};
    this.status = saved.status || 'idle';
    this.startTime = saved.startTime || null;
    this.dailyPuzzleDate = saved.dailyPuzzleDate || null;
    this.endTime = saved.endTime || null;
    this.timerDuration = saved.timerDuration || 0;
    this.wordHistory = saved.wordHistory || [];

    if (options.exact) {
      for (const key of ['commonWords','rareWords','hiddenWords','threeLetterWords','commonCount','rareCount','hiddenCount','threeLetterCount','foundCommonCount','foundRareCount','foundHiddenCount','foundThreeLetterCount']) this[key] = saved[key] ?? (key.endsWith('Words') ? [] : 0);
      if (saved.foundThreeLetterCount == null) this.foundThreeLetterCount = Object.keys(this.foundWords).filter(word => this.threeLetterWords.includes(word)).length;
      if (saved.threeLetterCount == null) this.threeLetterCount = this.threeLetterWords.length;
    } else {
    // Reclassify words using live frequency data (handles pre-upgrade saves too)
    this.splitWords();

    // Recount found words by category using fresh classification
    this.foundCommonCount = 0;
    this.foundRareCount = 0;
    this.foundHiddenCount = 0;
    this.foundThreeLetterCount = 0;
    const commonSet = new Set(this.commonWords);
    const rareSet = new Set(this.rareWords);
    const hiddenSet = new Set(this.hiddenWords);
    const threeLetterSet = new Set(this.threeLetterWords);
    for (const word of Object.keys(this.foundWords)) {
      if (threeLetterSet.has(word)) {
        this.foundThreeLetterCount++;
        this.foundWords[word].isThreeLetter = true;
        this.foundWords[word].isRare = false;
        this.foundWords[word].isHidden = false;
      } else if (commonSet.has(word)) {
        this.foundCommonCount++;
        this.foundWords[word].isThreeLetter = false;
        this.foundWords[word].isRare = false;
        this.foundWords[word].isHidden = false;
      } else if (rareSet.has(word)) {
        this.foundRareCount++;
        this.foundWords[word].isThreeLetter = false;
        this.foundWords[word].isRare = true;
        this.foundWords[word].isHidden = false;
      } else if (hiddenSet.has(word)) {
        this.foundHiddenCount++;
        this.foundWords[word].isThreeLetter = false;
        this.foundWords[word].isRare = false;
        this.foundWords[word].isHidden = true;
      }
    }
    }
    this.completionEmitted = saved.completionEmitted === true || this.commonCount > 0 && this.foundCommonCount >= this.commonCount;
    this.puzzleId = saved.puzzleId || null;
    this.puzzleName = saved.puzzleName || null;
    this.puzzleTheme = saved.puzzleTheme || null;

    delete this._remainingAtPause;
    if (Number.isFinite(saved._remainingAtPause) && saved._remainingAtPause >= 0) {
      this._remainingAtPause = saved._remainingAtPause;
    }
    if (this.status === 'paused' && this.timerDuration > 0 && !Number.isFinite(this._remainingAtPause)) {
      this._remainingAtPause = Number.isFinite(this.endTime) ? Math.max(0, this.endTime - Date.now()) : 0;
    }

    if (options.exact && this.status === 'active' && this.timerDuration > 0) {
      this._armTimer();
    } else if (this.status === 'active' && this.timerDuration > 0) {
      this.status = 'paused';
      this._remainingAtPause = Math.max(0, this.endTime - Date.now());
    }

    if (!options.silent) this.emit('puzzle-loaded', this.getState());
  }

  _armTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (Date.now() >= this.endTime) {
        try { this.end(); } catch (_) { this.emit('storage-unavailable'); }
      }
      this.emit('timer-tick', this.getRemainingTime());
    }, 1000);
    this.timerInterval.unref?.();
  }
}

module.exports = Game;
