// article.js - Pick a Wikipedia article and extract its target words.
//
// Source list: Chat Relay's wikipedia-coverage.json (curated set of articles
// whose body text has been validated to tokenize cleanly). Same picker WikiSearchle
// uses, so playable articles overlap.
//
// For each round we want a small set of "target words" — content words that
// (1) appear in the article body, (2) are findable in the dictionary, and
// (3) are short enough to fit comfortably into a 7x7..9x9 grid. Targets are
// ranked by article frequency (more occurrences = higher ranked = bigger reveal).

const fs = require('fs');
const path = require('path');
const { rankBatch } = require('./searchle-client');

// Per-game bad-words filter. Self-heals: when buildArticleRound discovers
// a title word Searchle can't rank, it's added here + persisted so future
// rolls skip articles containing that word. Wikirec-specific — does not
// touch the shared coverage.json.
const _RELAY_DIR_FOR_BADWORDS = process.env.CHAT_RELAY_DIR
  || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const BAD_WORDS_PATH = process.env.SEARCHLE_BAD_WORDS_PATH
  || path.join(_RELAY_DIR_FOR_BADWORDS, 'data', 'searchle-unrankable-words.json');
const GOOD_WORDS_PATH = process.env.SEARCHLE_RANKABLE_WORDS_PATH
  || path.join(_RELAY_DIR_FOR_BADWORDS, 'data', 'searchle-rankable-words.json');
const badTitleWords = new Set();
const goodTitleWords = new Set();
function loadWordSet(filePath, set, label) {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const w of (data.words || [])) set.add(String(w).toLowerCase());
      console.log(`[Article] Loaded ${set.size} ${label} from ${filePath}`);
    }
  } catch (e) {
    console.log(`[Article] ${label} load failed: ${e.message}`);
  }
}
function persistWordSet(filePath, set, label) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      words: [...set].sort(),
    }));
  } catch (e) {
    console.log(`[Article] ${label} persist failed: ${e.message}`);
  }
}
function markBadWord(word) {
  const w = String(word || '').toLowerCase();
  if (!w || badTitleWords.has(w)) return;
  badTitleWords.add(w);
  persistWordSet(BAD_WORDS_PATH, badTitleWords, 'known bad title words');
}
function markGoodWord(word) {
  const w = String(word || '').toLowerCase();
  if (!w || goodTitleWords.has(w)) return;
  goodTitleWords.add(w);
  persistWordSet(GOOD_WORDS_PATH, goodTitleWords, 'known rankable title words');
}
function isKnownRankable(word) {
  return goodTitleWords.has(String(word || '').toLowerCase());
}
function isKnownUnrankable(word) {
  return badTitleWords.has(String(word || '').toLowerCase());
}
loadWordSet(BAD_WORDS_PATH, badTitleWords, 'known bad title words');
loadWordSet(GOOD_WORDS_PATH, goodTitleWords, 'known rankable title words');
const { fetchLeadSection } = require('../lib/wikipedia');

const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const COVERAGE_PATH = process.env.WIKI_COVERAGE_PATH || path.join(RELAY_DIR, 'data', 'wikipedia-coverage.json');
const MAX_TITLE_LETTERS = 72;

// Stoplist: function words and ultra-common content words. Kept short and
// hand-tuned — we want the targets to feel like article-specific vocabulary.
const STOPLIST = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to', 'in',
  'on', 'at', 'by', 'for', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'am', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'this', 'that',
  'these', 'those', 'it', 'its', 'they', 'them', 'their', 'there', 'here',
  'he', 'she', 'we', 'you', 'your', 'his', 'her', 'him', 'me', 'my', 'our',
  'who', 'whom', 'whose', 'which', 'what', 'when', 'where', 'why', 'how',
  'not', 'no', 'so', 'than', 'too', 'very', 'just', 'also', 'such', 'into',
  'from', 'about', 'after', 'before', 'over', 'under', 'between', 'through',
  'during', 'while', 'because', 'although', 'though', 'since', 'until',
  'one', 'two', 'three', 'first', 'second', 'new', 'old', 'other',
  'some', 'any', 'all', 'each', 'every', 'most', 'many', 'much', 'more',
  'less', 'few', 'several', 'both', 'either', 'neither',
]);

// Proper-noun filter dictionary. Any title word not in this dictionary
// (and not a stoplist word or pure number) is treated as a proper noun
// (a personal name, place name, brand, etc.) and the article is excluded
// from the picker pool. Built from the same word-bank frequency table
// Searchle uses, so the two systems are aligned.
//
// Mere dictionary presence isn't strict enough — words like "holts"
// (rare plural of "holt", a small grove) are technically valid English
// but in practice show up exclusively as proper nouns ("Holts Landing
// State Park"). The Zipf threshold rejects dictionary entries below
// the cutoff, treating them as proper-noun-flavored regardless of
// nominal English-word status.
const FREQ_PATH = process.env.SEARCHLE_FREQUENCY_PATH
  || path.join(RELAY_DIR, 'data', 'word-bank', 'frequency.json');
const PROPER_NOUN_MIN_ZIPF = (() => {
  const raw = process.env.WIKIREC_PROPER_NOUN_MIN_ZIPF;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 2.5;
})();
const dictionaryFreq = new Map(); // word → Zipf score
(function loadDictionary() {
  try {
    if (!fs.existsSync(FREQ_PATH)) {
      console.log(`[Article] Dictionary not found at ${FREQ_PATH} — proper-noun filter will be disabled.`);
      return;
    }
    const freq = JSON.parse(fs.readFileSync(FREQ_PATH, 'utf-8'));
    for (const k in freq) {
      const v = freq[k];
      if (typeof v === 'number') dictionaryFreq.set(String(k).toLowerCase(), v);
    }
    console.log(`[Article] Loaded dictionary: ${dictionaryFreq.size.toLocaleString()} words from ${FREQ_PATH} (proper-noun cutoff: Zipf >= ${PROPER_NOUN_MIN_ZIPF})`);
  } catch (e) {
    console.log(`[Article] Dictionary load failed: ${e.message}. Proper-noun filter disabled.`);
  }
})();

// Returns true if `word` looks like a proper noun (personal/place/brand
// name) — i.e. it isn't a stoplist function word, isn't a pure number,
// and either isn't in the dictionary at all OR is in the dictionary
// only as a sub-threshold rare entry (typically the case for words
// that happen to overlap with rare common nouns but in titles read
// as proper nouns: "holts", "trapezium", "trifid", etc.). If the
// dictionary failed to load, this always returns false (filter
// disabled).
function isLikelyProperNoun(word) {
  if (!word) return false;
  if (STOPLIST.has(word)) return false;
  if (/^[0-9]+$/.test(word)) return false;
  if (dictionaryFreq.size === 0) return false; // disabled
  const z = dictionaryFreq.get(word);
  if (typeof z !== 'number') return true;          // not in dict → proper noun
  return z < PROPER_NOUN_MIN_ZIPF;                 // in dict but too rare → proper noun
}

const RANKABLE_MIN_ZIPF = (() => {
  const raw = process.env.WIKIREC_RANKABLE_MIN_ZIPF;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 4.2;
})();
// High-frequency dictionary words are almost certainly in Searchle's ranking
// vocabulary. Treating them as rankable without a network probe removes the
// bulk of title-word validation calls and keeps round builds fast even when
// Searchle is under load. Rare or missing words still get probed.
function isLikelyRankableByFrequency(word) {
  if (!word) return false;
  if (dictionaryFreq.size === 0) return false;
  const z = dictionaryFreq.get(word);
  return typeof z === 'number' && z >= RANKABLE_MIN_ZIPF;
}

// Compound-named-entity filter. Catches multi-word titles where each
// constituent word individually passes the per-word Zipf check above
// but the assembled phrase is clearly a specific person/place/named
// thing (e.g. "Carolina Beach State Park", "Henry Pollock"). Reads
// shortdesc + categories from the coverage entry; both are populated
// at coverage build time by Chat Relay.
//
// Two regexes for shortdesc: SHORTDESC_NAMED_ROLE_RE is case-insensitive
// for occupation/era markers (work at sentence start with caps), and
// SHORTDESC_NAMED_PLACE_RE is case-sensitive so a capitalized place name
// is required after "in/of/near" — avoids false positives like
// "region of the stratosphere" or "state in which".
const SHORTDESC_NAMED_PLACE_RE = new RegExp([
  '\\b(?:municipality|town|city|village|hamlet|borough|township|commune|civil parish|suburb|district|county|province|country|region|territory|reservation|prefecture) (?:in|of|near) [A-Z]',
  '\\b(?:river|lake|mountain|peak|range|ridge|valley|gorge|canyon|island|archipelago|peninsula|cape|bay|gulf|strait|desert|forest|glacier|volcano|crater|reef|atoll|waterfall) (?:in|of|near) [A-Z]',
  '\\b(?:skyscraper|cathedral|basilica|mosque|synagogue|monastery|abbey|palace|castle|fortress|stadium|arena|opera house|railway station|train station|metro station|subway station) (?:in|of|at|near) [A-Z]',
].join('|'));
const SHORTDESC_NAMED_ROLE_RE = new RegExp([
  // Sports
  '\\b(footballer|cricketer|cyclist|swimmer|boxer|wrestler|gymnast|skater|skier|surfer|golfer|sportsman|sportswoman|sportsperson|athletics competitor)\\b',
  '\\b(rugby (union |league )?(player|coach))\\b',
  '\\b(tennis|baseball|basketball|hockey|volleyball|football|soccer|handball|water polo|ice hockey|field hockey) (player|coach)\\b',
  '\\bolympic (gold|silver|bronze)?\\s*(medall?ist|champion|competitor|athlete)\\b',
  // Performers / artists
  '\\b(actor|actress|singer|songwriter|musician|composer|guitarist|pianist|drummer|violinist|cellist|saxophonist|trumpeter|conductor|opera singer|rapper|record producer|film producer|film director|filmmaker|cinematographer|screenwriter|playwright|novelist|poet|essayist|biographer|memoirist|journalist|columnist|painter|sculptor|illustrator|cartoonist|photographer|fashion designer|graphic designer|industrial designer|architect|chef)\\b',
  // Power / clergy / military / legal — drop noisy "general/chief/judge/justice"
  '\\b(politician|statesman|stateswoman|diplomat|senator|congressman|congresswoman|governor|mayor|prime minister|monarch|emperor|empress|sultan|tsar|pharaoh|chieftain|admiral|brigadier|field marshal|bishop|cardinal|rabbi|imam|guru|martyr|prophet|jurist|barrister|solicitor|prosecutor)\\b',
  // Sciences / academia
  '\\b(scientist|physicist|chemist|biologist|botanist|zoologist|astronomer|mathematician|engineer|inventor|economist|sociologist|psychologist|psychiatrist|anthropologist|archaeologist|historian|linguist|philosopher|theologian)\\b',
  // Adventurers / activists
  '\\b(activist|reformer|revolutionary|abolitionist|suffragist|explorer|navigator|aviator|astronaut|cosmonaut|mountaineer)\\b',
  // Year/date markers
  '\\(\\s*\\d{3,4}\\s*[-\u2013]\\s*\\d{0,4}\\s*\\)',
  '\\bborn\\s+\\d{3,4}\\b',
  '\\bdied\\s+\\d{3,4}\\b',
  '\\bborn\\s+in\\s+\\d{3,4}\\b',
  // Named protected/political places — strong signals
  '\\b(state park|national park|national monument|national forest|national seashore|national wildlife refuge|national recreation area|national historic site|national historic park|protected area|provincial park|regional park|country park|county park|wildlife refuge|wildlife sanctuary|nature reserve|nature preserve|biosphere reserve|world heritage site|game reserve|marine park|marine reserve)\\b',
  '\\b(populated place|census-designated place|unincorporated community|former settlement|abandoned settlement|ghost town|electoral district|administrative division|administrative region|self-governing|sovereign state|landlocked country|island country|island nation|capital city)\\b',
].join('|'), 'i');
const CATEGORY_NAMED_ENTITY_RE = /(?:^|_)(?:living_people|\d{3,4}_births?|\d{3,4}_deaths?|footballers|cricketers|olympic_(?:athletes|gold_medalists|silver_medalists|bronze_medalists|medalists|competitors|champions)|baseball_players|basketball_players|tennis_players|hockey_players|rugby_(?:union_|league_)?(?:players|footballers)|boxers|cyclists|swimmers|skaters|skiers|surfers|gymnasts|wrestlers|golfers|sportsmen|sportswomen|actors|actresses|singers|musicians|composers|conductors|guitarists|pianists|drummers|rappers|songwriters|record_producers|film_producers|film_directors|filmmakers|screenwriters|playwrights|novelists|poets|writers|authors|journalists|painters|sculptors|illustrators|architects|photographers|designers|chefs|politicians|statesmen|monarchs|emperors|generals|admirals|saints|scientists|physicists|chemists|biologists|botanists|zoologists|astronomers|mathematicians|engineers|inventors|economists|sociologists|psychologists|anthropologists|archaeologists|historians|linguists|philosophers|theologians|judges|jurists|lawyers|activists|explorers|astronauts|state_parks(?:_of|_in)|national_parks(?:_of|_in)|national_monuments(?:_of|_in)|national_forests(?:_of|_in)|protected_areas(?:_of|_in)|wildlife_refuges(?:_of|_in)|nature_reserves(?:_of|_in)|cities_in|towns_in|villages_in|hamlets_in|boroughs_in|townships_in|counties_in|municipalities_in|settlements_in|populated_places_in|former_populated_places|former_settlements|ghost_towns_in|neighbou?rhoods_in|suburbs_of|rivers_of|rivers_in|lakes_of|lakes_in|mountains_of|mountains_in|peaks_of|islands_of|islands_in|forests_of|forests_in|reservoirs_in|reservoirs_of|stadiums_in|theatres_in|theaters_in|museums_in|universities_in|cathedrals_in|basilicas_in|temples_in|monasteries_in|abbeys_in|palaces_in|castles_in|forts_in|landmarks_in|monuments_in|memorials_in)(?:_|$)/i;

function looksLikeNamedEntity(entry) {
  const sd = entry && entry.shortdesc;
  if (typeof sd === 'string') {
    if (SHORTDESC_NAMED_ROLE_RE.test(sd)) return true;
    if (SHORTDESC_NAMED_PLACE_RE.test(sd)) return true;
  }
  const cats = entry && entry.categories;
  if (Array.isArray(cats)) {
    for (const c of cats) if (CATEGORY_NAMED_ENTITY_RE.test(String(c))) return true;
  }
  return false;
}

// Article-level filter for the picker. An article is excluded if any
// of its title-word-norms is a proper noun, OR if its shortdesc/categories
// flag it as a compound named entity (person, named place, etc.) — the
// latter catches "Carolina Beach State Park" and "Henry Pollock" cases
// where each constituent word individually clears the per-word Zipf
// check but the assembled phrase is a specific named thing.
// Built once at coverage load time and applied to coverageKeys.
//
// As of 2026-05-13 also requires the shared chat-relay easy-article
// filter (rejects polysemous/verb-dominant titles like "Set theory",
// adjective-only too-rare-noun titles, and Wikipedia disambiguation
// parentheticals like "Marble (toy)"). See ContextKeep memory
// `wikisearchle_easy_article_filter` for the design — WikiRec shares
// the same filter for consistency. Disable via env
// WIKIREC_EASY_FILTER_DISABLE=1 if it shrinks the pool too far.
const _EASY_FILTER_ENABLED = !process.env.WIKIREC_EASY_FILTER_DISABLE;
let _sharedTiering = null;
function _sharedTieringModule() {
  if (_sharedTiering) return _sharedTiering;
  _sharedTiering = require('./rank-target-tiering');
  return _sharedTiering;
}

function articlePassesPickerFilter(entry) {
  const norms = entry && entry.titleWordNorms;
  if (!Array.isArray(norms) || norms.length === 0) return false;
  for (const n of norms) {
    if (isLikelyProperNoun(n)) return false;
  }
  if (looksLikeNamedEntity(entry)) return false;
  if (_EASY_FILTER_ENABLED) {
    if (!_sharedTieringModule().articlePassesEasyFilter(entry)) return false;
  }
  return true;
}

let coverage = null;
let coverageKeys = null;

function loadCoverage() {
  if (coverage) return coverage;
  if (!fs.existsSync(COVERAGE_PATH)) {
    throw new Error(`wikipedia-coverage.json not found at ${COVERAGE_PATH}. Set WIKI_COVERAGE_PATH or install Chat Relay.`);
  }
  coverage = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf-8'));
  // Only "exists"-status pages with title words are playable.
  // Additionally, articles whose titles contain proper nouns or fail
  // the shared easy-tier filter (T3 polysemous / T4 proper / named-
  // entity / Wikipedia disambiguation parenthetical) are excluded —
  // see articlePassesPickerFilter above.
  const allKeys = Object.keys(coverage.pages || {});
  let totalExists = 0;
  let dropped = 0;
  coverageKeys = allKeys.filter((k) => {
    const e = coverage.pages[k];
    if (!e || e.status !== 'exists') return false;
    totalExists++;
    if (!articlePassesPickerFilter(e)) {
      dropped++;
      return false;
    }
    return true;
  });
  console.log(`[Article] Loaded coverage: ${coverageKeys.length.toLocaleString()} playable pages from ${COVERAGE_PATH}`);
  if (dictionaryFreq.size > 0) {
    const pct = (dropped/totalExists*100).toFixed(1);
    const gates = _EASY_FILTER_ENABLED ? 'proper-noun + named-entity + easy-tier filters' : 'proper-noun + named-entity filters';
    console.log(`[Article] Picker filter: dropped ${dropped.toLocaleString()} of ${totalExists.toLocaleString()} pages (${pct}%) via ${gates}`);
  }
  return coverage;
}

function pickRandomKey() {
  loadCoverage();
  return coverageKeys[Math.floor(Math.random() * coverageKeys.length)];
}

// Per-difficulty article-length thresholds. 'normal' (or null) = no filter.
// Long Wikipedia articles tend to be major topics; short stubs tend to be
// obscure. Imperfect proxy for popularity but the only signal available
// across the full 35K-article coverage map.
const DIFFICULTY_LENGTH = {
  'very-common': { min: 50000, max: Infinity },
  'common':      { min: 20000, max: Infinity },
  'normal':      null,
  'rare':        { min: 5000,  max: 20000 },
  'very-rare':   { min: 0,     max: 5000 },
};
function pickRandomKeyForDifficulty(wordFrequency) {
  loadCoverage();
  const range = DIFFICULTY_LENGTH[wordFrequency || 'normal'];
  if (!range) return coverageKeys[Math.floor(Math.random() * coverageKeys.length)];
  // Reservoir pick within length range. Sample a handful of keys and pick
  // the first that matches — keeps memory flat (no precomputed buckets per
  // difficulty) since the filter rarely runs and 35K is small enough to
  // tolerate the rejection-sampling loop.
  const MAX_REJECTIONS = 200;
  for (let i = 0; i < MAX_REJECTIONS; i++) {
    const k = coverageKeys[Math.floor(Math.random() * coverageKeys.length)];
    const len = coverage.pages[k]?.length;
    if (typeof len === 'number' && len >= range.min && len < range.max) return k;
  }
  // Filter too strict for the available pool — fall back to any article so
  // round-build still completes. Caller logs the difficulty intent.
  return coverageKeys[Math.floor(Math.random() * coverageKeys.length)];
}

// Tokenize plaintext into a stream of lowercase a-z runs of length >= 3.
function tokenize(text) {
  const out = [];
  const re = /[a-z]+/g;
  const lower = text.toLowerCase();
  let m;
  while ((m = re.exec(lower)) !== null) {
    if (m[0].length >= 3) out.push(m[0]);
  }
  return out;
}

// Build the per-article target list. Rules:
//   - word must be in the dictionary trie (so the grid's path-finder will recognize it)
//   - word length 4..9 (3-letter words are too easy / too short for a feature card;
//     10+ words are too long to fit alongside other targets in a 7x7 grid)
//   - not in STOPLIST
//   - not the same as a title word (those are the "hidden meta" lines, scored differently)
//
// Returns up to `count` targets sorted by descending article frequency, with the
// first occurrence index recorded so the UI can show a position card like "#34".
function extractTargets(plaintext, trie, { count = 5, minLen = 4, maxLen = 9, excludeNorms = new Set() } = {}) {
  const tokens = tokenize(plaintext);
  const counts = new Map();
  const firstIdx = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.length < minLen || t.length > maxLen) continue;
    if (STOPLIST.has(t)) continue;
    if (excludeNorms.has(t)) continue;
    if (!trie.has(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
    if (!firstIdx.has(t)) firstIdx.set(t, i);
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || firstIdx.get(a[0]) - firstIdx.get(b[0]))
    .slice(0, count)
    .map(([word, freq]) => ({ word, freq, position: firstIdx.get(word) + 1 }));

  return ranked;
}

// Normalize raw title strings to single-word atoms, lowercase, alpha-only.
function titleWordNorms(entry, key) {
  const sourceWords = Array.isArray(entry.titleWords) && entry.titleWords.length
    ? entry.titleWords
    : String(entry.title || key).split(/\s+/);
  const seen = new Set();
  return sourceWords
    .map((w) => String(w || '').toLowerCase().replace(/[^a-z]/g, ''))
    .filter((n) => {
      if (!n || STOPLIST.has(n) || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
}

// Pick an article and return everything the round needs:
//   { title, key, plaintext, titleWords, titleWordsRaw, targets }
//
// `titleWordsRaw` preserves the original Wikipedia casing so the
// rank-target tiering helper can detect proper nouns from capitalization.
async function buildArticleRound(trie, { count = 5, maxAttempts = 100, minBodyChars = 400, minTitleWords = 2, maxTotalLetters = MAX_TITLE_LETTERS, wordFrequency = 'normal' } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = pickRandomKeyForDifficulty(wordFrequency);
    const entry = coverage.pages[key];
    if (!entry) continue;

    // Pre-filter by title-word metadata BEFORE fetching the article body — most
    // Wikipedia titles have <4 title words, so checking first avoids wasted
    // MediaWiki API calls. We require minTitleWords post-filter (length 4–9,
    // present in dictionary) so every title chip the player sees is findable.
    const allTitleWords = titleWordNorms(entry, key);
    // Preserve original-casing title words for the rank-target tiering
    // heuristic. Source from entry.titleWords when present (already
    // tokenized), otherwise fall back to splitting the raw title.
    const titleWordsRaw = Array.isArray(entry.titleWords) && entry.titleWords.length
      ? entry.titleWords.slice()
      : String(entry.title || key).split(/\s+/).filter(Boolean);
    const placeableTitleWords = allTitleWords.filter(
      (w) => w.length >= 4 && w.length <= 9, // trie check dropped — proper nouns OK as title words
    );
    if (placeableTitleWords.length < minTitleWords) continue;

    // Skip articles whose title contains any word Searchle can't rank.
    // Self-healing: failures discovered below add to this set and persist.
    if (placeableTitleWords.some((w) => isKnownUnrankable(w))) {
      continue;
    }

    let plaintext;
    let fullPlaintext;
    let title;
    try {
      const r = await fetchLeadSection(entry.title);
      plaintext = r.plaintext;
      fullPlaintext = r.fullPlaintext || r.plaintext;
      title = r.title;
    } catch (e) {
      console.log(`[Article] fetch "${key}" failed: ${e.message}`);
      continue;
    }
    if (!plaintext || plaintext.length < minBodyChars) {
      console.log(`[Article] skip "${key}": body too short (${plaintext ? plaintext.length : 0} chars)`);
      continue;
    }

    // Validate every placeable title word against Searchle in parallel. Known-
    // good words are skipped (persisted across restarts), which dramatically
    // reduces Searchle load once the cache warms. rankBatch has a 5s timeout
    // and searchle-client.js limits concurrency.
    const wordsToCheck = placeableTitleWords.filter((w) => !isKnownRankable(w) && !isLikelyRankableByFrequency(w));
    // Common high-Zipf words are treated as rankable without a network call.
    for (const w of placeableTitleWords) {
      if (!isKnownRankable(w) && isLikelyRankableByFrequency(w)) markGoodWord(w);
    }
    if (wordsToCheck.length > 0) {
      let titleWordsAllRankable = true;
      const titleChecks = await Promise.all(
        wordsToCheck.map((w) =>
          rankBatch(w, [])
            .then(() => ({ w, ok: true, err: null }))
            .catch((e) => ({ w, ok: false, err: e }))
        )
      );
      for (const { w, ok, err } of titleChecks) {
        if (ok) {
          markGoodWord(w);
          continue;
        }
        // Only mark a word bad on the exact "Invalid or unknown target"
        // error from Searchle. Network errors / timeouts / 5xx are transient
        // and must NOT poison the list.
        const msg = String(err && err.message || '');
        const isTrueBad = /Invalid or unknown target/i.test(msg);
        if (isTrueBad) markBadWord(w);
        console.log('[Article] skip "' + key + '": title word "' + w + '" not rankable (' + msg + ')' + (isTrueBad ? ' [marked bad]' : ' [transient, not marked]'));
        titleWordsAllRankable = false;
        break;
      }
      if (!titleWordsAllRankable) continue;
    }

    const targets = extractTargets(plaintext, trie, {
      count,
      excludeNorms: new Set(placeableTitleWords),
    });
    if (false && targets.length < Math.min(3, count)) {
      console.log(`[Article] skip "${key}": only ${targets.length} viable targets`);
      continue;
    }

    const totalLetters = placeableTitleWords.reduce((acc, w) => acc + w.length, 0);
    if (totalLetters > maxTotalLetters) {
      console.log(`[Article] skip "${key}": ${totalLetters} letters exceed cap ${maxTotalLetters}`);
      continue;
    }

    return { title, key, plaintext, fullPlaintext, titleWords: placeableTitleWords, titleWordsRaw, targets };
  }
  return null;
}

function getPoolStats() {
  if (!coverage) loadCoverage();
  const total = coverageKeys ? coverageKeys.length : 0;
  // Static-cheap-filter count: how many entries pass the in-memory criteria
  // (≥4 placeable title words, 4-9 letters each, <= MAX_TITLE_LETTERS total).
  // This excludes
  // the body-fetch + Searchle-rankable check which both happen at round-build.
  let staticPlayable = 0;
  if (coverageKeys && coverage) {
    for (const k of coverageKeys) {
      const e = coverage.pages[k];
      if (!e) continue;
      const norms = (e.titleWordNorms || []).filter((n) => n && n.length >= 4 && n.length <= 9 && !STOPLIST.has(n));
      if (norms.length < 4) continue;
      if (norms.reduce((a, w) => a + w.length, 0) > MAX_TITLE_LETTERS) continue;
      // Skip articles whose title words include a known-bad word.
      if (norms.some((n) => isKnownUnrankable(n))) continue;
      staticPlayable++;
    }
  }
  return {
    total,
    staticPlayable,
    badTitleWords: badTitleWords.size,
  };
}

module.exports = { buildArticleRound, loadCoverage, getPoolStats, isKnownRankable, isKnownUnrankable };
