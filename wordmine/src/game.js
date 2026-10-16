/**
 * Word Mine — MP Game Engine
 * EventEmitter-based state machine for multiplayer (chat-driven) gameplay.
 */

const { EventEmitter } = require('events');
const mineEngine = require('./mine-engine');

const DEPTH_THRESHOLDS = mineEngine.DEPTH_THRESHOLDS;
const TIER_XP = mineEngine.TIER_XP;
const TIER_IDS = ['surface', 'shallow', 'medium', 'deep', 'core'];

class Game extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.status = 'idle'; // idle | active | paused | ended
    this.letters = [];
    this.initialIndices = [];
    this.bonusOrder = [];
    this.wordsByTier = null;
    this.wordLookup = {};     // word → tier (flat lookup from capped list)
    this.dictionarySet = null; // full dictionary for accepting all valid words

    this.currentDepth = 'surface';
    this.depthProgress = { surface: 0, shallow: 0, medium: 0, deep: 0, core: 0 };
    this.depthThresholds = null; // Per-game dynamic thresholds, set by loadMine
    this.unlockedDepths = ['surface'];
    this.revealedBonusCount = 0;

    this.foundWords = {};     // word → { player, platform, tier, xp, timestamp }
    this.players = {};        // "platform:userId" → { displayName, totalXP, wordsFound, deepestTier, cosmetics }
    this.wordHistory = [];    // ordered list for feed display
    this.mineCompleted = false; // true once medium tier is finished (win condition)

    this.mineId = null;
    this.mineName = null;
    this.mineTheme = null;
    this.isDaily = false;

    this.timerDuration = 0;
    this.startTime = null;
    this.endTime = null;
    this._timerInterval = null;
    this._remainingAtPause = 0;
  }

  // ─── Mine Loading ─────────────────────────────────────────────────────────

  /**
   * Load a mine with pre-solved words.
   * @param {object} mineData - { letters, initialIndices, bonusOrder, name, theme, id }
   * @param {object} wordsByTier - { surface: [...], shallow: [...], ... }
   * @param {Set} [dictionarySet] - full dictionary for accepting all valid words
   */
  loadMine(mineData, wordsByTier, dictionarySet, frequency) {
    this.reset();
    this.letters = mineData.letters.map(l => l.toLowerCase());
    this.initialIndices = mineData.initialIndices;
    this.bonusOrder = mineData.bonusOrder;
    this.wordsByTier = wordsByTier;
    this.dictionarySet = dictionarySet || null;
    this.frequency = frequency || null;
    // Use per-game thresholds from capToThresholds, or fall back to static defaults
    this.depthThresholds = (wordsByTier && wordsByTier.thresholds)
      ? { ...wordsByTier.thresholds }
      : { ...DEPTH_THRESHOLDS };
    this.mineId = mineData.id || null;
    this.mineName = mineData.name || 'Mine';
    this.mineTheme = mineData.theme || null;
    this.isDaily = mineData.isDaily || false;

    // Build flat word lookup from capped list (these are the "target" words)
    this.wordLookup = {};
    for (const tier of TIER_IDS) {
      for (const word of (wordsByTier[tier] || [])) {
        this.wordLookup[word.toLowerCase()] = tier;
      }
    }
    // Include hidden (ultra rare) words in lookup
    for (const word of (wordsByTier.hidden || [])) {
      this.wordLookup[word.toLowerCase()] = 'hidden';
    }

    // Auto-skip any initial tiers with 0 words (nothing to find)
    while (this.currentDepth !== 'core') {
      const th = this.depthThresholds[this.currentDepth];
      if (th === 0) {
        const idx = TIER_IDS.indexOf(this.currentDepth);
        if (idx >= 0 && idx < TIER_IDS.length - 1) {
          this.unlockedDepths.push(TIER_IDS[idx + 1]);
          this.currentDepth = TIER_IDS[idx + 1];
          if (this.revealedBonusCount < this.bonusOrder.length) {
            this.revealedBonusCount++;
          }
        } else break;
      } else break;
    }

    this.emit('mine-loaded', this.getState());
  }

  // ─── Game Lifecycle ───────────────────────────────────────────────────────

  start(timerSeconds = 0) {
    if (this.status === 'active') return;
    if (!this.letters.length) return;

    this.status = 'active';
    this.startTime = Date.now();
    this.timerDuration = timerSeconds;

    if (timerSeconds > 0) {
      this.endTime = Date.now() + timerSeconds * 1000;
      this._timerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((this.endTime - Date.now()) / 1000));
        this.emit('timer-tick', remaining);
        if (remaining <= 0) {
          this.end();
        }
      }, 1000);
    }

    this.emit('game-started', this.getState());
  }

  pause() {
    if (this.status !== 'active') return;
    this.status = 'paused';

    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
      this._remainingAtPause = Math.max(0, this.endTime - Date.now());
    }

    this.emit('game-paused', this.getState());
  }

  resume() {
    if (this.status !== 'paused') return;
    this.status = 'active';

    if (this._remainingAtPause > 0) {
      this.endTime = Date.now() + this._remainingAtPause;
      this._timerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((this.endTime - Date.now()) / 1000));
        this.emit('timer-tick', remaining);
        if (remaining <= 0) this.end();
      }, 1000);
    }

    this.emit('game-resumed', this.getState());
  }

  end() {
    if (this.status === 'ended' || this.status === 'idle') return;
    this.status = 'ended';

    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }

    this.emit('game-ended', {
      ...this.getState(),
      leaderboard: this.getLeaderboard(),
    });
  }

  // ─── Available Letters ────────────────────────────────────────────────────

  getAvailableLetterSet() {
    const set = new Set();
    for (const idx of this.initialIndices) set.add(this.letters[idx]);
    for (let i = 0; i < this.revealedBonusCount; i++) {
      set.add(this.letters[this.bonusOrder[i]]);
    }
    return set;
  }

  // ─── Word Submission ──────────────────────────────────────────────────────

  /**
   * Submit a word from a player.
   * @param {string} word
   * @param {object} playerInfo - { platform, userId, username, displayName, cosmetics }
   * @returns {object} { valid, reason, tier, xp, depthUnlocked, bonusLetter }
   */
  submitWord(word, playerInfo) {
    if (this.status !== 'active') {
      return { valid: false, reason: 'Game not active' };
    }

    word = (word || '').toLowerCase().trim();

    if (word.length < 4) {
      return { valid: false, reason: 'Too short' };
    }

    // Check already found
    if (this.foundWords[word]) {
      return { valid: false, reason: 'Already found' };
    }

    // Check word can be formed from currently available letters
    const available = this.getAvailableLetterSet();
    for (let i = 0; i < word.length; i++) {
      if (!available.has(word[i])) {
        return { valid: false, reason: 'Letter not available yet' };
      }
    }

    // Check word is in the mine's target list (capped), or at least in the dictionary
    let tier = this.wordLookup[word];
    let isBonus = false;
    if (!tier) {
      // Not in the capped target list — check the full dictionary
      if (this.dictionarySet && this.dictionarySet.has(word)) {
        tier = mineEngine.classifyWord(word, this.frequency || {});
        isBonus = true;
      } else {
        return { valid: false, reason: 'Not a valid word' };
      }
    }

    // Valid! Record it
    const isHidden = tier === 'hidden';
    const xp = isHidden ? 4 : (TIER_XP[tier] || TIER_XP.surface);
    const playerKey = (playerInfo.platform || 'local') + ':' + (playerInfo.userId || playerInfo.username);

    this.foundWords[word] = {
      player: playerInfo.displayName || playerInfo.username,
      playerKey,
      platform: playerInfo.platform,
      tier,
      xp,
      isBonus,
      timestamp: Date.now(),
    };

    // Update player stats
    if (!this.players[playerKey]) {
      this.players[playerKey] = {
        displayName: playerInfo.displayName || playerInfo.username,
        platform: playerInfo.platform,
        userId: playerInfo.userId,
        totalXP: 0,
        wordsFound: 0,
        deepestTier: 'surface',
        cosmetics: playerInfo.cosmetics || {},
      };
    }
    const player = this.players[playerKey];
    player.totalXP += xp;
    player.wordsFound++;
    player.cosmetics = playerInfo.cosmetics || player.cosmetics;
    // Track deepest tier this player has found
    if (TIER_IDS.indexOf(tier) > TIER_IDS.indexOf(player.deepestTier)) {
      player.deepestTier = tier;
    }

    // Add to ordered history
    this.wordHistory.push({
      word,
      tier,
      xp,
      player: playerInfo.displayName || playerInfo.username,
      playerKey,
      cosmetics: playerInfo.cosmetics || {},
    });

    // Depth progress — only SURFACE (common) words drive depth progression.
    // All other tiers are bonus and can be found at any time for extra XP.
    let depthUnlocked = null;
    let bonusLetter = null;

    if (!isBonus && !isHidden && tier === 'surface') {
      this.depthProgress[this.currentDepth]++;
      const threshold = (this.depthThresholds || DEPTH_THRESHOLDS)[this.currentDepth];
      if (threshold != null && this.depthProgress[this.currentDepth] >= threshold) {
        const unlockResult = this._unlockNextDepth();
        depthUnlocked = unlockResult.depth;
        bonusLetter = unlockResult.letter;
      }
    }

    // Emit word-found
    const entry = {
      word,
      tier,
      xp,
      player: playerInfo.displayName || playerInfo.username,
      playerKey,
      cosmetics: playerInfo.cosmetics || {},
      depthProgress: { ...this.depthProgress },
      depthUnlocked,
      bonusLetter,
      ...this._computeHints(),
    };
    this.emit('word-found', entry);

    // Win condition: finding all surface words (= core unlocked) wins the mine
    if (depthUnlocked === 'core' && !this.mineCompleted) {
      this.mineCompleted = true;
      this.emit('mine-completed', this.getState());
    }

    // Check all words found
    if (this._checkAllFound()) {
      this.emit('all-words-found', this.getState());
    }

    return {
      valid: true,
      tier,
      xp,
      depthUnlocked,
      bonusLetter,
    };
  }

  // ─── Depth Unlocking ──────────────────────────────────────────────────────

  _unlockNextDepth() {
    const idx = TIER_IDS.indexOf(this.currentDepth);
    if (idx < 0 || idx >= TIER_IDS.length - 1) return { depth: null, letter: null };

    const nextTier = TIER_IDS[idx + 1];
    this.unlockedDepths.push(nextTier);
    this.currentDepth = nextTier;

    let bonusLetter = null;
    if (this.revealedBonusCount < this.bonusOrder.length) {
      bonusLetter = this.letters[this.bonusOrder[this.revealedBonusCount]];
      this.revealedBonusCount++;
    }

    const tierDef = mineEngine.DEPTH_TIERS.find(t => t.id === nextTier);
    this.emit('depth-unlocked', {
      depth: nextTier,
      label: tierDef ? tierDef.label : nextTier,
      ore: tierDef ? tierDef.ore : '',
      bonusLetter,
      revealedBonusCount: this.revealedBonusCount,
      state: this.getState(),
    });

    return { depth: nextTier, letter: bonusLetter };
  }

  _checkAllFound() {
    if (!this.wordsByTier || !this.wordsByTier.totals) return false;
    // Goal = non-hidden words only (ultra rare are bonus)
    const nonHiddenFound = Object.values(this.foundWords).filter(w => w.tier !== 'hidden').length;
    return nonHiddenFound >= this.wordsByTier.totals.total;
  }

  // ─── Tier Hints ──────────────────────────────────────────────────────────

  /**
   * Compute hint data for the current depth tier.
   * - tierLetters: unique letters appearing in unfound target words of current tier
   * - startCounts: { letter: count } of unfound words starting with each letter
   */
  _computeHints() {
    if (!this.wordsByTier || !this.wordsByTier[this.currentDepth]) {
      return { tierLetters: [], startCounts: {} };
    }
    const unfound = this.wordsByTier[this.currentDepth].filter(w => !this.foundWords[w]);
    const letterSet = new Set();
    const startCounts = {};
    for (const w of unfound) {
      for (let i = 0; i < w.length; i++) letterSet.add(w[i]);
      const first = w[0];
      startCounts[first] = (startCounts[first] || 0) + 1;
    }
    return { tierLetters: [...letterSet], startCounts };
  }

  // ─── State ────────────────────────────────────────────────────────────────

  /**
   * Client-safe state (excludes word lists).
   */
  getState() {
    return {
      status: this.status,
      letters: this.letters,
      initialIndices: this.initialIndices,
      // Only reveal bonus letters that have been unlocked
      bonusOrder: this.bonusOrder.slice(0, this.revealedBonusCount),
      currentDepth: this.currentDepth,
      depthProgress: { ...this.depthProgress },
      unlockedDepths: [...this.unlockedDepths],
      revealedBonusCount: this.revealedBonusCount,
      foundWords: this.foundWords,
      players: this.players,
      wordHistory: this.wordHistory.slice(-50), // last 50 for feed
      mineId: this.mineId,
      mineName: this.mineName,
      mineTheme: this.mineTheme,
      isDaily: this.isDaily,
      totalWords: this.wordsByTier ? this.wordsByTier.totals.total : 0,
      foundCount: Object.values(this.foundWords).filter(w => !w.isBonus && w.tier !== 'hidden').length,
      hiddenCount: this.wordsByTier ? (this.wordsByTier.hidden || []).length : 0,
      foundHiddenCount: Object.values(this.foundWords).filter(w => w.tier === 'hidden').length,
      mineCompleted: this.mineCompleted,
      depthTiers: mineEngine.DEPTH_TIERS,
      depthThresholds: this.depthThresholds || mineEngine.DEPTH_THRESHOLDS,
      ...this._computeHints(),
    };
  }

  /**
   * Full state for admin panel (includes word lists).
   */
  getAdminState() {
    return {
      ...this.getState(),
      bonusOrder: this.bonusOrder,
      wordsByTier: this.wordsByTier,
    };
  }

  /**
   * Serializable state for persistence.
   */
  getSerializableState() {
    return {
      status: this.status,
      letters: this.letters,
      initialIndices: this.initialIndices,
      bonusOrder: this.bonusOrder,
      currentDepth: this.currentDepth,
      depthProgress: this.depthProgress,
      unlockedDepths: this.unlockedDepths,
      revealedBonusCount: this.revealedBonusCount,
      foundWords: this.foundWords,
      players: this.players,
      wordHistory: this.wordHistory,
      mineId: this.mineId,
      mineName: this.mineName,
      mineTheme: this.mineTheme,
      isDaily: this.isDaily,
      timerDuration: this.timerDuration,
      depthThresholds: this.depthThresholds,
    };
  }

  /**
   * Restore from serialized state (game resume on server restart).
   */
  restoreState(saved, wordsByTier, dictionarySet, frequency) {
    this.status = saved.status || 'idle';
    this.letters = saved.letters || [];
    this.initialIndices = saved.initialIndices || [];
    this.bonusOrder = saved.bonusOrder || [];
    this.currentDepth = saved.currentDepth || 'surface';
    this.depthProgress = saved.depthProgress || { surface: 0, shallow: 0, medium: 0, deep: 0, core: 0 };
    this.unlockedDepths = saved.unlockedDepths || ['surface'];
    this.revealedBonusCount = saved.revealedBonusCount || 0;
    this.foundWords = saved.foundWords || {};
    this.players = saved.players || {};
    this.wordHistory = saved.wordHistory || [];
    this.mineId = saved.mineId || null;
    this.mineName = saved.mineName || null;
    this.mineTheme = saved.mineTheme || null;
    this.isDaily = saved.isDaily || false;
    this.timerDuration = saved.timerDuration || 0;

    // Restore per-game thresholds (from saved state, or from wordsByTier, or static fallback)
    this.depthThresholds = saved.depthThresholds
      || (wordsByTier && wordsByTier.thresholds ? { ...wordsByTier.thresholds } : null);

    // Core unlocked means all surface words were found = mine completed
    this.mineCompleted = (this.unlockedDepths.indexOf('core') >= 0);

    this.wordsByTier = wordsByTier || null;
    this.dictionarySet = dictionarySet || null;
    this.frequency = frequency || null;

    // Rebuild word lookup
    this.wordLookup = {};
    if (this.wordsByTier) {
      for (const tier of TIER_IDS) {
        for (const word of (this.wordsByTier[tier] || [])) {
          this.wordLookup[word.toLowerCase()] = tier;
        }
      }
      // Include hidden (ultra rare) words in lookup
      for (const word of (this.wordsByTier.hidden || [])) {
        this.wordLookup[word.toLowerCase()] = 'hidden';
      }
    }
  }

  // ─── Leaderboard ──────────────────────────────────────────────────────────

  getLeaderboard() {
    return Object.entries(this.players)
      .map(([key, p]) => ({
        key,
        displayName: p.displayName,
        platform: p.platform,
        totalXP: p.totalXP,
        wordsFound: p.wordsFound,
        deepestTier: p.deepestTier,
        cosmetics: p.cosmetics,
      }))
      .sort((a, b) => b.totalXP - a.totalXP);
  }
}

module.exports = Game;
