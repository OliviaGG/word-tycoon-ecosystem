// ===== Searchle 3.0 Server Configuration =====
// Edit values here to customize the game without touching server.js

const { resolveRelayOrShared } = require('./shared-resolver');

module.exports = {
  // Network
  port: 3015,
  chatRelayUrl: 'http://localhost:3000',
  wordEmpiresUrl: 'http://localhost:3020',

  // Data paths (relative to project root)
  vocabPath: 'data/vocabulary.json',       // legacy fallback
  targetsPath: 'data/target-words.json',

  // Embedding Models
  modelsDir: 'data/models',
  // Blend Numberbatch's broad semantic coverage with a lighter FastText
  // contribution that tends to surface more player-guessable neighbors.
  activeModels: ['numberbatch', 'fasttext'],
  modelWeights: {
    'numberbatch': 1,
    'fasttext': 0.75,
  },
  allowRuntimeModelSwitch: false,
  rrfK: 60,                     // Reciprocal Rank Fusion constant

  // Language-specific single-player / streamer-session profiles. Public
  // multiplayer keeps using activeModels above; these profiles are opt-in.
  languageProfiles: {
    'pt-br': {
      label: 'Portuguese (Brazil)',
      modelsDir: 'data/pt-br/models',
      activeModels: ['numberbatch-pt-gated', 'nilc-glove-300d-gated'],
      modelWeights: {
        'numberbatch-pt-gated': 1,
        'nilc-glove-300d-gated': 1.25,
      },
      rrfK: 200,
      singularFilter: false,
      guessPattern: /^[\p{L}]+$/u,
      targetPools: {
        'very-common': 'data/pt-br/targets/difficulty/searchle-ptbr-very-easy-targets.json',
        'common': 'data/pt-br/targets/difficulty/searchle-ptbr-easy-targets.json',
        'normal': 'data/pt-br/targets/difficulty/searchle-ptbr-normal-targets.json',
        'rare': 'data/pt-br/targets/difficulty/searchle-ptbr-rare-targets.json',
        'very-rare': 'data/pt-br/targets/difficulty/searchle-ptbr-very-rare-targets.json',
      },
    },
  },

  // Frequency gate. Excludes low-frequency words from rank slots so the
  // top of the rank list is dominated by words players might actually
  // guess. Words below the Zipf threshold are skipped during ranking
  // *unless* they appear in the keep-always set (Searchle target list +
  // every Wikipedia title norm in the shared coverage file). The gate is
  // built once at boot as a per-model Uint8Array bitmap; runtime cost is
  // a single conditional inside the cosine loop. Set enabled: false to
  // restore legacy whole-vocab ranking.
  //
  // Zipf scale reference: 7 = "the/of/and", 5 = "house", 4 = "table",
  // 3 = "esoteric but recognizable", 2 = "rare/specialized".
  gate: {
    enabled: true,
    rankedPoolMinZipf: 2.5,
    frequencyPath: process.env.SEARCHLE_FREQUENCY_PATH
      || resolveRelayOrShared('data/word-bank/frequency.json'),
    keepAlwaysCoveragePath: process.env.WIKI_COVERAGE_PATH
      || resolveRelayOrShared('data/wikipedia-coverage.json'),
    keepAlwaysTargetsPath: 'data/target-words.json',
    // Word bank dictionary — every word the bank considers valid English.
    // Pulled into keep-always so rare-but-real words (xylyl, trebuckets, etc.)
    // survive the Zipf gate and end up in each game's rankings Map.
    keepAlwaysBankDictPath: process.env.SEARCHLE_BANK_DICT_PATH
      || resolveRelayOrShared('data/word-bank/dictionary.json'),
    disabledModels: ['fasttext-cc-pt-gated', 'numberbatch-pt-gated', 'nilc-glove-300d-gated'],
  },

  // Game
  winRank: 1,                    // rank that triggers a win
  autoRestartDelay: 5000,        // ms after win before new game starts

  // Chat Relay reconnection
  reconnectionDelay: 1000,       // ms initial reconnect delay
  reconnectionDelayMax: 5000,    // ms max reconnect delay

  // Guess validation
  guessPattern: /^[a-z]+$/,      // only lowercase letters allowed

  // Anti-spam guards on the chat → guess fan-out (processMultiWordGuess).
  // The old 4-word batch cap was removed on purpose (f1530a3) so viewers
  // can paste several words at once; these limits only stop paste-bombs
  // (a single 500-word message used to schedule 500 staggered timers over
  // 8+ minutes and farm proximity XP). Keep them generous.
  maxWordsPerMessage: 20,          // words beyond this in one message are dropped
  guessRateLimit: {
    max: 40,                       // max dispatched guesses per identity...
    windowMs: 30000,               // ...per rolling window
  },
};
