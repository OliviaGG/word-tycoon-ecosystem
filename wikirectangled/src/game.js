// game.js - Round state for WiKirecTangled.
//
// One Game = one round = one article + one grid. Tracks who found which words
// and what each was worth. Scoring borrows Rectangled's word-length + letter-rarity
// curves, then adds a target-word bonus when the found word is a ranked article target.

const path = require('path');
const fs = require('fs');

// Dictionary used for plural→singular detection on title words. We accept
// guesses of the singular form even when the displayed title chip is
// plural (e.g. title chip "Yeomen" is satisfied by a guess of "yeoman"
// or "yeomen"). Same word-bank dictionary the proper-noun filter uses.
const _RELAY_DIR_FOR_DICT = process.env.CHAT_RELAY_DIR
  || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const _FREQ_PATH = process.env.SEARCHLE_FREQUENCY_PATH
  || path.join(_RELAY_DIR_FOR_DICT, 'data', 'word-bank', 'frequency.json');
const _SINGULAR_MIN_ZIPF = (() => {
  const raw = process.env.WIKIREC_SINGULAR_ALIAS_MIN_ZIPF;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 2.5;
})();
const _dictionaryFreq = new Map();
(function _loadDictForSingularize() {
  try {
    if (!fs.existsSync(_FREQ_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(_FREQ_PATH, 'utf-8'));
    for (const k in raw) {
      const v = raw[k];
      if (typeof v === 'number') _dictionaryFreq.set(String(k).toLowerCase(), v);
    }
  } catch (e) { /* silent — singular aliasing just disabled */ }
})();

// Words that LOOK plural but aren't (would lead to bogus singularization).
const _SINGULAR_EXCLUDE = new Set([
  'always','besides','does','furthermore','goes','perhaps','sometimes','thus',
  'towards','whereas','crossroads','measles','molasses','mumps','news','species',
  'series','atlas','chaos','cosmos','diabetes','ethos','herpes','kudos','lens',
  'pathos','thermos','mathematics','physics','politics','statistics','economics',
  'genetics','this','as','his','its','was','has','please','was','its','his','its',
  'plus','minus','sons','sis','bus','plus','focus','virus','status','genius',
  'mars',  // false positive — Mars (planet) shouldn't singularize to "mar"
]);

// Try to find the singular form of a word in the dictionary using
// English morphology rules. Returns null if no plausible singular
// exists or the candidate falls below the Zipf threshold (so rare
// "mar"-type entries aren't accepted as aliases for "Mars").
function singularizeForTitleAlias(word) {
  if (!word) return null;
  if (_SINGULAR_EXCLUDE.has(word)) return null;
  if (word.length < 4) return null;
  if (_dictionaryFreq.size === 0) return null;
  const accept = (cand) => {
    if (!cand || cand === word) return null;
    const z = _dictionaryFreq.get(cand);
    if (typeof z !== 'number') return null;
    if (z < _SINGULAR_MIN_ZIPF) return null;
    return cand;
  };
  // -ies → -y (stories → story)
  if (word.endsWith('ies')) {
    const r = accept(word.slice(0, -3) + 'y');
    if (r) return r;
  }
  // -ves → -f / -fe / -ve (knives → knife, leaves → leaf)
  if (word.endsWith('ves')) {
    for (const cand of [word.slice(0,-3)+'f', word.slice(0,-3)+'fe', word.slice(0,-1)]) {
      const r = accept(cand); if (r) return r;
    }
  }
  // -es → strip 1 or 2 chars (boxes → box, buses → bus)
  if (word.endsWith('es')) {
    for (const cand of [word.slice(0,-1), word.slice(0,-2)]) {
      const r = accept(cand); if (r) return r;
    }
  }
  // bare -s (cats → cat) — skip -ss, -us, -is which are usually singular
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    const r = accept(word.slice(0,-1));
    if (r) return r;
  }
  return null;
}

const WORD_LENGTH_BONUS = { 4: 75, 5: 150, 6: 300, 7: 500, 8: 800, 9: 1200, 10: 1750, 11: 2500 };
const WORD_LENGTH_BONUS_MAX = 3500;

function getWordLengthBonus(word) {
  const len = word.length;
  if (len <= 3) return 0;
  if (len >= 12) return WORD_LENGTH_BONUS_MAX;
  return WORD_LENGTH_BONUS[len] || 0;
}

const LETTER_RARITY = {
  e: 0, t: 0, a: 0, o: 0, i: 0, n: 0, s: 0, h: 0, r: 0,
  d: 15, l: 15,
  c: 30, u: 30, m: 30, w: 30, f: 30,
  g: 60, y: 60, p: 60,
  b: 105, v: 105, k: 105,
  j: 180, x: 180,
  q: 300, z: 300,
};

const ZIPF_COMMON_THRESHOLD = 4.0;
const ZIPF_ULTRA_THRESHOLD = 2.5; // Zipf < this = ultra rare (the rest of has-freq is rare)
const COMMON_CAP_BY_SIZE = {
  3: 50, 4: 100, 5: 150, 6: 200, 7: 300, 8: 400,
  9: 500, 10: 500, 11: 500, 12: 500
};

function getLetterRarityBonus(word) {
  let bonus = 0;
  for (const ch of word.toLowerCase()) {
    bonus += (LETTER_RARITY[ch] || 0);
  }
  return bonus;
}

// Title words are the headline reward — find them in cascade order:
// 50k / 40k / 30k / 20k for the first/second/third/fourth-and-beyond title chip.
const TITLE_BONUSES = [50000, 40000, 30000, 20000];
function getTitleBonus(findIndex) {
  if (findIndex < 0) return 0;
  return TITLE_BONUSES[Math.min(findIndex, TITLE_BONUSES.length - 1)];
}

// Per-tier reward bonus. Designed so finding lots of high-tier words can
// rival a title reveal. Common (×24 finds ≈ 36k), rare (×8 ≈ 40k), ultra
// (×3 ≈ 45k) — comparable to a title cascade.
const TIER_BONUSES = { common: 1500, rare: 5000, ultra: 15000, three: 250, hidden: 2500 };
function getTierBonus(tier) {
  return TIER_BONUSES[tier] || 0;
}

// Article-target body words used to get a bonus too — that's been removed.
function getTargetBonus(_findIndex) {
  return 0;
}

// ---- Searchle-style rank scoring ------------------------------------------
// Mirrors /opt/searchle/server/game-manager.js so semantic guessers can
// compete on score even without grid finds.
// Slot-base × rank-multiplier. Slot 1 with rank 1 = 16k (the max possible
// rank reward in a single guess). Worse slots and worse ranks both decay.
//
// NOTE 2026-05-09: SLOT_BASE values were divided by 5 from the original
// 80k/55k/40k/28k/20k. The previous values made semantic-only guessers
// dominate the leaderboard — a single rank-1 slot-1 guess paid 80k,
// bigger than a title hit's 50k. With the cut, title bonuses are now
// the unambiguous headline reward, rank slots are roughly comparable
// to a high-tier grid find, and grid scoring is unchanged. The break
// even is around: grid hunters keep ~80% of their previous score, pure
// semantic guessers drop to ~25%.
const SLOT_BASE = {
  1: 16000, 2: 11000, 3: 8000, 4: 5600, 5: 4000,
};
function rankMultiplier(rank) {
  if (!Number.isFinite(rank) || rank <= 0) return 1;
  // Log decay: 1.0 at rank 1, ~0.4 at rank 1000, floor 0.2 at rank ≥100k.
  return Math.max(0.2, 1 - Math.log10(rank) / 5);
}
function proximityPoints(_rank) {
  // Disabled — scoring only fires inside the top-5 displayed slots now.
  return 0;
}
const MAX_CLIMB_BONUS = 0; // disabled — no scoring outside top 5
function climbBonus(_currentBest, _newRank) {
  // Disabled — no scoring outside top 5.
  return 0;
}
function computeRankAward(slot, semanticRank, wordAlreadyPaid) {
  // slot: 1-5, position in the displayed top-5 list (best guess = slot 1).
  // semanticRank: the actual Searchle rank of this guess (1 = closest to target).
  // Slot determines the base, semanticRank weights it. Same canonical paid
  // only once per rankTarget round.
  if (!Number.isFinite(slot) || slot < 1 || slot > 5) {
    return { points: 0, rankClaimed: false, newBest: false };
  }
  if (wordAlreadyPaid) {
    return { points: 0, rankClaimed: false, newBest: false };
  }
  const base = SLOT_BASE[slot] || 0;
  const mult = rankMultiplier(semanticRank);
  return { points: Math.floor(base * mult), rankClaimed: true, newBest: false };
}

// Closeness — how "close" a guess feels to a target word. Drives the colored
// fill bar on each unfound target card. Range [0,1].
//   0.55 * letter-bag overlap   — anagrams ride high
// + 0.25 * length similarity    — penalize wildly different lengths
// + 0.30 * shared-substring bonus — partial spellings surge
// Clamped to [0,1]. Identical strings short-circuit to 1.
function wordSimilarity(a, b) {
  a = String(a || '').toLowerCase();
  b = String(b || '').toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;

  const bagA = {}, bagB = {};
  for (const c of a) bagA[c] = (bagA[c] || 0) + 1;
  for (const c of b) bagB[c] = (bagB[c] || 0) + 1;
  let shared = 0;
  for (const c in bagA) if (bagB[c]) shared += Math.min(bagA[c], bagB[c]);
  const overlap = shared / Math.max(a.length, b.length);

  const lenPen = 1 - Math.abs(a.length - b.length) / Math.max(a.length, b.length);

  let bonus = 0;
  for (let n = 3; n <= Math.min(a.length, b.length); n++) {
    let found = false;
    for (let i = 0; i <= a.length - n && !found; i++) {
      if (b.includes(a.slice(i, i + n))) {
        found = true;
        bonus = Math.max(bonus, n / Math.max(a.length, b.length));
      }
    }
  }
  return Math.min(1, 0.55 * overlap + 0.25 * lenPen + 0.30 * bonus);
}

const UNKNOWN_RANK = 9999999;

function rankToCloseness(rank, totalRankedWords) {
  const r = Math.max(1, Number(rank) || UNKNOWN_RANK);
  const max = Math.max(r, totalRankedWords || 200000);
  const progress = Math.min(1, Math.log(r) / Math.log(max));
  return Math.max(0.02, 1 - progress);
}

function uniqueTitleWords(words) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(words) ? words : []) {
    const word = String(raw || '').trim().toLowerCase();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

class Game {
  constructor() {
    this.grid = [];
    this.rows = 0;
    this.cols = 0;
    this.minWordLength = 3;
    this.allWords = new Map();           // word -> [cellIdx,...]
    this.targetByWord = new Map();       // word -> { word, freq, position }
    this.titleWordSet = new Set();       // norm -> presence
    this.foundWords = new Map();         // word -> { finder info }
    this.foundTargets = new Map();       // word -> { ...finder, target }
    this.revealedTitleWords = new Map(); // title words that have been guessed
    this.playerScores = new Map();       // platformUserId -> { score, displayName, profileImage, platform, xp }
    this.recentTags = [];                // [{ result, word, ts }]
    this.guessCounts = new Map();        // norm -> times the word has been guessed this round
    this.rankedGuesses = new Map();      // word -> { rank, canonical, finder, timestamp }
    this.rankRewardsTaken = new Set();   // top-10 slots claimed for current rankTarget
    this.bestNonTop10Rank = Infinity;    // best rank seen in 11-10000 band
    this.commonWords = new Map();        // word -> cells (Zipf >= threshold)
    this.rareWords = new Map();          // word -> cells (has freq, below threshold)
    this.hiddenWords = new Map();        // word -> cells (no freq data)
    this.threeLetterWords = new Map();   // word -> cells (3-letter words)
    this.foundCommon = new Map();        // word -> finder (drives round completion)
    this.ultraRareWords = new Map();     // word -> cells (Zipf < ultra threshold)
    this.foundRare = new Map();          // word -> finder
    this.foundUltra = new Map();         // word -> finder
    this.frequencyMap = null;            // Map<word, zipf>
    this.rankTarget = null;              // primary target word all guesses rank against
    this.totalRankedWords = 0;           // vocabulary size reported by Searchle for this target
    this.startTime = null;
    this.articleTitle = null;
    this.articleKey = null;
    this.articlePlaintext = null;
    this.titleWords = [];                // ordered, original
    this.titleWordsRaw = [];             // original Wikipedia casing (for rank-target tiering)
  }

  _buildArticleWordSet(plaintext) {
    const set = new Set();
    if (!plaintext) return set;
    const re = /[a-z]+/g;
    const lower = plaintext.toLowerCase();
    let m;
    while ((m = re.exec(lower)) !== null) {
      if (m[0].length >= 3) set.add(m[0]);
    }
    return set;
  }

  _isWordInArticle(norm) {
    if (this.titleWordSet.has(norm)) return true;
    if (this.targetByWord.has(norm)) return true;
    return this.articleWordSet ? this.articleWordSet.has(norm) : false;
  }

  initialize({ grid, rows, cols, allWords, targetPaths, targets, articleTitle, articleKey, articlePlaintext, titleWords, titleWordsRaw, minWordLength = 3, totalRankedWords = 0, rankTarget = null, frequencyMap = null, topicTrie = null, mode = null }) {
    this.grid = grid;
    this.rows = rows;
    this.cols = cols;
    this.minWordLength = minWordLength;
    this.allWords = allWords;
    this.targetPaths = targetPaths || {};
    this.targetByWord = new Map();
    for (const t of targets) this.targetByWord.set(t.word, t);
    this.titleWords = uniqueTitleWords(titleWords);
    this.titleWordsRaw = Array.isArray(titleWordsRaw) ? titleWordsRaw.slice() : [];
    this.titleWordSet = new Set(this.titleWords);
    // Plural→singular aliases. Display chips remain the original (plural)
    // form, but matches against the singular ALSO count and resolve back
    // to the displayed chip via titleSingularToPlural. Built once per
    // round; doesn't affect grids that already have only singular norms.
    this.titleSingularToPlural = new Map();
    for (const w of this.titleWords) {
      const sg = singularizeForTitleAlias(w);
      if (sg && !this.titleWordSet.has(sg)) {
        this.titleWordSet.add(sg);
        this.titleSingularToPlural.set(sg, w);
      }
    }
    this.articleTitle = articleTitle;
    this.articleKey = articleKey;
    this.articlePlaintext = articlePlaintext;
    // Precompute the set of article words so misses don't run a regex over
    // the full plaintext on every guess. Title/target words are implicitly
    // in the article and are checked via their own Maps/Sets already.
    this.articleWordSet = this._buildArticleWordSet(articlePlaintext);
    this.foundWords = new Map();
    this.foundTargets = new Map();
    this.revealedTitleWords = new Map();
    this.playerScores = new Map();
    this.recentTags = [];
    this.guessCounts = new Map();
    this.startTime = Date.now();
    this.rankTarget = rankTarget || (targets && targets[0] && targets[0].word) || null;
    this.totalRankedWords = totalRankedWords || 0;
    this.closeness = new Map();
    this.frequencyMap = frequencyMap || null;
    this.mode = mode || null;
    // topicTrie restricts what counts toward common/rare/ultra completion.
    // null = legacy behaviour (every findable word classified by Zipf).
    this.topicTrie = topicTrie || null;
    this.foundCommon = new Map();
    this.foundRare = new Map();
    this.foundUltra = new Map();
    this.ultraRareWords = new Map();
    this.rankRewardsTaken = new Set();
    this.bestNonTop10Rank = Infinity;
    this.splitWords();
  }

  splitWords() {
    this.commonWords = new Map();
    this.rareWords = new Map();
    this.hiddenWords = new Map();
    this.threeLetterWords = new Map();
    if (!this.allWords) return;
    const freq = this.frequencyMap || new Map();
    const targetSet = new Set(this.titleWordSet);
    for (const w of this.targetByWord.keys()) targetSet.add(w);
    for (const [word, cells] of this.allWords.entries()) {
      // If a topic trie is wired, classification is restricted to its
      // members so common/rare/ultra reflect only topic words; the rest
      // stay findable via allWords but don't count toward completion.
      if (this.topicTrie && !this.topicTrie.has(word)) continue;
      if (word.length === 3) {
        this.threeLetterWords.set(word, cells);
      } else if (freq.has(word)) {
        const z = freq.get(word);
        if (z >= ZIPF_COMMON_THRESHOLD) this.commonWords.set(word, cells);
        else if (z >= ZIPF_ULTRA_THRESHOLD) this.rareWords.set(word, cells);
        else this.ultraRareWords.set(word, cells);
      } else {
        this.hiddenWords.set(word, cells);
      }
    }
    // Cap commons by smallest grid dim — demote excess to rare (rectangled standard)
    const maxCommon = COMMON_CAP_BY_SIZE[Math.min(this.rows || 5, this.cols || 9)] || 150;
    if (this.commonWords.size > maxCommon) {
      const sorted = [...this.commonWords.entries()].sort((a, b) => (freq.get(a[0]) || 0) - (freq.get(b[0]) || 0));
      const excess = sorted.slice(0, this.commonWords.size - maxCommon);
      for (const [word, cells] of excess) {
        this.commonWords.delete(word);
        this.rareWords.set(word, cells);
      }
    }
  }

  guess(word, platform, platformUserId, username, displayName, profileImage, rankInfo = null, isFanClub = false) {
    const norm = String(word || '').trim().toLowerCase();
    if (!norm || norm.length < this.minWordLength) {
      return { result: 'too_short', word: norm };
    }
    // Bump the per-word guess counter on every attempt (after too_short
    // returns above so 2-letter spam doesn't pollute the count).
    const _gc = (this.guessCounts.get(norm) || 0) + 1;
    this.guessCounts.set(norm, _gc);

    if (this.foundWords.has(norm)) {
      this._tag('already_found', norm);
      return { result: 'already_found', word: norm, guessCount: _gc };
    }

    const rank = rankInfo && typeof rankInfo.rank === 'number' ? rankInfo.rank : null;
    const canonical = rankInfo && rankInfo.canonical ? rankInfo.canonical : norm;
    const effectiveRank = rank != null ? rank : UNKNOWN_RANK;
    const closeness = rankToCloseness(effectiveRank, this.totalRankedWords);

    if (!this.rankedGuesses.has(norm)) {
      this.rankedGuesses.set(norm, {
        rank: effectiveRank,
        canonical,
        closeness,
        finder: { displayName: displayName || username, profileImage: profileImage || null, platformUserId: platformUserId || null, platform: platform || null },
        timestamp: Date.now(),
      });
    }

    const inGrid = this.allWords.has(norm);
    const isTarget = this.targetByWord.has(norm);

    // Resolve a guess form to the chip key it would reveal. For a plural
    // already in titleWords, the chip key is the form itself; for a
    // singular alias, the chip key is the original plural.
    const _chipKey = (form) => this.titleSingularToPlural.get(form) || form;
    const rawIsTitleWord = this.titleWordSet.has(norm)
      && !this.revealedTitleWords.has(_chipKey(norm));
    const canonicalIsTitleWord = canonical !== norm
      && this.titleWordSet.has(canonical)
      && !this.revealedTitleWords.has(_chipKey(canonical));
    const isTitleWord = rawIsTitleWord || canonicalIsTitleWord;

    if (!inGrid) {
      if (isTitleWord) {
        let titleNorm = rawIsTitleWord ? norm : canonical;
        // If the matched form is a singular alias for a plural display
        // chip, resolve back to the original (plural) so getTitleChips()
        // marks the right chip as revealed.
        if (this.titleSingularToPlural.has(titleNorm)) {
          titleNorm = this.titleSingularToPlural.get(titleNorm);
        }
        this.revealedTitleWords.set(titleNorm, { displayName: displayName || username, profileImage: profileImage || null, platform: platform || null, platformUserId: platformUserId || null, isFanClub: !!isFanClub });
        this._tag('correct', norm);
        const titleFindIndex = this.revealedTitleWords.size - 1; // post-set
        const titleBonus = getTitleBonus(titleFindIndex);
        const prev = this.playerScores.get(platformUserId) || {
          score: 0, xp: 0, wordCount: 0, targetCount: 0, titleWordCount: 0,
          displayName: displayName || username, profileImage: null, platform,
          isFanClub: !!isFanClub,
        };
        this.playerScores.set(platformUserId, {
          score: prev.score + titleBonus,
          xp: prev.xp + Math.round(titleBonus / 10),
          wordCount: prev.wordCount,
          targetCount: prev.targetCount,
          titleWordCount: prev.titleWordCount + 1,
          displayName: displayName || username || prev.displayName,
          profileImage: profileImage || prev.profileImage,
          platform: platform || prev.platform,
          isFanClub: !!isFanClub || !!prev.isFanClub,
        });
        return {
          result: 'correct',
          word: norm,
          cells: [],
          points: titleBonus,
          guessCount: _gc,
          breakdown: { base: 0, length: 0, rarity: 0, target: 0, title: titleBonus },
          isTarget: false,
          isTitleWord: true,
          target: null,
          rank,
          closeness,
          finder: { displayName: displayName || username, profileImage: profileImage || null, platformUserId: platformUserId || null, platform: platform || null },
        };
      }

      const inArticle = isTarget || this._isWordInArticle(norm);
      this._tag(inArticle ? 'miss_in_article' : 'incorrect', norm);
      this._updateCloseness(norm);
      return { result: inArticle ? 'miss_in_article' : 'incorrect', word: norm, rank, closeness, guessCount: _gc };
    }

    // Tier resolution first; baseScore is per-tier so structure mirrors eRecTangled.
    const lengthBonus = getWordLengthBonus(norm);
    const rarityBonus = getLetterRarityBonus(norm);
    let tierName = null;
    if (this.commonWords.has(norm)) tierName = 'common';
    else if (this.rareWords.has(norm)) tierName = 'rare';
    else if (this.ultraRareWords.has(norm)) tierName = 'ultra';
    else if (norm.length === 3) tierName = 'three';
    let baseScore;
    if      (tierName === 'three')  baseScore = 100;
    else if (tierName === 'common') baseScore = 1000;
    else if (tierName === 'rare')   baseScore = 2500;
    else if (tierName === 'ultra')  baseScore = 5000;
    else                            baseScore = 25;   // random English (non-topic) — fallback
    const tierBonus = 0; // moved into baseScore — kept in breakdown for back-compat
    let targetBonus = 0;
    let titleBonus = 0;

    if (isTarget) {
      const targetFindIndex = this.foundTargets.size;
      targetBonus = getTargetBonus(targetFindIndex);
    }
    if (isTitleWord) {
      // If the match was via the singular alias, resolve back to the
      // displayed (plural) form so getTitleChips marks the right chip.
      const finder = { displayName: displayName || username, profileImage: profileImage || null, platform: platform || null, platformUserId: platformUserId || null, isFanClub: !!isFanClub };
      if (rawIsTitleWord) {
        const key = this.titleSingularToPlural.get(norm) || norm;
        this.revealedTitleWords.set(key, finder);
      }
      if (canonicalIsTitleWord) {
        const key = this.titleSingularToPlural.get(canonical) || canonical;
        this.revealedTitleWords.set(key, finder);
      }
      titleBonus = getTitleBonus(this.revealedTitleWords.size - 1);
    }

    const total = baseScore + lengthBonus + rarityBonus + tierBonus + targetBonus + titleBonus;

    const finder = {
      platform, platformUserId, username, displayName, profileImage,
      isFanClub: !!isFanClub,
      timestamp: Date.now(),
      cells: this.allWords.get(norm),
      points: total,
      isTarget,
      isTitleWord,
      target: isTarget ? this.targetByWord.get(norm) : null,
    };
    this.foundWords.set(norm, finder);
    if (isTarget) this.foundTargets.set(norm, finder);
    if (this.commonWords.has(norm) && !this.foundCommon.has(norm)) {
      this.foundCommon.set(norm, finder);
    }
    if (this.rareWords.has(norm) && !this.foundRare.has(norm)) {
      this.foundRare.set(norm, finder);
    }
    if (this.ultraRareWords.has(norm) && !this.foundUltra.has(norm)) {
      this.foundUltra.set(norm, finder);
    }
    this._tag('correct', norm);

    const prev = this.playerScores.get(platformUserId) || {
      score: 0, xp: 0, wordCount: 0, targetCount: 0, titleWordCount: 0,
      displayName: displayName || username, profileImage: null, platform,
      isFanClub: !!isFanClub,
    };
    this.playerScores.set(platformUserId, {
      score: prev.score + total,
      xp: prev.xp + Math.round(total / 10),
      wordCount: prev.wordCount + 1,
      targetCount: prev.targetCount + (isTarget ? 1 : 0),
      titleWordCount: prev.titleWordCount + (isTitleWord ? 1 : 0),
      displayName: displayName || username || prev.displayName,
      profileImage: profileImage || prev.profileImage,
      platform: platform || prev.platform,
      isFanClub: !!isFanClub || !!prev.isFanClub,
    });

    return {
      result: 'correct',
      word: norm,
      cells: [...finder.cells],
      points: total,
      guessCount: _gc,
      breakdown: { base: baseScore, length: lengthBonus, rarity: rarityBonus, tier: tierBonus, target: targetBonus, title: titleBonus, tierName },
      isTarget,
      isTitleWord,
      target: finder.target,
      rank,
      closeness,
      finder: { displayName: finder.displayName, profileImage: finder.profileImage, platformUserId: finder.platformUserId, platform: finder.platform },
    };
  }

  _tag(result, word) {
    this.recentTags.push({ result, word, ts: Date.now() });
    if (this.recentTags.length > 16) this.recentTags.shift();
  }

  _updateCloseness(guess) {
    if (!guess) return;
    for (const t of this.targetByWord.values()) {
      if (this.foundTargets.has(t.word)) continue;
      const sim = wordSimilarity(guess, t.word);
      const prev = this.closeness.get(t.word) || 0;
      if (sim > prev) this.closeness.set(t.word, sim);
    }
  }

  isComplete() {
    const commonTarget = this.getCommonWordTarget();
    const rareTarget = this.getRareWordTarget();
    const ultraTarget = this.getUltraWordTarget();
    const hasAnyObjective = commonTarget > 0 || rareTarget > 0 || ultraTarget > 0
      || (this.titleWords && this.titleWords.length > 0);
    if (!hasAnyObjective) return false;

    if (this.titleWords && this.titleWords.length > 0) {
      if (this.revealedTitleWords.size < this.titleWords.length) return false;
    }
    if (this.foundCommon.size < commonTarget) return false;
    if (this.foundRare.size < rareTarget) return false;
    if (this.foundUltra.size < ultraTarget) return false;
    return true;
  }

  getTopPlayers() {
    return [...this.playerScores.entries()]
      .map(([id, d]) => ({
        platformUserId: id, displayName: d.displayName, score: d.score, xp: d.xp,
        wordCount: d.wordCount || 0, targetCount: d.targetCount || 0, titleWordCount: d.titleWordCount || 0,
        profileImage: d.profileImage, platform: d.platform,
        isFanClub: !!d.isFanClub,
      }))
      .sort((a, b) => b.score - a.score);
  }

  getTargetCards() {
    const seenCanonicals = new Set();
    const ranked = [...this.rankedGuesses.entries()]
      .map(([word, d]) => ({
        word: d.canonical || word,
        rawWord: word,
        rank: d.rank,
        canonical: d.canonical || word,
        finder: d.finder,
        isTarget: (d.canonical || word) === this.rankTarget,
      }))
      .filter((g) => {
        if (seenCanonicals.has(g.canonical)) return false;
        seenCanonicals.add(g.canonical);
        return true;
      })
      .sort((a, b) => {
        const ra = a.rank != null ? a.rank : UNKNOWN_RANK;
        const rb = b.rank != null ? b.rank : UNKNOWN_RANK;
        return ra - rb || a.word.localeCompare(b.word);
      });

    const out = [];
    for (let i = 0; i < 5; i++) {
      const g = ranked[i];
      if (g) {
        out.push({
          position: i + 1,
          rank: g.rank,
          word: g.word,
          revealed: true,
          closeness: rankToCloseness(g.rank, this.totalRankedWords),
          finder: g.finder,
          isTarget: g.isTarget,
        });
      } else {
        out.push({
          position: i + 1,
          rank: null,
          word: null,
          revealed: false,
          closeness: 0,
          finder: null,
          isPlaceholder: true,
        });
      }
    }
    return out;
  }

  getTitleChips() {
    return this.titleWords.map((w) => ({
      word: this.revealedTitleWords.has(w) ? w : null,
      revealed: this.revealedTitleWords.has(w),
      finder: this.revealedTitleWords.get(w) || null,
    }));
  }

  getCommonWordTarget() {
    if (this.mode === 'wikiword-4x4') return 0;
    const count = this.commonWords ? this.commonWords.size : 0;
    return count > 0 ? Math.ceil(count * 0.25) : 0;
  }

  getRareWordTarget() {
    if (this.mode === 'wikiword-4x4') return 0;
    const count = this.rareWords ? this.rareWords.size : 0;
    return count > 0 ? Math.ceil(count * 0.10) : 0;
  }

  getUltraWordTarget() {
    if (this.mode === 'wikiword-4x4') return 0;
    const count = this.ultraRareWords ? this.ultraRareWords.size : 0;
    return count > 0 ? Math.min(3, count) : 0;
  }

  getCurrentTierPhase() {
    // Returns 'common' | 'rare' | 'ultra' | 'complete' based on which threshold is unmet first.
    const cTarget = this.getCommonWordTarget();
    if (cTarget > 0 && this.foundCommon.size < cTarget) return 'common';
    const rTarget = this.getRareWordTarget();
    if (rTarget > 0 && this.foundRare.size < rTarget) return 'rare';
    const uTarget = this.getUltraWordTarget();
    if (uTarget > 0 && this.foundUltra.size < uTarget) return 'ultra';
    return 'complete';
  }

  getWordTier(word) {
    if (this.commonWords && this.commonWords.has(word)) return "common";
    if (this.rareWords && this.rareWords.has(word)) return "rare";
    if (this.ultraRareWords && this.ultraRareWords.has(word)) return "ultra";
    if (this.threeLetterWords && this.threeLetterWords.has(word)) return "three";
    // Fallback: frequencyMap direct lookup for words not placed (proper nouns).
    const freq = this.frequencyMap;
    if (freq && freq.has(word)) {
      const z = freq.get(word);
      if (z >= ZIPF_COMMON_THRESHOLD) return "common";
      if (z >= ZIPF_ULTRA_THRESHOLD) return "rare";
      return "ultra";
    }
    // No freq data either — proper noun, niche term, etc. Treat as ultra-rare.
    return "ultra";
  }

  getActiveTierStartCells() {
    const phase = this.getCurrentTierPhase();
    const out = [];
    const seenIdx = new Set();
    const pushIfNew = (idx, tier, extra) => {
      if (typeof idx !== 'number' || seenIdx.has(idx)) return;
      seenIdx.add(idx);
      out.push({ idx, tier, ...(extra || {}) });
    };

    // WikiWord 4x4: no free start-cell hint. Once 75% of the round's common
    // words are found, reveal the target's starting cell — the client renders
    // `filled` as a solid-colored tile instead of an outline.
    if (this.mode === 'wikiword-4x4') {
      const commonTotal = this.commonWords ? this.commonWords.size : 0;
      const found = this.foundCommon ? this.foundCommon.size : 0;
      if (commonTotal > 0 && found * 4 >= commonTotal * 3) {
        for (const [word] of this.targetByWord.entries()) {
          if (this.foundTargets.has(word)) continue;
          let cells = this.allWords ? this.allWords.get(word) : null;
          if (!Array.isArray(cells) || cells.length === 0) {
            cells = this.targetPaths ? this.targetPaths[word] : null;
          }
          if (Array.isArray(cells) && cells.length > 0) {
            pushIfNew(cells[0], 'common', { filled: true });
          }
        }
      }
      return out;
    }

    // Compact (single-target) mode: always outline the unfound target's start
    // cell so the 4×4 grid has a visible color hint even though it has no
    // common/rare/ultra tiers.
    if (this.targetByWord && this.targetByWord.size === 1) {
      for (const [word, t] of this.targetByWord.entries()) {
        if (this.foundTargets.has(word)) continue;
        let cells = this.allWords ? this.allWords.get(word) : null;
        if (!Array.isArray(cells) || cells.length === 0) {
          cells = this.targetPaths ? this.targetPaths[word] : null;
        }
        if (Array.isArray(cells) && cells.length > 0) {
          pushIfNew(cells[0], 'common');
        }
      }
      if (out.length) return out;
    }

    // While in an active tier phase, outline that tier's unfound starts.
    if (phase === 'common' || phase === 'rare' || phase === 'ultra') {
      const map = phase === 'rare' ? this.rareWords
                : phase === 'ultra' ? this.ultraRareWords
                : this.commonWords;
      const found = phase === 'rare' ? this.foundRare
                  : phase === 'ultra' ? this.foundUltra
                  : this.foundCommon;
      if (map && map.size > 0) {
        for (const [word, cells] of map.entries()) {
          if (found && found.has(word)) continue;
          if (Array.isArray(cells) && cells.length > 0) pushIfNew(cells[0], phase);
        }
      }
      return out;
    }

    // Phase 'complete' but title words still unrevealed: outline each title-word
    // start cell with the title word's own tier (common/rare/ultra) so the
    // colors mix as titles get revealed one by one.
    // Iterate displayed chips (titleWords) — not titleWordSet, which may
    // include singular aliases that have no grid placement.
    if (phase === 'complete' && this.titleWords && this.revealedTitleWords.size < this.titleWords.length) {
      for (const titleNorm of this.titleWords) {
        if (this.revealedTitleWords.has(titleNorm)) continue;
        // Title words may be proper nouns not in the trie. The solver's allWords
        // map won't have them, but buildGrid placed them — fall back to targetPaths.
        let cells = this.allWords ? this.allWords.get(titleNorm) : null;
        if (!Array.isArray(cells) || cells.length === 0) {
          cells = this.targetPaths ? this.targetPaths[titleNorm] : null;
        }
        if (!Array.isArray(cells) || cells.length === 0) continue;
        const tier = this.getWordTier(titleNorm);
        pushIfNew(cells[0], tier);
      }
      return out;
    }

    // Truly done — no outlines.
    return [];
  }

  getActiveCommonCells() {
    // Phase-aware: include cells from the currently-active tier's unfound
    // words (or unrevealed title words if phase is 'complete' but titles
    // remain). Returns [] when truly complete — no dimming.
    const phase = this.getCurrentTierPhase();
    const out = new Set();
    const collectMap = (map, found) => {
      if (!map) return;
      for (const [word, cells] of map.entries()) {
        if (found && found.has(word)) continue;
        if (Array.isArray(cells)) for (const c of cells) out.add(c);
      }
    };
    if (phase === 'common') collectMap(this.commonWords, this.foundCommon);
    else if (phase === 'rare') collectMap(this.rareWords, this.foundRare);
    else if (phase === 'ultra') collectMap(this.ultraRareWords, this.foundUltra);
    else {
      // Phase complete (titles-only stage or fully done): no dimming.
      // Dimming the non-title cells would give away which cells form the
      // remaining title word(s).
      return [];
    }
    return [...out];
  }

  getCommonStartCells() {
    if (!this.commonWords || this.commonWords.size === 0) return [];
    const out = new Set();
    for (const [word, cells] of this.commonWords.entries()) {
      if (this.foundCommon && this.foundCommon.has(word)) continue;
      if (Array.isArray(cells) && cells.length > 0) out.add(cells[0]);
    }
    return [...out];
  }

  getState() {
    return {
      grid: this.grid,
      rows: this.rows,
      cols: this.cols,
      minWordLength: this.minWordLength,
      articleTitle: (this.isComplete() || (this.titleWords.length > 0 && this.revealedTitleWords.size >= this.titleWords.length)) ? this.articleTitle : null,
      titleChips: this.getTitleChips(),
      targets: this.getTargetCards(),
      foundWords: [...this.foundWords.entries()]
        .map(([word, data]) => ({
          word,
          displayName: data.displayName,
          platform: data.platform,
          platformUserId: data.platformUserId,
          profileImage: data.profileImage,
          isFanClub: !!data.isFanClub,
          points: data.points,
          timestamp: data.timestamp,
        }))
        .sort((a, b) => b.timestamp - a.timestamp),
      foundCount: this.foundWords.size,
      totalRankedWords: this.totalRankedWords,
      totalGridWords: this.allWords.size,
      targetCount: this.targetByWord.size,
      foundTargetCount: this.foundTargets.size,
      titleWordCount: this.titleWords ? this.titleWords.length : 0,
      commonWordCount: this.commonWords ? this.commonWords.size : 0,
      commonWordTarget: this.getCommonWordTarget(),
      rareWordCount: this.rareWords ? this.rareWords.size : 0,
      foundRareCount: this.foundRare ? this.foundRare.size : 0,
      rareWordTarget: this.getRareWordTarget(),
      ultraWordCount: this.ultraRareWords ? this.ultraRareWords.size : 0,
      foundUltraCount: this.foundUltra ? this.foundUltra.size : 0,
      ultraWordTarget: this.getUltraWordTarget(),
      foundCommonCount: this.foundCommon ? this.foundCommon.size : 0,
      commonStartCells: this.getCommonStartCells(),
      activeCommonCells: this.getActiveCommonCells(),
      currentTierPhase: this.getCurrentTierPhase(),
      activeTierStartCells: this.getActiveTierStartCells(),
      phase: (this.foundTargets.size < this.targetByWord.size) ? 1 : 2,
      revealedTitleWordCount: this.revealedTitleWords.size,
      topPlayers: this.getTopPlayers(),
      recentTags: this.recentTags.slice(-12),
      isComplete: this.isComplete(),
      startTime: this.startTime,
      rankTarget: this.isRankTargetResolved() ? this.rankTarget : null,
    };
  }

  reconcileFoundWordIndexes() {
    const foundWords = this.foundWords instanceof Map ? this.foundWords : new Map();
    const foundTargets = new Map();
    const foundCommon = new Map();
    const foundRare = new Map();
    const foundUltra = new Map();

    for (const [word, finder] of foundWords.entries()) {
      if (this.targetByWord && this.targetByWord.has(word)) foundTargets.set(word, finder);
      if (this.commonWords && this.commonWords.has(word)) foundCommon.set(word, finder);
      if (this.rareWords && this.rareWords.has(word)) foundRare.set(word, finder);
      if (this.ultraRareWords && this.ultraRareWords.has(word)) foundUltra.set(word, finder);
    }

    const changed =
      foundTargets.size !== (this.foundTargets ? this.foundTargets.size : 0) ||
      foundCommon.size !== (this.foundCommon ? this.foundCommon.size : 0) ||
      foundRare.size !== (this.foundRare ? this.foundRare.size : 0) ||
      foundUltra.size !== (this.foundUltra ? this.foundUltra.size : 0);

    this.foundTargets = foundTargets;
    this.foundCommon = foundCommon;
    this.foundRare = foundRare;
    this.foundUltra = foundUltra;

    return {
      changed,
      foundTargets: foundTargets.size,
      foundCommon: foundCommon.size,
      foundRare: foundRare.size,
      foundUltra: foundUltra.size,
    };
  }

  isRankTargetResolved() {
    if (!this.rankTarget) return false;
    const target = this.rankTarget;
    const titleKey = this.titleSingularToPlural && this.titleSingularToPlural.get(target)
      ? this.titleSingularToPlural.get(target)
      : target;
    return !!(
      (this.foundWords && this.foundWords.has(target)) ||
      (this.foundTargets && this.foundTargets.has(target)) ||
      (this.foundCommon && this.foundCommon.has(target)) ||
      (this.foundRare && this.foundRare.has(target)) ||
      (this.foundUltra && this.foundUltra.has(target)) ||
      (this.revealedTitleWords && this.revealedTitleWords.has(titleKey))
    );
  }

  // ---- Resume support: dump every mutable Map/Set/scalar so a fresh Game
  // initialized with the same article+grid can be restored to this state.
  snapshot() {
    return {
      v: 2,
      articlePlaintext: this.articlePlaintext || '',
      objectives: Object.fromEntries(['allWords','commonWords','rareWords','ultraRareWords','hiddenWords','threeLetterWords'].map(key => [key,[...(this[key] || new Map()).entries()]])),
      frequencyMap: this.frequencyMap ? [...this.frequencyMap.entries()].filter(([word]) => this.allWords.has(word)) : null,
      rankTarget: this.rankTarget || null,
      totalRankedWords: this.totalRankedWords || 0,
      bestNonTop10Rank: this.bestNonTop10Rank === Infinity ? null : this.bestNonTop10Rank,
      rankRewardsTaken: [...(this.rankRewardsTaken || [])],
      excludedRankTargets: [...(this.excludedRankTargets || [])],
      // Original Wikipedia casing for each title word, needed so
      // advanceRankTarget's tier sort still works after a PM2 restart
      // resumes a mid-flight round from the DB.
      titleWordsRaw: Array.isArray(this.titleWordsRaw) ? this.titleWordsRaw.slice() : [],
      foundWords: [...this.foundWords.entries()],
      foundTargets: [...this.foundTargets.entries()],
      foundCommon: [...this.foundCommon.entries()],
      foundRare: [...this.foundRare.entries()],
      foundUltra: [...this.foundUltra.entries()],
      revealedTitleWords: [...this.revealedTitleWords.entries()],
      playerScores: [...this.playerScores.entries()],
      rankedGuesses: [...this.rankedGuesses.entries()],
      closeness: this.closeness ? [...this.closeness.entries()] : [],
      recentTags: this.recentTags || [],
      guessCounts: [...(this.guessCounts || new Map()).entries()],
      startTime: this.startTime,
    };
  }

  restoreSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    if (snap.objectives && snap.v >= 2) for (const key of ['allWords','commonWords','rareWords','ultraRareWords','hiddenWords','threeLetterWords']) {
      if (!Array.isArray(snap.objectives[key])) throw Error('invalid saved objectives');
      this[key] = new Map(snap.objectives[key]);
    }
    if (Array.isArray(snap.frequencyMap)) this.frequencyMap = new Map(snap.frequencyMap);
    if (typeof snap.articlePlaintext === 'string') { this.articlePlaintext = snap.articlePlaintext; this.articleWordSet = this._buildArticleWordSet(snap.articlePlaintext); }
    if (Object.prototype.hasOwnProperty.call(snap, 'rankTarget')) this.rankTarget = snap.rankTarget;
    if (typeof snap.totalRankedWords === 'number') this.totalRankedWords = snap.totalRankedWords;
    this.bestNonTop10Rank = (snap.bestNonTop10Rank == null) ? Infinity : snap.bestNonTop10Rank;
    this.rankRewardsTaken = new Set(Array.isArray(snap.rankRewardsTaken) ? snap.rankRewardsTaken : []);
    this.excludedRankTargets = new Set(Array.isArray(snap.excludedRankTargets) ? snap.excludedRankTargets : []);
    if (Array.isArray(snap.titleWordsRaw) && snap.titleWordsRaw.length) {
      this.titleWordsRaw = snap.titleWordsRaw.slice();
    }
    if (Array.isArray(snap.foundWords)) this.foundWords = new Map(snap.foundWords);
    if (Array.isArray(snap.foundTargets)) this.foundTargets = new Map(snap.foundTargets);
    if (Array.isArray(snap.foundCommon)) this.foundCommon = new Map(snap.foundCommon);
    if (Array.isArray(snap.foundRare)) this.foundRare = new Map(snap.foundRare);
    if (Array.isArray(snap.foundUltra)) this.foundUltra = new Map(snap.foundUltra);
    if (Array.isArray(snap.revealedTitleWords)) this.revealedTitleWords = new Map(snap.revealedTitleWords);
    if (Array.isArray(snap.playerScores)) this.playerScores = new Map(snap.playerScores);
    if (Array.isArray(snap.rankedGuesses)) this.rankedGuesses = new Map(snap.rankedGuesses);
    if (Array.isArray(snap.closeness)) this.closeness = new Map(snap.closeness);
    if (Array.isArray(snap.recentTags)) this.recentTags = snap.recentTags;
    if (Array.isArray(snap.guessCounts)) this.guessCounts = new Map(snap.guessCounts);
    if (snap.startTime) this.startTime = snap.startTime;
  }
}

module.exports = { Game, computeRankAward };
