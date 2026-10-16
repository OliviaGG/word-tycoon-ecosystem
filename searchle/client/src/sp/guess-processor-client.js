// ===== Client-Side Guess Processor =====
// Port of server/guess-processor.js for browser use.
// Uses rankings object keys as vocabulary (word in rankings).

// ---------------------------------------------------------------------------
// Plural → Singular Normalization
// ---------------------------------------------------------------------------

const SINGULAR_EXCLUDE = new Set([
  // Plurale tantum — nouns that only exist in plural form
  'barracks', 'bellows', 'binoculars', 'boxers', 'briefs',
  'chaps', 'clothes', 'corps', 'credentials', 'customs',
  'dregs', 'dungarees', 'forceps', 'gallows', 'glasses',
  'goggles', 'goods', 'headquarters', 'jeans', 'knickers',
  'leggings', 'manners', 'narrows', 'overalls', 'pajamas',
  'pants', 'pliers', 'premises', 'proceeds', 'remains',
  'scissors', 'shears', 'shorts', 'slacks', 'suds',
  'surroundings', 'suspenders', 'tights', 'tongs', 'trousers',
  'tweezers', 'underpants',

  // Mass/uncountable nouns ending in -s
  'measles', 'molasses', 'mumps', 'news', 'shingles',

  // Same form singular and plural
  'series', 'species',

  // Words where -s/-es is part of the root, not a plural suffix
  'atlas', 'chaos', 'cosmos', 'diabetes', 'ethos',
  'herpes', 'kudos', 'lens', 'pathos', 'thermos',

  // Food/dish names commonly used in plural form
  'grits', 'nachos', 'oats',

  // Academic fields / disciplines
  'athletics', 'diagnostics', 'dynamics', 'economics', 'electronics',
  'ethics', 'genetics', 'gymnastics', 'linguistics', 'logistics',
  'mathematics', 'mechanics', 'physics', 'politics', 'statistics',
  'tactics', 'therapeutics',

  // Adverbs, pronouns, prepositions, verbs
  'across', 'always', 'besides', 'does', 'furthermore', 'goes',
  'nonetheless', 'overseas', 'perhaps', 'sometimes', 'themselves',
  'thus', 'upstairs', 'downstairs', 'towards', 'whereas',
  'crossroads',
]);

// ---------------------------------------------------------------------------
// British → American Spelling Normalization
// ---------------------------------------------------------------------------
const BRITISH_TO_AMERICAN = {
  grey: 'gray',
  tyre: 'tire', tyres: 'tires',
  aluminium: 'aluminum',
  jewellery: 'jewelry',
  kerb: 'curb',
  draught: 'draft',
  plough: 'plow',
  gaol: 'jail',
  storey: 'story',
  maths: 'math',
  orientate: 'orient',
  whilst: 'while',
  amongst: 'among',
  towards: 'toward',
  afterwards: 'afterward',
  forwards: 'forward',
  backwards: 'backward',
  upwards: 'upward',
  downwards: 'downward',
  outwards: 'outward',
  inwards: 'inward',
  cosy: 'cozy',
  cheque: 'check',
  catalogue: 'catalog',
  dialogue: 'dialog',
  prologue: 'prolog',
  analogue: 'analog',
  monologue: 'monolog',
  epilogue: 'epilog',
  skilful: 'skillful',
  wilful: 'willful',
  fulfilment: 'fulfillment',
  enrolment: 'enrollment',
  instalment: 'installment',
  fulfil: 'fulfill',
  enrol: 'enroll',
  distil: 'distill',
  enthral: 'enthrall',
  appal: 'appall',
  licence: 'license',
  practise: 'practice',
  pretence: 'pretense',
  offence: 'offense',
  defence: 'defense',
  metre: 'meter',
  litre: 'liter',
  centre: 'center',
  fibre: 'fiber',
  lustre: 'luster',
  theatre: 'theater',
  sabre: 'saber',
  sombre: 'somber',
  spectre: 'specter',
  calibre: 'caliber',
  manoeuvre: 'maneuver',
  oestrogen: 'estrogen',
  paediatric: 'pediatric',
  anaemia: 'anemia',
  anaesthetic: 'anesthetic',
  foetus: 'fetus',
  diarrhoea: 'diarrhea',
  haemorrhage: 'hemorrhage',
  leukaemia: 'leukemia',
  oesophagus: 'esophagus',
  encyclopaedia: 'encyclopedia',
  mediaeval: 'medieval',
  aeroplane: 'airplane',
  sulphur: 'sulfur',
  pyjamas: 'pajamas',
  sceptic: 'skeptic',
  moustache: 'mustache',
  artefact: 'artifact',
  behove: 'behoove',
  connexion: 'connection',
};

const OUR_EXCLUDE = new Set([
  'four', 'pour', 'your', 'tour', 'dour', 'sour', 'hour',
  'contour', 'detour', 'velour', 'glamour',
  'flour', 'scour', 'devour', 'amour', 'tambour', 'troubadour',
]);

const ISE_EXCLUDE = new Set([
  'advise', 'comprise', 'compromise', 'supervise', 'surprise', 'exercise',
  'improvise', 'revise', 'devise', 'demise', 'franchise', 'merchandise',
  'enterprise', 'disguise', 'surmise', 'excise', 'incise', 'circumcise',
  'concise', 'precise', 'premise', 'promise', 'otherwise', 'likewise',
  'clockwise', 'paradise', 'arise', 'praise', 'raise', 'cruise', 'bruise',
  'poise', 'noise', 'guise', 'reprise', 'wise'
]);

const DOUBLE_L_EXCLUDE = new Set([
  'dwelling', 'spelling', 'smelling', 'yelling', 'telling', 'selling',
  'compelling', 'propelling', 'repelling', 'quelling', 'swelling', 'shelling',
  'excelling', 'felling', 'belling', 'welling', 'knelling'
]);

// ---------------------------------------------------------------------------
// bestCandidate — picks the most common word (lowest rank) from candidates
// On the server this uses embedding wordIndex; here we use rankings rank.
// ---------------------------------------------------------------------------
function bestCandidate(candidates, rankings) {
  let best = null;
  let bestRank = Infinity;
  for (const word of candidates) {
    const rank = rankings[word];
    if (rank !== undefined && rank < bestRank) {
      bestRank = rank;
      best = word;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// toSingular — normalize plural words to singular form
// Uses rankings object as vocabulary (word in rankings)
// ---------------------------------------------------------------------------
export function toSingular(word, rankings) {
  if (word.length < 4) return word;
  if (SINGULAR_EXCLUDE.has(word)) return word;

  // -ies → -y (babies → baby)
  if (word.endsWith('ies') && word.length >= 5) {
    const s = word.slice(0, -3) + 'y';
    if (s in rankings) return s;
  }

  // -ves → try -f, -fe, and verb base -ve (knives→knife, gives→give)
  if (word.endsWith('ves') && word.length >= 5) {
    const candidates = [];
    const sf = word.slice(0, -3) + 'f';
    const sfe = word.slice(0, -3) + 'fe';
    const sve = word.slice(0, -1); // verb base: gives→give
    if (sf in rankings) candidates.push(sf);
    if (sfe in rankings) candidates.push(sfe);
    if (sve in rankings) candidates.push(sve);
    if (candidates.length > 0) return bestCandidate(candidates, rankings);
  }

  // -es → English plural rule is asymmetric:
  //   stems ending in s/sh/ch/x/z take -es  (box → boxes, wish → wishes)
  //   every other -e word just adds -s      (pore → pores, case → cases)
  // Previously this tried both candidates and let bestCandidate arbitrate
  // by rank, which picked "por" for "pores" — some games' rankings include
  // "por" (multilingual / abbreviation noise) with a lower rank than
  // "pore", so frequency arbitration lost to noise. The linguistic rule
  // is more reliable: pick the candidate that matches the stem pattern,
  // and don't fall back to the wrong one even if it's the only option.
  if (word.endsWith('es') && word.length >= 5) {
    const withoutS = word.slice(0, -1);
    const withoutEs = word.slice(0, -2);
    const stemNeedsE = /(s|sh|ch|x|z)$/i.test(withoutEs);
    if (stemNeedsE) {
      if (withoutEs in rankings) return withoutEs;
    } else {
      if (withoutS in rankings) return withoutS;
    }
  }

  // -s (but not -ss, -us, -is) → remove s
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    const s = word.slice(0, -1);
    if (s in rankings) return s;
  }

  return word;
}

// ---------------------------------------------------------------------------
// toAmerican — normalize British spelling to American
// ---------------------------------------------------------------------------
export function toAmerican(word, rankings) {
  // 1. Explicit irregular mapping
  if (BRITISH_TO_AMERICAN[word]) {
    const am = BRITISH_TO_AMERICAN[word];
    if (am in rankings) return am;
  }

  // 2. -our → -or (colour → color)
  if (word.endsWith('our') && word.length >= 5 && !OUR_EXCLUDE.has(word)) {
    const am = word.slice(0, -3) + 'or';
    if (am in rankings) return am;
  }

  // 3. -isation → -ization
  if (word.endsWith('isation')) {
    const am = word.slice(0, -7) + 'ization';
    if (am in rankings) return am;
  }

  // 4. -ise → -ize (realise → realize)
  if (word.endsWith('ise') && word.length >= 5 && !ISE_EXCLUDE.has(word)) {
    const am = word.slice(0, -3) + 'ize';
    if (am in rankings) return am;
  }

  // 5. -yse → -yze (analyse → analyze)
  if (word.endsWith('yse')) {
    const am = word.slice(0, -3) + 'yze';
    if (am in rankings) return am;
  }

  // 6. -elling → -eling / -elled → -eled
  if ((word.endsWith('elling') || word.endsWith('elled')) && !DOUBLE_L_EXCLUDE.has(word)) {
    const am = word.replace(/ll(ing|ed)$/, 'l$1');
    if (am in rankings) return am;
  }

  return word;
}

// ---------------------------------------------------------------------------
// processGuess — score a guess entirely on the client
// Returns { word, rank, isWin, isDuplicate } or null if invalid
// ---------------------------------------------------------------------------
const WIN_RANK = 1;
const GUESS_PATTERN = /^[a-z]+$/;

export function processGuess(input, rankings, guessedWords, vocabSet) {
  const raw = input.trim().toLowerCase();
  if (!raw || raw.includes(' ') || raw.includes('\t')) return null;

  // Strip non-letter characters
  const rawText = raw.replace(/[^a-z]/g, '');
  if (!rawText) return null;
  if (!GUESS_PATTERN.test(rawText)) return null;

  // Normalize: plural → singular, British → American
  const text = toAmerican(toSingular(rawText, rankings), rankings);

  // Duplicate detection
  if (guessedWords.has(text)) {
    return { word: text, rank: null, isWin: false, isDuplicate: true };
  }

  // Rank lookup:
  //   - In rankings (top 100k): exact rank
  //   - Real word but >100k:    100001 (displays as "100,000+")
  //   - Misspelt / unknown:     9999999
  let rank;
  if (text in rankings) {
    rank = rankings[text];
  } else if (vocabSet && vocabSet.has(text)) {
    rank = 100001;
  } else {
    rank = 9999999;
  }

  return {
    word: text,
    rank,
    isWin: rank === WIN_RANK,
    isDuplicate: false,
  };
}
