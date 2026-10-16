#!/usr/bin/env node
/**
 * Generate new target words for Searchable using semantic similarity.
 *
 * Strategy:
 * 1. Load all 3 model vocabularies AND vectors
 * 2. Compute the centroid (average vector) of the existing 1818 target words
 *    — this centroid represents "the kind of word we want" (concrete nouns)
 * 3. Apply hard character-level filters to reject garbage tokens
 * 4. Score remaining candidates by cosine similarity to the centroid
 * 5. Take top N — words semantically closest to existing concrete nouns
 *
 * Usage: node tools/generate-targets.js [count] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'data', 'models');
const TARGETS_PATH = path.join(__dirname, '..', 'data', 'target-words.json');
const COUNT = parseInt(process.argv[2]) || 2000;
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Load model with vectors ────────────────────────────────────────
function loadModel(modelName) {
  const dir = path.join(MODELS_DIR, modelName);
  const indexPath = path.join(dir, 'index.json');
  const vectorsPath = path.join(dir, 'vectors.bin');

  if (!fs.existsSync(indexPath) || !fs.existsSync(vectorsPath)) {
    console.log(`  [${modelName}] Not found, skipping.`);
    return null;
  }

  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const buf = fs.readFileSync(vectorsPath);

  // Ensure proper alignment for Float32Array
  const aligned = new ArrayBuffer(buf.length);
  new Uint8Array(aligned).set(buf);
  const vectors = new Float32Array(aligned);

  const wordIndex = new Map();
  for (let i = 0; i < idx.words.length; i++) {
    wordIndex.set(idx.words[i], i);
  }

  console.log(`  [${modelName}] ${idx.words.length.toLocaleString()} words, ${idx.dimensions}d`);

  return {
    name: modelName,
    words: idx.words,
    dimensions: idx.dimensions,
    vectors,
    wordIndex,
    getVector(word) {
      const i = this.wordIndex.get(word);
      if (i === undefined) return null;
      const offset = i * this.dimensions;
      return this.vectors.subarray(offset, offset + this.dimensions);
    }
  };
}

// ─── Vector math ────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

function computeCentroid(model, words) {
  const dim = model.dimensions;
  const centroid = new Float64Array(dim); // Use Float64 for accumulation precision
  let count = 0;

  for (const word of words) {
    const vec = model.getVector(word);
    if (!vec) continue;
    for (let i = 0; i < dim; i++) {
      centroid[i] += vec[i];
    }
    count++;
  }

  if (count === 0) return null;

  // Normalize to unit vector
  const result = new Float32Array(dim);
  let mag = 0;
  for (let i = 0; i < dim; i++) {
    result[i] = centroid[i] / count;
    mag += result[i] * result[i];
  }
  mag = Math.sqrt(mag);
  for (let i = 0; i < dim; i++) {
    result[i] /= mag;
  }

  return result;
}

// ─── Hard character-level filters ───────────────────────────────────
// These reject obvious garbage before we even look at vectors.

const VOWELS = new Set('aeiou'.split(''));

function passesHardFilters(word) {
  // Only lowercase letters
  if (!/^[a-z]+$/.test(word)) return false;

  // Length 3-14
  if (word.length < 3 || word.length > 14) return false;

  // Must contain at least one vowel
  let vowelCount = 0;
  for (const ch of word) {
    if (VOWELS.has(ch)) vowelCount++;
  }
  if (vowelCount === 0) return false;

  // At least 20% vowels (catches consonant-heavy garbage like "bckgrnd")
  if (vowelCount / word.length < 0.2) return false;

  // No 3+ consecutive identical characters (catches "aaa", "aaaa", "aabb" style)
  for (let i = 2; i < word.length; i++) {
    if (word[i] === word[i-1] && word[i] === word[i-2]) return false;
  }

  // No double-double pattern (aabb, eeff)
  for (let i = 3; i < word.length; i++) {
    if (word[i] === word[i-1] && word[i-2] === word[i-3] && word[i] !== word[i-2]) {
      // Allow common English patterns like "bookkeeper"
      // But reject "aabb", "ccdd" etc.
      return false;
    }
  }

  // Reject words with 4+ consecutive consonants (rare in English, common in garbage)
  let consec = 0;
  for (const ch of word) {
    if (!VOWELS.has(ch)) {
      consec++;
      if (consec >= 5) return false; // Allow 4 (e.g., "strengths"), reject 5+
    } else {
      consec = 0;
    }
  }

  // Reject words starting with unusual bigrams that barely appear in English
  const start2 = word.slice(0, 2);
  const UNLIKELY_STARTS = new Set([
    'aa', 'ae', 'ah', 'ao', 'bv', 'bw', 'bx', 'bz',
    'cb', 'cd', 'cf', 'cg', 'cj', 'ck', 'cm', 'cn', 'cp', 'cq', 'cv', 'cw', 'cx', 'cz',
    'db', 'dc', 'dd', 'df', 'dg', 'dh', 'dj', 'dk', 'dl', 'dm', 'dn', 'dp', 'dq', 'dt', 'dv', 'dx', 'dz',
    'eb', 'eg', 'eh', 'ej', 'ek', 'eo', 'ep', 'eq', 'ew', 'ey',
    'fb', 'fc', 'fd', 'ff', 'fg', 'fh', 'fj', 'fk', 'fm', 'fn', 'fp', 'fq', 'fs', 'ft', 'fv', 'fw', 'fx', 'fz',
    'gb', 'gc', 'gd', 'gf', 'gg', 'gj', 'gk', 'gm', 'gp', 'gq', 'gs', 'gt', 'gv', 'gw', 'gx', 'gz',
    'hb', 'hc', 'hd', 'hf', 'hg', 'hh', 'hj', 'hk', 'hl', 'hm', 'hn', 'hp', 'hq', 'hr', 'hs', 'ht', 'hv', 'hw', 'hx', 'hz',
    'ib', 'ig', 'ih', 'ii', 'ij', 'ik', 'io', 'iu', 'iw', 'ix', 'iy', 'iz',
    'jb', 'jc', 'jd', 'jf', 'jg', 'jh', 'jj', 'jk', 'jl', 'jm', 'jn', 'jp', 'jq', 'jr', 'js', 'jt', 'jv', 'jw', 'jx', 'jz',
    'kb', 'kc', 'kd', 'kf', 'kg', 'kh', 'kj', 'kk', 'kl', 'km', 'kp', 'kq', 'kr', 'ks', 'kt', 'kv', 'kw', 'kx', 'kz',
    'lb', 'lc', 'ld', 'lf', 'lg', 'lh', 'lj', 'lk', 'll', 'lm', 'ln', 'lp', 'lq', 'lr', 'ls', 'lt', 'lv', 'lw', 'lx', 'lz',
    'mb', 'mc', 'md', 'mf', 'mg', 'mh', 'mj', 'mk', 'ml', 'mm', 'mn', 'mp', 'mq', 'mr', 'ms', 'mt', 'mv', 'mw', 'mx', 'mz',
    'nb', 'nc', 'nd', 'nf', 'ng', 'nj', 'nk', 'nl', 'nm', 'nn', 'np', 'nq', 'nr', 'ns', 'nt', 'nv', 'nw', 'nx', 'nz',
    'oa', 'oe', 'og', 'oh', 'oi', 'oj', 'ok', 'oo', 'oq', 'oy', 'oz',
    'pb', 'pc', 'pd', 'pf', 'pg', 'pj', 'pk', 'pm', 'pn', 'pp', 'pq', 'ps', 'pt', 'pv', 'pw', 'px', 'pz',
    'qa', 'qb', 'qc', 'qd', 'qe', 'qf', 'qg', 'qh', 'qi', 'qj', 'qk', 'ql', 'qm', 'qn', 'qo', 'qp', 'qq', 'qr', 'qs', 'qt', 'qv', 'qw', 'qx', 'qy', 'qz',
    'rb', 'rc', 'rd', 'rf', 'rg', 'rj', 'rk', 'rl', 'rm', 'rn', 'rp', 'rq', 'rr', 'rs', 'rt', 'rv', 'rw', 'rx', 'rz',
    'sb', 'sd', 'sf', 'sg', 'sj', 'sr', 'ss', 'sv', 'sx', 'sz',
    'tb', 'tc', 'td', 'tf', 'tg', 'tj', 'tk', 'tl', 'tm', 'tn', 'tp', 'tq', 'ts', 'tt', 'tv', 'tx', 'tz',
    'ub', 'uc', 'ud', 'uf', 'ug', 'uh', 'uj', 'uk', 'uo', 'uu', 'uw', 'ux', 'uy', 'uz',
    'vb', 'vc', 'vd', 'vf', 'vg', 'vh', 'vj', 'vk', 'vl', 'vm', 'vn', 'vp', 'vq', 'vr', 'vs', 'vt', 'vu', 'vv', 'vw', 'vx', 'vy', 'vz',
    'wb', 'wc', 'wd', 'wf', 'wg', 'wj', 'wk', 'wl', 'wm', 'wn', 'wp', 'wq', 'ws', 'wt', 'wu', 'wv', 'ww', 'wx', 'wy', 'wz',
    'xa', 'xb', 'xc', 'xd', 'xe', 'xf', 'xg', 'xh', 'xi', 'xj', 'xk', 'xl', 'xm', 'xn', 'xo', 'xp', 'xq', 'xr', 'xs', 'xt', 'xu', 'xv', 'xw', 'xx', 'xy', 'xz',
    'yb', 'yc', 'yd', 'yf', 'yg', 'yh', 'yj', 'yk', 'yl', 'ym', 'yn', 'yp', 'yq', 'yr', 'ys', 'yt', 'yv', 'yw', 'yx', 'yy', 'yz',
    'za', 'zb', 'zc', 'zd', 'zf', 'zg', 'zh', 'zj', 'zk', 'zl', 'zm', 'zn', 'zp', 'zq', 'zr', 'zs', 'zt', 'zu', 'zv', 'zw', 'zx', 'zy', 'zz',
  ]);
  if (UNLIKELY_STARTS.has(start2)) return false;

  return true;
}

// ─── Suffix & grammar filters ───────────────────────────────────────
const BAD_SUFFIXES = [
  'ing', 'ed', 'ly', 'ness', 'ment', 'tion', 'sion', 'ous', 'ful',
  'less', 'able', 'ible', 'ive', 'ism', 'ist', 'ity', 'ence', 'ance',
  'ish', 'ize', 'ise', 'ify', 'ory', 'ual', 'ial',
  'ical', 'ally', 'ward', 'wise', 'like', 'emic', 'atic',
  'ated', 'ting', 'ted', 'ised', 'ized', 'ling',
  'escent', 'ular', 'ular',
];

// Noun-looking words that end with "bad" suffixes but are actually concrete nouns
const SUFFIX_EXCEPTIONS = new Set([
  // -ing nouns
  'pudding', 'ceiling', 'herring', 'sterling', 'stocking', 'building',
  'earring', 'sibling', 'offspring', 'dumpling', 'duckling', 'gosling',
  'seedling', 'sapling', 'yearling', 'darling', 'inkling',
  'shilling', 'farthing', 'flooring', 'roofing', 'stuffing', 'frosting',
  'filling', 'railing', 'siding', 'casing', 'lining', 'binding',
  'awning', 'bunting', 'coating', 'carving', 'etching', 'drawing',
  'painting', 'blessing', 'offering', 'morning', 'evening',
  'string', 'spring', 'king', 'ring', 'wing', 'thing', 'swing',
  'sling', 'sting', 'fling', 'cling', 'railing', 'dwelling',
  'covering', 'wrapping', 'padding', 'bedding', 'webbing', 'rigging',
  'piping', 'tubing', 'glazing', 'paneling', 'molding', 'bushing',
  'bushing', 'grating', 'netting', 'matting', 'decking',
  // -ed nouns
  'shed', 'bed', 'sled', 'shred', 'bread', 'thread',
  // -ly nouns
  'lily', 'belly', 'jelly', 'holly', 'bully', 'alley',
  'valley', 'pulley', 'volley', 'trolley', 'galley', 'barley',
  'parsley', 'medley', 'fly', 'butterfly', 'dragonfly', 'firefly',
  'family', 'assembly',
  // -ment nouns (concrete)
  'cement', 'garment', 'pigment', 'filament', 'element',
  'ointment', 'parchment', 'apartment', 'basement', 'compartment',
  'instrument', 'ornament', 'tournament', 'document', 'monument',
  'sediment', 'parliament', 'department', 'fragment',
  // -tion nouns (concrete)
  'bastion', 'potion', 'station', 'auction', 'skeleton',
  'cotton', 'button', 'mutton', 'piston', 'baton', 'carton',
  'crouton', 'futon', 'plantation', 'constellation', 'ammunition',
  // -ure nouns
  'creature', 'furniture', 'scripture', 'sculpture', 'pasture',
  'moisture', 'mixture', 'fixture', 'texture', 'fracture',
  'posture', 'denture', 'miniature', 'treasure',
  'enclosure',
  // -ance/-ence nouns
  'lance', 'dance', 'fence', 'ambulance', 'substance', 'fragrance',
  'entrance', 'nuisance', 'sentence', 'audience', 'evidence',
  'residence', 'science', 'sequence',
  // -ive nouns
  'olive', 'archive', 'locomotive', 'detective', 'hive', 'beehive',
  // -ary nouns
  'aviary', 'granary', 'canary', 'apiary', 'estuary',
  'sanctuary', 'library', 'diary', 'dictionary',
  'infirmary', 'rosemary',
  // -ory nouns
  'armory', 'factory', 'inventory', 'laboratory',
  'observatory', 'conservatory', 'dormitory', 'directory',
  'refectory', 'repository', 'lavatory', 'rectory', 'story',
  'hickory', 'ivory', 'chicory',
  // -ist nouns
  'fist', 'wrist', 'mist', 'gist', 'twist', 'list',
  // -ism nouns
  'prism', 'organism', 'mechanism',
  // -ling nouns
  'duckling', 'gosling', 'seedling', 'sapling', 'yearling',
  'darling', 'underling', 'dumpling', 'inkling', 'starling',
  'foundling', 'changeling', 'hatchling',
]);

function passesSuffixFilter(word) {
  if (SUFFIX_EXCEPTIONS.has(word)) return true;

  for (const suf of BAD_SUFFIXES) {
    if (word.endsWith(suf) && word.length > suf.length + 2) {
      return false;
    }
  }
  return true;
}

// ─── Derived adjective detection ────────────────────────────────────
// Catches adjectives formed from nouns: muddy←mud, wooden←wood, etc.
const ADJECTIVE_NOUN_EXCEPTIONS = new Set([
  // -y words that ARE nouns, not adjectives
  'baby', 'berry', 'body', 'bunny', 'bury', 'candy', 'celery', 'cherry',
  'chimney', 'city', 'copy', 'county', 'country', 'curry', 'daisy',
  'dairy', 'derby', 'dinghy', 'donkey', 'ebony', 'ferry', 'fury',
  'gallery', 'gully', 'gravy', 'hobby', 'honey', 'ivory', 'jelly',
  'journey', 'jury', 'kidney', 'kitty', 'levy', 'lorry', 'money',
  'monkey', 'navy', 'pansy', 'pantry', 'penny', 'plenty', 'ploy',
  'pony', 'poppy', 'poultry', 'puppy', 'quarry', 'query', 'ruby',
  'sally', 'storey', 'story', 'study', 'supply', 'survey', 'turkey',
  'valley', 'volley', 'whiskey', 'alley', 'army', 'battery',
  'belly', 'buddy', 'buggy', 'canopy', 'century', 'colony',
  'company', 'convoy', 'deputy', 'destiny', 'diary', 'discovery',
  'dynasty', 'ecstasy', 'embassy', 'energy', 'entry', 'factory',
  'galaxy', 'gentry', 'glory', 'grocery', 'harmony', 'history',
  'industry', 'infantry', 'inventory', 'ivy', 'jetty', 'jockey',
  'laboratory', 'laundry', 'legacy', 'library', 'lottery', 'luxury',
  'masonry', 'mastery', 'melody', 'memory', 'mercy', 'ministry',
  'misery', 'monastery', 'mystery', 'nursery', 'poetry', 'pottery',
  'priory', 'privacy', 'progeny', 'property', 'proxy', 'remedy',
  'rivalry', 'robbery', 'rosemary', 'rotary', 'salary', 'scenery',
  'sherry', 'smithy', 'sorcery', 'strategy', 'surgery', 'tapestry',
  'theory', 'therapy', 'tragedy', 'treasury', 'trilogy', 'trophy',
  'university', 'vacancy', 'victory',
]);

function isDerivedAdjective(word, allModelWords) {
  // -y adjectives from nouns: muddy←mud, slimy←slime, airy←air, etc.
  if (word.endsWith('y') && word.length >= 4 && !ADJECTIVE_NOUN_EXCEPTIONS.has(word)) {
    // Check: base = word without trailing y
    const base1 = word.slice(0, -1); // muddy → mudd (won't match, but try)
    const base2 = word.slice(0, -2); // muddy → mud (if doubled consonant)
    const base3 = word.slice(0, -1) + 'e'; // slimy → slime

    // If word ends in doubled consonant + y, check single consonant base
    if (word.length >= 5 && word[word.length - 2] === word[word.length - 3]) {
      // muddy → mud, foggy → fog, fuzzy → fuzz... wait fuzz ends in zz
      if (allModelWords.has(base2)) return true;
    }
    // slimy → slime, bony → bone
    if (allModelWords.has(base3)) return true;
    // airy → air, rainy → rain
    if (allModelWords.has(base1)) return true;
  }

  // -en adjectives from nouns: wooden←wood, woolen←wool, golden←gold
  if (word.endsWith('en') && word.length >= 5) {
    const enBase = word.slice(0, -2);
    if (allModelWords.has(enBase) && ['wooden', 'woolen', 'golden', 'earthen', 'flaxen',
        'leaden', 'oaken', 'silken', 'waxen', 'brazen', 'molten', 'sunken',
        'drunken', 'mistaken', 'barren', 'sodden', 'rotten', 'swollen',
        'frozen', 'chosen', 'broken', 'spoken', 'stolen', 'woven'].includes(word)) {
      return true;
    }
  }

  // -ic adjectives (most -ic words are adjectives)
  if (word.endsWith('ic') && word.length >= 5) {
    const IC_NOUN_EXCEPTIONS = new Set([
      'fabric', 'garlic', 'relic', 'tunic', 'tonic', 'panic', 'comic',
      'clinic', 'epic', 'mosaic', 'ceramic', 'music', 'magic', 'logic',
      'topic', 'attic', 'arctic', 'republic', 'picnic', 'mimic', 'antic',
      'traffic', 'plastic', 'elastic', 'classic', 'lunatic', 'fanatic',
    ]);
    if (!IC_NOUN_EXCEPTIONS.has(word)) return true;
  }

  return false;
}

// ─── Plural detection ───────────────────────────────────────────────
function isPlural(word, allModelWords) {
  if (word.length < 4) return false;
  if (!word.endsWith('s')) return false;
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return false;

  // words ending in -s: check if base form exists
  const base = word.slice(0, -1);
  if (allModelWords.has(base)) return true;

  // words ending in -es: check base
  if (word.endsWith('es') && word.length >= 5) {
    const esBase = word.slice(0, -2);
    if (allModelWords.has(esBase)) return true;
  }

  // words ending in -ies: check -y form
  if (word.endsWith('ies') && word.length >= 5) {
    const yBase = word.slice(0, -3) + 'y';
    if (allModelWords.has(yBase)) return true;
  }

  // Irregular Latin/Greek plurals
  // -ae plurals: antennae←antenna, larvae←larva, algae←alga
  if (word.endsWith('ae') && word.length >= 5) {
    const aBase = word.slice(0, -1); // antennae → antenna
    if (allModelWords.has(aBase)) return true;
  }
  // -i plurals: fungi←fungus, cacti←cactus, alumni←alumnus
  if (word.endsWith('i') && word.length >= 5) {
    const usBase = word.slice(0, -1) + 'us'; // fungi → fungus
    if (allModelWords.has(usBase)) return true;
  }

  return false;
}

// ─── Blocked words ──────────────────────────────────────────────────
const BLOCKED = new Set();
function block(...words) { for (const w of words) BLOCKED.add(w.toLowerCase()); }

// Function words, pronouns, prepositions, conjunctions
block(
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'his', 'how', 'its', 'let',
  'may', 'new', 'now', 'old', 'see', 'way', 'who', 'did', 'get', 'got',
  'him', 'she', 'too', 'use', 'yet', 'also', 'back', 'been', 'come',
  'each', 'even', 'from', 'give', 'good', 'have', 'help', 'here', 'high',
  'just', 'know', 'last', 'long', 'look', 'make', 'many', 'more', 'most',
  'much', 'must', 'only', 'over', 'same', 'some', 'such', 'take',
  'tell', 'than', 'that', 'them', 'then', 'they', 'this', 'very',
  'want', 'well', 'were', 'what', 'when', 'will', 'with', 'your',
  'about', 'after', 'could', 'every', 'first', 'found', 'great',
  'never', 'other', 'right', 'shall', 'since', 'still', 'their',
  'there', 'these', 'think', 'those', 'three', 'under', 'until',
  'where', 'which', 'while', 'whole', 'whose', 'would',
  'like', 'into', 'said', 'does', 'done', 'went', 'made', 'before',
  'should', 'because', 'between', 'through', 'might', 'again', 'often',
  'around', 'another', 'without', 'within', 'toward', 'already',
  'though', 'whether', 'almost', 'against', 'however', 'perhaps',
  'rather', 'either', 'neither', 'enough', 'always', 'above', 'below',
  'across', 'among', 'along', 'behind', 'beyond', 'beside', 'except',
  'upon', 'else', 'once', 'twice', 'both', 'several', 'certain',
  'fewer', 'less', 'least', 'worse', 'worst', 'better', 'best', 'next',
);

// Common verbs (not nouns)
block(
  'ask', 'run', 'turn', 'move', 'live', 'need', 'mean', 'open', 'close',
  'seem', 'show', 'hear', 'play', 'feel', 'hold', 'bring', 'write',
  'lead', 'begin', 'stand', 'lose', 'pay', 'meet', 'buy', 'send',
  'fall', 'cut', 'reach', 'stay', 'kill', 'remain', 'speak', 'read',
  'spend', 'grow', 'draw', 'walk', 'win', 'teach', 'offer', 'happen',
  'add', 'appear', 'cover', 'produce', 'develop', 'choose', 'wear',
  'raise', 'pick', 'pull', 'push', 'catch', 'drop', 'carry', 'throw',
  'deal', 'fight', 'clear', 'return', 'serve', 'watch', 'cause', 'pass',
  'lie', 'accept', 'die', 'drive', 'hit', 'follow', 'include', 'enjoy',
  'stop', 'start', 'join', 'save', 'sing', 'sit', 'eat', 'drink',
  'sleep', 'talk', 'change', 'allow', 'force', 'rise', 'hang', 'strike',
  'shoot', 'touch', 'sell', 'fill', 'act', 'argue', 'avoid', 'bear',
  'beat', 'belong', 'bind', 'bite', 'blow', 'burn', 'burst', 'call',
  'care', 'claim', 'climb', 'commit', 'compare', 'consider', 'contain',
  'continue', 'control', 'cook', 'cost', 'count', 'cross', 'cry',
  'decide', 'demand', 'depend', 'describe', 'destroy', 'determine',
  'discover', 'discuss', 'divide', 'drag', 'dress', 'earn', 'enter',
  'escape', 'examine', 'exist', 'expect', 'explain', 'express', 'extend',
  'fail', 'feed', 'forget', 'form', 'gain', 'gather', 'grab', 'grant',
  'handle', 'hide', 'imagine', 'improve', 'indicate', 'insist', 'intend',
  'involve', 'jump', 'lack', 'laugh', 'lay', 'learn', 'leave', 'lend',
  'lift', 'link', 'listen', 'manage', 'mark', 'matter', 'measure',
  'mention', 'mind', 'miss', 'note', 'notice', 'obtain', 'occur',
  'order', 'own', 'pack', 'paint', 'perform', 'permit', 'plan',
  'please', 'point', 'pour', 'prefer', 'prepare', 'present', 'press',
  'prevent', 'promise', 'protect', 'prove', 'provide', 'publish',
  'realize', 'receive', 'recognize', 'record', 'reduce', 'reflect',
  'refuse', 'regard', 'relate', 'release', 'remember', 'remove',
  'repeat', 'replace', 'report', 'represent', 'require', 'respond',
  'rest', 'result', 'reveal', 'ride', 'roll', 'rule', 'rush',
  'satisfy', 'seek', 'settle', 'shake', 'shape', 'share', 'shift',
  'shut', 'sign', 'slip', 'smile', 'snap', 'solve', 'sort', 'sound',
  'split', 'spread', 'steal', 'stick', 'store', 'struggle', 'study',
  'succeed', 'suffer', 'suggest', 'supply', 'suppose', 'surprise',
  'surround', 'survive', 'suspect', 'swim', 'tear', 'tend', 'test',
  'threaten', 'tie', 'total', 'train', 'treat', 'trust', 'visit',
  'vote', 'wait', 'wake', 'warn', 'wash', 'waste', 'wave', 'wonder',
  'worry', 'wrap', 'yield',
);

// Adjectives
block(
  'big', 'small', 'large', 'little', 'tall', 'short', 'low', 'high',
  'upper', 'lower', 'inner', 'outer', 'front', 'rear', 'left', 'far',
  'near', 'true', 'sure', 'real', 'full', 'deep', 'thick', 'thin',
  'flat', 'round', 'sharp', 'smooth', 'rough', 'soft', 'tough', 'hard',
  'firm', 'solid', 'heavy', 'light', 'hot', 'cold', 'warm', 'cool',
  'wet', 'dry', 'fresh', 'clean', 'dirty', 'dark', 'bright', 'clear',
  'plain', 'simple', 'easy', 'fast', 'slow', 'quick', 'rapid', 'sudden',
  'quiet', 'loud', 'silent', 'gentle', 'fierce', 'wild', 'tame', 'rich',
  'poor', 'cheap', 'free', 'busy', 'empty', 'huge', 'tiny', 'vast',
  'brief', 'raw', 'pure', 'mere', 'sole', 'lone', 'main',
  'white', 'black', 'red', 'blue', 'green', 'yellow', 'brown',
  'grey', 'gray', 'pink', 'purple', 'orange',
  'happy', 'sad', 'angry', 'afraid', 'eager', 'proud', 'sorry',
  'pretty', 'ugly', 'handsome', 'beautiful', 'lovely',
  'ancient', 'modern', 'medieval', 'contemporary', 'traditional',
  'acoustic', 'organic', 'exotic', 'domestic', 'fantastic', 'tragic',
  'toxic', 'chronic', 'cosmic', 'scenic', 'rustic', 'cryptic',
  'airy', 'breezy', 'chilly', 'cloudy', 'crispy', 'curly', 'dusty',
  'early', 'fancy', 'filthy', 'flaky', 'frosty', 'funny', 'fuzzy',
  'gloomy', 'glossy', 'greasy', 'grumpy', 'guilty', 'hairy', 'hazy',
  'holy', 'icy', 'itchy', 'juicy', 'lazy', 'lofty', 'lonely',
  'lucky', 'messy', 'mighty', 'milky', 'misty', 'moody', 'muddy',
  'murky', 'mushy', 'musty', 'nasty', 'noisy', 'picky', 'rainy',
  'risky', 'rocky', 'roomy', 'rosy', 'rusty', 'salty', 'sandy',
  'scary', 'shady', 'shaky', 'shiny', 'silky', 'silly', 'slimy',
  'smoky', 'snowy', 'soggy', 'spicy', 'sticky', 'stormy', 'stuffy',
  'sunny', 'tasty', 'thirsty', 'thorny', 'tidy', 'tricky', 'ugly',
  'wavy', 'weary', 'windy', 'witty', 'woody', 'woolly', 'yummy',
  'lumpy', 'meaty', 'nutty', 'peachy', 'pearly', 'peppy',
  'perky', 'plucky', 'pouty', 'pushy', 'racy', 'ratty', 'ready',
  'sappy', 'sassy', 'savvy', 'seedy', 'showy', 'sketchy',
  'skinny', 'snooty', 'snowy', 'soupy', 'steamy', 'steely',
  'stony', 'stuffy', 'sultry', 'swampy', 'tacky', 'tangy',
  'teeny', 'touchy', 'trashy', 'trendy', 'trusty', 'wacky',
  'wealthy', 'weedy', 'whiny', 'zany', 'zippy',
  'worn', 'torn', 'born', 'forlorn', 'sworn',
  'alive', 'alone', 'asleep', 'awake', 'aware', 'bare', 'bizarre',
  'bland', 'bleak', 'blind', 'blunt', 'bold', 'brave', 'broad',
  'calm', 'coarse', 'compact', 'content', 'cozy', 'crude', 'cruel',
  'damp', 'deaf', 'dense', 'dim', 'dire', 'distinct', 'divine',
  'dull', 'eager', 'earnest', 'elegant', 'faint', 'fertile',
  'fragile', 'frail', 'frank', 'glad', 'graceful', 'grim', 'gross',
  'harsh', 'hollow', 'humble', 'ideal', 'immense', 'immune',
  'keen', 'lame', 'lean', 'lush', 'mad', 'mature', 'meek', 'mild',
  'moist', 'naive', 'neat', 'noble', 'numb', 'obscure', 'odd',
  'pale', 'petty', 'plump', 'potent', 'prone', 'quaint', 'rigid',
  'ripe', 'robust', 'rude', 'sacred', 'savage', 'scarce', 'selfish',
  'serene', 'severe', 'shallow', 'sheer', 'shrewd', 'shy',
  'sincere', 'slender', 'slim', 'sly', 'solemn', 'sour', 'spare',
  'stark', 'steep', 'stern', 'stiff', 'subtle', 'superb', 'supreme',
  'swift', 'tender', 'tense', 'timid', 'trivial', 'vague', 'vain',
  'vivid', 'void', 'vulnerable', 'weary', 'wicked', 'yonder',
  'strange', 'favorite', 'favourite', 'royal', 'loyal', 'legal',
  'local', 'oral', 'rural', 'urban', 'tribal', 'naval', 'fatal',
  'vital', 'dental', 'mental', 'total', 'neutral', 'mutual',
  'annual', 'manual', 'visual', 'actual', 'casual', 'equal',
  'sexual', 'usual', 'normal', 'formal', 'moral', 'final',
  'original', 'natural', 'digital', 'central', 'general',
  'federal', 'several', 'special', 'typical', 'tropical', 'optical',
  'musical', 'medical', 'chemical', 'physical', 'magical',
  'classical', 'biblical', 'surgical', 'vertical', 'horizontal',
  'identical', 'mechanical', 'electrical', 'historical', 'political',
  'familiar', 'popular', 'similar', 'regular', 'circular', 'solar',
  'nuclear', 'cellular', 'muscular', 'secular', 'singular', 'lunar',
  'polar', 'angular', 'stellar', 'linear', 'molecular',
  'proper', 'bitter', 'clever', 'eager', 'inner', 'outer',
  'upper', 'lower', 'utter', 'former', 'latter', 'elder',
  'major', 'minor', 'junior', 'senior', 'prior', 'superior',
  'inferior', 'interior', 'exterior', 'anterior', 'posterior',
  'literary', 'military', 'ordinary', 'necessary', 'primary',
  'secondary', 'temporary', 'legendary', 'imaginary', 'solitary',
  'dietary', 'honorary',
  'weird', 'diverse', 'adverse', 'intense', 'immense', 'dense',
  'remote', 'supreme', 'extreme', 'mere', 'rare', 'secure',
);

// Abstract nouns (not guessable by semantic similarity to physical things)
block(
  'ability', 'absence', 'abuse', 'access', 'account', 'action', 'activity',
  'advice', 'affair', 'age', 'agency', 'aim', 'amount', 'analysis',
  'anger', 'answer', 'appeal', 'approach', 'area', 'argument', 'aspect',
  'attempt', 'attention', 'attitude', 'authority', 'balance', 'basis',
  'battle', 'benefit', 'birth', 'bit', 'body', 'bottom', 'budget',
  'burden', 'business', 'call', 'campaign', 'capacity', 'career', 'case',
  'cause', 'centre', 'challenge', 'chance', 'charge', 'check', 'choice',
  'circumstance', 'claim', 'class', 'climate', 'code', 'comment',
  'commitment', 'committee', 'community', 'company', 'competition',
  'concern', 'condition', 'conflict', 'connection', 'consequence',
  'contact', 'content', 'context', 'contract', 'contribution', 'control',
  'conversation', 'copy', 'cost', 'council', 'couple', 'course', 'credit',
  'crime', 'crisis', 'criticism', 'culture', 'damage', 'danger', 'data',
  'date', 'deal', 'death', 'debate', 'debt', 'decade', 'decision',
  'defence', 'degree', 'demand', 'democracy', 'design', 'desire',
  'detail', 'difference', 'direction', 'discipline', 'disease', 'dispute',
  'doubt', 'duty', 'economy', 'edge', 'education', 'effect', 'effort',
  'election', 'emergency', 'emphasis', 'employment', 'energy',
  'enterprise', 'environment', 'episode', 'error', 'event', 'example',
  'exchange', 'exercise', 'existence', 'experience', 'experiment',
  'explanation', 'expression', 'extent', 'face', 'fact', 'factor',
  'failure', 'faith', 'fashion', 'fate', 'fault', 'fear', 'feature',
  'feeling', 'field', 'figure', 'finding', 'focus', 'force', 'form',
  'framework', 'freedom', 'function', 'fund', 'future', 'gap',
  'generation', 'goal', 'grade', 'ground', 'group', 'growth', 'guide',
  'half', 'head', 'health', 'help', 'idea', 'identity', 'impact',
  'importance', 'impression', 'income', 'increase', 'independence',
  'index', 'industry', 'influence', 'information', 'initiative', 'injury',
  'instance', 'institution', 'insurance', 'intelligence', 'intention',
  'interest', 'introduction', 'investment', 'issue', 'item', 'job',
  'judgment', 'justice', 'kind', 'knowledge', 'labour', 'lack',
  'language', 'law', 'leader', 'league', 'length', 'lesson', 'level',
  'life', 'limit', 'line', 'link', 'list', 'loss', 'love', 'luck',
  'majority', 'manner', 'market', 'mass', 'match', 'material', 'matter',
  'meaning', 'measure', 'media', 'method', 'mind', 'minority', 'mistake',
  'model', 'moment', 'money', 'mood', 'motion', 'movement', 'murder',
  'nature', 'need', 'news', 'note', 'notion', 'object', 'occasion',
  'offer', 'office', 'operation', 'opinion', 'opportunity', 'opposition',
  'option', 'order', 'origin', 'outcome', 'output', 'outside', 'owner',
  'pair', 'part', 'partner', 'party', 'past', 'path', 'pattern', 'peace',
  'people', 'percentage', 'period', 'person', 'phase', 'philosophy',
  'piece', 'plan', 'platform', 'player', 'pleasure', 'policy', 'politics',
  'population', 'position', 'post', 'potential', 'power', 'practice',
  'presence', 'pressure', 'price', 'principle', 'priority', 'problem',
  'procedure', 'process', 'product', 'production', 'profit', 'program',
  'progress', 'project', 'promise', 'proportion', 'proposal', 'protection',
  'provision', 'purpose', 'quality', 'quarter', 'question', 'range',
  'rank', 'rate', 'ratio', 'reaction', 'reason', 'record', 'reform',
  'region', 'relation', 'release', 'relief', 'religion', 'report',
  'request', 'research', 'resource', 'response', 'result', 'return',
  'review', 'revolution', 'reward', 'right', 'risk', 'role', 'round',
  'route', 'rule', 'safety', 'sale', 'sample', 'scale', 'scene',
  'schedule', 'scheme', 'scope', 'search', 'season', 'seat', 'secret',
  'sector', 'security', 'sense', 'series', 'service', 'session', 'share',
  'shift', 'shock', 'show', 'side', 'sign', 'signal', 'silence', 'site',
  'size', 'skill', 'sleep', 'smile', 'society', 'solution', 'sort',
  'soul', 'source', 'space', 'speech', 'speed', 'spirit', 'sport',
  'spread', 'staff', 'stage', 'standard', 'start', 'state', 'status',
  'step', 'stock', 'strategy', 'strength', 'strike', 'struggle',
  'structure', 'style', 'subject', 'success', 'sum', 'supply', 'support',
  'survey', 'survival', 'switch', 'system', 'talk', 'task', 'taste',
  'tax', 'team', 'technique', 'technology', 'term', 'test', 'text',
  'theme', 'theory', 'thought', 'threat', 'till', 'tip', 'tone', 'tool',
  'top', 'topic', 'total', 'touch', 'tour', 'track', 'trade', 'traffic',
  'trend', 'trial', 'trouble', 'trust', 'truth', 'turn', 'type', 'union',
  'unit', 'use', 'user', 'value', 'variety', 'version', 'view', 'voice',
  'volume', 'wage', 'walk', 'war', 'waste', 'wealth', 'week', 'weight',
  'wish', 'wonder', 'word', 'worth', 'lot', 'set', 'spot', 'row',
  'drop', 'run', 'cut', 'hit', 'shot', 'mark', 'break',
);

// Time/date words
block(
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'january', 'february', 'march', 'april', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'christmas', 'easter', 'halloween', 'thanksgiving',
  'yesterday', 'today', 'tomorrow', 'tonight', 'afternoon', 'midnight',
  'noon',
);

// Numbers, quantifiers
block(
  'percent', 'billion', 'million', 'thousand', 'hundred', 'dozen',
  'zero', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty',
  'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
);

// Family/person words
block(
  'man', 'woman', 'men', 'women', 'boy', 'girl', 'child', 'baby',
  'adult', 'human', 'person', 'lady', 'sir', 'lord', 'master',
  'father', 'mother', 'son', 'daughter', 'brother', 'sister',
  'husband', 'wife', 'uncle', 'aunt', 'nephew', 'niece',
  'grandfather', 'grandmother', 'grandson', 'granddaughter',
);

// Pronouns, determiners, etc.
block(
  'himself', 'herself', 'itself', 'themselves', 'myself', 'yourself',
  'ourselves', 'somebody', 'someone', 'something', 'somewhere',
  'nobody', 'anyone', 'anything', 'anywhere', 'everyone', 'everything',
  'everywhere', 'whoever', 'whatever', 'whenever', 'wherever',
);

// Titles, abbreviations
block(
  'mr', 'mrs', 'ms', 'dr', 'prof', 'gen', 'col', 'sgt', 'cpl',
  'govt', 'corp', 'inc', 'ltd', 'dept', 'assn', 'intl', 'natl',
  'univ', 'misc', 'approx', 'assoc', 'admin', 'mgmt', 'comm',
  'tech', 'info', 'org', 'edu', 'http', 'www', 'blog', 'wiki',
  'app', 'web', 'email', 'cyber',
);

// Offensive
block(
  'slave', 'slavery', 'whore', 'slut', 'bitch', 'bastard', 'damn',
  'hell', 'crap', 'piss', 'shit', 'fuck', 'ass', 'cock',
  'rape', 'suicide', 'genocide', 'holocaust', 'torture',
  'heroin', 'cocaine', 'meth', 'crack',
);

// Names that might slip through semantic filtering
block(
  'popeye', 'garfield', 'tarzan', 'pinocchio', 'godzilla',
  'dracula', 'frankenstein', 'rapunzel', 'cinderella',
);

// Abstract nouns that semantic similarity might rank high
block(
  'poetry', 'prose', 'fiction', 'genre', 'anthem', 'hymn',
  'myth', 'legend', 'lore', 'saga', 'epic', 'tale', 'fable',
  'dialect', 'slang', 'jargon', 'syntax', 'grammar', 'verse',
  'diet', 'ritual', 'custom', 'habit', 'tradition', 'ceremony',
  'heritage', 'folklore', 'cuisine', 'accent', 'dialect',
  'wonderland',
);

// Filler/interjection
block(
  'yeah', 'okay', 'nah', 'hmm', 'wow', 'hey', 'hello', 'goodbye',
  'sorry', 'please', 'thanks', 'thank', 'ooh', 'aah', 'ugh',
  'whatta', 'gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'dunno',
  'gee', 'gosh', 'yep', 'nope', 'huh', 'heh', 'meh', 'bah', 'duh',
  'tsk', 'pfft', 'mhm', 'ugh', 'eek', 'oops', 'shh', 'psst',
  // Irregular plurals that slip through
  'antennae', 'larvae', 'algae', 'vertebrae', 'formulae', 'nebulae',
  'alumni', 'fungi', 'cacti', 'nuclei', 'stimuli', 'syllabi', 'radii',
  'criteria', 'phenomena', 'data', 'media', 'bacteria', 'strata',
);

// Irregular past tenses / participles
block(
  'written', 'spoken', 'broken', 'chosen', 'frozen', 'stolen',
  'driven', 'given', 'taken', 'shaken', 'woven', 'proven',
  'began', 'begun', 'became', 'become', 'brought', 'bought',
  'caught', 'chose', 'dealt', 'drew', 'drank', 'drove', 'eaten',
  'fell', 'felt', 'flew', 'forgot', 'gave', 'grew', 'heard', 'held',
  'hid', 'knew', 'laid', 'led', 'lost', 'meant', 'met', 'paid',
  'ran', 'rode', 'rose', 'sang', 'sat', 'saw', 'sent', 'shook',
  'showed', 'slept', 'sold', 'sought', 'spoke', 'stood',
  'struck', 'swam', 'swept', 'swore', 'swung', 'taught', 'threw',
  'told', 'tore', 'understood', 'woke', 'won', 'wore', 'wound',
  'wrote',
);

// ─── Main ───────────────────────────────────────────────────────────
console.log('Loading models with vectors...');
const models = [];
for (const name of ['glove-300d', 'word2vec', 'fasttext']) {
  const m = loadModel(name);
  if (m) models.push(m);
}

if (models.length < 2) {
  console.error('Need at least 2 models loaded.');
  process.exit(1);
}

// Load existing targets
const existingTargets = new Set(JSON.parse(fs.readFileSync(TARGETS_PATH, 'utf-8')));
console.log(`\nExisting target words: ${existingTargets.size}`);

// Words present in ALL models
const allModelWordsSet = new Set();
const first = models[0];
for (const w of first.words) {
  if (models.every(m => m.wordIndex.has(w))) {
    allModelWordsSet.add(w);
  }
}
console.log(`Words in all ${models.length} models: ${allModelWordsSet.size.toLocaleString()}`);

// ─── Compute centroids ──────────────────────────────────────────────
console.log('\nComputing centroids from existing target words...');
const centroids = [];
for (const model of models) {
  const c = computeCentroid(model, existingTargets);
  if (c) {
    centroids.push({ model, centroid: c });
    // Count how many existing targets have vectors
    let inModel = 0;
    for (const w of existingTargets) {
      if (model.wordIndex.has(w)) inModel++;
    }
    console.log(`  [${model.name}] Centroid from ${inModel}/${existingTargets.size} target words`);
  }
}

// ─── Filter + score candidates ──────────────────────────────────────
console.log('\nFiltering and scoring candidates...');

let passedHard = 0;
let passedSuffix = 0;
let passedPlural = 0;
let passedBlock = 0;
const candidates = [];

for (const word of allModelWordsSet) {
  // Skip existing targets
  if (existingTargets.has(word)) continue;

  // Hard character filters
  if (!passesHardFilters(word)) continue;
  passedHard++;

  // Blocked words
  if (BLOCKED.has(word)) continue;
  passedBlock++;

  // Suffix filter
  if (!passesSuffixFilter(word)) continue;
  passedSuffix++;

  // Plural detection
  if (isPlural(word, allModelWordsSet)) continue;
  passedPlural++;

  // Derived adjective detection (-y from noun, -en from noun, -ic)
  if (isDerivedAdjective(word, allModelWordsSet)) continue;

  // Compute average cosine similarity to centroids across all models
  let totalSim = 0;
  let simCount = 0;
  for (const { model, centroid } of centroids) {
    const vec = model.getVector(word);
    if (!vec) continue;
    totalSim += cosineSimilarity(vec, centroid);
    simCount++;
  }

  if (simCount === 0) continue;
  const avgSim = totalSim / simCount;

  candidates.push({ word, score: avgSim });
}

console.log(`  After hard filters: ${passedHard.toLocaleString()}`);
console.log(`  After block list:   ${passedBlock.toLocaleString()}`);
console.log(`  After suffix filter: ${passedSuffix.toLocaleString()}`);
console.log(`  After plural filter: ${passedPlural.toLocaleString()}`);
console.log(`  Total scored candidates: ${candidates.length.toLocaleString()}`);

// Sort by semantic similarity (highest first = most like existing concrete nouns)
candidates.sort((a, b) => b.score - a.score);

// Show score distribution
if (candidates.length > 0) {
  console.log(`\n  Score range: ${candidates[0].score.toFixed(4)} (best) → ${candidates[candidates.length - 1].score.toFixed(4)} (worst)`);
  if (candidates.length >= COUNT) {
    console.log(`  Score at cutoff (${COUNT}): ${candidates[COUNT - 1].score.toFixed(4)}`);
  }
}

const selected = candidates.slice(0, COUNT).map(c => c.word);
selected.sort();

console.log(`\nSelected ${selected.length} new words`);
if (selected.length > 0) {
  console.log(`Sample (first 30): ${selected.slice(0, 30).join(', ')}`);
  console.log(`Sample (last 30):  ${selected.slice(-30).join(', ')}`);
}

// Show what's near the cutoff boundary
if (candidates.length >= COUNT) {
  console.log(`\nNear cutoff:`);
  const around = candidates.slice(COUNT - 5, COUNT + 5);
  for (const c of around) {
    const marker = selected.includes(c.word) ? '✓' : '✗';
    console.log(`  ${marker} ${c.word} (${c.score.toFixed(4)})`);
  }
}

// Show the lowest-scored selected words (these are the "worst" picks)
if (selected.length > 0) {
  console.log(`\nLowest-scored selected words:`);
  const worst = candidates.slice(Math.max(0, Math.min(COUNT, candidates.length) - 20), Math.min(COUNT, candidates.length));
  for (const c of worst) {
    console.log(`  ${c.word} (${c.score.toFixed(4)})`);
  }
}

if (selected.length < COUNT) {
  console.log(`\nWARNING: Only found ${selected.length} candidates (requested ${COUNT})`);
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] Not saving. Remove --dry-run to save.');
  process.exit(0);
}

// ─── Merge and save ─────────────────────────────────────────────────
const allTargets = [...existingTargets, ...selected];
const uniqueTargets = [...new Set(allTargets)].sort();

console.log(`\nTotal: ${existingTargets.size} existing + ${selected.length} new = ${uniqueTargets.length}`);

fs.writeFileSync(TARGETS_PATH, JSON.stringify(uniqueTargets, null, 2));
console.log(`Saved to ${TARGETS_PATH}`);
