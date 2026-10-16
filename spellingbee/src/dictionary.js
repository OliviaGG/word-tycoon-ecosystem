// dictionary.js - Word validation & scoring with Word Bank integration
// Falls back to an-array-of-english-words if Word Bank unavailable

const RELAY_ORIGIN=process.env.CHAT_RELAY_URL||'http://localhost:3000';
const relayFetch=require('./relay-request').createRelayRequest({baseUrl:RELAY_ORIGIN});
const WORD_BANK_URL = RELAY_ORIGIN + '/api/word-bank';
const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;

class Dictionary {
  constructor() {
    this.words = [];
    this.wordSet = new Set();
    this.targetSet = new Set();
    this.frequencyMap = new Map(); // word -> Zipf score
    this.ready = false;
  }

  /**
   * Initialize the dictionary from Word Bank API with fallback.
   */
  async init() {
    let loaded = false;

    // Try Word Bank first
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[Dictionary] Loading from Word Bank (attempt ${attempt}/${MAX_RETRIES})...`);

        // Fetch dictionary words for lengths 3-15
        const allWords = [];
        for (let first = 3; first <= 15; first += 4) {
          const groups = await Promise.all(Array.from({length:Math.min(4,16-first)},(_,offset)=>first+offset).map(async len=>{
            try {const res=await relayFetch(`${WORD_BANK_URL}/dictionary/${len}`);if(!res.ok)return [];const words=await res.json();return Array.isArray(words)?words.filter(w=>typeof w==='string'&&/^[a-z]{3,128}$/i.test(w)).map(w=>w.toLowerCase()):[];}catch(_){return [];}
          }));
          for (const words of groups) allWords.push(...words);
        }

        if (allWords.length > 0) {
          this.words = allWords;
          this.wordSet = new Set(allWords);
          console.log(`[Dictionary] Loaded ${allWords.length} words from Word Bank`);
          loaded = true;
        }

        // Fetch curated targets for common/rare categorization (matches Squaredle/Word Mine)
        try {
          const tRes = await relayFetch(`${WORD_BANK_URL}/targets`);
          if (tRes.ok) {
            const data = await tRes.json();
            if (typeof data === 'object' && !Array.isArray(data)) {
              for (const len of Object.keys(data)) {
                if (parseInt(len) < 4) continue;
                const arr = data[len];
                if (Array.isArray(arr)) {
                  for (const w of arr) {
                    const lw = w.toLowerCase().trim();
                    if (lw.length >= 4 && /^[a-z]+$/.test(lw)) this.targetSet.add(lw);
                  }
                }
              }
            } else if (Array.isArray(data)) {
              for (const w of data) {
                const lw = w.toLowerCase().trim();
                if (lw.length >= 4 && /^[a-z]+$/.test(lw)) this.targetSet.add(lw);
              }
            }
            console.log(`[Dictionary] Loaded ${this.targetSet.size} curated target words`);
          }
        } catch (e) {
          console.log('[Dictionary] Could not load targets, all words will be common');
        }

        // Fetch word frequency data (Zipf scores) from word bank API
        try {
          const fRes = await relayFetch(`${WORD_BANK_URL}/frequency`);
          if (fRes.ok) {
            const freqData = await fRes.json();
            for (const [w, z] of Object.entries(freqData)) {
              this.frequencyMap.set(w.toLowerCase(), z);
            }
            console.log(`[Dictionary] Loaded ${this.frequencyMap.size} word frequencies from API`);
          } else {
            console.log(`[Dictionary] Frequency fetch returned ${fRes.status} (all words without freq will be hidden)`);
          }
        } catch (e) {
          console.log('[Dictionary] Could not load frequency data');
        }

        if (loaded) break;
      } catch (e) {
        console.log(`[Dictionary] Word Bank attempt ${attempt} failed: ${e.message}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
      }
    }

    // Fallback to npm package
    if (!loaded) {
      console.log('[Dictionary] Falling back to an-array-of-english-words...');
      try {
        const wordList = require('an-array-of-english-words');
        this.words = wordList.filter(w => w.length >= 4 && /^[a-z]+$/.test(w));
        this.wordSet = new Set(this.words);
        console.log(`[Dictionary] Loaded ${this.words.length} words from npm fallback`);
      } catch (e) {
        console.error('[Dictionary] FATAL: Could not load any word source');
        this.words = [];
        this.wordSet = new Set();
      }
    }

    this.ready = true;
    return this;
  }

  /**
   * Get all valid words for a given set of letters and center letter.
   */
  getValidWords(letters, centerLetter) {
    const letterSet = new Set(letters.map(l => l.toLowerCase()));
    const center = centerLetter.toLowerCase();

    return this.words.filter(word => {
      if (!word.includes(center)) return false;
      for (const ch of word) {
        if (!letterSet.has(ch)) return false;
      }
      return true;
    });
  }

  /**
   * Check if a word is a target (common/curated).
   */
  isTarget(word) {
    return this.targetSet.has(word.toLowerCase());
  }

  /**
   * Get the full target set.
   */
  getTargetSet() {
    return this.targetSet;
  }

  /**
   * Get all target words as an array.
   */
  getTargetWords() {
    return [...this.targetSet];
  }

  /**
   * Get all dictionary words as an array.
   */
  getAllWords() {
    return this.words;
  }

  /**
   * Get the frequency Map (word -> Zipf score).
   */
  getFrequencyMap() {
    return this.frequencyMap;
  }

  /**
   * Get the Zipf frequency score for a word.
   */
  getFrequency(word) {
    const z = this.frequencyMap.get(word.toLowerCase());
    return z !== undefined ? z : null;
  }

  /**
   * Check if a word is a pangram (uses all 7 letters at least once).
   */
  isPangram(word, letters) {
    const letterSet = new Set(letters.map(l => l.toLowerCase()));
    const wordLetters = new Set(word.toLowerCase());
    for (const l of letterSet) {
      if (!wordLetters.has(l)) return false;
    }
    return true;
  }

  /**
   * Score a word: 4-letter words = 1 point, 5+ = 1 per letter, pangram bonus = +7.
   */
  scoreWord(word, letters) {
    let score = word.length === 4 ? 1 : word.length;
    if (this.isPangram(word, letters)) {
      score += 7;
    }
    return score;
  }

  /**
   * Generate a random puzzle by finding a pangram and extracting its unique letters.
   */
  generatePuzzle() {
    const pangrams = this.words.filter(word => new Set(word).size === 7);

    if (pangrams.length === 0) {
      throw new Error('No valid pangrams found in dictionary');
    }

    for (let attempt = 0; attempt < 50; attempt++) {
      const pangram = pangrams[Math.floor(Math.random() * pangrams.length)];
      const letters = [...new Set(pangram)];

      let bestCenter = null;
      let bestWords = [];
      let bestScore = 0;

      for (const center of letters) {
        const validWords = this.getValidWords(letters, center);
        if (validWords.length >= 15 && validWords.length <= 150) {
          const totalScore = validWords.reduce((sum, w) => sum + this.scoreWord(w, letters), 0);
          if (validWords.length > bestWords.length) {
            bestCenter = center;
            bestWords = validWords;
            bestScore = totalScore;
          }
        }
      }

      if (bestCenter) {
        const puzzlePangrams = bestWords.filter(w => this.isPangram(w, letters));
        const outerLetters = letters.filter(l => l !== bestCenter);
        this.shuffleArray(outerLetters);

        return {
          letters: [bestCenter, ...outerLetters],
          centerLetter: bestCenter,
          validWords: bestWords.sort(),
          totalScore: bestScore,
          pangrams: puzzlePangrams,
          wordCount: bestWords.length
        };
      }
    }

    throw new Error('Could not generate a suitable puzzle after 50 attempts');
  }

  /**
   * Generate a puzzle from specific letters.
   */
  generateFromLetters(letters, centerLetter) {
    const normalized = letters.map(l => l.toLowerCase());
    const center = centerLetter.toLowerCase();
    const validWords = this.getValidWords(normalized, center);
    const totalScore = validWords.reduce((sum, w) => sum + this.scoreWord(w, normalized), 0);
    const pangrams = validWords.filter(w => this.isPangram(w, normalized));

    return {
      letters: normalized,
      centerLetter: center,
      validWords: validWords.sort(),
      totalScore,
      pangrams,
      wordCount: validWords.length
    };
  }

  shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

module.exports = Dictionary;
