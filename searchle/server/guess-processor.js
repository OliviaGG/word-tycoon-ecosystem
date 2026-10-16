// ===== Guess Processor =====
// Input validation, plural normalization, and guess handling.

const path = require('path');

const rankingEngine = require('./ranking-engine');
const bankDict = require('./bank-dict');
const anonRegistry = require('./anon-registry');
const languageProfiles = require('./language-profiles');

// Rank sentinel for "valid English word in the shared bank dictionary, but
// outside this game's ranked pool" — the client renders it as `(N+)`.
// 9999999 stays reserved for "not a real word at all" → "???".
const RANK_OUTSIDE_POOL = 99999998;

// Three-tier rank resolution. Use this everywhere a guess word is matched
// against a game's rankings — otherwise restore/recompute paths will lose
// the "(N+)" classification and fall back to "???".
// Apply the streamer's custom fan-club title (e.g. "Pookie") over the
// catalog default ("Fan Club") on a cosmetics object. No-op unless:
//   • game is a session AND has a non-null fcTitle cached
//   • cosmetics.title exists AND is tagged __fanClubOnly (the fan-club
//     set's title item — non-fan-club titles are user-chosen and never
//     overridden)
// Returns a NEW cosmetics object when substitution applies (so the
// shared cache object isn't mutated), or the original object otherwise.
//
// This is the single choke point for the substitution on Searchle's
// side. It catches non-Discord-linked TikTok viewers who skip chat-
// relay's enrichment block at relay.js:617 and therefore arrive with
// raw "Fan Club" cosmetics from the cosmeticsCache fallback.
// Perk flags for a guess's author, normalized from either shape.
//
// Chat identities arrive from chat-relay carrying a `badges` array. WEB players
// do not: the relay's badges are keyed by TikTok handle, so a player signed in
// on the site with Discord/GitHub/Google has none. For those, server.js's
// premium gate stamps booleans onto msg.user from /api/public/perks before the
// guess gets here. Reading both shapes in one place keeps the two paths from
// drifting apart again.
function _readPerks(user) {
  const badges = Array.isArray(user && user.badges) ? user.badges : [];
  return {
    isFanClub: !!(user && user.isFanClub) || badges.indexOf('fan-club') !== -1,
    isSuperfan: !!(user && user.isSuperfan) || badges.indexOf('superfan') !== -1,
    isDonor: !!(user && user.isDonor) || badges.indexOf('donor') !== -1,
  };
}

function _applyFcTitleSubstitution(cosmetics, game) {
  if (!cosmetics || !game || !game.fcTitle) return cosmetics;
  const t = cosmetics.title;
  if (!t || !t.__fanClubOnly || typeof t.title !== 'string' || t.title === game.fcTitle) {
    return cosmetics;
  }
  return { ...cosmetics, title: { ...t, title: game.fcTitle } };
}

function resolveRank(word, rankings, language = 'en') {
  if (rankings && rankings.has(word)) return rankings.get(word);
  if (languageProfiles.normalizeLanguageId(language) === 'en' && bankDict.has(word)) return RANK_OUTSIDE_POOL;
  return 9999999;
}
const { requireRelayOrShared } = require('./shared-resolver');
const GAME_WORD_POLICY_ID = process.env.GAME_WORD_POLICY_ID || 'searchle';

let gameWordPolicy = { isWordBlockedForGame: () => false };
try {
  gameWordPolicy = requireRelayOrShared('src/game-word-policy.js');
} catch (error) {
  console.warn('[GuessProcessor] Word policy unavailable:', error.message);
}

const CHAT_RELAY_PUBLIC_URL = process.env.CHAT_RELAY_PUBLIC_URL || 'https://wordtycoon.live';

function fixAvatarUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/api/avatar/')) {
    const base = CHAT_RELAY_PUBLIC_URL.endsWith('/') ? CHAT_RELAY_PUBLIC_URL.slice(0, -1) : CHAT_RELAY_PUBLIC_URL;
    return base + url;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Plural → Singular Normalization
// ---------------------------------------------------------------------------

// Words that must NOT be singularized despite matching plural suffixes.
// Plurale tantum (always-plural nouns), mass/uncountable nouns, and words
// where the -s/-es ending is part of the root word — not a plural suffix.
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

  // Academic fields / disciplines (-ics is the base form, not plural)
  'athletics', 'diagnostics', 'dynamics', 'economics', 'electronics',
  'ethics', 'genetics', 'gymnastics', 'linguistics', 'logistics',
  'mathematics', 'mechanics', 'physics', 'politics', 'statistics',
  'tactics', 'therapeutics',

  // Adverbs, pronouns, prepositions, verbs — -s/-es is part of the word
  'across', 'always', 'besides', 'does', 'furthermore', 'goes',
  'nonetheless', 'overseas', 'perhaps', 'sometimes', 'themselves',
  'thus', 'upstairs', 'downstairs', 'towards', 'whereas',
  'crossroads',
]);

function bestCandidate(candidates) {
  let best = null;
  let bestIdx = Infinity;
  const allModels = rankingEngine.getAllModels();
  for (const word of candidates) {
    for (const model of allModels) {
      const idx = model.wordIndex.get(word);
      if (idx !== undefined && idx < bestIdx) {
        bestIdx = idx;
        best = word;
      }
    }
  }
  return best;
}

function toSingular(word) {
  const vocabSet = rankingEngine.getActiveVocabSet();
  if (word.length < 4) return word;
  if (SINGULAR_EXCLUDE.has(word)) return word;

  // -ies → -y (babies → baby, puppies → puppy)
  if (word.endsWith('ies') && word.length >= 5) {
    const s = word.slice(0, -3) + 'y';
    if (vocabSet.has(s)) return s;
  }

  // -ves → try -f, -fe, and verb base -ve (knives→knife, gives→give)
  // All three candidates compete — bestCandidate picks the most common.
  // This naturally picks "knife" over "knive", "give" over "gif", etc.
  if (word.endsWith('ves') && word.length >= 5) {
    const candidates = [];
    const sf = word.slice(0, -3) + 'f';
    const sfe = word.slice(0, -3) + 'fe';
    const sve = word.slice(0, -1); // verb base: gives→give, knives→knive
    if (vocabSet.has(sf)) candidates.push(sf);
    if (vocabSet.has(sfe)) candidates.push(sfe);
    if (vocabSet.has(sve)) candidates.push(sve);
    if (candidates.length > 0) return bestCandidate(candidates);
  }

  // -es → English plural rule is asymmetric:
  //   stems ending in s/sh/ch/x/z take -es  (box → boxes, wish → wishes)
  //   every other -e word just adds -s      (pore → pores, case → cases)
  // Previously this tried both candidates and let bestCandidate arbitrate
  // by model-vocab frequency. That picked "por" for "pores" — some
  // embedding models carry "por" (multilingual / abbreviation noise) with
  // a lower index than "pore", so frequency arbitration lost to noise.
  // The linguistic rule is more reliable: pick the candidate that matches
  // the stem pattern, and don't fall back to the wrong one even if it's
  // the only option in vocab.
  if (word.endsWith('es') && word.length >= 5) {
    const withoutS = word.slice(0, -1);
    const withoutEs = word.slice(0, -2);
    const stemNeedsE = /(s|sh|ch|x|z)$/i.test(withoutEs);
    if (stemNeedsE) {
      if (vocabSet.has(withoutEs)) return withoutEs;
    } else {
      if (vocabSet.has(withoutS)) return withoutS;
    }
  }

  // -s (but not -ss, -us, -is) → remove s
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    const s = word.slice(0, -1);
    if (vocabSet.has(s)) return s;
  }

  return word;
}

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

function toAmerican(word) {
  const vocabSet = rankingEngine.getActiveVocabSet();

  // 1. Explicit irregular mapping
  if (BRITISH_TO_AMERICAN[word]) {
    const am = BRITISH_TO_AMERICAN[word];
    if (vocabSet.has(am)) return am;
  }

  // 2. -our → -or (colour → color)
  if (word.endsWith('our') && word.length >= 5 && !OUR_EXCLUDE.has(word)) {
    const am = word.slice(0, -3) + 'or';
    if (vocabSet.has(am)) return am;
  }

  // 3. -isation → -ization (organisation → organization) — before -ise rule
  if (word.endsWith('isation')) {
    const am = word.slice(0, -7) + 'ization';
    if (vocabSet.has(am)) return am;
  }

  // 4. -ise → -ize (realise → realize)
  if (word.endsWith('ise') && word.length >= 5 && !ISE_EXCLUDE.has(word)) {
    const am = word.slice(0, -3) + 'ize';
    if (vocabSet.has(am)) return am;
  }

  // 5. -yse → -yze (analyse → analyze)
  if (word.endsWith('yse')) {
    const am = word.slice(0, -3) + 'yze';
    if (vocabSet.has(am)) return am;
  }

  // 6. -elling → -eling / -elled → -eled (travelling → traveling)
  if ((word.endsWith('elling') || word.endsWith('elled')) && !DOUBLE_L_EXCLUDE.has(word)) {
    const am = word.replace(/ll(ing|ed)$/, 'l$1');
    if (vocabSet.has(am)) return am;
  }

  return word;
}

function isBlockedGuess(text) {
  if (!text || typeof gameWordPolicy.isWordBlockedForGame !== 'function') return false;
  return gameWordPolicy.isWordBlockedForGame(GAME_WORD_POLICY_ID, 'guess', text);
}

// ---------------------------------------------------------------------------
// Process a chat message as a guess
// ---------------------------------------------------------------------------
async function processGuess(msg, game, config, cosmeticsCache, callbacks) {
  if(!msg||typeof msg.message!=='string'||msg.message.length>160||!msg.user||typeof msg.user!=='object'||Array.isArray(msg.user))return {valid:false,result:'bad_request'};
  if (msg.isSystem || msg.platform === 'system') return;
  if (game.isWon) return;
  if (!game.rankings) return;
  const originalTarget=game.targetWord,originalStart=game.startTime,originalRankings=game.rankings;
  const stillCurrent=()=>!game.isWon&&game.targetWord===originalTarget&&game.startTime===originalStart&&game.rankings===originalRankings&&(!callbacks.isCurrent||callbacks.isCurrent());

  const language = languageProfiles.normalizeLanguageId(game.language);
  const raw = String(msg.message || '').trim().normalize('NFC').toLocaleLowerCase(language === 'pt-br' ? 'pt-BR' : 'en-US');
  if (!raw || raw.includes(' ') || raw.includes('\t')) return;
  if (isBlockedGuess(raw)) return;

  // Strip non-letter characters. pt-BR keeps accents; English keeps legacy a-z.
  const rawText = languageProfiles.normalizeGuessText(raw, language);
  if (!rawText) return;

  // Normalize plurals → singular, then British → American spelling for English.
  // Portuguese words stay as typed because English morphology corrupts pt-BR.
  const text = language === 'pt-br' ? rawText : toAmerican(toSingular(rawText));
  if (isBlockedGuess(text)) return;

  // Canonical identity: if linked Discord exists, use it as the canonical user ID
  // so the same person on TikTok/YouTube/web is always one identity (matches erecTangled pattern)
  const rawUserId = msg.user.id || msg.user.username || null;
  const linkedDiscord = msg.linkedDiscord || null;
  const canonicalUserId = linkedDiscord || rawUserId;
  const canonicalPlatform = linkedDiscord ? 'web' : msg.platform;

  // Resolve display name (assigns Anon #N for users without a custom name)
  const resolvedDisplayName = anonRegistry.resolveDisplayName({
    customNick: msg.user.customNick,
    displayName: msg.user.displayName,
    username: msg.user.username,
    platformUserId: canonicalUserId,
    id: rawUserId
  });

  // Duplicate detection: bump to top
  if (game.guessedWords.has(text)) {
    const existing = game.guesses.find(g => g.word === text);
    if (existing) {
      // Bumper cosmetics: prefer chat-relay's enriched value (msg.user.cosmetics)
      // — that lookup uses /api/cosmetics/discord/:discordId which handles
      // linked-account cosmetic merging properly. Local cosmeticsCache hits
      // /api/cosmetics/:platform/:userId which often misses cosmetics for
      // linked-Discord users (canonicalPlatform='web' lookup doesn't find
      // cosmetics stored against the discord platform record).
      const bumperCosmeticsRaw = (msg.user && msg.user.cosmetics)
        || await cosmeticsCache.getPlayerCosmetics(canonicalPlatform, canonicalUserId);
      if(!stillCurrent())return {valid:false,result:'round_changed'};
      if(!game.guesses.includes(existing))return {valid:false,result:'round_changed'};
      const bumperCosmetics = _applyFcTitleSubstitution(bumperCosmeticsRaw, game);
      const _bumperPerks = _readPerks(msg.user);
      const bumper = {
        displayName: resolvedDisplayName,
        profilePic: fixAvatarUrl(msg.user.profilePic) || null,
        platform: canonicalPlatform,
        platformUserId: canonicalUserId,
        linkedDiscord: linkedDiscord,
        cosmetics: bumperCosmetics,
        ..._bumperPerks
      };
      if(callbacks.acceptBump)return callbacks.acceptBump(existing,text,bumper);
      existing.lastBumper = bumper;
      callbacks.onBump(text, bumper);
    }
    return;
  }

  const rank = resolveRank(text, game.rankings, language);

  // Same prefer-msg logic as bumper above — chat-relay's discord-keyed
  // cosmetics merge is more reliable than the local platform/userId fetch
  // for linked-Discord users.
  const playerCosmeticsRaw = (msg.user && msg.user.cosmetics)
    || await cosmeticsCache.getPlayerCosmetics(canonicalPlatform, canonicalUserId);
  if(!stillCurrent())return {valid:false,result:'round_changed'};
  // Another caller can accept the same normalized word while decorations load.
  // The accepted guess owns its scoring slot; this caller must not score again.
  if(game.guessedWords.has(text))return {valid:false,result:'duplicate'};
  const playerCosmetics = _applyFcTitleSubstitution(playerCosmeticsRaw, game);

  const _perks = _readPerks(msg.user);
  const guess = {
    word: text,
    rank,
    user: {
      id: rawUserId,
      platformUserId: canonicalUserId,
      displayName: resolvedDisplayName,
      username: msg.user.username || null,
      profilePic: fixAvatarUrl(msg.user.profilePic) || null,
      platform: canonicalPlatform,
      customColor: msg.user.customColor || null,
      cosmetics: playerCosmetics,
      linkedDiscord: linkedDiscord,
      ..._perks
    },
    timestamp: new Date().toISOString()
  };

  if(callbacks.acceptGuess)return callbacks.acceptGuess(guess,text);
  game.guessedWords.add(text);
  game.guesses.push(guess);

  callbacks.onNewGuess(guess);

  console.log(`[Game] "${text}" = #${rank.toLocaleString()} by ${guess.user.displayName}`);

  if (rank === config.winRank) {
    await callbacks.onWin(guess, text);
  }
  return {valid:true,result:'accepted',word:text};
}

// Guess processing must never take the server down. Call sites (server.js
// handleGuess/handleSessionGuess, sp-namespace) fire this without awaiting,
// so any exception escaping the async body — e.g. a bug in the onNewGuess /
// onWin callbacks — becomes an unhandled promise rejection. Log and swallow.
async function processGuessSafe(msg, game, config, cosmeticsCache, callbacks) {
  try {
    return await processGuess(msg, game, config, cosmeticsCache, callbacks);
  } catch (err) {
    console.warn('[Game] Guess acceptance unavailable');
    return {valid:false,result:'unavailable',retryable:true};
  }
}

module.exports = { processGuess: processGuessSafe, toSingular, toAmerican, isBlockedGuess, resolveRank, RANK_OUTSIDE_POOL };
