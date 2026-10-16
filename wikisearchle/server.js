try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (e) { /* dotenv optional */ }
if (!process.env.GAME_API_SECRET) {
  console.error('[FATAL] GAME_API_SECRET env var not set — refusing to start.');
  process.exit(1);
}

// ===== WikiSearchle — Fully Independent Composite Game =====
// Owns its own target, round, chat processing, and article state.
// Uses Searchle's POST /api/rank as a stateless ranking backend for the
// semantic-rank cards. Uses Wikipedia's MediaWiki API (via lib/wikipedia) for
// the article reveal. Guesses arrive via Chat Relay chat-message events.

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

const { buildRound, processGuess, serializeRound, revealAll, revealTitle, isFullyRevealed, unrevealedBodyNorms, getTitleDisplayOrderNorms, STOPLIST, normalize } = require('./lib/redactor');

// ── Rank-target ordering ──────────────────────────────────────────────
//
// Tier-orders the title-word rotation so common-noun context-builders
// rank first and proper nouns / polysemous words defer to the end. See
// chat-relay's src/rank-target-tiering.js for the full helper module
// (data sources, tier definitions, heuristic specifics) and ContextKeep
// memory wikisearchle_rank_target_tiering for behavior details.
//
// The deferProperNounsToEnd name is kept as a thin wrapper for backward
// compatibility with the four existing call-sites in this file.

let _tieringModule = null;
function _getTieringModule() {
  if (_tieringModule) return _tieringModule;
  const RELAY_DIR = process.env.CHAT_RELAY_DIR
    || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
  _tieringModule = require(path.join(RELAY_DIR, 'src', 'rank-target-tiering'));
  return _tieringModule;
}

function deferProperNounsToEnd(baseOrder, titleWordsRaw) {
  return _getTieringModule().orderByRankTier(baseOrder, titleWordsRaw);
}

// Recover original-casing title words from a round/session object. Used
// by the rotation functions where the round may have been resumed from
// a persisted snapshot lacking titleWordsRaw. Falls back to splitting
// articleTitle by whitespace.
function _titleWordsRawForRound(round) {
  if (round && Array.isArray(round.titleWordsRaw) && round.titleWordsRaw.length) {
    return round.titleWordsRaw;
  }
  const t = (round && round.articleTitle) || '';
  return String(t).split(/\s+/).filter(Boolean);
}


const { fetchLeadSection } = require('./lib/wikipedia');
const articleGenerator = require('./lib/article-generator');
const sessionManager = require('./src/session-manager');

const PORT = process.env.PORT || 3029;
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';

// Auto-end public MP rounds that stay unsolved for too long so the same
// article doesn't play forever on low-traffic surfaces like wikicontexto.com.
const MAX_ROUND_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const STALE_ROUND_CHECK_MS = 5 * 60 * 1000;   // check every 5 minutes

// ── Premium web-play gate (2026-07-19) ──────────────────────────────
// Public web MULTIPLAYER guessing and UNLIMITED (random-article) solo
// require Donor Class / TikTok Super Fan. The daily + weekly solo puzzles
// stay free, streamer-session sockets and relay chat (tiktok/discord)
// use different code paths and stay free.
// Share the SDK's current entitlement policy: unknown/denied accounts
// cannot gain access during an outage; confirmed active access has a fixed
// five-minute grace measured from the last successful entitlement lookup.
async function isPremiumWebUser(accountId) {
  return gameShared.isPremiumWebUser(accountId);
}

// Resolve a browser request to the WT account id by asking Chat Relay to
// verify its signed portal session or remember cookie. Returns null for guests.
async function resolveUserFromCookie(req) {
  const cookie = req.headers.cookie || '';
  if (typeof cookie !== 'string' || cookie.length > 16384 || !/(?:^|;)\s*(?:wt_remember|connect\.sid)=[^;]+/.test(cookie)) return null;
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/internal/whoami`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
      headers: {
        'x-api-key': API_SECRET,
        'x-forwarded-cookie': cookie,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.user) {
      return data.user.anchorId || data.user.id || null;
    }
  } catch (e) {
    console.error('[WikiSearchle] whoami failed:', e.message);
  }
  return null;
}

// Whitelist of streamer handles allowed to spawn private sessions.
// Refreshed from chat-relay every 5 min so newly-whitelisted streamers
// get their /<handle> URL working without a restart. Empty set = deny
// all (fail-closed) on boot until first refresh succeeds.
let _validStreamerHandles = new Set();
// Per-streamer settings: { disablePlayerPage: bool, blockedSet: Set<"platform:id"> }
let _streamerSettings = new Map();
async function _refreshStreamerHandles() {
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-handles`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data && data.handles)) {
      _validStreamerHandles = new Set(data.handles.map(h => String(h).toLowerCase()));
    }
    if (Array.isArray(data && data.settings)) {
      const m = new Map();
      for (const s of data.settings) {
        const h = String((s && s.handle) || '').toLowerCase();
        if (!h) continue;
        const bset = new Set();
        if (Array.isArray(s.blockedPlayers)) {
          for (const b of s.blockedPlayers) {
            const p = String((b && b.platform) || '').toLowerCase();
            const id = String((b && b.id) || '');
            if (p && id) bset.add(p + ':' + id);
          }
        }
        m.set(h, { disablePlayerPage: !!s.disablePlayerPage, blockedSet: bset });
      }
      _streamerSettings = m;
    }
  } catch (_) { /* keep stale set on transient errors */ }
}
// Initial fetch + an aggressive retry loop until the Set is non-empty.
// Avoids a boot-race where wikisearchle finishes loading before chat-relay
// is ready, leaving valid handles unrecognized for 5 minutes.
_refreshStreamerHandles();
const _initialRetry = setInterval(() => {
  if (_validStreamerHandles.size > 0) { clearInterval(_initialRetry); return; }
  _refreshStreamerHandles();
}, 5000);
setTimeout(() => clearInterval(_initialRetry), 2 * 60 * 1000); // bail after 2min
setInterval(_refreshStreamerHandles, 60 * 1000).unref();
// Helpers used by URL routes + chat handlers.
function _isPagePlayDisabled(handle) {
  const s = _streamerSettings.get(String(handle || '').toLowerCase());
  return !!(s && s.disablePlayerPage);
}
function _isStreamerBlocking(handle, platform, platformUserId) {
  const s = _streamerSettings.get(String(handle || '').toLowerCase());
  if (!s || !s.blockedSet || !s.blockedSet.size) return false;
  const p = String(platform || '').toLowerCase();
  const id = String(platformUserId || '');
  if (!p || !id) return false;
  return s.blockedSet.has(p + ':' + id);
}

const SEARCHLE_URL = process.env.SEARCHLE_URL || 'http://localhost:3015';
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const RELAY_DIR = process.env.CHAT_RELAY_DIR || (process.platform === 'win32' ? 'C:/Chat Relay' : '/opt/chat-relay');
const API_SECRET = process.env.GAME_API_SECRET;
const searchleClient = require('./server/searchle-client');
const crypto = require('crypto');
// Opaque per-article handle. The client must be able to name which article it
// is playing on /guess and /complete, but the clean title IS the answer, so it
// cannot be that name. HMAC-keyed, NOT a plain digest: the playable pool is
// only ~27k titles and an unkeyed hash would be brute-forced offline.
// Falls back to a per-process random key in dev, where handles need only
// outlive the process (the random-article cache is in memory anyway).
const SOLO_HANDLE_KEY = process.env.SOLO_HANDLE_SECRET;
if (!SOLO_HANDLE_KEY) throw new Error('Solo handle credential unavailable');
function soloHandle(cleanTitle) {
  if (!cleanTitle) return null;
  return crypto.createHmac('sha256', SOLO_HANDLE_KEY)
    .update(String(cleanTitle)).digest('hex').slice(0, 24);
}
const gameShared = require(path.join(RELAY_DIR, 'src', 'game-shared.js'));
const { createCookieIdentityResolver, createWebGuessHandler, isolateRoundUser } = require('./lib/multiplayer-identity');
const { createRoundActions, createMultiplayerRewards } = require('./lib/multiplayer-rounds');
const { createTransactionalHintHandler } = require('./lib/paid-hints');
const { createHintJournal, writeAtomic } = require('./lib/hint-journal');
const resolveMultiplayerIdentity = createCookieIdentityResolver({ relayUrl: CHAT_RELAY_URL, secret: API_SECRET });

const TOP_N = 6;
const TICKER_CAP = 60;
const BATCH_GUESS_INTERVAL_MS = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POINTS_PER_FIND_FALLBACK = 1000;   // used if the word-bank lookup fails
const SESSION_HINT_INITIAL_STUCK_MS = 2 * 60 * 1000;
const SESSION_HINT_REPEAT_STUCK_MS = 60 * 1000;
const SESSION_HINT_LIKES_PER_LETTER = 1000;
const SESSION_HINT_SWEEP_MS = 5000;
const SESSION_HINT_PROGRESS_BROADCAST_MS = 1000;

// In-page guess-bar cosmetics cache. TikTok/YouTube chat messages already
// arrive with a `user.cosmetics` block (Chat Relay enriches them upstream),
// but `submit-guess` from the web bar bypasses Chat Relay entirely — so we
// hit Word Tycoon's /api/cosmetics/discord/<id> ourselves and cache the
// equipped block per platformUserId. Read is synchronous (cache or null);
// stale/missing entries kick a background refresh that fills the cache for
// the next guess. Aggressive TTL keeps load on Word Tycoon negligible.
const COSMETICS_CACHE_TTL_MS = 60_000;
const cosmeticsCache = new Map();           // id → { fetchedAt, equipped }
const cosmeticsFetchInFlight = new Map();   // id → Promise<void>
function readCachedCosmetics(id) {
  if (!id) return null;
  const c = cosmeticsCache.get(id);
  if (!c) return null;
  if ((Date.now() - c.fetchedAt) >= COSMETICS_CACHE_TTL_MS) return null;
  return c.equipped || null;
}
function refreshCosmeticsAsync(id) {
  if (!id) return;
  if (cosmeticsFetchInFlight.has(id)) return;
  const p = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(
        `${WORD_EMPIRES_URL}/api/cosmetics/discord/${encodeURIComponent(id)}`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (!res.ok) {
        cosmeticsCache.set(id, { fetchedAt: Date.now(), equipped: null });
        return;
      }
      const json = await res.json();
      cosmeticsCache.set(id, { fetchedAt: Date.now(), equipped: (json && json.equipped) || null });
    } catch (e) {
      // Negative-cache so a flapping endpoint doesn't trigger a fetch on
      // every keystroke. Expires with the same TTL as a successful entry.
      cosmeticsCache.set(id, { fetchedAt: Date.now(), equipped: null });
    } finally {
      cosmeticsFetchInFlight.delete(id);
    }
  })();
  cosmeticsFetchInFlight.set(id, p);
}

// Per-title-word bonus by find-order (1st title word found = 50k, 2nd = 40k,
// 3rd = 30k, 4th = 20k). Single-word articles get the first tier and end the
// round immediately. Applied in addition to the word's A+B+C base score.
const TITLE_WORD_BONUSES = [50000, 40000, 30000, 20000];
function titleWordBonus(findIndex) {
  if (findIndex < 0) return 0;
  return TITLE_WORD_BONUSES[Math.min(findIndex, TITLE_WORD_BONUSES.length - 1)];
}

// Strip trailing Wikipedia disambiguator parentheticals — "Clue (information)"
// → "Clue". The parenthetical isn't a real title word and showing it as a
// separate HIDDEN box confuses players (they can't guess a descriptor, and
// the round ends when the real title words are found leaving the descriptor
// box permanently hidden).
function stripDisambiguator(s) {
  return String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Word rarity base by Zipf tier. Letter + length bonuses come direct from
// the word-bank API and are added on top.
const WORD_RARITY_BASE = {
  common:   1000,   // Zipf >= 4
  uncommon: 4000,   // Zipf 3–4
  rare:     8000,   // Zipf 2–3
  ultra:   12000,   // Zipf < 2
  unknown: 15000,   // not in frequency data → treat as obscure
};
// The word-bank's letter-rarity bonus is tuned for daily word games. Scale
// it up for WikiSearchle so letter rarity contributes meaningfully relative
// to the higher word-rarity base above.
const LETTER_BONUS_MULTIPLIER = 10;

// Numbers score independently of word rarity, scaled by digit count.
// 1=500, 2=1k, 3=5k, 4=10k; 5+ doubles per digit and caps at 200k.
const NUMBER_POINTS_TABLE = { 1: 500, 2: 1000, 3: 5000, 4: 10000 };
const NUMBER_POINTS_CAP = 200000;

function scoreNumber(digitCount) {
  if (digitCount <= 0) return 0;
  if (NUMBER_POINTS_TABLE[digitCount]) return NUMBER_POINTS_TABLE[digitCount];
  // 5+ digits → 10k × 2^(d−4), capped at 200k.
  const extrapolated = NUMBER_POINTS_TABLE[4] * Math.pow(2, digitCount - 4);
  return Math.min(NUMBER_POINTS_CAP, extrapolated);
}

// Rank tiers for the word-announce rarity badge.
function rankTier(rank) {
  if (typeof rank !== 'number' || rank < 0) return 'common';
  if (rank <= 100) return 'rare';
  if (rank <= 2000) return 'uncommon';
  return 'common';
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// Host-aware SEO middleware: serves /, /about, /solo, /sitemap.xml, /robots.txt
// with rebranded titles/OG/JSON-LD when Host=wikicontexto.com (canonical still
// points to wikisearchle.com — Option B dedupe). Must come BEFORE static so it
// can intercept index.html / solo/index.html.
require('./src/seo-middleware').attach(app);

// Versioned Vite bundles and the copied app shell share the existing origin.
// No dev server runs in production; set WIKICONTEXTO_LEGACY_UI=1 to roll back.
if (process.env.WIKICONTEXTO_LEGACY_UI !== '1') {
  app.use('/assets', express.static(path.join(__dirname, 'dist', 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(path.join(__dirname, 'dist')));
}
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://wordtycoon.live', 'https://www.wordtycoon.live',
  'https://wordgame.live', 'https://www.wordgame.live',
  'https://wikiword.live', 'https://www.wikiword.live',
  'https://wikisearchle.com', 'https://www.wikisearchle.com',
  // WikiContexto co-hosts the same app on a second domain — see public/index.html
  'https://wikicontexto.com', 'https://www.wikicontexto.com',
];
const io = new Server(server, {
  cors: { origin: (o, cb) => (!o || ALLOWED_ORIGINS.includes(o)) ? cb(null, true) : cb(new Error('CORS rejected')) }
});
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: API_SECRET, io });

// --- Coverage pool (shared with WikiWord) ---
const COVERAGE_PATH = path.join(RELAY_DIR, 'data', 'wikipedia-coverage.json');
let coverage;
try {
  coverage = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf-8'));
} catch (e) {
  console.error(`[WikiSearchle] Failed to load coverage at ${COVERAGE_PATH}: ${e.message}`);
  process.exit(1);
}
// Per-source acceptance for the deck. Vital, popular-*, and the legacy
// "unknown" pool (simple concept words like "Ape", "Bed") are pre-curated
// at import time and pass unfiltered. category-crawl content was scraped
// indiscriminately from Wikipedia category pages and needs a popularity
// gate so the deck doesn't drown in obscure indie films / 2008 novels /
// japanese-only video games. Threshold tunable via env without code change.
// Articles that 404'd during the pageview backfill are excluded outright
// — they're literally gone from Wikipedia and would fail to render.
const CATEGORY_CRAWL_MIN_VIEWS = parseInt(process.env.CATEGORY_CRAWL_MIN_VIEWS || '50000', 10);

// Curated MP article pool. When data/article-pool-1k.json (or the path in
// WIKISEARCHLE_POOL_PATH) exists, the MP deck restricts to the slugs in
// that file — drops the deck from ~27K to a balanced ~1K of multi-word
// titles where most have LLM-rewritten article cache. To revert to the
// full coverage deck: rename the file or set WIKISEARCHLE_POOL_DISABLE=1
// then restart.
const ARTICLE_POOL_PATH = process.env.WIKISEARCHLE_POOL_PATH
  || path.join(__dirname, 'data', 'article-pool-1k.json');
let articlePoolSlugs = null;
if (!process.env.WIKISEARCHLE_POOL_DISABLE) {
  try {
    const ap = JSON.parse(fs.readFileSync(ARTICLE_POOL_PATH, 'utf-8'));
    articlePoolSlugs = new Set((ap.pool || []).map((e) => e.slug));
    console.log(`[WikiSearchle] Curated article pool active (${articlePoolSlugs.size} slugs from ${path.basename(ARTICLE_POOL_PATH)})`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] article pool load failed: ${e.message}`);
    else console.log('[WikiSearchle] No curated article pool — using full coverage deck');
  }
}

// Build the set of titles that actually have a cached LLM article. By
// default the deck restricts to these too — no Wikipedia fallback for
// MP rounds. To allow Wikipedia fallback (older behavior), set env
// WIKISEARCHLE_ALLOW_WIKIPEDIA_FALLBACK=1.
let cachedArticleSlugs = null;
if (articlePoolSlugs && !process.env.WIKISEARCHLE_ALLOW_WIKIPEDIA_FALLBACK) {
  cachedArticleSlugs = new Set();
  try {
    const dir = path.join(__dirname, 'data', 'generated-articles');
    for (const f of fs.readdirSync(dir)) {
      // Skip the .failed.txt sidecars — those are not active articles.
      if (!f.endsWith('.txt') || f.endsWith('.failed.txt')) continue;
      cachedArticleSlugs.add(f.slice(0, -4));
    }
    console.log(`[WikiSearchle] LLM-only mode active (${cachedArticleSlugs.size} cached articles will be the deck)`);
  } catch (e) {
    console.log(`[WikiSearchle] cached-articles dir read failed: ${e.message} — Wikipedia fallback enabled`);
    cachedArticleSlugs = null;
  }
}

// Easy-article filter: require the title to be all common-noun /
// adjective / focused mixed-POS words (tiers 1-2), reject proper nouns
// (T4), polysemous/verb-dominant words (T3), Wikipedia disambiguation
// parentheticals ("Marble (toy)"), and compound named entities
// ("Carolina Beach State Park"). Implemented in the shared chat-relay
// tiering module — see ContextKeep `wikisearchle_easy_article_filter`.
// Disable with WIKISEARCHLE_EASY_FILTER_DISABLE=1.
const EASY_FILTER_ENABLED = !process.env.WIKISEARCHLE_EASY_FILTER_DISABLE;
let _tieringForFilter = null;
function _easyFilterModule() {
  if (_tieringForFilter) return _tieringForFilter;
  _tieringForFilter = require(path.join(RELAY_DIR, 'src', 'rank-target-tiering'));
  return _tieringForFilter;
}

function acceptForDeck(p) {
  if (p.backfillStatus === 'not-found') return false;
  if (p.source === 'category-crawl') {
    if (typeof p.views12mo !== 'number' || p.views12mo < CATEGORY_CRAWL_MIN_VIEWS) return false;
  }
  // Curated pool restriction: title's slug must appear in the loaded set.
  if (articlePoolSlugs) {
    const slug = articleGenerator.slugify(p.title || '');
    if (!articlePoolSlugs.has(slug)) return false;
    // No-fallback mode: also require a cached LLM article exists.
    if (cachedArticleSlugs && !cachedArticleSlugs.has(slug)) return false;
  }
  // Easy-article filter (last gate, so the curated pool's intersection
  // is computed). Applied to every article regardless of curated-pool
  // status — the easy filter is the new primary difficulty control.
  if (EASY_FILTER_ENABLED) {
    // Looser variant: accept if AT LEAST ONE title word is findable (T1/T2).
    // T3/T4 words in the title are tagged skippedTitleNorms at round-build
    // and hidden from gameplay until round-end reveal. See ContextKeep
    // memory `wikisearchle_hidden_hard_title_words`.
    if (!_easyFilterModule().articleHasAtLeastOneEasyTitleWord(p)) return false;
  }
  return true;
}
const playablePool = Object.entries(coverage.pages)
  .filter(([, v]) => v.status === 'exists')
  .filter(([, v]) => acceptForDeck(v))
  .map(([w]) => w);
console.log(`[WikiSearchle] Loaded coverage: ${playablePool.length} playable targets (category-crawl gate: >=${CATEGORY_CRAWL_MIN_VIEWS} views/yr${articlePoolSlugs ? ', curated pool active' : ''}${EASY_FILTER_ENABLED ? ', easy-article filter active' : ''})`);

// ── Per-streamer difficulty ────────────────────────────────────────────
// Streamers set this on the chat-relay dashboard. WikiSearchle uses the
// `views12mo` (annual Wikipedia pageviews) baked into the curated article-
// pool files as the difficulty signal — long-form article length turned
// out to be a poor popularity proxy (court-case articles are huge but
// obscure), so we load all per-pool view counts at boot and bucket by
// real popularity instead. Cached 60s per handle so we don't poll the
// relay on every round build.

function _pageKeySlug(pageKey) {
  return articleGenerator.slugify(pageKey || '');
}

// Build a slug -> metadata map from every article-pool file. ~7800 slugs
// out of ~14500 playable targets have view data; the rest are implicitly
// "unknown / obscure" and only included in Hard/Very Hard. Topic metadata is
// also used to keep shuffled decks from clumping into long pop-culture runs.
const _slugToPoolMeta = (() => {
  const map = new Map();
  const dir = path.join(__dirname, 'data');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f !== 'article-pool.json' && !/^article-pool-.+\.json$/.test(f)) continue;
      if (f.includes('.bak')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        for (const a of (data.pool || [])) {
          const slug = a && a.slug;
          const views = a && a.views12mo;
          if (typeof slug !== 'string') continue;
          const prev = map.get(slug) || {};
          const next = { ...prev };
          if (typeof views === 'number' && (typeof next.views12mo !== 'number' || next.views12mo < views)) {
            next.views12mo = views;
          }
          if (!next.topic && typeof a.topic === 'string' && a.topic.trim()) {
            next.topic = a.topic.trim();
          }
          map.set(slug, next);
        }
      } catch (_) {}
    }
  } catch (_) {}
  return map;
})();
const _slugToViews = new Map(
  [..._slugToPoolMeta.entries()]
    .filter(([, meta]) => typeof meta.views12mo === 'number')
    .map(([slug, meta]) => [slug, meta.views12mo])
);
console.log(`[WikiSearchle] Difficulty view-table: ${_slugToViews.size.toLocaleString()} slugs with views12mo data`);

// Difficulty → views range. 'requiresViewData=true' rejects articles
// without view data (used for Easy modes — those should be guaranteed-
// popular targets). Hard modes include unknown-views slugs because no
// curated pool listed them, which usually means obscure.
const DIFFICULTY_VIEWS = {
  'very-common': { min: 300000, max: Infinity, requiresViewData: true  },
  'common':      { min: 100000, max: Infinity, requiresViewData: true  },
  'normal':      null,
  'rare':        { min: 0,      max: 100000,   requiresViewData: false },
  'very-rare':   { min: 0,      max: 20000,    requiresViewData: false },
};

function _pageKeyViews(pageKey) {
  // Coverage keys come in as raw titles (e.g. "Prime Minister of the
  // United Kingdom"); pool files use slugified keys. Slugify on the fly
  // — articleGenerator.slugify is the canonical normalizer.
  const slug = _pageKeySlug(pageKey);
  return _slugToViews.get(slug);
}
function _pageKeyTopic(pageKey) {
  const meta = _slugToPoolMeta.get(_pageKeySlug(pageKey));
  return (meta && meta.topic) || 'unknown';
}
function _passesDifficulty(pageKey, range) {
  if (!range) return true;
  const v = _pageKeyViews(pageKey);
  if (typeof v !== 'number') return !range.requiresViewData;
  return v >= range.min && v < range.max;
}
const _DIFFICULTY_TTL_MS = 60 * 1000;
const _difficultyCache = new Map();
async function _getStreamerDifficulty(handle) {
  const key = String(handle || '').toLowerCase();
  if (!key) return 'normal';
  const cached = _difficultyCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < _DIFFICULTY_TTL_MS) return cached.value;
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/streamer-public/by-handle/${encodeURIComponent(key)}/difficulty`);
    if (!res.ok) { _difficultyCache.set(key, { value: 'normal', fetchedAt: Date.now() }); return 'normal'; }
    const data = await res.json();
    const value = (data && typeof data.wordFrequency === 'string') ? data.wordFrequency : 'normal';
    _difficultyCache.set(key, { value, fetchedAt: Date.now() });
    return value;
  } catch (_) {
    return (cached && cached.value) || 'normal';
  }
}

function filterPoolByDifficulty(pool, wordFrequency) {
  const range = DIFFICULTY_VIEWS[wordFrequency || 'normal'];
  if (!range) return pool;
  const filtered = pool.filter((key) => _passesDifficulty(key, range));
  // Don't strand the picker on an over-aggressive filter — fall back to the
  // unfiltered pool so the round still spawns, just at default difficulty.
  if (filtered.length < 10) {
    console.warn(`[WikiSearchle] difficulty="${wordFrequency}" yielded ${filtered.length} candidates from ${pool.length} — using full pool.`);
    return pool;
  }
  console.log(`[WikiSearchle] difficulty="${wordFrequency}" pool: ${filtered.length} candidates (from ${pool.length})`);
  return filtered;
}

// --- Round state ---
let currentRound = null;
function isCurrentRound(round) {
  return !!round && (round.sessionHandle ? sessionManager.getSession(round.sessionHandle) === round : currentRound === round);
}
function isActiveRound(round) { return isCurrentRound(round) && !round.won; }
const roundActions = createRoundActions({ isCurrent: isCurrentRound });
const multiplayerRewards = createMultiplayerRewards({ shared: gameShared,
  onError: () => console.warn('[WikiMPRewards] Delivery retained for retry/review') });

function roundNeedsCompletion(round) {
  return !!round && !round.won && (!!round.completionPending || (
    Array.isArray(round.titleWordNorms) && round.titleWordNorms.length > 0 &&
    round.titleWordNorms.every(norm => round.revealed.has(norm))
  ));
}

// Reveals can survive an interrupted handler or restart before the finalizer.
// Recover from the round itself; a later guess must not change its winner.
function finishCompletedRound(round) {
  if (!isActiveRound(round) || !roundNeedsCompletion(round)) return false;
  const lastFinder = Object.values(round.titleWordFinders || {})
    .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  const targetFinder = round.completionPending
    ? round.completionPending.targetFinder : lastFinder?.nickname || null;
  if (!round.titleRevealed) {
    round.titleRevealed = true;
    io.to(round.sessionHandle ? _sessionRoom(round.sessionHandle) : 'ws').emit('wikisearchle-title-revealed', {
      articleTitle: round.articleTitle,
      titleWordsRevealed: round.titleWordNorms || [],
    });
  }
  if (round.sessionHandle) endSessionRound(round, targetFinder);
  else endRound(targetFinder, round);
  return true;
}

function retryRoundCompletions() {
  const candidates = [currentRound, ...sessionManager.listSessions().map(row => sessionManager.getSession(row.handle))];
  for (const round of candidates) if (roundNeedsCompletion(round))
    roundActions.run(round, finishCompletedRound)
      .catch(() => console.warn('[WikiMPRewards] Completion retry unavailable'));
}

function prepareRoundCompletion(round, targetFinder) {
  if (!round.completionPending) {
    const winner = Object.values(round.playerStats || {}).sort((a, b) => (b.points || 0) - (a.points || 0))[0] || null;
    round.completionPending = JSON.parse(JSON.stringify({ winner, targetFinder: targetFinder || null }));
  }
  const completion = round.completionPending;
  try {
    const reward = multiplayerRewards.reserve(round, completion.winner);
    if (reward) round.rewardEventId = reward.payload.eventId;
    delete round.completionPending;
    return { ...completion, reward };
  } catch {
    // Freeze the candidate, keep the round unfinished and retry reservation.
    // Gameplay snapshots alone never authorize reconstructed historic rewards.
    if (round.sessionHandle) sessionManager.scheduleSave(); else scheduleSave();
    console.warn('[WikiMPRewards] Reservation unavailable; completion retained');
    return null;
  }
}

let restartTimer = null;
let nextAnonymousGuestNumber = 1;
const anonymousGuestNames = new Map();

function sanitizeGuestId(value) {
  const clean = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return clean || '';
}

function nextAnonymousLabel() {
  const label = `Anon${nextAnonymousGuestNumber}`;
  nextAnonymousGuestNumber += 1;
  return label;
}

function ensureNextAnonymousGuestNumberFromPlayers(playerStats) {
  let maxSeen = 0;
  for (const player of Object.values(playerStats || {})) {
    const match = /^Anon(\d+)$/i.exec(String(player && player.nickname || '').trim());
    if (!match) continue;
    maxSeen = Math.max(maxSeen, Number(match[1]) || 0);
  }
  if (maxSeen >= nextAnonymousGuestNumber) {
    nextAnonymousGuestNumber = maxSeen + 1;
  }
}

function restoreAnonymousGuestState(savedNames, savedNextNumber, playerStats) {
  anonymousGuestNames.clear();
  const fromState = Array.isArray(savedNames) ? savedNames : [];
  for (const [guestId, label] of fromState) {
    const cleanId = sanitizeGuestId(guestId);
    const cleanLabel = String(label || '').trim();
    if (!cleanId || !/^Anon\d+$/i.test(cleanLabel)) continue;
    anonymousGuestNames.set(cleanId, cleanLabel);
  }
  nextAnonymousGuestNumber = Math.max(1, Number(savedNextNumber) || 1);
  ensureNextAnonymousGuestNumberFromPlayers(playerStats);
}

function assignAnonymousGuestName(rawGuestId) {
  const guestId = sanitizeGuestId(rawGuestId);
  if (!guestId) return nextAnonymousLabel();
  const existing = anonymousGuestNames.get(guestId);
  if (existing) return existing;
  const label = nextAnonymousLabel();
  anonymousGuestNames.set(guestId, label);
  return label;
}

// --- Persistence ---
// The round is saved to disk on every significant state change (debounced),
// and synchronously on graceful shutdown, so a PM2 restart or crash resumes
// the round that was in progress.
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'round-state.json');
const DECK_PATH = path.join(DATA_DIR, 'deck-state.json');
const SESSION_DECK_PATH = path.join(DATA_DIR, 'session-deck-state.json');
const SOLO_RANDOM_DECK_PATH = path.join(DATA_DIR, 'solo-random-deck-state.json');
const DECK_SHUFFLE_VERSION = 2; // v2: topic-balanced remaining deck tails
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

// --- Player suspensions ---
const SUSPENDED_USERS_PATH = path.join(DATA_DIR, 'suspended-users.json');
const SUSPENDED_IPS_PATH = path.join(DATA_DIR, 'suspended-ips.json');
const suspendedUsers = new Set();
const suspendedIPs = new Set();
function loadSuspendedUsers() {
  try {
    const raw = fs.readFileSync(SUSPENDED_USERS_PATH, 'utf-8');
    const arr = JSON.parse(raw);
    suspendedUsers.clear();
    for (const id of arr) suspendedUsers.add(String(id));
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] suspension load failed: ${e.message}`);
  }
}
function loadSuspendedIPs() {
  try {
    const raw = fs.readFileSync(SUSPENDED_IPS_PATH, 'utf-8');
    const arr = JSON.parse(raw);
    suspendedIPs.clear();
    for (const ip of arr) suspendedIPs.add(String(ip));
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] IP suspension load failed: ${e.message}`);
  }
}
function saveSuspendedUsers() {
  try {
    const tmp = SUSPENDED_USERS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Array.from(suspendedUsers)));
    fs.renameSync(tmp, SUSPENDED_USERS_PATH);
  } catch (e) { console.log(`[WikiSearchle] suspension save failed: ${e.message}`); }
}
function saveSuspendedIPs() {
  try {
    const tmp = SUSPENDED_IPS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Array.from(suspendedIPs)));
    fs.renameSync(tmp, SUSPENDED_IPS_PATH);
  } catch (e) { console.log(`[WikiSearchle] IP suspension save failed: ${e.message}`); }
}
function isSuspended(user, ip) {
  if (!user && !ip) return false;
  if (user) {
    const candidates = [user.linkedDiscord, user.platformUserId, user.id];
    if (candidates.some((c) => c && suspendedUsers.has(String(c)))) return true;
  }
  if (ip) {
    const normalizedIP = String(ip).split(',')[0].trim();
    if (suspendedIPs.has(normalizedIP)) return true;
  }
  return false;
}
loadSuspendedUsers();
loadSuspendedIPs();
// Auto-add known suspended IDs/IPs here; remove via admin endpoints
suspendedUsers.add('838862323350634526');
suspendedIPs.add('143.44.225.52');
saveSuspendedUsers();
saveSuspendedIPs();

// --- Article deck (plays every article once per cycle in shuffled order) ---
// A fresh Fisher-Yates shuffle is drawn when the deck drains; persisted so
// PM2 restarts don't re-draw titles we've already played in this cycle.
let deck = [];
let deckCursor = 0;

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function buildTopicBalancedDeck(pool) {
  const source = Array.isArray(pool) ? pool : [];
  if (source.length <= 1) return source.slice();
  const groups = new Map();
  for (const key of source) {
    const topic = _pageKeyTopic(key);
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(key);
  }
  if (groups.size <= 1) return shuffleInPlace(source.slice());

  const decorated = [];
  for (const [topic, items] of groups) {
    const shuffled = shuffleInPlace(items.slice());
    const size = shuffled.length;
    for (let i = 0; i < shuffled.length; i++) {
      decorated.push({
        key: (i + Math.random()) / size,
        tie: Math.random(),
        topic,
        value: shuffled[i],
      });
    }
  }
  decorated.sort((a, b) => (a.key - b.key) || (a.tie - b.tie));
  return decorated.map((item) => item.value);
}
function reshuffleDeck() {
  deck = buildTopicBalancedDeck(playablePool);
  deckCursor = 0;
  console.log(`[WikiSearchle] Reshuffled topic-balanced deck — ${deck.length} articles in new cycle`);
  saveDeck();
}
function reconcileDeck(savedDeck, savedCursor, pool, opts = {}) {
  const poolSet = new Set(pool);
  const seen = new Set();
  const drawn = [];
  const remaining = [];
  const rawDeck = Array.isArray(savedDeck) ? savedDeck : [];
  const rawCursor = Math.min(Math.max(Number(savedCursor) || 0, 0), rawDeck.length);
  for (let i = 0; i < rawDeck.length; i++) {
    const key = rawDeck[i];
    if (!poolSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (i < rawCursor) drawn.push(key);
    else remaining.push(key);
  }
  const missing = pool.filter((key) => !seen.has(key));
  const rebalanceRemaining = !!opts.rebalanceRemaining;
  let nextRemaining;
  if (rebalanceRemaining) {
    nextRemaining = buildTopicBalancedDeck(remaining.concat(missing));
  } else {
    nextRemaining = remaining.concat(buildTopicBalancedDeck(missing));
  }
  return {
    deck: drawn.concat(nextRemaining),
    cursor: drawn.length,
    added: missing.length,
    rebalanced: rebalanceRemaining,
  };
}
function saveDeck() {
  try {
    const tmp = DECK_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ deck, cursor: deckCursor, shuffleVersion: DECK_SHUFFLE_VERSION }));
    fs.renameSync(tmp, DECK_PATH);
  } catch (e) { console.log(`[WikiSearchle] deck save failed: ${e.message}`); }
}
function loadDeck() {
  try {
    const raw = fs.readFileSync(DECK_PATH, 'utf-8');
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.deck)) throw new Error('malformed');
    const reconciled = reconcileDeck(s.deck, s.cursor, playablePool, {
      rebalanceRemaining: s.shuffleVersion !== DECK_SHUFFLE_VERSION,
    });
    deck = reconciled.deck;
    deckCursor = reconciled.cursor;
    if (reconciled.added > 0 || reconciled.rebalanced) {
      if (reconciled.added > 0) {
        console.log(`[WikiSearchle] Added ${reconciled.added} new article(s) to saved deck cycle`);
      }
      if (reconciled.rebalanced) {
        console.log('[WikiSearchle] Rebalanced remaining saved deck cycle by topic');
      }
      saveDeck();
    }
    if (deckCursor >= deck.length) { reshuffleDeck(); return; }
    console.log(`[WikiSearchle] Restored deck — ${deckCursor}/${deck.length} drawn, ${deck.length - deckCursor} remaining in cycle`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] deck load failed: ${e.message}`);
    reshuffleDeck();
  }
}
function drawNextTitle() {
  if (deckCursor >= deck.length) reshuffleDeck();
  const key = deck[deckCursor++];
  saveDeck();
  return key;
}
loadDeck();

// Streamer-private sessions have their own shuffled decks. Public multiplayer
// already drains a deck; sessions used to pick random-with-replacement, which
// made repeated articles much more likely during a live stream.
const sessionDecks = new Map();
const SESSION_RECENT_CAP = 200; // last N played are deferred to the end of the next cycle
function _sessionDeckKey(handle, wordFrequency) {
  return `${String(handle || '').toLowerCase()}:${String(wordFrequency || 'normal').toLowerCase()}`;
}
function _sessionRecentCap(poolLength) {
  return Math.min(SESSION_RECENT_CAP, Math.max(0, Math.floor((poolLength || 0) / 2)));
}
function saveSessionDecks() {
  try {
    const out = {};
    for (const [key, state] of sessionDecks) {
      out[key] = {
        handle: state.handle || '',
        wordFrequency: state.wordFrequency || 'normal',
        deck: Array.isArray(state.deck) ? state.deck : [],
        cursor: Math.max(0, Number(state.cursor) || 0),
        shuffleVersion: DECK_SHUFFLE_VERSION,
        recent: Array.isArray(state.recent) ? state.recent : [],
      };
    }
    const tmp = SESSION_DECK_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, SESSION_DECK_PATH);
  } catch (e) {
    console.log(`[Session] deck save failed: ${e.message}`);
  }
}
function loadSessionDecks() {
  try {
    const raw = fs.readFileSync(SESSION_DECK_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') throw new Error('malformed');
    let count = 0;
    for (const [key, state] of Object.entries(data)) {
      if (!state || !Array.isArray(state.deck)) continue;
      sessionDecks.set(key, {
        handle: String(state.handle || '').toLowerCase(),
        wordFrequency: String(state.wordFrequency || 'normal').toLowerCase(),
        deck: state.deck,
        cursor: Math.max(0, Number(state.cursor) || 0),
        shuffleVersion: Number(state.shuffleVersion) || 0,
        recent: Array.isArray(state.recent) ? state.recent : [],
      });
      count++;
    }
    if (count) console.log(`[Session] Loaded ${count} session deck(s)`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[Session] deck load failed: ${e.message}`);
  }
}
function reshuffleSessionDeck(handle, wordFrequency, pool, previousRecent) {
  const key = _sessionDeckKey(handle, wordFrequency);
  const cap = _sessionRecentCap(pool.length);
  // Seed recent from the tail of the previous cycle if nothing explicit was passed.
  const recentSet = new Set((previousRecent || []));
  const available = pool.filter((k) => !recentSet.has(k));
  const tail = buildTopicBalancedDeck([...recentSet]);
  const deck = buildTopicBalancedDeck(available).concat(tail);
  const state = {
    handle: String(handle || '').toLowerCase(),
    wordFrequency: String(wordFrequency || 'normal').toLowerCase(),
    deck,
    cursor: 0,
    shuffleVersion: DECK_SHUFFLE_VERSION,
    recent: Array.from(recentSet).slice(-cap),
  };
  sessionDecks.set(key, state);
  console.log(`[Session] "${state.handle}" reshuffled topic-balanced ${state.wordFrequency} deck — ${state.deck.length} articles (${tail.length} recent deferred to tail)`);
  saveSessionDecks();
  return state;
}
function drawNextSessionTitle(handle, wordFrequency, pool) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const key = _sessionDeckKey(handle, wordFrequency);
  let state = sessionDecks.get(key);
  if (!state || !Array.isArray(state.deck)) {
    state = reshuffleSessionDeck(handle, wordFrequency, pool);
  } else {
    const needsRebalance = state.shuffleVersion !== DECK_SHUFFLE_VERSION;
    const reconciled = reconcileDeck(state.deck, state.cursor, pool, {
      rebalanceRemaining: needsRebalance,
    });
    state.deck = reconciled.deck;
    state.cursor = reconciled.cursor;
    state.handle = String(handle || '').toLowerCase();
    state.wordFrequency = String(wordFrequency || 'normal').toLowerCase();
    state.shuffleVersion = DECK_SHUFFLE_VERSION;
    if (!Array.isArray(state.recent)) state.recent = [];
    if (reconciled.added > 0) {
      console.log(`[Session] "${state.handle}" added ${reconciled.added} article(s) to ${state.wordFrequency} deck`);
    }
    if (reconciled.rebalanced) {
      console.log(`[Session] "${state.handle}" rebalanced remaining ${state.wordFrequency} deck by topic`);
    }
  }
  if (state.cursor >= state.deck.length) {
    const cap = _sessionRecentCap(pool.length);
    const previousRecent = state.recent && state.recent.length
      ? state.recent
      : state.deck.slice(0, state.cursor).slice(-cap);
    state = reshuffleSessionDeck(handle, wordFrequency, pool, previousRecent);
  }
  const pick = state.deck[state.cursor++];
  if (pick) {
    state.recent = state.recent || [];
    state.recent.push(pick);
    const cap = _sessionRecentCap(pool.length);
    if (state.recent.length > cap) state.recent.shift();
  }
  saveSessionDecks();
  return pick || null;
}
loadSessionDecks();

// Solo Random used to pick from playablePool with replacement, so a player
// could see a recently completed article again long before the pool was
// exhausted. Give random mode its own persisted no-repeat deck cycle too.
let soloRandomDeck = [];
let soloRandomDeckCursor = 0;

function reshuffleSoloRandomDeck() {
  soloRandomDeck = buildTopicBalancedDeck(playablePool);
  soloRandomDeckCursor = 0;
  console.log(`[WikiSearchle-Solo] Reshuffled topic-balanced random deck — ${soloRandomDeck.length} articles in new cycle`);
  saveSoloRandomDeck();
}

function saveSoloRandomDeck() {
  try {
    const tmp = SOLO_RANDOM_DECK_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      deck: soloRandomDeck,
      cursor: soloRandomDeckCursor,
      shuffleVersion: DECK_SHUFFLE_VERSION,
    }));
    fs.renameSync(tmp, SOLO_RANDOM_DECK_PATH);
  } catch (e) {
    console.log(`[WikiSearchle-Solo] random deck save failed: ${e.message}`);
  }
}

function loadSoloRandomDeck() {
  try {
    const raw = fs.readFileSync(SOLO_RANDOM_DECK_PATH, 'utf-8');
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.deck)) throw new Error('malformed');
    const reconciled = reconcileDeck(s.deck, s.cursor, playablePool, {
      rebalanceRemaining: s.shuffleVersion !== DECK_SHUFFLE_VERSION,
    });
    soloRandomDeck = reconciled.deck;
    soloRandomDeckCursor = reconciled.cursor;
    if (reconciled.added > 0 || reconciled.rebalanced) {
      if (reconciled.added > 0) {
        console.log(`[WikiSearchle-Solo] Added ${reconciled.added} new article(s) to saved random deck cycle`);
      }
      if (reconciled.rebalanced) {
        console.log('[WikiSearchle-Solo] Rebalanced remaining random deck cycle by topic');
      }
      saveSoloRandomDeck();
    }
    if (soloRandomDeckCursor >= soloRandomDeck.length) {
      reshuffleSoloRandomDeck();
      return;
    }
    console.log(`[WikiSearchle-Solo] Restored random deck — ${soloRandomDeckCursor}/${soloRandomDeck.length} drawn, ${soloRandomDeck.length - soloRandomDeckCursor} remaining in cycle`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle-Solo] random deck load failed: ${e.message}`);
    reshuffleSoloRandomDeck();
  }
}

function drawNextSoloRandomTitle() {
  if (soloRandomDeckCursor >= soloRandomDeck.length) reshuffleSoloRandomDeck();
  const key = soloRandomDeck[soloRandomDeckCursor++];
  saveSoloRandomDeck();
  return key || null;
}

loadSoloRandomDeck();
let _saveScheduled = false;
function scheduleSave() {
  if (_saveScheduled) return;
  _saveScheduled = true;
  setTimeout(() => { _saveScheduled = false; saveState(); }, 1000);
}
function roundSnapshot() {
  if (!currentRound || !currentRound.leadPlaintext) return null;
  return {
    targetWord: currentRound.targetWord,
    startTime: currentRound.startTime,
    rewardRoundId: currentRound.rewardRoundId || null,
    rewardEventId: currentRound.rewardEventId || null,
    completionPending: currentRound.completionPending || null,
    firstHitAt: Array.from((currentRound.firstHitAt || new Map()).entries()),
    articleTitle: currentRound.articleTitle,
    leadPlaintext: currentRound.leadPlaintext,
    revealedWords: Array.from(currentRound.revealed),
    playerStats: currentRound.playerStats || {},
    allGuesses: currentRound.allGuesses || [],
    tickerBuffer: currentRound.tickerBuffer || [],
    topGuesses: currentRound.topGuesses || [],
    lastAnnounce: currentRound.lastAnnounce || null,
    rankCache: Array.from((currentRound.rankCache || new Map()).entries()),
    canonicalCache: Array.from((currentRound.canonicalCache || new Map()).entries()),
    totalRankedWords: currentRound.totalRankedWords || 0,
    guessCount: currentRound.guessCount || 0,
    won: !!currentRound.won,
    titleRevealed: !!currentRound.titleRevealed,
    rankTarget: currentRound.rankTarget || currentRound.targetWord,
    rankTargetTitleNorm: currentRound.rankTargetTitleNorm || null,
    excludedRankTargets: Array.from(currentRound.excludedRankTargets || []),
    titleWordNorms: currentRound.titleWordNorms || [],
    skippedTitleNorms: currentRound.skippedTitleNorms || [],
    titleCanonicals: currentRound.titleCanonicals || {},
    titleWordsFound: currentRound.titleWordsFound || 0,
    titleWordFinders: currentRound.titleWordFinders || {},
    anonymousGuestNames: Array.from(anonymousGuestNames.entries()),
    nextAnonymousGuestNumber,
    savedAt: Date.now(),
  };
}
function saveState(strict = false) {
  const snap = roundSnapshot();
  if (!snap) {
    if (strict) throw Error('Active round snapshot unavailable');
    try { fs.unlinkSync(STATE_PATH); } catch (e) {}
    return;
  }
  try {
    writeAtomic(STATE_PATH, snap);
  } catch (e) { if (strict) throw e; console.log(`[WikiSearchle] state save failed: ${e.message}`); }
}
function saveStateSync() { saveState(); }

// --- Lifetime player stats ---
// Per-player aggregation across rounds. Keyed by lowercased nickname.
// Accumulated in endRound() via aggregateRoundIntoStats() and served
// to the frontend via /api/player-stats/:key for the stats-modal feature.
const STATS_PATH = path.join(DATA_DIR, 'player-stats.json');
let playerStatsLifetime = {};
function loadPlayerStats() {
  try {
    const raw = fs.readFileSync(STATS_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') playerStatsLifetime = obj;
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] player stats load failed: ${e.message}`);
  }
}
function savePlayerStats() {
  try {
    const tmp = STATS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(playerStatsLifetime));
    fs.renameSync(tmp, STATS_PATH);
  } catch (e) { console.log(`[WikiSearchle] player stats save failed: ${e.message}`); }
}
function aggregateRoundIntoStats(round) {
  if (!round || !round.playerStats) return;
  const ranked = Object.entries(round.playerStats)
    .filter(([, p]) => (p.points || 0) > 0)
    .sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
  if (ranked.length === 0) return;
  const topScorerKey = ranked[0][0];
  const targetNorm = String(round.targetWord || '').toLowerCase();
  const titleFinders = round.titleWordFinders || {};
  const targetFinderEntry = titleFinders[targetNorm];
  const targetFinderKey = targetFinderEntry
    ? String(targetFinderEntry.nickname || '').toLowerCase()
    : null;
  const titleWordFindsByPlayer = {};
  for (const finder of Object.values(titleFinders)) {
    const nick = String(finder && finder.nickname || '').toLowerCase();
    if (!nick) continue;
    titleWordFindsByPlayer[nick] = (titleWordFindsByPlayer[nick] || 0) + 1;
  }

  // Count hits + guesses per player from allGuesses.
  const revealed = new Set(Array.from(round.revealed || new Set()));
  const perPlayer = {};
  for (const g of (round.allGuesses || [])) {
    const nick = String((g.user && g.user.displayName) || '').toLowerCase();
    if (!nick) continue;
    if (!perPlayer[nick]) perPlayer[nick] = { guesses: 0, hits: new Set() };
    perPlayer[nick].guesses++;
    const canon = String(g.canonical || g.word || '').toLowerCase();
    if (canon && revealed.has(canon)) perPlayer[nick].hits.add(canon);
  }

  const now = Date.now();
  const articleTitle = round.articleTitle || round.targetWord || '?';

  ranked.forEach(([key, pStats], idx) => {
    const points = pStats.points || 0;
    const existing = playerStatsLifetime[key] || {
      nickname: pStats.nickname,
      user: pStats.user || null,
      totalPoints: 0,
      roundsPlayed: 0,
      roundsWon: 0,
      targetFinds: 0,
      bestRound: null,
      totalTitleWordsFound: 0,
      totalWordsFound: 0,
      totalGuesses: 0,
      lastSeen: 0,
      recentRounds: [],
    };
    existing.nickname = pStats.nickname;
    if (pStats.user) existing.user = pStats.user;
    if (!Object.prototype.hasOwnProperty.call(existing, 'totalTitleWordsFound')) {
      existing.totalTitleWordsFound = Number(existing.targetFinds || 0);
    }
    existing.totalPoints += points;
    existing.roundsPlayed += 1;
    if (key === topScorerKey) existing.roundsWon += 1;
    if (key === targetFinderKey) existing.targetFinds += 1;

    const per = perPlayer[key] || { guesses: 0, hits: new Set() };
    const titleWordFinds = titleWordFindsByPlayer[key] || 0;
    existing.totalTitleWordsFound += titleWordFinds;
    existing.totalWordsFound += per.hits.size;
    existing.totalGuesses += per.guesses;
    existing.lastSeen = now;

    if (!existing.bestRound || points > existing.bestRound.points) {
      existing.bestRound = { points, articleTitle, at: now };
    }
    const identityKey = getIdentityKey(pStats.user);
    const firstHitAt = round.firstHitAt?.get(identityKey);
    const firstHitMs = firstHitAt ? (firstHitAt - new Date(round.startTime).getTime()) : null;

    existing.recentRounds.unshift({
      at: now,
      articleTitle,
      points,
      rankInRound: idx + 1,
      rankOutOf: ranked.length,
      wonRound: key === topScorerKey,
      foundTarget: key === targetFinderKey,
      titleWordsFound: titleWordFinds,
      wordsFound: per.hits.size,
      guesses: per.guesses,
      firstHitMs,
    });
    if (existing.recentRounds.length > 50) existing.recentRounds.length = 50;

    playerStatsLifetime[key] = existing;
  });
  savePlayerStats();

  // Update ELO and suspicion after stats are saved.
  try { updateEloForRound(round); } catch (e) { console.log(`[WikiSearchle] ELO update failed: ${e.message}`); }
  try { updateSuspicionForRound(round); } catch (e) { console.log(`[WikiSearchle] suspicion update failed: ${e.message}`); }
  try { reportRoundToWordTycoon(round).catch(() => console.warn('[WikiSearchle] round report unavailable')); } catch (e) { console.log(`[WikiSearchle] report to WT failed: ${e.message}`); }
}
loadPlayerStats();

// --- ELO + Cheater Detection ---
const ELO_PATH = path.join(DATA_DIR, 'elo-ratings.json');
const SUSPICION_PATH = path.join(DATA_DIR, 'suspicion-scores.json');
const CHEATER_FLAGS_PATH = path.join(DATA_DIR, 'cheater-flags.json');
let eloRatings = {};
let suspicionScores = {};
let cheaterFlags = [];

function getIdentityKey(user) {
  if (!user || typeof user !== 'object') return null;
  if (user.linkedDiscord) return `discord:${user.linkedDiscord}`;
  if (user.platformUserId && user.platform) return `${user.platform}:${user.platformUserId}`;
  return `nick:${String(user.displayName || '').toLowerCase()}`;
}

function loadEloRatings() {
  try {
    const raw = fs.readFileSync(ELO_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') eloRatings = obj;
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] ELO load failed: ${e.message}`);
  }
}
function saveEloRatings() {
  try {
    const tmp = ELO_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(eloRatings));
    fs.renameSync(tmp, ELO_PATH);
  } catch (e) { console.log(`[WikiSearchle] ELO save failed: ${e.message}`); }
}

function loadSuspicionScores() {
  try {
    const raw = fs.readFileSync(SUSPICION_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') suspicionScores = obj;
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] suspicion load failed: ${e.message}`);
  }
}
function saveSuspicionScores() {
  try {
    const tmp = SUSPICION_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(suspicionScores));
    fs.renameSync(tmp, SUSPICION_PATH);
  } catch (e) { console.log(`[WikiSearchle] suspicion save failed: ${e.message}`); }
}

function loadCheaterFlags() {
  try {
    const raw = fs.readFileSync(CHEATER_FLAGS_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    if (Array.isArray(obj)) cheaterFlags = obj;
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] cheater flags load failed: ${e.message}`);
  }
}
function saveCheaterFlags() {
  try {
    const tmp = CHEATER_FLAGS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cheaterFlags));
    fs.renameSync(tmp, CHEATER_FLAGS_PATH);
  } catch (e) { console.log(`[WikiSearchle] cheater flags save failed: ${e.message}`); }
}

function getAllStatsForIdentity(identityKey) {
  const matches = [];
  for (const [nick, entry] of Object.entries(playerStatsLifetime)) {
    if (!entry || !entry.user) continue;
    const u = entry.user;
    if (getIdentityKey(u) === identityKey) matches.push(entry);
  }
  return matches;
}

loadEloRatings();
loadSuspicionScores();
loadCheaterFlags();

// --- ELO update ---
function updateEloForRound(round) {
  if (!round || !round.playerStats) return;
  const ranked = Object.entries(round.playerStats)
    .filter(([, p]) => (p.points || 0) > 0)
    .sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
  if (ranked.length < 3) return;

  const N = ranked.length;
  const participants = ranked.map(([key, pStats], idx) => {
    const identityKey = getIdentityKey(pStats.user) || key;
    const existing = eloRatings[identityKey] || { elo: 1200, roundsCounted: 0, history: [] };
    return { key, identityKey, idx, points: pStats.points || 0, elo: existing.elo, roundsCounted: existing.roundsCounted, existing };
  });

  const deltas = new Map();
  for (let i = 0; i < participants.length; i++) {
    const A = participants[i];
    let totalDelta = 0;
    for (let j = 0; j < participants.length; j++) {
      if (i === j) continue;
      const B = participants[j];
      // Ties: same points → no exchange
      if (A.points === B.points) continue;
      const actual = A.points > B.points ? 1 : 0;
      const expected = 1 / (1 + Math.pow(10, (B.elo - A.elo) / 400));
      let K;
      if (A.roundsCounted < 10) K = 40;
      else if (A.roundsCounted < 30) K = 32;
      else if (A.roundsCounted < 100) K = 24;
      else K = 16;
      totalDelta += (K / (N - 1)) * (actual - expected);
    }
    deltas.set(A.identityKey, totalDelta);
  }

  const now = Date.now();
  const articleTitle = round.articleTitle || round.targetWord || '?';
  for (const p of participants) {
    const delta = Math.round(deltas.get(p.identityKey) || 0);
    const oldElo = p.elo;
    const newElo = Math.max(100, oldElo + delta);
    p.existing.elo = newElo;
    p.existing.roundsCounted = (p.existing.roundsCounted || 0) + 1;
    p.existing.history.unshift({ at: now, delta, newElo, articleTitle });
    if (p.existing.history.length > 20) p.existing.history.length = 20;
    eloRatings[p.identityKey] = p.existing;
  }
  saveEloRatings();
}

// --- Suspicion / cheater detection ---
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeSuspicion(rollingWindow) {
  if (!rollingWindow || rollingWindow.length < 50) return { score: 0, flags: [] };
  const window = rollingWindow.slice(-50);
  let score = 0;
  const flags = [];

  const totalGuesses = window.reduce((s, r) => s + (r.guesses || 0), 0);
  const totalHits = window.reduce((s, r) => s + (r.wordsFound || 0), 0);
  const totalWins = window.filter((r) => r.wonRound).length;
  const totalTargets = window.filter((r) => r.foundTarget).length;
  const totalPoints = window.reduce((s, r) => s + (r.points || 0), 0);
  const totalTargetBonuses = window.filter((r) => r.foundTarget).length * 50000; // rough estimate
  const sumInverseN = window.reduce((s, r) => s + (1 / Math.max(1, r.rankOutOf || 1)), 0);
  const validLatencies = window.map((r) => r.firstHitMs).filter((v) => typeof v === 'number' && v > 0);

  // 1. Guess accuracy > 40%
  if (totalGuesses > 0 && totalHits / totalGuesses > 0.40) {
    score += 30;
    flags.push('guess-accuracy');
  }

  // 2. Win rate > 2.5x expected
  if (sumInverseN > 0 && totalWins / sumInverseN > 2.5) {
    score += 25;
    flags.push('win-rate');
  }

  // 3. First-hit latency < 3s median
  if (validLatencies.length >= 20) {
    const med = median(validLatencies);
    if (med !== null && med < 3000) {
      score += 25;
      flags.push('first-hit-latency');
    }
  }

  // 4. Target find rate > 2.5x expected
  if (sumInverseN > 0 && totalTargets / sumInverseN > 2.5) {
    score += 15;
    flags.push('target-find-rate');
  }

  // 5. Word points per guess > 2,500
  const wordPoints = totalPoints - totalTargetBonuses;
  if (totalGuesses > 0 && wordPoints / totalGuesses > 2500) {
    score += 5;
    flags.push('points-per-guess');
  }

  return { score, flags };
}

function updateSuspicionForRound(round) {
  if (!round || !round.playerStats) return;
  const now = Date.now();
  const articleTitle = round.articleTitle || round.targetWord || '?';
  const ranked = Object.entries(round.playerStats)
    .filter(([, p]) => (p.points || 0) > 0)
    .sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
  const rankMap = new Map();
  ranked.forEach(([key, pStats], idx) => {
    rankMap.set(key, { rank: idx + 1, rankOutOf: ranked.length, points: pStats.points || 0 });
  });

  for (const [key, pStats] of Object.entries(round.playerStats || {})) {
    const identityKey = getIdentityKey(pStats.user) || key;
    const existing = suspicionScores[identityKey] || { score: 0, flags: [], rollingWindow: [] };
    const rankInfo = rankMap.get(key) || { rank: 0, rankOutOf: 0, points: 0 };

    // Gather all recentRounds across matching nickname entries
    const allEntries = getAllStatsForIdentity(identityKey);
    const allRecent = [];
    for (const entry of allEntries) {
      if (entry.recentRounds) allRecent.push(...entry.recentRounds);
    }
    // Also include the current round data (it may not be in recentRounds yet)
    const firstHitAt = round.firstHitAt.get(identityKey);
    const firstHitMs = firstHitAt ? (firstHitAt - new Date(round.startTime).getTime()) : null;
    const per = {};
    for (const g of (round.allGuesses || [])) {
      const nick = String((g.user && g.user.displayName) || '').toLowerCase();
      if (nick === key.toLowerCase()) {
        if (!per[nick]) per[nick] = { guesses: 0, hits: new Set() };
        per[nick].guesses++;
        const canon = String(g.canonical || g.word || '').toLowerCase();
        const revealed = new Set(Array.from(round.revealed || new Set()));
        if (canon && revealed.has(canon)) per[nick].hits.add(canon);
      }
    }
    const myPer = per[key.toLowerCase()] || { guesses: 0, hits: new Set() };

    allRecent.push({
      at: now,
      articleTitle,
      points: pStats.points || 0,
      rankInRound: rankInfo.rank,
      rankOutOf: rankInfo.rankOutOf,
      wonRound: rankInfo.rank === 1,
      foundTarget: !!round.titleWordFinders[String(round.targetWord || '').toLowerCase()] &&
        String(round.titleWordFinders[String(round.targetWord || '').toLowerCase()].nickname || '').toLowerCase() === key.toLowerCase(),
      guesses: myPer.guesses,
      hits: myPer.hits.size,
      firstHitMs,
    });

    allRecent.sort((a, b) => (b.at || 0) - (a.at || 0));
    const window = allRecent.slice(0, 50);
    const { score, flags } = computeSuspicion(window);
    existing.score = score;
    existing.flags = flags;
    existing.flagged = score >= 75 ? 'high-risk' : score >= 50 ? 'suspicious' : null;
    existing.rollingWindow = window;
    suspicionScores[identityKey] = existing;
  }
  saveSuspicionScores();
}

// --- Backfill existing players ---
function backfillEloAndSuspicion() {
  let eloCount = 0;
  let suspicionCount = 0;
  let flaggedCount = 0;

  for (const [nick, entry] of Object.entries(playerStatsLifetime)) {
    if (!entry || !entry.user) continue;
    const identityKey = getIdentityKey(entry.user) || nick;

    if (!eloRatings[identityKey]) {
      eloRatings[identityKey] = { elo: 1200, roundsCounted: 0, history: [] };
      eloCount++;
    }

    if (!suspicionScores[identityKey]) {
      const allEntries = getAllStatsForIdentity(identityKey);
      const allRecent = [];
      for (const e of allEntries) {
        if (e.recentRounds) allRecent.push(...e.recentRounds);
      }
      allRecent.sort((a, b) => (b.at || 0) - (a.at || 0));
      const window = allRecent.slice(0, 50);
      const { score, flags } = computeSuspicion(window);
      suspicionScores[identityKey] = {
        score,
        flags,
        flagged: score >= 75 ? 'high-risk' : score >= 50 ? 'suspicious' : null,
        rollingWindow: window,
      };
      suspicionCount++;
      if (suspicionScores[identityKey].flagged) flaggedCount++;
    }
  }

  saveEloRatings();
  saveSuspicionScores();
  console.log(`[WikiSearchle] Backfilled ${eloCount} ELO entries, ${suspicionCount} suspicion entries (${flaggedCount} flagged)`);
}

function normalizeAccountIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function entryMatchesAccountIdentity(entry, identityKey) {
  if (!entry || !identityKey) return false;
  const user = entry.user || null;
  if (!user || typeof user !== 'object') return false;
  const candidates = [
    user.linkedDiscord,
    user.platformUserId,
  ];
  return candidates.some((candidate) => normalizeAccountIdentity(candidate) === identityKey);
}

async function reportRoundToWordTycoon(round) {
  if (!round || !round.playerStats) return;
  const ranked = Object.entries(round.playerStats)
    .filter(([, p]) => (p.points || 0) > 0)
    // Bots and guests play in private streamer sessions but must never earn a
    // rating. Players with no resolvable identity key are left as-is.
    .filter(([, p]) => {
      const ik = getIdentityKey(p.user);
      return ik ? gameShared.isStatsEligible(ik) : true;
    })
    .sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
  if (ranked.length < 2) return;

  const targetFinderKey = String(round.titleWordFinders?.[String(round.targetWord || '').toLowerCase()]?.nickname || '').toLowerCase();
  const participants = [];
  const revealed = new Set(Array.from(round.revealed || new Set()));
  for (const [key, pStats] of ranked) {
    const identityKey = getIdentityKey(pStats.user) || key;
    const per = { guesses: 0, hits: 0 };
    for (const g of (round.allGuesses || [])) {
      const nick = String((g.user && g.user.displayName) || '').toLowerCase();
      if (nick !== key.toLowerCase()) continue;
      per.guesses++;
      const canon = String(g.canonical || g.word || '').toLowerCase();
      if (canon && revealed.has(canon)) per.hits++;
    }
    const firstHitAt = round.firstHitAt instanceof Map ? round.firstHitAt.get(identityKey) : null;
    const firstHitMs = firstHitAt ? (firstHitAt - new Date(round.startTime).getTime()) : null;
    participants.push({
      identityKey,
      points: pStats.points || 0,
      rank: ranked.findIndex(([k]) => k === key) + 1,
      rankOutOf: ranked.length,
      guesses: per.guesses,
      hits: per.hits,
      firstHitMs,
      wonRound: ranked[0][0] === key,
      foundTarget: !!targetFinderKey && String(pStats.nickname || key).toLowerCase() === targetFinderKey,
      articleTitle: round.articleTitle || round.targetWord || '?',
    });
  }

  try {
    const res = await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_SECRET },
      body: JSON.stringify({ game: 'wikisearchle', participants }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[WikiSearchle] ELO report failed: ${res.status} ${text}`);
    }
  } catch (e) {
    console.log(`[WikiSearchle] ELO report error: ${e.message}`);
  }
}

function getAccountLifetimeStats(identityKey) {
  const normalizedIdentity = normalizeAccountIdentity(identityKey);
  if (!normalizedIdentity) return null;

  const aggregate = {
    totalPoints: 0,
    roundsPlayed: 0,
    roundsWon: 0,
    targetFinds: 0,
    totalTitleWordsFound: 0,
    totalWordsFound: 0,
    totalGuesses: 0,
    lastSeen: 0,
    matchedPlayers: 0,
  };

  let matched = false;
  for (const entry of Object.values(playerStatsLifetime || {})) {
    if (!entryMatchesAccountIdentity(entry, normalizedIdentity)) continue;
    matched = true;
    aggregate.totalPoints += Number(entry.totalPoints || 0);
    aggregate.roundsPlayed += Number(entry.roundsPlayed || 0);
    aggregate.roundsWon += Number(entry.roundsWon || 0);
    aggregate.targetFinds += Number(entry.targetFinds || 0);
    aggregate.totalTitleWordsFound += Number(
      Object.prototype.hasOwnProperty.call(entry, 'totalTitleWordsFound')
        ? entry.totalTitleWordsFound
        : (entry.targetFinds || 0)
    );
    aggregate.totalWordsFound += Number(entry.totalWordsFound || 0);
    aggregate.totalGuesses += Number(entry.totalGuesses || 0);
    aggregate.lastSeen = Math.max(aggregate.lastSeen, Number(entry.lastSeen || 0));
    aggregate.matchedPlayers += 1;
  }

  return matched ? aggregate : null;
}

function loadState() {
  let snap;
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    snap = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle] state load failed: ${e.message}`);
    return false;
  }
  if (!snap || !snap.targetWord || !snap.leadPlaintext) return false;

  try {
    // Derive titleWordNorms from snapshot (new format) or fall back to the
    // old single-target format. Pre-multi-word snapshots had targetWord as
    // the single title word; normalize it through the redactor so it matches
    // what processGuess produces from live chat text.
    const titleWordNorms = Array.isArray(snap.titleWordNorms) && snap.titleWordNorms.length
      ? snap.titleWordNorms.slice()
      : [normalize(stripDisambiguator(snap.targetWord || ''))].filter(Boolean);
    // Snapshots from before the hidden-hard-word feature have no
    // skippedTitleNorms — default to [] so resumed rounds keep their
    // original behavior (all title words findable, nothing skipped).
    const skippedTitleNorms = Array.isArray(snap.skippedTitleNorms) ? snap.skippedTitleNorms.slice() : [];
    const cleanTitle = stripDisambiguator(snap.articleTitle || snap.targetWord || '');
    const base = buildRound({
      targetWord: cleanTitle || snap.targetWord,
      articleTitle: cleanTitle || snap.articleTitle,
      leadPlaintext: snap.leadPlaintext,
      targetNorms: titleWordNorms,
      skippedTitleNorms,
    });
    currentRound = Object.assign(base, {
      startTime: snap.startTime,
      rewardRoundId: snap.rewardRoundId || null,
      rewardEventId: snap.rewardEventId || null,
      completionPending: snap.completionPending || null,
      totalRankedWords: snap.totalRankedWords || 0,
      leadPlaintext: snap.leadPlaintext,
      rankCache: new Map(snap.rankCache || []),
      canonicalCache: new Map(snap.canonicalCache || []),
      allGuesses: snap.allGuesses || [],
      tickerBuffer: snap.tickerBuffer || [],
      topGuesses: snap.topGuesses || [],
      playerStats: snap.playerStats || {},
      firstHitAt: new Map(snap.firstHitAt || []),
      lastAnnounce: snap.lastAnnounce || null,
      won: !!snap.won,
      titleRevealed: !!snap.titleRevealed,
      rankTarget: snap.rankTarget || snap.targetWord,
      rankTargetTitleNorm: snap.rankTargetTitleNorm || snap.rankTarget || snap.targetWord,
      excludedRankTargets: new Set(snap.excludedRankTargets || []),
      titleWordNorms,
      skippedTitleNorms,
      titleCanonicals: snap.titleCanonicals || {},
      titleWordsFound: snap.titleWordsFound || 0,
      titleWordFinders: snap.titleWordFinders || {},
    });
    restoreAnonymousGuestState(snap.anonymousGuestNames, snap.nextAnonymousGuestNumber, currentRound.playerStats);
    // Replay reveals so article tokens + revealed set match what was saved.
    // Body title-word slots stay redacted by design (deferred reveal until
    // round end), so isHiddenTarget tokens are skipped here too — and
    // already-found title norms are mirrored into foundTitleNorms /
    // foundSlotIds so the green-confirm paint survives a restart.
    for (const w of snap.revealedWords || []) {
      if (currentRound.revealed.has(w)) continue;
      currentRound.revealed.add(w);
      if (currentRound.targetNormSet && currentRound.targetNormSet.has(w)) {
        if (currentRound.foundTitleNorms) currentRound.foundTitleNorms.add(w);
        const sid = currentRound.targetSlotIds && currentRound.targetSlotIds.get(w);
        if (sid && currentRound.foundSlotIds) currentRound.foundSlotIds.add(sid);
      }
      const tokens = currentRound.wordIndex.get(w);
      if (tokens) for (const t of tokens) {
        if (t.isHiddenTarget) continue;
        if (!t.revealed) { t.revealed = true; currentRound.revealedCount++; }
      }
    }
    currentRound.guessCount = snap.guessCount || currentRound.guessCount;
    if (multiplayerRewards.recover(currentRound)) revealAll(currentRound);
    console.log(`[WikiSearchle] Restored round — target="${snap.targetWord}" article="${snap.articleTitle}" players=${Object.keys(currentRound.playerStats).length} guesses=${currentRound.allGuesses.length}`);
    return true;
  } catch (e) {
    console.log(`[WikiSearchle] state restore failed (will start fresh): ${e.message}`);
    currentRound = null;
    return false;
  }
}

function broadcastState() {
  io.to('ws').emit('wikisearchle-state', wikisearchleStateSnapshot());
  io.to('ws').emit('wikiword-state', currentRound ? serializeRound(currentRound) : null);
}

function wikisearchleStateSnapshot() {
  if (!currentRound) return null;
  // SECURITY: mask targetWord while the round is still active. The frontend
  // only uses this field as a "round-in-progress" sentinel (truthy check),
  // not as visible content — see public/index.html `if (!s.targetWord)`
  // checks. Real target reveal happens via the dedicated
  // `wikisearchle-round-end` socket event after currentRound.won flips true.
  const roundOver = !!currentRound.won;
  return {
    targetWord: roundOver ? currentRound.targetWord : '(active)',
    startTime: currentRound.startTime,
    ...(roundOver ? multiplayerRewards.view(currentRound) : {}),
    topGuesses: currentRound.topGuesses,
    recentGuesses: currentRound.tickerBuffer.slice(-TICKER_CAP),
    guessCount: currentRound.guessCount,
    scoreboard: scoreboardTop3(),
    lastAnnounce: currentRound.lastAnnounce || null,
    totalRankedWords: currentRound.totalRankedWords || 0,
    titleWordNorms: roundOver ? (currentRound.titleWordNorms || []) : [],
    titleWordFinders: currentRound.titleWordFinders || {},
    rankTarget: roundOver ? (currentRound.rankTarget || null) : null,
  };
}

function scoreboardTop3(round = currentRound) {
  if (!round || !round.playerStats) return [];
  return Object.values(round.playerStats)
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);
}

async function rankBatch(target, words) {
  return searchleClient.rankBatch(target, words, {
    searchleUrl: SEARCHLE_URL,
    apiSecret: API_SECRET,
  });
}

// Score a revealed article word using Chat Relay's 3-layer word-bank API:
// word-rarity base (Zipf tier) + letter-rarity bonus + word-length bonus.
// Cached per round so repeat reveals of the same norm don't re-hit the API.
async function scoreWord(word, round = currentRound) {
  if (!round) return { total: POINTS_PER_FIND_FALLBACK };
  if (!round.wordScoreCache) round.wordScoreCache = new Map();
  if (round.wordScoreCache.has(word)) return round.wordScoreCache.get(word);

  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/validate/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const zipf = typeof data.zipf === 'number' ? data.zipf : null;
    let base;
    if (zipf === null) base = WORD_RARITY_BASE.unknown;
    else if (zipf >= 4) base = WORD_RARITY_BASE.common;
    else if (zipf >= 3) base = WORD_RARITY_BASE.uncommon;
    else if (zipf >= 2) base = WORD_RARITY_BASE.rare;
    else base = WORD_RARITY_BASE.ultra;

    const letterBonus = (Number(data.letterRarityScore) || 0) * LETTER_BONUS_MULTIPLIER;
    const lengthBonus = Number(data.wordLengthBonus) || 0;
    const total = base + letterBonus + lengthBonus;
    const result = { total, base, letterBonus, lengthBonus, zipf };
    round.wordScoreCache.set(word, result);
    return result;
  } catch (e) {
    console.log(`[WikiSearchle] word-bank score lookup failed for "${word}": ${e.message}`);
    // Don't cache fallback — let the next reveal retry.
    return { total: POINTS_PER_FIND_FALLBACK, base: POINTS_PER_FIND_FALLBACK, letterBonus: 0, lengthBonus: 0, zipf: null, fallback: true };
  }
}

// Fetch + validate + build the next round WITHOUT assigning to currentRound
// or broadcasting. Returns the built round object, or null if all attempts
// failed. Callers either commit immediately (startRound) or stash it as a
// preload (endRound → commit at the 25s mark).
async function buildNextRound() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const pickKey = drawNextTitle();
    if (!pickKey) continue;
    const entry = coverage.pages[pickKey];
    if (!entry || entry.status !== 'exists') continue;

    // titleWordNorms comes from the filtered coverage (scripts/filter-coverage.js).
    // The coverage's normalizer is ASCII-only but the redactor's is Unicode-aware,
    // so we re-normalize through the redactor to guarantee the norms match the
    // ones processGuess will produce from live chat text.
    const sourceWords = Array.isArray(entry.titleWords) && entry.titleWords.length
      ? entry.titleWords
      : String(entry.title || pickKey).split(/\s+/);
    const allTitleWordNorms = sourceWords
      .map((w) => normalize(String(w)))
      .filter((n) => n && !STOPLIST.has(n));
    if (!allTitleWordNorms.length) continue;

    // Split title words into findable (T1/T2 — drives Searchle) vs skipped
    // (T3/T4 — hidden from gameplay until round-end reveal). Articles with
    // zero findable words are rejected here — they'd have nothing to anchor
    // the rank-target rotation against. See ContextKeep memory
    // `wikisearchle_hidden_hard_title_words` for the design.
    const _classify = _easyFilterModule().classifyTitleWords({
      title: entry.title || pickKey,
      titleWordNorms: allTitleWordNorms,
    });
    const titleWordNorms = _classify.findable;
    const skippedTitleNorms = _classify.skipped;
    if (!titleWordNorms.length) {
      console.log(`[WikiSearchle] skip "${pickKey}": no findable title words (all ${allTitleWordNorms.length} are T3/T4)`);
      continue;
    }

    try {
      const { title, plaintext } = await fetchLeadSection(entry.title);
      if (!plaintext || plaintext.length < 200) { console.log(`[WikiSearchle] skip "${pickKey}": article too short`); continue; }

      // Every FINDABLE title word must appear in the body (so the player has
      // a way to reveal it). Skipped words may or may not appear — they're
      // gameplay-invisible and revealed only at round-end.
      const lowerText = plaintext.toLowerCase();
      const missing = titleWordNorms.filter((n) => !new RegExp(`\\b${n}\\b`, 'i').test(lowerText));
      if (missing.length > 0) {
        console.log(`[WikiSearchle] skip "${pickKey}": findable title words not in body: ${missing.join(',')}`);
        continue;
      }

      // Build the round FIRST so we can derive the player-visible title
      // shuffle order, then pick rankTarget by walking that shuffled order.
      // Otherwise the game would rank against the natural-article-order
      // first title word while the visually-first slot belongs to a
      // different word — confusing players who infer the active target
      // from the leftmost redacted slot at the top.
      const cleanTitle = stripDisambiguator(title);

      // Try to swap in a pre-generated LLM article (cached on disk by the
      // offline batch). Falls back to the raw Wikipedia lead if either:
      //   - no cached article exists yet, OR
      //   - the cached article fails the same title-word presence check
      //     we apply to the raw lead (defensive — the batch validator
      //     enforced this, but a manually-edited file might not).
      let articleText = plaintext;
      let articleSource = 'wikipedia';
      try {
        const slug = articleGenerator.slugify(cleanTitle);
        const cached = articleGenerator.getCachedArticle(slug);
        if (cached) {
          const cachedLower = cached.toLowerCase();
          const cachedMissing = titleWordNorms.filter(
            (n) => !new RegExp(`\\b${n}\\b`, 'i').test(cachedLower)
          );
          if (cachedMissing.length === 0) {
            articleText = cached;
            articleSource = 'llm';
          } else {
            console.log(`[WikiSearchle] cached LLM article for "${cleanTitle}" missing norms ${cachedMissing.join(',')} — using Wikipedia lead`);
          }
        }
      } catch (e) {
        console.log(`[WikiSearchle] cached-article lookup error for "${cleanTitle}": ${e.message}`);
      }

      const base = buildRound({
        targetWord: cleanTitle,
        articleTitle: cleanTitle,
        leadPlaintext: articleText,
        targetNorms: titleWordNorms,
        skippedTitleNorms,
      });
      base._articleSource = articleSource;  // surfaced in console logs only
      const displayOrderNorms = getTitleDisplayOrderNorms(base);
      const baseOrderNorms = displayOrderNorms.length ? displayOrderNorms : titleWordNorms;
      // Proper nouns deferred to last so players build context before the
      // name reveal. Source casing comes from entry.titleWords.
      const titleWordsRaw = Array.isArray(entry.titleWords) && entry.titleWords.length
        ? entry.titleWords
        : String(entry.title || pickKey).split(/\s+/);
      const pickOrder = deferProperNounsToEnd(baseOrderNorms, titleWordsRaw);

      // Try title words as rankTarget in DISPLAY order. First one Searchle
      // can rank wins. Skip the article entirely if none work — the game
      // needs live ranking for the card cycle to function.
      let rankTarget = null;
      let preload = null;
      const excluded = [];
      for (const norm of pickOrder) {
        try {
          preload = await rankBatch(norm, []);
          rankTarget = norm;
          break;
        } catch (e) {
          console.log(`[WikiSearchle] "${pickKey}" title word "${norm}" not rankable: ${e.message}`);
          excluded.push(norm);
        }
      }
      if (!rankTarget) {
        console.log(`[WikiSearchle] skip "${pickKey}": no title word is rankable by Searchle`);
        continue;
      }

      // Canonical (singular/American) form for each title word. Built by asking
      // Searchle to rank the plural forms as guess words — the /api/rank
      // response returns each word's canonical in the `canonicals` map.
      const titleCanonicals = {};
      try {
        const probe = await rankBatch(rankTarget, titleWordNorms);
        const canons = (probe && probe.canonicals) || {};
        for (const tn of titleWordNorms) titleCanonicals[tn] = canons[tn] || tn;
      } catch (e) {
        for (const tn of titleWordNorms) titleCanonicals[tn] = tn;
      }

      // Prefer the canonical form AS the rankTarget so similarity is computed
      // singular-vs-singular (matches how Searchle's own ranking works). If
      // the canonical itself isn't rankable for some reason, fall back to the
      // raw plural we already validated. rankTargetTitleNorm tracks the raw
      // plural this rankTarget corresponds to (used for title-progression).
      const rankTargetTitleNorm = rankTarget;
      const canonicalTarget = titleCanonicals[rankTarget] || rankTarget;
      if (canonicalTarget !== rankTarget) {
        try {
          preload = await rankBatch(canonicalTarget, []);
          rankTarget = canonicalTarget;
        } catch (e) {
          // canonical not rankable — keep raw plural as rankTarget
        }
      }
      return Object.assign(base, {
        startTime: new Date().toISOString(),
        titleWordNorms,           // FINDABLE title norms only (T1/T2) — drive Searchle rank-target rotation
        titleWordsRaw,            // original-casing words; used by deferProperNounsToEnd at rotation time
        skippedTitleNorms,        // T3/T4 norms — gameplay-hidden, revealed only at round-end
        titleCanonicals,
        titleWordsFound: 0,
        totalRankedWords: preload.totalRankedWords || 0,
        leadPlaintext: plaintext,
        rankCache: new Map(),
        canonicalCache: new Map(),
        allGuesses: [],
        tickerBuffer: [],
        topGuesses: [],
        playerStats: {},
        firstHitAt: new Map(),
        lastAnnounce: null,
        titleRevealed: false,
        rankTarget,
        rankTargetTitleNorm,
        excludedRankTargets: new Set(excluded),
        seenPlayers: new Set(),
        wordScoreCache: new Map(),
        // Words that have been guessed but are NOT in the article. Lets the
        // ticker distinguish a fresh miss (red chip) from a duplicate miss
        // (yellow chip with red x) the same way revealed words distinguish
        // fresh hits from duplicate hits.
        guessedMisses: new Set(),
      });
    } catch (e) {
      console.log(`[WikiSearchle] target "${pickKey}" failed: ${e.message}`);
    }
  }

  return null;
}

// Pre-built round buffer. buildNextRound makes Wikipedia + Searchle calls
// that can take a few seconds — by keeping a small queue of ready-to-go
// rounds, endRound can swap in the next round instantly instead of making
// players (and the game state) wait. Background filler keeps it topped up.
const ROUND_BUFFER_SIZE = parseInt(process.env.ROUND_BUFFER_SIZE || '3', 10);
const roundBuffer = [];
let bufferFillInFlight = false;
async function fillRoundBuffer() {
  if (bufferFillInFlight) return;
  bufferFillInFlight = true;
  try {
    while (roundBuffer.length < ROUND_BUFFER_SIZE) {
      const next = await buildNextRound();
      if (!next) break; // buildNextRound already retried 8 picks; bail to avoid tight loop
      roundBuffer.push(next);
      console.log(`[WikiSearchle] round buffer: ${roundBuffer.length}/${ROUND_BUFFER_SIZE} ready (added "${next.articleTitle}")`);
    }
  } catch (e) {
    console.log(`[WikiSearchle] round buffer fill error: ${e.message}`);
  } finally {
    bufferFillInFlight = false;
  }
}
function takePreBuiltRound() {
  const next = roundBuffer.shift() || null;
  // Always kick off a refill (fire-and-forget) so the buffer stays warm.
  fillRoundBuffer().catch(() => {});
  return next;
}

// Swap a freshly-built round into currentRound and broadcast round-start.
function commitRound(next) {
  // Refresh startTime — pre-built rounds may have been sitting in the
  // buffer for a while; the round officially starts NOW.
  next.startTime = new Date().toISOString();
  next.rewardRoundId = require('crypto').randomUUID();
  currentRound = next;
  scheduleSave();
  console.log(`[WikiSearchle] Round opened — target="${next.targetWord}" article="${next.articleTitle}" source=${next._articleSource || 'wikipedia'} totalRankedWords=${next.totalRankedWords || '?'}`);
  io.to('ws').emit('wikisearchle-round-start', { targetWord: '(active)', articleTitle: null, startTime: next.startTime });
  broadcastState();
  // Keep the buffer warm while this round is being played.
  fillRoundBuffer().catch(() => {});
}

async function startRound() {
  if (currentRound && !currentRound.won) return;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  const next = await buildNextRound();
  if (next) {
    commitRound(next);
    return;
  }
  console.log('[WikiSearchle] 8 random picks all failed; retrying in 30s');
  restartTimer = setTimeout(startRound, 30000);
}

// Advance rankTarget to the next unrevealed title word (reading order) that
// Searchle can rank. Returns the norm, or null if no title words remain /
// none are rankable. Skips over title words already cached in
// excludedRankTargets (those Searchle couldn't handle previously).
async function advanceRankTargetToNextTitleWord(round = currentRound) {
  if (!round || !Array.isArray(round.titleWordNorms)) return null;
  if (!round.excludedRankTargets) round.excludedRankTargets = new Set();
  const canons = round.titleCanonicals || {};
  // Iterate in player-visible (shuffled) display order so rankTarget always
  // tracks the next visibly-leftmost unrevealed title slot, not the next
  // natural-reading-order slot (which the player can't see).
  const displayOrder = getTitleDisplayOrderNorms(round);
  const baseOrder = displayOrder.length ? displayOrder : round.titleWordNorms;
  const order = deferProperNounsToEnd(baseOrder, _titleWordsRawForRound(round));
  for (const norm of order) {
    if (round.revealed.has(norm)) continue;
    if (round.excludedRankTargets.has(norm)) continue;
    // Prefer the canonical (singular) form as the Searchle target so
    // rankings are computed singular-vs-singular; fall back to the raw
    // plural if canonical isn't rankable.
    const candidates = [];
    const canonical = canons[norm];
    if (canonical && canonical !== norm) candidates.push(canonical);
    candidates.push(norm);
    let set = false;
    for (const cand of candidates) {
      try {
        const preload = await rankBatch(cand, []);
        if (!isActiveRound(round)) return null;
        round.rankTarget = cand;
        round.rankTargetTitleNorm = norm;
        round.totalRankedWords = preload.totalRankedWords || 0;
        set = true;
        break;
      } catch (e) {
        // try next candidate
      }
    }
    if (set) return round.rankTarget;
    console.log(`[WikiSearchle] title word "${norm}" unavailable in Searchle`);
    round.excludedRankTargets.add(norm);
  }
  return null;
}

// Pick the next unrevealed non-stop body word that Searchle can rank.
// Probes rankBatch(candidate, []) to validate; caches misses in
// currentRound.excludedRankTargets so we don't re-probe them. Updates
// totalRankedWords on success. Returns the norm, or null if none usable.
async function advanceRankTarget() {
  if (!currentRound) return null;
  if (!currentRound.excludedRankTargets) currentRound.excludedRankTargets = new Set();
  while (true) {
    const candidates = unrevealedBodyNorms(currentRound, currentRound.excludedRankTargets);
    if (candidates.length === 0) return null;
    const next = candidates[0];
    try {
      const preload = await rankBatch(next, []);
      currentRound.totalRankedWords = preload.totalRankedWords || 0;
      return next;
    } catch (e) {
      console.log(`[WikiSearchle] rankTarget "${next}" unavailable in Searchle: ${e.message}`);
      currentRound.excludedRankTargets.add(next);
      continue;
    }
  }
}

function rebuildTop(round = currentRound) {
  if (!round) return;
  round.topGuesses = [...round.allGuesses]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TOP_N);
}

function endRound(targetFinder, round = currentRound) {
  if (!isActiveRound(round)) return;
  const completion = prepareRoundCompletion(round, targetFinder);
  if (!completion) return;
  targetFinder = completion.targetFinder;
  // Winner = top scorer. Usually that IS the target finder (they just
  // collected the 50k target bonus plus the target word's A+B+C score),
  // but a player who revealed several rare words earlier in the round can
  // still edge them out. playerStats are already up-to-date because the
  // finder's points were credited in handleChat before endRound was called.
  const topEntry = completion.winner;
  const winner = (topEntry && topEntry.nickname) || targetFinder || '?';
  const perPlayer = {};
  for (const g of (round.allGuesses || [])) {
    perPlayer[g.nickname] = (perPlayer[g.nickname] || 0) + 1;
  }
  console.log(`[WikiSearchle] DEBUG endRound — allGuesses=${(round.allGuesses || []).length}, perPlayer=${JSON.stringify(perPlayer)}`);
  console.log(`[WikiSearchle] Round ended — winner=${winner} (target found by ${targetFinder || '?'}) target=${round.targetWord} guesses=${round.guessCount}`);
  revealAll(round);
  round.won = true;
  multiplayerRewards.deliver(completion.reward);
  try { aggregateRoundIntoStats(round); } catch (e) { console.log(`[WikiSearchle] stats aggregation failed: ${e.message}`); }
  scheduleSave();
  const finalArticle = serializeRound(round);
  io.to('ws').emit('wikisearchle-round-end', {
    targetWord: round.targetWord,
    winner,
    targetFinder,
    finalGuessCount: round.guessCount,
  });
  io.to('ws').emit('wikiword-round-end', { ...finalArticle, winner });

  // Publish the win payload. The player page renders `game-win` itself via
  // WinCard, so the 'ws' room emit is unconditional; the chat-relay forward
  // (unified win overlay + win reward) stays gated by Chat Relay's per-game
  // toggle, exactly as before.
  if (winner) {
    const stats = topEntry || {};
    const winnerUser = stats.user || { displayName: winner, platform: 'web', profilePic: null };
    // Top 5 players by points — rendered as a leaderboard on the win overlay.
    // titleWordsFound is the list of title-word norms this player revealed
    // (may be empty, one, or several for multi-word articles). Derived by
    // inverting titleWordFinders (norm → nickname) so every player entry
    // carries its own list of credited target words.
    const finderByNick = {};
    for (const [norm, f] of Object.entries(round.titleWordFinders || {})) {
      const key = String(f.nickname || '').toLowerCase();
      if (!key) continue;
      (finderByNick[key] = finderByNick[key] || []).push(norm);
    }
    const topPlayers = Object.values(round.playerStats || {})
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .slice(0, 10)
      .map((p) => {
        const nickKey = String(p.nickname || '').toLowerCase();
        const u = p.user || {};
        return {
          displayName: p.nickname,
          profilePic: u.profilePic || null,
          platform: u.platform || 'unknown',
          platformUserId: u.platformUserId || u.id || null,
          linkedDiscord: u.linkedDiscord || null,
          isFanClub: !!u.isFanClub,
          isSuperfan: !!u.isSuperfan,
          isDonor: !!u.isDonor,
          points: p.points || 0,
          titleWordsFound: finderByNick[nickKey] || [],
        };
      });
    const gameWinPayload = {
      game: 'wikisearchle',
      gameName: 'WikiSearchle',
      word: String(round.targetWord || '').toUpperCase(),
      winner: {
        displayName: winnerUser.displayName || winner,
        profilePic: winnerUser.profilePic || null,
        platform: winnerUser.platform || 'web',
        platformUserId: winnerUser.platformUserId || winnerUser.id || null,
        linkedDiscord: winnerUser.linkedDiscord || null,
        cosmetics: winnerUser.cosmetics || null,
        isFanClub: !!winnerUser.isFanClub,
        isSuperfan: !!winnerUser.isSuperfan,
        isDonor: !!winnerUser.isDonor,
      },
      jackpot: 0,
      guessCount: round.guessCount,
      isDaily: false,
      topPlayers,
    };
    io.to('ws').emit('game-win', gameWinPayload);

    if (chatRelay && chatRelay.connected) {
      chatRelay.emit('game-win', gameWinPayload);


    }
  }

  // Keep the finished article on screen for ~30 seconds. The next round is
  // pulled from the pre-built buffer (instant) — only fall back to inline
  // buildNextRound if the buffer happens to be empty (cold start, fill
  // lagged behind two rapid round endings, etc.). Either way, the 30s
  // timer fires, finalizeRestart commits the new round.
  const COMMIT_AT_MS = 30000;
  const commitAt = Date.now() + COMMIT_AT_MS;
  let pendingRound = takePreBuiltRound();
  let pendingReady = !!pendingRound;
  let timerFired = false;

  if (!pendingRound) {
    console.log('[WikiSearchle] buffer empty on round end — falling back to inline buildNextRound');
    buildNextRound().then((r) => {
      pendingRound = r;
      pendingReady = true;
      if (timerFired) finalizeRestart();
    }).catch((e) => {
      console.log(`[WikiSearchle] preload error: ${e && e.message}`);
      pendingReady = true;
      if (timerFired) finalizeRestart();
    });
  }

  function finalizeRestart() {
    if (currentRound !== round) return;
    saveState();
    if (pendingRound) {
      commitRound(pendingRound);
    } else {
      // Preload failed — fall back to a full retry loop.
      startRound();
    }
  }

  restartTimer = setTimeout(() => {
    timerFired = true;
    if (pendingReady) finalizeRestart();
    // Else: preload still running. finalizeRestart fires when it resolves.
  }, COMMIT_AT_MS);
}

async function handleChat(msg, clientIP) {
  const openingRound = currentRound;
  const text = msg && (msg.message || msg.text);
  if (!openingRound || typeof text !== 'string' || text.length > 1024 || text.trim().split(/\s+/).length > 32) return;
  try {
    const input = JSON.parse(JSON.stringify(msg));
    return await roundActions.run(openingRound, async round => {
      if (finishCompletedRound(round)) return;
      try { return await processPublicChat(input, clientIP, round); }
      finally { if (!round.completionPending) finishCompletedRound(round); }
    });
  } catch { console.warn('[WikiSearchle] Round action failed'); }
}

async function processPublicChat(msg, clientIP, round) {
  if (!isActiveRound(round)) return;
  const text = msg && (msg.message || msg.text);
  if (!text || typeof text !== 'string') return;

  // Canonical identity: linkedDiscord (if present) collapses TikTok/YouTube/web
  // for the same person to one Word Tycoon identity. Matches Searchle pattern.
  const rawUserId = (msg && msg.user && (msg.user.id || msg.user.platformUserId || msg.user.username)) || null;
  const linkedDiscord = (msg && msg.linkedDiscord) || null;
  const canonicalUserId = linkedDiscord || rawUserId;
  const rawPlatform = (msg && msg.user && msg.user.platform) || (msg && msg.platform) || 'unknown';
  const canonicalPlatform = linkedDiscord ? 'web' : rawPlatform;
  const _isFanClubFromBadges = !!(msg && msg.user && Array.isArray(msg.user.badges) && msg.user.badges.indexOf('fan-club') !== -1);
  const _isSuperfanFromBadges = !!(msg && msg.user && Array.isArray(msg.user.badges) && msg.user.badges.indexOf('superfan') !== -1);
  let user = msg && msg.user ? {
    displayName: msg.user.displayName || msg.displayName || 'viewer',
    username: msg.user.username || null,
    platform: canonicalPlatform,
    platformUserId: canonicalUserId,
    linkedDiscord,
    profilePic: msg.user.profilePic || null,
    // Forward equipped cosmetics so cards/podium can render hero badges,
    // profile glow, name color, title, etc. Chat Relay enriches every chat
    // message with the user's equipped cosmetics object — without this
    // line WikiSearchle's user object construction would strip them.
    cosmetics: msg.user.cosmetics || null,
    isFanClub: _isFanClubFromBadges,
    isSuperfan: _isSuperfanFromBadges,
  } : {
    displayName: msg?.displayName || 'viewer',
    username: null,
    platform: 'unknown',
    platformUserId: null,
    linkedDiscord: null,
    profilePic: null,
    cosmetics: null,
    isFanClub: false,
  };
  user = isolateRoundUser(round, user);
  let nickname = user.displayName;

  if (isSuspended(user, clientIP)) {
    console.log(`[WikiSearchle] Suspended user blocked: ${nickname} (${user.platformUserId || 'no-id'}) ip=${clientIP || 'none'}`);
    return;
  }

  // Classify each word BEFORE processGuess mutates state.
  // Statuses: 'hit' (in article, not yet revealed — this guess will reveal it),
  //           'dup' (in article, already revealed by someone),
  //           'miss' (not in article at all).
  const words = text
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 0);
  const unique = Array.from(new Set(words));
  // Defensive init for in-flight rounds that predate the guessedMisses field.
  if (!round.guessedMisses) round.guessedMisses = new Set();
  const classifications = unique.map((w) => {
    if (round.revealed.has(w)) return { word: w, status: 'dup-hit' };
    if (round.wordIndex.has(w)) return { word: w, status: 'hit' };
    if (round.guessedMisses.has(w)) return { word: w, status: 'dup-miss' };
    return { word: w, status: 'miss' };
  });
  // Record fresh misses so the next time anyone guesses the same wrong
  // word, the ticker chip flips to dup-miss (yellow + red x).
  for (const c of classifications) {
    if (c.status === 'miss') round.guessedMisses.add(c.word);
  }

  // Track first-hit latency for cheater detection (record before processGuess mutates state).
  const identityKey = getIdentityKey(user);
  if (identityKey && !round.firstHitAt.has(identityKey)) {
    if (classifications.some((c) => c.status === 'hit')) {
      round.firstHitAt.set(identityKey, Date.now());
    }
  }

  // --- Reveal side (mutates state; emits wikiword-reveal for article body) ---
  const { newlyRevealed, isTarget } = processGuess(round, text);

  // --- Rank words via Searchle (against current rankTarget). Done BEFORE the
  // reveal broadcast so canonical matches can promote title-word finds into
  // newlyRevealed — otherwise a guess like "bodies" (canonical "body") would
  // rank #1 but fail to advance the round, because processGuess keys on the
  // raw norm and wordIndex has "body", not "bodies". The downstream chip/card
  // loop reads rankCache.get(word), so moving the ranking here is a no-op for
  // those branches. ---
  if (round.rankTarget) {
    const unranked = unique.filter((w) => !round.rankCache.has(w));
    if (unranked.length > 0) {
      const fetchTarget = round.rankTarget;
      const fetchPurgeVersion = round.purgeVersion || 0;
      try {
        const { ranks, canonicals } = await rankBatch(fetchTarget, unranked);
        if (!isActiveRound(round)) return;
        // Concurrent handler may have advanced rankTarget OR bumped the
        // purge version (title-word progression clears caches before
        // awaiting the new rankTarget). Either signal means our ranks are
        // against the wrong target — discard rather than poison the freshly
        // cleared cache with old-target rank values.
        if (round.rankTarget === fetchTarget
            && (round.purgeVersion || 0) === fetchPurgeVersion) {
          if (!round.canonicalCache) round.canonicalCache = new Map();
          for (const w of unranked) {
            const rank = ranks && ranks[w];
            if (typeof rank === 'number') {
              round.rankCache.set(w, rank);
              round.canonicalCache.set(w, (canonicals && canonicals[w]) || w);
            }
          }
        }
      } catch (e) {
        if (!isActiveRound(round)) return;
        console.log(`[WikiSearchle] rank fetch failed: ${e.message}`);
      }
    }

    // Canonical-match title reveal: if any guess canonicalizes to the current
    // rankTarget and that title norm isn't yet revealed, reveal it now so the
    // existing title-word progression code at line ~933 detects it. Also
    // promote the guess's chip status from 'miss' to 'hit' so the UI reflects
    // that the morphological variant counted as finding the title word.
    const titleNorm = round.rankTargetTitleNorm;
    if (titleNorm && !round.revealed.has(titleNorm)) {
      for (const w of unique) {
        const canonical = round.canonicalCache && round.canonicalCache.get(w);
        if (canonical && canonical === round.rankTarget) {
          round.revealed.add(titleNorm);
          newlyRevealed.push(titleNorm);
          if (round.targetNormSet && round.targetNormSet.has(titleNorm)) {
            if (round.foundTitleNorms) round.foundTitleNorms.add(titleNorm);
            const sid = round.targetSlotIds && round.targetSlotIds.get(titleNorm);
            if (sid && round.foundSlotIds) round.foundSlotIds.add(sid);
          }
          const tokens = round.wordIndex.get(titleNorm) || [];
          for (const t of tokens) {
            // Body title-word slots stay redacted until round end —
            // matches processGuess's deferred-reveal behavior.
            if (t.isHiddenTarget) continue;
            if (!t.revealed) { t.revealed = true; round.revealedCount++; }
          }
          const cls = classifications.find((c) => c.word === w);
          if (cls) cls.status = 'hit';
          break;
        }
      }
    }
  }

  if (newlyRevealed.length > 0) {
    // Push the freshly-revealed article first so the client's DOM has up-to-date
    // spans (with data-norm on the newly-revealed tokens) before the glow event
    // fires. Socket.IO guarantees in-order delivery on a single socket.
    io.to('ws').emit('wikiword-state', serializeRound(round));
    io.to('ws').emit('wikiword-reveal', {
      words: newlyRevealed,
      by: nickname,
      guessCount: round.guessCount,
      revealedCount: round.revealedCount,
    });
  }

  // --- Scoring: per-word A+B+C (rarity + letter bonus + length) from the
  // Chat Relay word-bank. Numbers use a separate digit-count tier. Title
  // words (all of them for multi-word articles) get a positional bonus on
  // top — 50k/40k/30k/20k by find-order, so the first title word found in
  // the round is worth most. Single-word articles end the round on the
  // first (and only) title word, keeping the 50k feel.
  let earned = 0;
  const titleWordsRevealedThisGuess = [];
  const titleSet = new Set(round.titleWordNorms || []);
  for (const norm of newlyRevealed) {
    const tokens = round.wordIndex.get(norm) || [];
    const tok = tokens[0];
    if (tok && tok.isNumber) {
      earned += scoreNumber(tok.digitCount || tok.text.length);
    } else {
      const s = await scoreWord(norm, round);
      if (!isActiveRound(round)) return;
      earned += s.total;
    }
    if (titleSet.has(norm)) {
      const bonus = titleWordBonus(round.titleWordsFound || 0);
      earned += bonus;
      round.titleWordsFound = (round.titleWordsFound || 0) + 1;
      titleWordsRevealedThisGuess.push(norm);
      // Remember who found this title word so the client can show their PFP
      // next to the revealed word. Stored in the round snapshot so it
      // survives reconnects and PM2 restarts.
      if (!round.titleWordFinders) round.titleWordFinders = {};
      round.titleWordFinders[norm] = {
        nickname,
        profilePic: user.profilePic || null,
        platform: user.platform || 'unknown',
        isFanClub: !!user.isFanClub,
        isSuperfan: !!user.isSuperfan,
        isDonor: !!user.isDonor,
        at: Date.now(),
      };
    }
  }
  if (earned > 0) {
    // Recheck ownership after asynchronous scoring before crediting points.
    user = isolateRoundUser(round, user);
    nickname = user.displayName;
    for (const norm of titleWordsRevealedThisGuess) {
      round.titleWordFinders[norm].nickname = nickname;
    }
    const key = nickname.toLowerCase();
    if (!round.playerStats[key]) {
      round.playerStats[key] = { nickname, points: 0, user };
    }
    round.playerStats[key].points += earned;
    round.playerStats[key].user = user; // keep latest avatar/platform
    io.to('ws').emit('wikisearchle-scoreboard', scoreboardTop3(round));
  }

  // (rankBatch moved up — before the reveal broadcast — so canonical title
  // matches can promote into newlyRevealed. rankCache/canonicalCache are
  // already populated by the time we reach the chip loop below.)

  // --- Build ticker chips + announce banner + cards update ---
  // Snapshot the previous best rank so we can fire a Sassie `guess_best_so_far`
  // event when this message lowers the #1 rank on the cards.
  const prevTopRank = round.topGuesses[0]?.rank;
  let topChanged = false;
  let firstHit = null;
  // Batch guesses are paced ~500ms apart so chips/cards animate in one at a
  // time instead of flooding when a viewer types "apple banana orange".
  // Snapshot the round reference; if endRound fires mid-loop (e.g. word 2 is
  // the target) or the round otherwise rolls over, break so stale chips
  // don't bleed into the next round.
  const loopRound = round;
  // Snapshot rankTarget AND a purge counter. The purge counter is bumped
  // synchronously in the title-word-progression block BEFORE its async
  // advanceRankTargetToNextTitleWord call (which awaits a rankBatch and
  // doesn't actually mutate round.rankTarget until AFTER its await).
  // Without the purge check, a concurrent chip-loop iteration during that
  // window would see rankTarget unchanged, push its old-target-ranked
  // guess into the just-cleared allGuesses, and trigger a rebuildTop that
  // re-emits the just-found title word at #1.
  const loopRankTarget = round.rankTarget;
  const loopPurgeVersion = round.purgeVersion || 0;
  for (let i = 0; i < classifications.length; i++) {
    if (i > 0) await sleep(BATCH_GUESS_INTERVAL_MS);
    if (!isActiveRound(round) || round !== loopRound) return;
    const rankTargetStale = round.rankTarget !== loopRankTarget
                         || (round.purgeVersion || 0) !== loopPurgeVersion;
    const c = classifications[i];
    const rank = round.rankCache.get(c.word);
    const canonical = (round.canonicalCache && round.canonicalCache.get(c.word)) || c.word;
    // If another guesser already put this canonical form on the cards, the
    // first one stays — mark as dup so the chip reflects it and skip the card.
    const isCanonicalDup = typeof rank === 'number'
      && round.allGuesses.some((g) => (g.canonical || g.word) === canonical);
    // Decide chip status. Most cases use c.status from earlier classification
    // (hit / dup-hit / dup-miss / miss). The exception is when the RAW form
    // is fresh ('miss') but its CANONICAL was already used — then we still
    // want a duplicate chip, but the dup flavour depends on whether the
    // canonical was a hit (revealed) or a miss (in guessedMisses).
    let chipStatus = c.status;
    if (isCanonicalDup && c.status === 'miss') {
      chipStatus = round.revealed.has(canonical) ? 'dup-hit' : 'dup-miss';
    }
    const chip = {
      word: c.word,
      status: chipStatus,     // 'hit' | 'dup-hit' | 'dup-miss' | 'miss'
      by: nickname,
      platform: user.platform,
      profilePic: user.profilePic || null,
      rank: typeof rank === 'number' ? rank : null,
      timestamp: Date.now(),
    };
    io.to('ws').emit('wikisearchle-chip', chip);

    // Library credit: a 'hit' means this player was the first to reveal this
    // word in the article — mirrors Searchle's onNewGuess library credit.
    // Requires platformUserId; anonymous web guests get no library entry.
    if (chipStatus === 'hit' && user.platformUserId) {
      gameShared.reportLibraryWord(
        user.platform, user.platformUserId, c.word,
        'wikisearchle',
        user.username || user.displayName, user.displayName,
        null,
      );
    }

    // Cards accept every ranked word (hits, dups, and misses) — ranking is
    // independent of whether the word appears in the article body. Dedupe by
    // canonical form so "cat" and "cats" (or "colour" and "color") don't both
    // get their own card — first guesser stays on the board.
    let thisWordTopChanged = false;
    if (typeof rank === 'number' && !isCanonicalDup && !rankTargetStale) {
      // Display the canonical (lemmatized) form on the cards so plurals,
      // gerunds, and other inflected forms collapse to base — "cats" shows
      // as "cat", matching Searchle's top-card behavior. Chips and announce
      // banner keep the typed form so chat reflects what was actually said.
      const displayWord = canonical || c.word;
      const guess = { word: displayWord, rank, canonical, user, timestamp: Date.now() };
      round.allGuesses.push(guess);
      round.tickerBuffer.push(guess);
      if (round.tickerBuffer.length > TICKER_CAP * 2) round.tickerBuffer = round.tickerBuffer.slice(-TICKER_CAP);
      io.to('ws').emit('wikisearchle-new-guess', guess);
      if (round.topGuesses.length < TOP_N || rank < round.topGuesses[round.topGuesses.length - 1].rank) {
        thisWordTopChanged = true;
        topChanged = true;
      }
    }
    // Rebuild + broadcast top-6 per word so card animations stay aligned
    // with the paced chips instead of all reshuffling at the end.
    if (thisWordTopChanged) {
      rebuildTop(round);
      io.to('ws').emit('wikisearchle-top', round.topGuesses);
    }

    // Announce banner fires in sync with the first hit's chip — not after
    // the whole loop — so the banner lands when the viewer sees the hit.
    if (c.status === 'hit' && !firstHit) {
      firstHit = c;
      const announceRank = round.rankCache.get(firstHit.word);
      const playerKey = nickname.toLowerCase();
      const totalPoints = round.playerStats[playerKey]?.points || 0;
      const announce = {
        nickname,
        user,
        word: firstHit.word,
        earned,
        totalPoints,
        rank: typeof announceRank === 'number' ? announceRank : null,
        rarity: rankTier(announceRank),
        timestamp: Date.now(),
      };
      round.lastAnnounce = announce;
      io.to('ws').emit('wikisearchle-announce', announce);
    }
  }

  // --- Title-word progression ---
  // If this guess revealed one or more title words: cards reset (they were
  // ranked against the previous rankTarget), rankTarget advances to the
  // next unrevealed title word, and the round ends if all title words are
  // now revealed.
  if (titleWordsRevealedThisGuess.length > 0) {
    const allTitleFound = (round.titleWordNorms || []).every((n) => round.revealed.has(n));
    if (allTitleFound) {
      round.titleRevealed = true;
      io.to('ws').emit('wikisearchle-title-revealed', {
        articleTitle: round.articleTitle,
        titleWordsRevealed: titleWordsRevealedThisGuess,
      });
      endRound(nickname, round);
    } else {
      // rankTarget only needs to change if the word the player just found
      // WAS the current rankTarget. Out-of-order finds (e.g. guessing word 2
      // while rankTarget was word 1) leave rankTarget pointed at the first
      // unrevealed title word in reading order — no card reset needed.
      // The raw (plural) title norm the current rankTarget corresponds to.
      // titleWordsRevealedThisGuess contains raw title norms, so compare
      // against the title-norm alias — not the canonical Searchle target.
      const prevRankTargetTitleNorm = round.rankTargetTitleNorm || round.rankTarget;
      const rankTargetFound = titleWordsRevealedThisGuess.includes(prevRankTargetTitleNorm);
      let nextTitleWord = prevRankTargetTitleNorm;
      if (rankTargetFound) {
        // Clear cards — rankings were against the old target and are now stale.
        round.topGuesses = [];
        round.allGuesses = [];
        round.rankCache = new Map();
        round.canonicalCache = new Map();
        round.tickerBuffer = [];
        // Bump the purge version BEFORE awaiting advanceRankTargetToNextTitleWord
        // (which awaits a rankBatch internally — and during THAT await,
        // round.rankTarget is still the old value because advance only
        // sets it AFTER its await resolves). Without this version bump, a
        // concurrent chip-loop iteration would see rankTarget unchanged,
        // think its cached rank against the OLD target was still valid,
        // and push the just-found title word back into allGuesses → it
        // re-enters topGuesses → bean stays at #1 even after the find.
        round.purgeVersion = (round.purgeVersion || 0) + 1;
        nextTitleWord = await advanceRankTargetToNextTitleWord(round);
        if (!isActiveRound(round)) return;
        // Defensive re-clear — also wipe rankCache / canonicalCache: a
        // concurrent rankBatch racing this advance can pass both the
        // rankTarget and purgeVersion checks (target unchanged until the
        // inner rankBatch resolves) and write OLD-target ranks back into
        // the freshly-cleared cache. Without this, the just-found title
        // word's rank-1 entry stays poisoned in rankCache and re-enters
        // topGuesses on the next guess (stuck #1, lower 4 still update).
        round.topGuesses = [];
        round.allGuesses = [];
        round.tickerBuffer = [];
        round.rankCache = new Map();
        round.canonicalCache = new Map();
      }
      io.to('ws').emit('wikisearchle-title-word-found', {
        articleTitle: null,
        wordsRevealed: titleWordsRevealedThisGuess,
        titleWordsFound: round.titleWordsFound,
        titleWordsTotal: (round.titleWordNorms || []).length,
        rankTarget: null,
        rankTargetChanged: rankTargetFound,
        totalRankedWords: round.totalRankedWords || 0,
        by: nickname,
        user: { displayName: nickname, profilePic: user.profilePic || null, platform: user.platform || 'unknown' },
        finders: round.titleWordFinders || {},
      });
      if (rankTargetFound) {
        // Use [] literal so this broadcast is provably empty — even if
        // some race let topGuesses get repopulated after our re-clear
        // above, the wire payload here can't carry stale entries.
        io.to('ws').emit('wikisearchle-top', []);
      }
      broadcastState();
      if (rankTargetFound && !nextTitleWord) {
        // No remaining title word is rankable by Searchle — shouldn't happen
        // since buildNextRound validated at least one, but guard anyway.
        console.log('[WikiSearchle] no next title word rankable after find — ending round');
        endRound(nickname, round);
      }
    }
  }

  // --- Forward Sassie game events (fire-and-forget, gated per-event in the monitor) ---
  // Chat Relay's generic `game-event` handler translates { game, eventName,
  // data, priority } into sassie.forwardGameEvent(). Toggles in the Sassy
  // monitor dashboard control which events actually reach the chatbot.
  if (chatRelay && chatRelay.connected) {
    const sassieUser = {
      displayName: nickname,
      platform: user.platform,
      profilePic: user.profilePic,
      platformUserId: user.platformUserId || user.id || null,
    };
    const emitGameEvent = (eventName, extra, priority) => {
      chatRelay.emit('game-event', {
        game: 'wikisearchle',
        eventName,
        data: { user: sassieUser, guessCount: round.guessCount, ...extra },
        priority: priority || 'normal',
      });
    };

    // First-time player (one-shot per round per nickname). Rounds restored
    // from disk may pre-date this field — init lazily.
    if (!round.seenPlayers) round.seenPlayers = new Set();
    const nickKey = nickname.toLowerCase();
    if (!round.seenPlayers.has(nickKey)) {
      round.seenPlayers.add(nickKey);
      emitGameEvent('first_time_player', {}, 'low');
    }

    // hidden_word + rarity tier per newly-revealed article body word. The
    // rarity is based on the guess's rank vs. the current rankTarget (same
    // tiers the announce banner uses).
    for (const norm of newlyRevealed) {
      const rank = round.rankCache.get(norm);
      const hasRank = typeof rank === 'number';
      const tier = rankTier(hasRank ? rank : -1);
      let rarityEvent;
      if (!hasRank) rarityEvent = 'ultra_rare_word_found';
      else if (tier === 'rare') rarityEvent = 'rare_word_found';
      else rarityEvent = 'common_word_found';
      const pri = rarityEvent === 'common_word_found' ? 'normal' : 'high';
      emitGameEvent('hidden_word', { word: norm, rank: hasRank ? rank : undefined }, pri);
      emitGameEvent(rarityEvent, {
        word: norm,
        rank: hasRank ? rank : undefined,
        isRare: rarityEvent === 'rare_word_found',
        isHidden: rarityEvent === 'ultra_rare_word_found',
      }, pri);
    }

    // wrong_guess per miss classification.
    for (const c of classifications) {
      if (c.status !== 'miss') continue;
      emitGameEvent('wrong_guess', { guess: c.word }, 'low');
    }

    // guess_best_so_far — only when this message's author is now the #1.
    const newTopRank = round.topGuesses[0]?.rank;
    const hasNewBest = typeof newTopRank === 'number'
      && (typeof prevTopRank !== 'number' || newTopRank < prevTopRank);
    if (hasNewBest && round.topGuesses[0].user?.displayName === nickname) {
      emitGameEvent('guess_best_so_far', {
        guess: round.topGuesses[0].word,
        rank: newTopRank,
      }, 'normal');
    }
  }

  // Save whatever state changed on this message (reveals, scores, top).
  scheduleSave();
}


// ───── Per-streamer private session round flow ─────────────────────────────
// Sessions are ephemeral private rounds keyed by streamer handle. The round
// shape mirrors public currentRound. sessionManager owns the Map<handle,round>.
// Public-game ELO / suspicion / aggregation / WT-reporting are skipped.

function _sessionRoom(handle) {
  return `wikisearchle:session:${String(handle || '').toLowerCase()}`;
}

function _sessionHintTargetNorm(session) {
  return String((session && (session.rankTargetTitleNorm || session.rankTarget)) || '').toLowerCase();
}

function _sessionTitleTokenForNorm(session, norm) {
  if (!session || !norm || !Array.isArray(session.titleTokens)) return null;
  return session.titleTokens.find((t) => t && t.type === 'word' && t.norm === norm) || null;
}

function _sessionHintLetterCount(session, norm, maxLetters) {
  if (!session || !norm) return 0;
  if (!session.hintLettersByNorm || typeof session.hintLettersByNorm !== 'object' || Array.isArray(session.hintLettersByNorm)) {
    session.hintLettersByNorm = {};
  }
  const raw = Number(session.hintLettersByNorm[norm]);
  const count = Number.isFinite(raw) ? Math.floor(raw) : 1;
  const clamped = Math.max(1, Math.min(maxLetters, count));
  session.hintLettersByNorm[norm] = clamped;
  return clamped;
}

function _clearSessionHintPrompt(session) {
  if (!session) return;
  session.hintPrompt = null;
}

function _resetSessionHintOffer(session, now) {
  if (!session) return null;
  const norm = _sessionHintTargetNorm(session);
  if (!norm) {
    session.likeHintState = null;
    _clearSessionHintPrompt(session);
    return null;
  }
  session.likeHintState = {
    rankTargetTitleNorm: norm,
    rankTarget: String(session.rankTarget || ''),
    stuckSince: now,
    eligibleAt: now + SESSION_HINT_INITIAL_STUCK_MS,
    likes: 0,
    offerIndex: 1,
    lastUnlockedAt: 0,
  };
  return session.likeHintState;
}

function _syncSessionHintState(session, now = Date.now()) {
  if (!session || session.won) {
    _clearSessionHintPrompt(session);
    return null;
  }
  const norm = _sessionHintTargetNorm(session);
  const token = _sessionTitleTokenForNorm(session, norm);
  if (!norm || !token || token.revealed || token.isSkipped) {
    session.likeHintState = null;
    _clearSessionHintPrompt(session);
    return null;
  }
  const maxLetters = Math.max(1, Array.from(String(token.text || '')).length);
  _sessionHintLetterCount(session, norm, maxLetters);
  const rankTarget = String(session.rankTarget || '');
  let state = session.likeHintState;
  if (!state || state.rankTargetTitleNorm !== norm || state.rankTarget !== rankTarget) {
    state = _resetSessionHintOffer(session, now);
  }
  if (!Number.isFinite(Number(state.stuckSince))) state.stuckSince = now;
  if (!Number.isFinite(Number(state.eligibleAt))) state.eligibleAt = now + SESSION_HINT_INITIAL_STUCK_MS;
  if (!Number.isFinite(Number(state.likes))) state.likes = 0;
  return state;
}

function _buildSessionHintPrompt(session, now = Date.now()) {
  const state = _syncSessionHintState(session, now);
  if (!state) return null;
  const norm = state.rankTargetTitleNorm;
  const token = _sessionTitleTokenForNorm(session, norm);
  if (!token) return null;
  const maxLetters = Math.max(1, Array.from(String(token.text || '')).length);
  const lettersRevealed = _sessionHintLetterCount(session, norm, maxLetters);
  if (lettersRevealed >= maxLetters) return null;
  if (now < Number(state.eligibleAt || 0)) return null;
  const likes = Math.max(0, Math.floor(Number(state.likes) || 0));
  return {
    show: true,
    likes,
    likesRequired: SESSION_HINT_LIKES_PER_LETTER,
    likesRemaining: Math.max(0, SESSION_HINT_LIKES_PER_LETTER - likes),
    lettersRevealed,
    offerIndex: Number(state.offerIndex) || 1,
  };
}

function updateSessionHintPrompt(session, now = Date.now()) {
  if (!session) return null;
  const prompt = _buildSessionHintPrompt(session, now);
  session.hintPrompt = prompt;
  return prompt;
}

function _sessionHintPromptKey(prompt) {
  if (!prompt || !prompt.show) return '';
  return [
    prompt.offerIndex || 0,
    prompt.likes || 0,
    prompt.likesRequired || 0,
    prompt.lettersRevealed || 0,
  ].join(':');
}

function _sessionLikeDelta(event) {
  if (!event || event.type !== 'like') return 0;
  const candidates = [event.count, event.likeCount, event.repeatCount, event.likes];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 1;
}

function _unlockSessionHintLetter(session, state, now) {
  const norm = state && state.rankTargetTitleNorm;
  const token = _sessionTitleTokenForNorm(session, norm);
  if (!token) return false;
  const maxLetters = Math.max(1, Array.from(String(token.text || '')).length);
  const current = _sessionHintLetterCount(session, norm, maxLetters);
  if (current >= maxLetters) return false;
  session.hintLettersByNorm[norm] = current + 1;
  state.likes = 0;
  state.eligibleAt = now + SESSION_HINT_REPEAT_STUCK_MS;
  state.offerIndex = (Number(state.offerIndex) || 1) + 1;
  state.lastUnlockedAt = now;
  return true;
}

function handleSessionEngagement(event) {
  if (!event || event.type !== 'like') return;
  const handle = String(event.streamerHandle || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return;
  const session = sessionManager.getSession(handle);
  if (!session || session.won) return;
  const now = Date.now();
  session.lastActivityAt = now;
  updateSessionHintPrompt(session, now);
  const state = _syncSessionHintState(session, now);
  if (!state || !session.hintPrompt || !session.hintPrompt.show) return;
  const delta = _sessionLikeDelta(event);
  if (delta <= 0) return;
  const promptWasShowing = !!(session.hintPrompt && session.hintPrompt.show);
  const offerBefore = session.hintPrompt ? session.hintPrompt.offerIndex : 0;
  state.likes = Math.min(
    SESSION_HINT_LIKES_PER_LETTER,
    Math.max(0, Math.floor(Number(state.likes) || 0)) + delta
  );
  const unlocked = state.likes >= SESSION_HINT_LIKES_PER_LETTER
    ? _unlockSessionHintLetter(session, state, now)
    : false;
  updateSessionHintPrompt(session, now);
  const promptIsShowing = !!(session.hintPrompt && session.hintPrompt.show);
  const offerAfter = session.hintPrompt ? session.hintPrompt.offerIndex : 0;
  const progressDue = now - (session.likeHintLastBroadcastAt || 0) >= SESSION_HINT_PROGRESS_BROADCAST_MS;
  if (unlocked || progressDue || promptWasShowing !== promptIsShowing || offerBefore !== offerAfter) {
    session.likeHintLastBroadcastAt = now;
    broadcastSessionState(session);
  }
  sessionManager.scheduleSave();
}

async function buildSessionRound(handle) {
  // Per-streamer difficulty narrows the pool by article length before
  // attempting picks. Falls back to the full pool if the filter is empty.
  const wordFrequency = await _getStreamerDifficulty(handle);
  const sessionPool = filterPoolByDifficulty(playablePool, wordFrequency);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!sessionPool.length) return null;
    const pickKey = drawNextSessionTitle(handle, wordFrequency, sessionPool);
    if (!pickKey) continue;
    const entry = coverage.pages[pickKey];
    if (!entry || entry.status !== 'exists') continue;
    const sourceWords = Array.isArray(entry.titleWords) && entry.titleWords.length
      ? entry.titleWords : String(entry.title || pickKey).split(/\s+/);
    const allTitleWordNorms = sourceWords.map((w) => normalize(String(w))).filter((n) => n && !STOPLIST.has(n));
    if (!allTitleWordNorms.length) continue;
    // Split into findable + skipped (mirrors the public-MP round-build).
    const _classify = _easyFilterModule().classifyTitleWords({
      title: entry.title || pickKey,
      titleWordNorms: allTitleWordNorms,
    });
    const titleWordNorms = _classify.findable;
    const skippedTitleNorms = _classify.skipped;
    if (!titleWordNorms.length) continue;  // no anchor word, skip article
    try {
      const { title, plaintext } = await fetchLeadSection(entry.title);
      if (!plaintext || plaintext.length < 200) continue;
      const lowerText = plaintext.toLowerCase();
      const missing = titleWordNorms.filter((n) => !new RegExp(`\\b${n}\\b`, 'i').test(lowerText));
      if (missing.length > 0) continue;
      const cleanTitle = stripDisambiguator(title);
      let articleText = plaintext;
      try {
        const slug = articleGenerator.slugify(cleanTitle);
        const cached = articleGenerator.getCachedArticle(slug);
        if (cached) {
          const cachedLower = cached.toLowerCase();
          const cachedMissing = titleWordNorms.filter((n) => !new RegExp(`\\b${n}\\b`, 'i').test(cachedLower));
          if (cachedMissing.length === 0) articleText = cached;
        }
      } catch (e) {}
      const base = buildRound({ targetWord: cleanTitle, articleTitle: cleanTitle, leadPlaintext: articleText, targetNorms: titleWordNorms, skippedTitleNorms });
      const displayOrderNorms = getTitleDisplayOrderNorms(base);
      const baseOrderNorms = displayOrderNorms.length ? displayOrderNorms : titleWordNorms;
      const titleWordsRaw = Array.isArray(entry.titleWords) && entry.titleWords.length
        ? entry.titleWords
        : String(entry.title || pickKey).split(/\s+/);
      const pickOrder = deferProperNounsToEnd(baseOrderNorms, titleWordsRaw);
      let rankTarget = null, preload = null;
      const excluded = [];
      for (const norm of pickOrder) {
        try { preload = await rankBatch(norm, []); rankTarget = norm; break; }
        catch (e) { excluded.push(norm); }
      }
      if (!rankTarget) continue;
      const titleCanonicals = {};
      try {
        const probe = await rankBatch(rankTarget, titleWordNorms);
        const canons = (probe && probe.canonicals) || {};
        for (const tn of titleWordNorms) titleCanonicals[tn] = canons[tn] || tn;
      } catch (e) { for (const tn of titleWordNorms) titleCanonicals[tn] = tn; }
      const rankTargetTitleNorm = rankTarget;
      const canonicalTarget = titleCanonicals[rankTarget] || rankTarget;
      if (canonicalTarget !== rankTarget) {
        try { preload = await rankBatch(canonicalTarget, []); rankTarget = canonicalTarget; } catch (e) {}
      }
      const round = Object.assign(base, {
        startTime: new Date().toISOString(), rewardRoundId: require('crypto').randomUUID(),
        titleWordNorms, titleWordsRaw, skippedTitleNorms, titleCanonicals, titleWordsFound: 0,
        totalRankedWords: preload.totalRankedWords || 0,
        leadPlaintext: plaintext,
        rankCache: new Map(), canonicalCache: new Map(),
        allGuesses: [], tickerBuffer: [], topGuesses: [],
        playerStats: {}, firstHitAt: new Map(),
        lastAnnounce: null, titleRevealed: false,
        rankTarget, rankTargetTitleNorm,
        excludedRankTargets: new Set(excluded),
        seenPlayers: new Set(), wordScoreCache: new Map(),
        guessedMisses: new Set(),
        hintLettersByNorm: {}, likeHintState: null, hintPrompt: null,
        sessionHandle: String(handle).toLowerCase(),
        lastActivityAt: Date.now(),
      });
      updateSessionHintPrompt(round);
      console.log(`[Session] "${handle}" started: target="${cleanTitle}" (${round.totalRankedWords} ranked words)`);
      return round;
    } catch (e) {
      console.log(`[Session] "${handle}" target "${pickKey}" failed: ${e.message}`);
    }
  }
  return null;
}

async function advanceSessionRankTargetToNextTitleWord(session) {
  if (!session || !Array.isArray(session.titleWordNorms)) return null;
  if (!session.excludedRankTargets) session.excludedRankTargets = new Set();
  const canons = session.titleCanonicals || {};
  const displayOrder = getTitleDisplayOrderNorms(session);
  const baseOrder = displayOrder.length ? displayOrder : session.titleWordNorms;
  const order = deferProperNounsToEnd(baseOrder, _titleWordsRawForRound(session));
  for (const norm of order) {
    if (session.revealed.has(norm)) continue;
    if (session.excludedRankTargets.has(norm)) continue;
    const candidates = [];
    const canonical = canons[norm];
    if (canonical && canonical !== norm) candidates.push(canonical);
    candidates.push(norm);
    let set = false;
    for (const cand of candidates) {
      try {
        const preload = await rankBatch(cand, []);
        if (!isActiveRound(session)) return null;
        session.rankTarget = cand;
        session.rankTargetTitleNorm = norm;
        session.totalRankedWords = preload.totalRankedWords || 0;
        _resetSessionHintOffer(session, Date.now());
        set = true; break;
      } catch (e) {}
    }
    if (set) return session.rankTarget;
    session.excludedRankTargets.add(norm);
  }
  return null;
}

function sessionRebuildTop(session) {
  if (!session) return;
  session.topGuesses = [...session.allGuesses].sort((a, b) => a.rank - b.rank).slice(0, TOP_N);
}

function _wikisearchleSessionStateSnapshot(session) {
  if (!session) return null;
  const hintPrompt = updateSessionHintPrompt(session);
  const roundOver = !!session.won;
  return {
    targetWord: roundOver ? session.targetWord : '(active)',
    startTime: session.startTime,
    ...(roundOver ? multiplayerRewards.view(session) : {}),
    topGuesses: session.topGuesses,
    recentGuesses: session.tickerBuffer.slice(-TICKER_CAP),
    guessCount: session.guessCount,
    scoreboard: _sessionScoreboardTop3(session),
    lastAnnounce: session.lastAnnounce || null,
    totalRankedWords: session.totalRankedWords || 0,
    titleWordNorms: roundOver ? (session.titleWordNorms || []) : [],
    titleWordFinders: session.titleWordFinders || {},
    rankTarget: roundOver ? (session.rankTarget || null) : null,
    hintPrompt,
    isSession: true,
    sessionHandle: session.sessionHandle,
  };
}

function _sessionScoreboardTop3(session) {
  if (!session || !session.playerStats) return [];
  return Object.values(session.playerStats)
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 3)
    .map((s) => ({ nickname: s.nickname, points: s.points, user: s.user }));
}

function broadcastSessionRoundStart(session) {
  io.to(_sessionRoom(session.sessionHandle)).emit('wikisearchle-round-start', {
    targetWord: '(active)', articleTitle: null, startTime: session.startTime,
  });
  broadcastSessionState(session);
}

function broadcastSessionState(session) {
  if (!session) return;
  updateSessionHintPrompt(session);
  const room = _sessionRoom(session.sessionHandle);
  io.to(room).emit('wikisearchle-state', _wikisearchleSessionStateSnapshot(session));
  io.to(room).emit('wikiword-state', serializeRound(session));
}

function sweepSessionHintPrompts() {
  const now = Date.now();
  for (const row of sessionManager.listSessions()) {
    const session = sessionManager.getSession(row.handle);
    if (!session || session.won) continue;
    const before = _sessionHintPromptKey(session.hintPrompt);
    updateSessionHintPrompt(session, now);
    const after = _sessionHintPromptKey(session.hintPrompt);
    if (!before && after) broadcastSessionState(session);
  }
}
setInterval(sweepSessionHintPrompts, SESSION_HINT_SWEEP_MS).unref();

function endSessionRound(session, targetFinder) {
  if (!isActiveRound(session)) return;
  const completion = prepareRoundCompletion(session, targetFinder);
  if (!completion) return;
  targetFinder = completion.targetFinder;
  revealAll(session);
  multiplayerRewards.deliver(completion.reward);
  sessionManager.scheduleSave();
  updateSessionHintPrompt(session);
  const winner = completion.winner;
  const room = _sessionRoom(session.sessionHandle);
  const finalArticle = serializeRound(session);
  io.to(room).emit('wikisearchle-round-end', {
    targetWord: session.targetWord,
    articleTitle: session.articleTitle,
    winner: winner ? { nickname: winner.nickname, points: winner.points, user: winner.user } : null,
    targetFinder: targetFinder || null,
    scoreboard: _sessionScoreboardTop3(session),
    isSession: true,
  });
  io.to(room).emit('wikiword-round-end', { ...finalArticle, winner: winner?.nickname || null });
  console.log(`[Session] "${session.sessionHandle}" ended: target="${session.targetWord}" winner=${winner?.nickname || '(none)'}`);
  if (winner) {
    try {
      const sessTop10 = Object.values(session.playerStats || {})
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, 10)
        .map((p) => {
          const u = p.user || {};
          return {
            displayName: p.nickname,
            profilePic: u.profilePic || null,
            platform: u.platform || 'unknown',
            platformUserId: u.platformUserId || u.id || null,
            linkedDiscord: u.linkedDiscord || null,
            isFanClub: !!u.isFanClub,
          isSuperfan: !!u.isSuperfan,
          isDonor: !!u.isDonor,
            points: p.points || 0,
            cosmetics: p.cosmetics || u.cosmetics || null,
          };
        });
      const _winPayload = {
        game: 'wikisearchle', gameName: 'WikiSearchle',
        word: session.targetWord,
        winner: winner.user || { displayName: winner.nickname },
        guessCount: session.guessCount || 0,
        isDaily: false,
        topPlayers: sessTop10,
        streamerHandle: session.sessionHandle,
      };
      io.to(room).emit('game-win', _winPayload);
      if (chatRelay && chatRelay.connected) {
        chatRelay.emit('game-win', _winPayload);
      }
    } catch (e) {}


  }

  // Stats + ELO run whether or not there was a scoring winner, matching the
  // public path (both no-op internally on an empty round).
  try { aggregateRoundIntoStats(session); } catch (e) { console.log(`[Session] stats aggregation failed: ${e.message}`); }

  setTimeout(async () => {
    try {
      if (sessionManager.getSession(session.sessionHandle) !== session) return;
      // Route through getOrBuildSession so concurrent viewer-connect or
      // chat-arrival paths during the 8s restart window share the same
      // build (no two-articles race).
      const next = await sessionManager.getOrBuildSession(
        session.sessionHandle,
        () => buildSessionRound(session.sessionHandle),
        broadcastSessionRoundStart
      );
      if (next) {
        broadcastSessionState(next);
        io.to(room).emit('wikisearchle-top', next.topGuesses);
      }
    } catch (e) {
      console.warn(`[Session] "${session.sessionHandle}" auto-restart failed: ${e.message}`);
    }
  }, 10000);
}

async function handleSessionChat(msg, clientIP, session) {
  const openingRound = session;
  const text = msg && (msg.message || msg.text);
  if (!openingRound || typeof text !== 'string' || text.length > 1024 || text.trim().split(/\s+/).length > 32) return;
  try {
    const input = JSON.parse(JSON.stringify(msg));
    return await roundActions.run(openingRound, async round => {
      if (finishCompletedRound(round)) return;
      try { return await processSessionChat(input, clientIP, round); }
      finally { if (!round.completionPending) finishCompletedRound(round); }
    });
  } catch { console.warn('[WikiSearchle] Round action failed'); }
}

async function processSessionChat(msg, clientIP, session) {
  if (!isActiveRound(session)) return;
  const roomName = _sessionRoom(session.sessionHandle);
  // Per-streamer blocklist: silently drop chat from blocked viewers.
  {
    const _u = (msg && msg.user) || {};
    const _platform = String((msg && msg.platform) || _u.platform || '').toLowerCase();
    const _pid = String(_u.id || _u.platformUserId || _u.userId || '');
    if (_platform && _pid && _isStreamerBlocking(session.sessionHandle, _platform, _pid)) return;
  }
  const text = msg && (msg.message || msg.text);
  if (!text || typeof text !== 'string') return;

  // Canonical identity: linkedDiscord (if present) collapses TikTok/YouTube/web
  // for the same person to one Word Tycoon identity. Matches Searchle pattern.
  const rawUserId = (msg && msg.user && (msg.user.id || msg.user.platformUserId || msg.user.username)) || null;
  const linkedDiscord = (msg && msg.linkedDiscord) || null;
  const canonicalUserId = linkedDiscord || rawUserId;
  const rawPlatform = (msg && msg.user && msg.user.platform) || (msg && msg.platform) || 'unknown';
  const canonicalPlatform = linkedDiscord ? 'web' : rawPlatform;
  const _isFanClubFromBadges = !!(msg && msg.user && Array.isArray(msg.user.badges) && msg.user.badges.indexOf('fan-club') !== -1);
  const _isSuperfanFromBadges = !!(msg && msg.user && Array.isArray(msg.user.badges) && msg.user.badges.indexOf('superfan') !== -1);
  let user = msg && msg.user ? {
    displayName: msg.user.displayName || msg.displayName || 'viewer',
    username: msg.user.username || null,
    platform: canonicalPlatform,
    platformUserId: canonicalUserId,
    linkedDiscord,
    profilePic: msg.user.profilePic || null,
    // Forward equipped cosmetics so cards/podium can render hero badges,
    // profile glow, name color, title, etc. Chat Relay enriches every chat
    // message with the user's equipped cosmetics object — without this
    // line WikiSearchle's user object construction would strip them.
    cosmetics: msg.user.cosmetics || null,
    isFanClub: _isFanClubFromBadges,
    isSuperfan: _isSuperfanFromBadges,
  } : {
    displayName: msg?.displayName || 'viewer',
    username: null,
    platform: 'unknown',
    platformUserId: null,
    linkedDiscord: null,
    profilePic: null,
    cosmetics: null,
    isFanClub: false,
  };
  user = isolateRoundUser(session, user);
  let nickname = user.displayName;

  if (isSuspended(user, clientIP)) {
    console.log(`[WikiSearchle] Suspended user blocked: ${nickname} (${user.platformUserId || 'no-id'}) ip=${clientIP || 'none'}`);
    return;
  }

  // Classify each word BEFORE processGuess mutates state.
  // Statuses: 'hit' (in article, not yet revealed — this guess will reveal it),
  //           'dup' (in article, already revealed by someone),
  //           'miss' (not in article at all).
  const words = text
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 0);
  const unique = Array.from(new Set(words));
  // Defensive init for in-flight rounds that predate the guessedMisses field.
  if (!session.guessedMisses) session.guessedMisses = new Set();
  const classifications = unique.map((w) => {
    if (session.revealed.has(w)) return { word: w, status: 'dup-hit' };
    if (session.wordIndex.has(w)) return { word: w, status: 'hit' };
    if (session.guessedMisses.has(w)) return { word: w, status: 'dup-miss' };
    return { word: w, status: 'miss' };
  });
  // Record fresh misses so the next time anyone guesses the same wrong
  // word, the ticker chip flips to dup-miss (yellow + red x).
  for (const c of classifications) {
    if (c.status === 'miss') session.guessedMisses.add(c.word);
  }

  // Track first-hit latency for cheater detection (record before processGuess mutates state).
  const identityKey = getIdentityKey(user);
  if (identityKey && !session.firstHitAt.has(identityKey)) {
    if (classifications.some((c) => c.status === 'hit')) {
      session.firstHitAt.set(identityKey, Date.now());
    }
  }

  // --- Reveal side (mutates state; emits wikiword-reveal for article body) ---
  const { newlyRevealed, isTarget } = processGuess(session, text);

  // --- Rank words via Searchle (against current rankTarget). Done BEFORE the
  // reveal broadcast so canonical matches can promote title-word finds into
  // newlyRevealed — otherwise a guess like "bodies" (canonical "body") would
  // rank #1 but fail to advance the round, because processGuess keys on the
  // raw norm and wordIndex has "body", not "bodies". The downstream chip/card
  // loop reads rankCache.get(word), so moving the ranking here is a no-op for
  // those branches. ---
  if (session.rankTarget) {
    const unranked = unique.filter((w) => !session.rankCache.has(w));
    if (unranked.length > 0) {
      const fetchTarget = session.rankTarget;
      const fetchPurgeVersion = session.purgeVersion || 0;
      try {
        const { ranks, canonicals } = await rankBatch(fetchTarget, unranked);
        if (!isActiveRound(session)) return;
        // Concurrent handler may have advanced rankTarget OR bumped the
        // purge version (title-word progression clears caches before
        // awaiting the new rankTarget). Either signal means our ranks are
        // against the wrong target — discard rather than poison the freshly
        // cleared cache with old-target rank values.
        if (session.rankTarget === fetchTarget
            && (session.purgeVersion || 0) === fetchPurgeVersion) {
          if (!session.canonicalCache) session.canonicalCache = new Map();
          for (const w of unranked) {
            const rank = ranks && ranks[w];
            if (typeof rank === 'number') {
              session.rankCache.set(w, rank);
              session.canonicalCache.set(w, (canonicals && canonicals[w]) || w);
            }
          }
        }
      } catch (e) {
        console.log(`[WikiSearchle] rank fetch failed: ${e.message}`);
      }
    }

    if (!isActiveRound(session)) return;
    // Canonical-match title reveal: if any guess canonicalizes to the current
    // rankTarget and that title norm isn't yet revealed, reveal it now so the
    // existing title-word progression code at line ~933 detects it. Also
    // promote the guess's chip status from 'miss' to 'hit' so the UI reflects
    // that the morphological variant counted as finding the title word.
    const titleNorm = session.rankTargetTitleNorm;
    if (titleNorm && !session.revealed.has(titleNorm)) {
      for (const w of unique) {
        const canonical = session.canonicalCache && session.canonicalCache.get(w);
        if (canonical && canonical === session.rankTarget) {
          session.revealed.add(titleNorm);
          newlyRevealed.push(titleNorm);
          if (session.targetNormSet && session.targetNormSet.has(titleNorm)) {
            if (session.foundTitleNorms) session.foundTitleNorms.add(titleNorm);
            const sid = session.targetSlotIds && session.targetSlotIds.get(titleNorm);
            if (sid && session.foundSlotIds) session.foundSlotIds.add(sid);
          }
          const tokens = session.wordIndex.get(titleNorm) || [];
          for (const t of tokens) {
            // Body title-word slots stay redacted until round end —
            // matches processGuess's deferred-reveal behavior.
            if (t.isHiddenTarget) continue;
            if (!t.revealed) { t.revealed = true; session.revealedCount++; }
          }
          const cls = classifications.find((c) => c.word === w);
          if (cls) cls.status = 'hit';
          break;
        }
      }
    }
  }

  if (newlyRevealed.length > 0) {
    // Push the freshly-revealed article first so the client's DOM has up-to-date
    // spans (with data-norm on the newly-revealed tokens) before the glow event
    // fires. Socket.IO guarantees in-order delivery on a single socket.
    io.to(roomName).emit('wikiword-state', serializeRound(session));
    io.to(roomName).emit('wikiword-reveal', {
      words: newlyRevealed,
      by: nickname,
      guessCount: session.guessCount,
      revealedCount: session.revealedCount,
    });
  }

  // --- Scoring: per-word A+B+C (rarity + letter bonus + length) from the
  // Chat Relay word-bank. Numbers use a separate digit-count tier. Title
  // words (all of them for multi-word articles) get a positional bonus on
  // top — 50k/40k/30k/20k by find-order, so the first title word found in
  // the round is worth most. Single-word articles end the round on the
  // first (and only) title word, keeping the 50k feel.
  let earned = 0;
  const titleWordsRevealedThisGuess = [];
  const titleSet = new Set(session.titleWordNorms || []);
  for (const norm of newlyRevealed) {
    const tokens = session.wordIndex.get(norm) || [];
    const tok = tokens[0];
    if (tok && tok.isNumber) {
      earned += scoreNumber(tok.digitCount || tok.text.length);
    } else {
      const s = await scoreWord(norm, session);
      if (!isActiveRound(session)) return;
      earned += s.total;
    }
    if (titleSet.has(norm)) {
      const bonus = titleWordBonus(session.titleWordsFound || 0);
      earned += bonus;
      session.titleWordsFound = (session.titleWordsFound || 0) + 1;
      titleWordsRevealedThisGuess.push(norm);
      // Remember who found this title word so the client can show their PFP
      // next to the revealed word. Stored in the round snapshot so it
      // survives reconnects and PM2 restarts.
      if (!session.titleWordFinders) session.titleWordFinders = {};
      session.titleWordFinders[norm] = {
        nickname,
        profilePic: user.profilePic || null,
        platform: user.platform || 'unknown',
        isFanClub: !!user.isFanClub,
        isSuperfan: !!user.isSuperfan,
        isDonor: !!user.isDonor,
        at: Date.now(),
      };
    }
  }
  if (earned > 0) {
    // Recheck ownership after asynchronous scoring before crediting points.
    user = isolateRoundUser(session, user);
    nickname = user.displayName;
    for (const norm of titleWordsRevealedThisGuess) {
      session.titleWordFinders[norm].nickname = nickname;
    }
    const key = nickname.toLowerCase();
    if (!session.playerStats[key]) {
      session.playerStats[key] = { nickname, points: 0, user };
    }
    session.playerStats[key].points += earned;
    session.playerStats[key].user = user; // keep latest avatar/platform
    io.to(roomName).emit('wikisearchle-scoreboard', _sessionScoreboardTop3(session));
  }

  // (rankBatch moved up — before the reveal broadcast — so canonical title
  // matches can promote into newlyRevealed. rankCache/canonicalCache are
  // already populated by the time we reach the chip loop below.)

  // --- Build ticker chips + announce banner + cards update ---
  // Snapshot the previous best rank so we can fire a Sassie `guess_best_so_far`
  // event when this message lowers the #1 rank on the cards.
  const prevTopRank = session.topGuesses[0]?.rank;
  let topChanged = false;
  let firstHit = null;
  // Batch guesses are paced ~500ms apart so chips/cards animate in one at a
  // time instead of flooding when a viewer types "apple banana orange".
  // Snapshot the round reference; if endRound fires mid-loop (e.g. word 2 is
  // the target) or the round otherwise rolls over, break so stale chips
  // don't bleed into the next round.
  const loopRound = session;
  // Snapshot rankTarget AND a purge counter. The purge counter is bumped
  // synchronously in the title-word-progression block BEFORE its async
  // advanceRankTargetToNextTitleWord call (which awaits a rankBatch and
  // doesn't actually mutate session.rankTarget until AFTER its await).
  // Without the purge check, a concurrent chip-loop iteration during that
  // window would see rankTarget unchanged, push its old-target-ranked
  // guess into the just-cleared allGuesses, and trigger a rebuildTop that
  // re-emits the just-found title word at #1.
  const loopRankTarget = session.rankTarget;
  const loopPurgeVersion = session.purgeVersion || 0;
  for (let i = 0; i < classifications.length; i++) {
    if (i > 0) await sleep(BATCH_GUESS_INTERVAL_MS);
    if (!isActiveRound(session) || session !== loopRound) return;
    const rankTargetStale = session.rankTarget !== loopRankTarget
                         || (session.purgeVersion || 0) !== loopPurgeVersion;
    const c = classifications[i];
    const rank = session.rankCache.get(c.word);
    const canonical = (session.canonicalCache && session.canonicalCache.get(c.word)) || c.word;
    // If another guesser already put this canonical form on the cards, the
    // first one stays — mark as dup so the chip reflects it and skip the card.
    const isCanonicalDup = typeof rank === 'number'
      && session.allGuesses.some((g) => (g.canonical || g.word) === canonical);
    // Decide chip status. Most cases use c.status from earlier classification
    // (hit / dup-hit / dup-miss / miss). The exception is when the RAW form
    // is fresh ('miss') but its CANONICAL was already used — then we still
    // want a duplicate chip, but the dup flavour depends on whether the
    // canonical was a hit (revealed) or a miss (in guessedMisses).
    let chipStatus = c.status;
    if (isCanonicalDup && c.status === 'miss') {
      chipStatus = session.revealed.has(canonical) ? 'dup-hit' : 'dup-miss';
    }
    const chip = {
      word: c.word,
      status: chipStatus,     // 'hit' | 'dup-hit' | 'dup-miss' | 'miss'
      by: nickname,
      platform: user.platform,
      profilePic: user.profilePic || null,
      rank: typeof rank === 'number' ? rank : null,
      timestamp: Date.now(),
    };
    io.to(roomName).emit('wikisearchle-chip', chip);

    // Library credit: a 'hit' means this player was the first to reveal this
    // word in the article — mirrors Searchle's onNewGuess library credit.
    // Requires platformUserId; anonymous web guests get no library entry.
    if (chipStatus === 'hit' && user.platformUserId) {
      gameShared.reportLibraryWord(
        user.platform, user.platformUserId, c.word,
        'wikisearchle',
        user.username || user.displayName, user.displayName,
        null,
      );
    }

    // Cards accept every ranked word (hits, dups, and misses) — ranking is
    // independent of whether the word appears in the article body. Dedupe by
    // canonical form so "cat" and "cats" (or "colour" and "color") don't both
    // get their own card — first guesser stays on the board.
    let thisWordTopChanged = false;
    if (typeof rank === 'number' && !isCanonicalDup && !rankTargetStale) {
      // Display the canonical (lemmatized) form on the cards so plurals,
      // gerunds, and other inflected forms collapse to base — "cats" shows
      // as "cat", matching Searchle's top-card behavior. Chips and announce
      // banner keep the typed form so chat reflects what was actually said.
      const displayWord = canonical || c.word;
      const guess = { word: displayWord, rank, canonical, user, timestamp: Date.now() };
      session.allGuesses.push(guess);
      session.tickerBuffer.push(guess);
      if (session.tickerBuffer.length > TICKER_CAP * 2) session.tickerBuffer = session.tickerBuffer.slice(-TICKER_CAP);
      io.to(roomName).emit('wikisearchle-new-guess', guess);
      if (session.topGuesses.length < TOP_N || rank < session.topGuesses[session.topGuesses.length - 1].rank) {
        thisWordTopChanged = true;
        topChanged = true;
      }
    }
    // Rebuild + broadcast top-6 per word so card animations stay aligned
    // with the paced chips instead of all reshuffling at the end.
    if (thisWordTopChanged) {
      sessionRebuildTop(session);
      io.to(roomName).emit('wikisearchle-top', session.topGuesses);
    }

    // Announce banner fires in sync with the first hit's chip — not after
    // the whole loop — so the banner lands when the viewer sees the hit.
    if (c.status === 'hit' && !firstHit) {
      firstHit = c;
      const announceRank = session.rankCache.get(firstHit.word);
      const playerKey = nickname.toLowerCase();
      const totalPoints = session.playerStats[playerKey]?.points || 0;
      const announce = {
        nickname,
        user,
        word: firstHit.word,
        earned,
        totalPoints,
        rank: typeof announceRank === 'number' ? announceRank : null,
        rarity: rankTier(announceRank),
        timestamp: Date.now(),
      };
      session.lastAnnounce = announce;
      io.to(roomName).emit('wikisearchle-announce', announce);
    }
  }

  // --- Title-word progression ---
  // If this guess revealed one or more title words: cards reset (they were
  // ranked against the previous rankTarget), rankTarget advances to the
  // next unrevealed title word, and the round ends if all title words are
  // now revealed.
  if (titleWordsRevealedThisGuess.length > 0) {
    const allTitleFound = (session.titleWordNorms || []).every((n) => session.revealed.has(n));
    if (allTitleFound) {
      session.titleRevealed = true;
      io.to(roomName).emit('wikisearchle-title-revealed', {
        articleTitle: session.articleTitle,
        titleWordsRevealed: titleWordsRevealedThisGuess,
      });
      endSessionRound(session, nickname);
    } else {
      // rankTarget only needs to change if the word the player just found
      // WAS the current rankTarget. Out-of-order finds (e.g. guessing word 2
      // while rankTarget was word 1) leave rankTarget pointed at the first
      // unrevealed title word in reading order — no card reset needed.
      // The raw (plural) title norm the current rankTarget corresponds to.
      // titleWordsRevealedThisGuess contains raw title norms, so compare
      // against the title-norm alias — not the canonical Searchle target.
      const prevRankTargetTitleNorm = session.rankTargetTitleNorm || session.rankTarget;
      const rankTargetFound = titleWordsRevealedThisGuess.includes(prevRankTargetTitleNorm);
      let nextTitleWord = prevRankTargetTitleNorm;
      if (rankTargetFound) {
        // Clear cards — rankings were against the old target and are now stale.
        session.topGuesses = [];
        session.allGuesses = [];
        session.rankCache = new Map();
        session.canonicalCache = new Map();
        session.tickerBuffer = [];
        // Bump the purge version BEFORE awaiting advanceRankTargetToNextTitleWord
        // (which awaits a rankBatch internally — and during THAT await,
        // session.rankTarget is still the old value because advance only
        // sets it AFTER its await resolves). Without this version bump, a
        // concurrent chip-loop iteration would see rankTarget unchanged,
        // think its cached rank against the OLD target was still valid,
        // and push the just-found title word back into allGuesses → it
        // re-enters topGuesses → bean stays at #1 even after the find.
        session.purgeVersion = (session.purgeVersion || 0) + 1;
        nextTitleWord = await advanceSessionRankTargetToNextTitleWord(session);
        if (!isActiveRound(session)) return;
        // Defensive re-clear — if any concurrent handler still managed to
        // slip a guess into allGuesses/topGuesses during the await above
        // (e.g., it captured purgeVersion AFTER our bump and its rankBatch
        // resolved while session.rankTarget was still the old value, passing
        // both staleness checks), wipe them out again so the broadcast
        // below sends the truly empty set. Also re-clear rankCache /
        // canonicalCache: a concurrent rankBatch racing the advance can
        // write OLD-target ranks back into the freshly-cleared cache —
        // leaving rank-1 poison that re-pushes the just-found title word
        // into topGuesses on the next guess (stuck #1 while 2-5 update).
        session.topGuesses = [];
        session.allGuesses = [];
        session.tickerBuffer = [];
        session.rankCache = new Map();
        session.canonicalCache = new Map();
      }
      io.to(roomName).emit('wikisearchle-title-word-found', {
        articleTitle: null,
        wordsRevealed: titleWordsRevealedThisGuess,
        titleWordsFound: session.titleWordsFound,
        titleWordsTotal: (session.titleWordNorms || []).length,
        rankTarget: null,
        rankTargetChanged: rankTargetFound,
        totalRankedWords: session.totalRankedWords || 0,
        by: nickname,
        user: { displayName: nickname, profilePic: user.profilePic || null, platform: user.platform || 'unknown' },
        finders: session.titleWordFinders || {},
      });
      if (rankTargetFound) {
        // Use [] literal so this broadcast is provably empty — even if
        // some race let topGuesses get repopulated after our re-clear
        // above, the wire payload here can't carry stale entries.
        io.to(roomName).emit('wikisearchle-top', []);
      }
      broadcastSessionState(session);
      if (rankTargetFound && !nextTitleWord) {
        // No remaining title word is rankable by Searchle — shouldn't happen
        // since buildNextRound validated at least one, but guard anyway.
        console.log('[WikiSearchle] no next title word rankable after find — ending round');
        endSessionRound(session, nickname);
      }
    }
  }

  // --- Forward Sassie game events (fire-and-forget, gated per-event in the monitor) ---
  // Chat Relay's generic `game-event` handler translates { game, eventName,
  // data, priority } into sassie.forwardGameEvent(). Toggles in the Sassy
  // monitor dashboard control which events actually reach the chatbot.
  // (Sassie / chat-relay game-event forwarding skipped for sessions — public-only signals.)
  

  // Save whatever state changed on this message (reveals, scores, top).
  sessionManager.scheduleSave();
}

// ==================== Solo Mode ====================
// Daily/random solo articles. The legacy weekly article still exists for
// admin compatibility, but the primary player flow is daily -> random.
const DAILY_PATH = path.join(DATA_DIR, 'daily-target.json');
const WEEKLY_PATH = path.join(DATA_DIR, 'weekly-target.json');
let dailyRound = null;
let dailyMeta = null;
let dailyPublic = null;
let dailyGenerationPromise = null;
let weeklyRound = null;
let weeklyMeta = null;
let weeklyPublic = null;  // { idToToken: Map, normToIds: Map, snapshot: {...} }
const weeklyScoreCache = new Map();
const SOLO_DAILY_MAX_ATTEMPTS = 8;
const SOLO_GUESS_RATE_CAPACITY = 10;
const SOLO_GUESS_REFILL_MS = 500;
const SOLO_GUESS_STALE_MS = 5 * 60 * 1000;
const soloGuessBuckets = new Map();

function refillSoloGuessBucket(bucket, now) {
  const elapsed = Math.max(0, now - bucket.lastRefillAt);
  if (elapsed > 0) {
    bucket.tokens = Math.min(
      SOLO_GUESS_RATE_CAPACITY,
      bucket.tokens + (elapsed / SOLO_GUESS_REFILL_MS)
    );
    bucket.lastRefillAt = now;
  }
  bucket.lastSeenAt = now;
  return bucket;
}

function soloGuessRateLimit(req, res, next) {
  const now = Date.now();
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const bucket = refillSoloGuessBucket(
    soloGuessBuckets.get(ip) || {
      tokens: SOLO_GUESS_RATE_CAPACITY,
      lastRefillAt: now,
      lastSeenAt: now,
    },
    now
  );

  if (bucket.tokens < 1) {
    const retryAfterMs = Math.ceil((1 - bucket.tokens) * SOLO_GUESS_REFILL_MS);
    const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
    soloGuessBuckets.set(ip, bucket);
    return res.status(429).json({ error: 'rate_limited', retryAfter });
  }

  bucket.tokens -= 1;
  soloGuessBuckets.set(ip, bucket);
  next();
}

const soloGuessBucketSweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of soloGuessBuckets.entries()) {
    if (now - (bucket.lastSeenAt || bucket.lastRefillAt || now) > SOLO_GUESS_STALE_MS) {
      soloGuessBuckets.delete(ip);
    }
  }
}, 60 * 1000);
if (typeof soloGuessBucketSweep.unref === 'function') soloGuessBucketSweep.unref();

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== API_SECRET) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// Parse "https://en.wikipedia.org/wiki/Polymerase_chain_reaction" → "Polymerase chain reaction".
// Accepts bare titles too ("Polymerase chain reaction") — pass-through. Throws
// on non-Wikipedia URLs so admins don't accidentally set a Wiktionary page etc.
function parseWikipediaTitle(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('missing url or title');
  if (!/^https?:\/\//i.test(raw)) {
    // Bare title — normalize underscores to spaces.
    return raw.replace(/_/g, ' ');
  }
  let u;
  try { u = new URL(raw); } catch (e) { throw new Error('not a valid URL'); }
  if (!/(^|\.)wikipedia\.org$/i.test(u.hostname)) throw new Error('not a Wikipedia URL');
  const m = u.pathname.match(/\/wiki\/([^#?]+)/);
  if (!m) throw new Error('URL path must be /wiki/<article>');
  let title;
  try { title = decodeURIComponent(m[1]); } catch (e) { title = m[1]; }
  return title.replace(/_/g, ' ');
}

async function buildRoundFromTitle(rawTitleOrUrl) {
  const wantedTitle = parseWikipediaTitle(rawTitleOrUrl);
  const poolEntry = coverage.pages[wantedTitle];
  // Source words come from the coverage pool if we have it (pre-normalized),
  // or from splitting the raw title (ad-hoc articles from pasted URLs).
  const sourceWords = (poolEntry && Array.isArray(poolEntry.titleWords) && poolEntry.titleWords.length)
    ? poolEntry.titleWords
    : stripDisambiguator(wantedTitle).split(/\s+/);
  const titleWordNorms = sourceWords.map((w) => normalize(String(w))).filter((n) => n && !STOPLIST.has(n));
  if (!titleWordNorms.length) throw new Error('no rankable title words');

  const fetched = await fetchLeadSection(wantedTitle, { maxBlocks: 50, maxChars: 15000 });
  if (!fetched) throw new Error('Wikipedia lookup failed');
  const { title, plaintext } = fetched;
  if (!plaintext || plaintext.length < 200) throw new Error('article too short (must be ≥200 chars of body text)');
  const lowerText = plaintext.toLowerCase();
  const missing = titleWordNorms.filter((n) => !new RegExp(`\\b${n}\\b`, 'i').test(lowerText));
  if (missing.length > 0) throw new Error(`title words not in body: ${missing.join(',')}`);

  let rankTarget = null, preload = null;
  for (const norm of titleWordNorms) {
    try { preload = await rankBatch(norm, []); rankTarget = norm; break; } catch (e) { /* try next */ }
  }
  if (!rankTarget) throw new Error('no rankable title word');

  // Canonical (singular/American) form for each title word — lets the guess
  // endpoint accept "indictment" as a find of the plural title "indictments",
  // matching how Searchle's own chat guesses normalize plurals.
  const titleCanonicals = {};
  try {
    const probe = await rankBatch(rankTarget, titleWordNorms);
    const canons = (probe && probe.canonicals) || {};
    for (const tn of titleWordNorms) titleCanonicals[tn] = canons[tn] || tn;
  } catch (e) {
    for (const tn of titleWordNorms) titleCanonicals[tn] = tn;
  }

  // Prefer canonical form as rankTarget so similarity is computed
  // singular-vs-singular (same as base Searchle). Fall back if canonical
  // isn't a valid Searchle target for any reason.
  const canonicalTarget = titleCanonicals[rankTarget] || rankTarget;
  if (canonicalTarget !== rankTarget) {
    try {
      preload = await rankBatch(canonicalTarget, []);
      rankTarget = canonicalTarget;
    } catch (e) { /* canonical not rankable — keep raw plural */ }
  }

  const cleanTitle = stripDisambiguator(title);
  const round = buildRound({
    targetWord: cleanTitle, articleTitle: cleanTitle,
    leadPlaintext: plaintext, targetNorms: titleWordNorms,
  });
  return {
    round,
    meta: { key: title, setAt: new Date().toISOString(), cleanTitle, plaintext, titleWordNorms, titleCanonicals, rankTarget, totalRankedWords: preload.totalRankedWords || 0 },
  };
}

function edmontonDateKey(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return `${out.year}-${out.month}-${out.day}`;
}

function soloMetaDateKey(meta) {
  if (meta && typeof meta.dateKey === 'string' && meta.dateKey) return meta.dateKey;
  return meta && meta.setAt ? edmontonDateKey(meta.setAt) : '';
}

const { createDailyArchive, validDate: validArchiveDate } = require('./lib/daily-archive');
const archiveHandle = (meta, date) => soloHandle('archive:' + date + ':' + meta.setAt + ':' + meta.cleanTitle);
const dailyArchive = createDailyArchive({
  directory: path.join(DATA_DIR, 'daily-archive'), today: edmontonDateKey,
  dateFor: soloMetaDateKey, handleFor: archiveHandle,
  warn: message => console.log('[WikiDailyArchive] ' + message),
});
const archivedSoloCache = new Map();

// Assigns stable IDs to each word token and returns (a) a public redacted
// snapshot and (b) norm → [ids] / id → token lookup maps for guess resolution.
function buildWeeklyPublic(round, meta) {
  const idToToken = new Map();
  const normToIds = new Map();
  let counter = 0;
  const addTok = (t) => {
    const id = 'w' + counter++;
    idToToken.set(id, t);
    if (!normToIds.has(t.norm)) normToIds.set(t.norm, []);
    normToIds.get(t.norm).push(id);
    return id;
  };
  const publicTitle = round.titleTokens.map((t) => {
    if (t.type !== 'word') return { type: 'space', text: t.text };
    const id = addTok(t);
    // text ONLY when the server itself seeded the token as revealed (stop
    // words, punctuation-adjacent fillers). Everything else arrives via
    // /api/solo/guess -> revealTexts once the player has actually earned it.
    const firstChar = Array.from(String(t.text || '').trim())[0] || '';
    return {
      type: 'word', id, len: t.text.length, isStop: !!t.isStop, isTitle: true,
      isNumber: !!t.isNumber, revealed: !!t.revealed,
      ...(t.revealed ? { text: t.text } : { hintLetter: firstChar, hintText: firstChar }),
    };
  });
  const publicParas = round.paragraphs.map((p) => p.map((t) => {
    if (t.type !== 'word') return { type: 'space', text: t.text, sentenceId: t.sentenceId || 0 };
    const id = addTok(t);
    return { type: 'word', id, len: t.text.length, isStop: !!t.isStop, isNumber: !!t.isNumber, digitCount: t.digitCount || 0, sentenceId: t.sentenceId || 0, revealed: !!t.revealed, ...(t.revealed ? { text: t.text } : {}) };
  }));
  return {
    idToToken, normToIds,
    snapshot: {
      setAt: meta.setAt,
      articleHandle: soloHandle(meta.cleanTitle),
      titleTokens: publicTitle,
      paragraphs: publicParas,
      titleWordCount: meta.titleWordNorms.length,
      totalRankedWords: meta.totalRankedWords,
    },
  };
}

function buildSoloEntryFromMeta(meta) {
  if (!meta || !meta.cleanTitle || !meta.plaintext || !Array.isArray(meta.titleWordNorms)) {
    throw new Error('malformed');
  }
  const round = buildRound({
    targetWord: meta.cleanTitle, articleTitle: meta.cleanTitle,
    leadPlaintext: meta.plaintext, targetNorms: meta.titleWordNorms,
  });
  return { round, meta, public: buildWeeklyPublic(round, meta) };
}

async function buildSoloEntryFromTitle(title, mode) {
  const built = await buildRoundFromTitle(title);
  if (mode) built.meta.mode = mode;
  if (mode === 'daily') built.meta.dateKey = edmontonDateKey(built.meta.setAt);
  return {
    round: built.round,
    meta: built.meta,
    public: buildWeeklyPublic(built.round, built.meta),
  };
}

function saveDaily(meta) {
  try {
    const tmp = DAILY_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, DAILY_PATH);
    try { dailyArchive.remember(meta); } catch (_) { console.log('[WikiDailyArchive] Current snapshot could not be retained'); }
  } catch (e) { console.log(`[WikiSearchle-Solo] daily save failed: ${e.message}`); }
}

function loadDaily() {
  try {
    const meta = JSON.parse(fs.readFileSync(DAILY_PATH, 'utf-8'));
    const entry = buildSoloEntryFromMeta(meta);
    dailyRound = entry.round; dailyMeta = entry.meta; dailyPublic = entry.public;
    try { dailyArchive.remember(meta); } catch (_) { console.log('[WikiDailyArchive] Current snapshot could not be retained'); }
    console.log(`[WikiSearchle-Solo] Daily target loaded: "${meta.cleanTitle}" (${soloMetaDateKey(meta) || 'undated'})`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle-Solo] daily load failed: ${e.message}`);
    dailyRound = null; dailyMeta = null; dailyPublic = null;
  }
}

async function generateDailyTarget() {
  if (!playablePool.length) throw new Error('no playable pool');
  let lastErr = null;
  for (let i = 0; i < SOLO_DAILY_MAX_ATTEMPTS; i++) {
    const title = playablePool[Math.floor(Math.random() * playablePool.length)];
    try {
      const entry = await buildSoloEntryFromTitle(title, 'daily');
      saveDaily(entry.meta);
      dailyRound = entry.round; dailyMeta = entry.meta; dailyPublic = entry.public;
      console.log(`[WikiSearchle-Solo] Daily target set: "${entry.meta.cleanTitle}" (${soloMetaDateKey(entry.meta)})`);
      return entry;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`daily build failed after retries: ${lastErr && lastErr.message}`);
}

async function ensureDailyTarget() {
  const today = edmontonDateKey();
  if (dailyRound && dailyMeta && dailyPublic && soloMetaDateKey(dailyMeta) === today) return true;
  if (!dailyGenerationPromise) {
    dailyGenerationPromise = generateDailyTarget()
      .then(() => true)
      .catch((e) => {
        console.log(`[WikiSearchle-Solo] daily generation failed: ${e.message}`);
        return false;
      })
      .finally(() => { dailyGenerationPromise = null; });
  }
  return dailyGenerationPromise;
}

function saveWeekly(meta) {
  try {
    const tmp = WEEKLY_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, WEEKLY_PATH);
  } catch (e) { console.log(`[WikiSearchle-Solo] weekly save failed: ${e.message}`); }
}
function loadWeekly() {
  try {
    const meta = JSON.parse(fs.readFileSync(WEEKLY_PATH, 'utf-8'));
    const entry = buildSoloEntryFromMeta(meta);
    weeklyRound = entry.round; weeklyMeta = entry.meta; weeklyPublic = entry.public;
    console.log(`[WikiSearchle-Solo] Weekly target loaded: "${meta.cleanTitle}" (set ${meta.setAt})`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[WikiSearchle-Solo] weekly load failed: ${e.message}`);
    weeklyRound = null; weeklyMeta = null; weeklyPublic = null;
  }
}

async function scoreWordSolo(norm) {
  if (weeklyScoreCache.has(norm)) return weeklyScoreCache.get(norm);
  try {
    const res = await fetch(`${CHAT_RELAY_URL}/api/word-bank/validate/${encodeURIComponent(norm)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const zipf = typeof data.zipf === 'number' ? data.zipf : null;
    let base;
    if (zipf === null) base = WORD_RARITY_BASE.unknown;
    else if (zipf >= 4) base = WORD_RARITY_BASE.common;
    else if (zipf >= 3) base = WORD_RARITY_BASE.uncommon;
    else if (zipf >= 2) base = WORD_RARITY_BASE.rare;
    else base = WORD_RARITY_BASE.ultra;
    const letterBonus = (Number(data.letterRarityScore) || 0) * LETTER_BONUS_MULTIPLIER;
    const lengthBonus = Number(data.wordLengthBonus) || 0;
    const total = base + letterBonus + lengthBonus;
    const result = { total, base, letterBonus, lengthBonus, zipf };
    weeklyScoreCache.set(norm, result);
    return result;
  } catch (e) {
    return { total: POINTS_PER_FIND_FALLBACK, base: POINTS_PER_FIND_FALLBACK, letterBonus: 0, lengthBonus: 0, zipf: null, fallback: true };
  }
}

// Per-article cache for "random" solo rounds. Daily/weekly targets live in
// their own globals. Random articles are built on-demand from the MP playable
// pool and cached here so subsequent guesses against the same article hit the
// cache instead of refetching Wikipedia.
const SOLO_RANDOM_CACHE_MAX = 200;
const soloRandomCache = new Map(); // cleanTitle → { round, meta, public }
function cacheRandomRound(entry) {
  const key = entry.meta.cleanTitle;
  if (soloRandomCache.has(key)) {
    // Touch — re-insert at end so FIFO eviction prefers stale entries.
    soloRandomCache.delete(key);
  } else if (soloRandomCache.size >= SOLO_RANDOM_CACHE_MAX) {
    const oldest = soloRandomCache.keys().next().value;
    soloRandomCache.delete(oldest);
  }
  soloRandomCache.set(key, entry);
}

const { createSoloRewardProof, createSoloRewardClaims } = require('./lib/solo-reward-proof');
const soloRewardProof = createSoloRewardProof(API_SECRET);
const soloRewardClaims = createSoloRewardClaims(path.join(__dirname, 'data', 'solo-reward-claims.json'));
const { createSoloRewardDelivery } = require('./lib/solo-reward-delivery');
const soloRewardDelivery = createSoloRewardDelivery({ shared: gameShared, legacy: soloRewardClaims,
  dailyCompleted: async (userId, date) => {
    const response = await fetch(`${CHAT_RELAY_URL}/api/sp-daily/status/wikisearchle-sp/${encodeURIComponent(userId)}`, { signal: AbortSignal.timeout(5000) });
    const status = response.ok ? await response.json() : null;
    if (!status?.ok || status._fallback || !Array.isArray(status.completedDates)) throw Object.assign(Error('Canonical completion status unavailable'), { retryable: true });
    return status.completedDates.includes(date);
  }
});
console.log('[WikiSoloRewards] Durable completion delivery enabled');
function rewardEntry(entry) {
  return { ...entry, meta: { ...entry.meta, dateKey: soloMetaDateKey(entry.meta) } };
}


function soloEntry(round, meta, publicEntry, mode) {
  return {
    round,
    meta,
    public: publicEntry,
    mode,
    isDaily: mode === 'daily',
    isWeekly: mode === 'weekly',
  };
}

async function soloRewardStatus(userId, meta, mode) {
  if (!meta) return { completed: false };
  return soloRewardDelivery.status(userId, rewardEntry({ meta, mode, isDaily: mode === 'daily', isWeekly: mode === 'weekly' }));
}

// Resolves the round/meta/public to use for a guess or complete request.
// An empty reference prefers daily; opaque handles select daily, weekly or
// a cached random article without accepting the hidden answer as a selector.
function getSoloEntryForTitle(articleRef) {
  const wanted = articleRef ? String(articleRef).trim() : '';
  if (!wanted) {
    if (dailyRound && dailyMeta && dailyPublic) return soloEntry(dailyRound, dailyMeta, dailyPublic, 'daily');
    if (weeklyRound && weeklyMeta && weeklyPublic) return soloEntry(weeklyRound, weeklyMeta, weeklyPublic, 'weekly');
    return null;
  }
  // Accept only opaque handles. Raw-title matching creates an online oracle:
  // different success/failure responses disclose whether a title is active.
  if (!/^[a-f0-9]{24}$/.test(wanted)) return null;
  const archived = dailyArchive.byHandle(wanted);
  if (archived) return buildArchivedEntry(archived.meta, archived.dateKey);
  const matches = (cleanTitle) => cleanTitle && wanted === soloHandle(cleanTitle);
  if (dailyMeta && matches(dailyMeta.cleanTitle)) {
    return soloEntry(dailyRound, dailyMeta, dailyPublic, 'daily');
  }
  if (weeklyMeta && matches(weeklyMeta.cleanTitle)) {
    return soloEntry(weeklyRound, weeklyMeta, weeklyPublic, 'weekly');
  }
  for (const [cleanTitle, cached] of soloRandomCache) {
    if (matches(cleanTitle)) return { ...cached, mode: 'random', isDaily: false, isWeekly: false };
  }
  return null;
}

function buildArchivedEntry(meta, date) {
  const handle = archiveHandle(meta, date);
  if (archivedSoloCache.has(handle)) return archivedSoloCache.get(handle);
  const entry = buildSoloEntryFromMeta(meta);
  entry.public.snapshot = { ...entry.public.snapshot, articleHandle: handle,
    setAt: 'archive:' + date + ':' + meta.setAt, dateKey: date };
  const archived = { ...entry, mode: 'archive', isArchive: true, isDaily: false, isWeekly: false };
  if (archivedSoloCache.size >= 128) archivedSoloCache.delete(archivedSoloCache.keys().next().value);
  archivedSoloCache.set(handle, archived);
  return archived;
}

// Public solo endpoints
app.get('/api/solo/archive', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const before = req.query.before;
  if (before && !validArchiveDate(before)) return res.status(400).json({ error: 'invalid_date' });
  const dates = dailyArchive.list(before);
  const puzzles = dates.slice(0, 50);
  res.json({ today: edmontonDateKey(), puzzles, hasMore: dates.length > 50,
    nextBefore: dates.length > 50 ? puzzles[puzzles.length - 1].dateKey : null });
});

app.get('/api/solo/archive/:date', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const date = req.params.date;
  if (!validArchiveDate(date)) return res.status(400).json({ error: 'invalid_date' });
  const meta = dailyArchive.get(date);
  if (!meta) return res.status(404).json({ available: false });
  const entry = buildArchivedEntry(meta, date);
  res.json({ available: true, mode: 'archive', isArchive: true, isDaily: false, isWeekly: false, ...entry.public.snapshot });
});

app.get('/api/solo/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await ensureDailyTarget();
    const verifiedAccountId = await resolveUserFromCookie(req);
    res.json({
      daily: {
        available: !!(dailyPublic && dailyMeta),
        ...(await soloRewardStatus(verifiedAccountId, dailyMeta, 'daily')),
        articleHandle: dailyMeta ? soloHandle(dailyMeta.cleanTitle) : null,
        dateKey: soloMetaDateKey(dailyMeta),
        setAt: dailyMeta ? dailyMeta.setAt : null,
      },
      weekly: {
        available: !!(weeklyPublic && weeklyMeta),
        ...(await soloRewardStatus(verifiedAccountId, weeklyMeta, 'weekly')),
        articleHandle: weeklyMeta ? soloHandle(weeklyMeta.cleanTitle) : null,
        setAt: weeklyMeta ? weeklyMeta.setAt : null,
      },
      random: { available: playablePool.length > 0, completed: false },
    });
  } catch (e) {
    console.log(`[WikiSearchle-Solo] /api/solo/status error: ${e.message}`);
    res.status(500).json({ ok: false, error: 'status failed' });
  }
});

app.get('/api/solo/daily', async (req, res) => {
  try {
    await ensureDailyTarget();
    if (!dailyPublic || !dailyMeta) return res.json({ available: false });
    res.json({
      available: true,
      mode: 'daily',
      isDaily: true,
      isWeekly: false,
      dateKey: soloMetaDateKey(dailyMeta),
      ...dailyPublic.snapshot,
    });
  } catch (e) {
    console.log(`[WikiSearchle-Solo] /api/solo/daily error: ${e.message}`);
    res.status(500).json({ ok: false, error: 'daily failed' });
  }
});

app.get('/api/solo/weekly', (req, res) => {
  if (!weeklyPublic || !weeklyMeta) return res.json({ available: false });
  res.json({ available: true, mode: 'weekly', isDaily: false, isWeekly: true, ...weeklyPublic.snapshot });
});

// Draw the next article from Solo Random's persisted no-repeat deck, build a
// round on-demand, cache it, and return the same snapshot shape as /weekly.
// Up to 5 retries in case an article fails to build (Wikipedia 404, body too
// short, etc.); failed picks are still consumed for this cycle so they cannot
// become a tiny retry loop.
app.get('/api/solo/random', async (req, res) => {
  try {
    if (!playablePool.length) return res.status(503).json({ ok: false, error: 'no playable pool' });
    let lastErr = null;
    for (let i = 0; i < 5; i++) {
      const title = drawNextSoloRandomTitle();
      if (!title) break;
      try {
        const built = await buildSoloEntryFromTitle(title, 'random');
        cacheRandomRound(built);
        return res.json({
          available: true,
          mode: 'random',
          isDaily: false,
          isWeekly: false,
          ...built.public.snapshot,
        });
      } catch (e) { lastErr = e; }
    }
    res.status(502).json({ ok: false, error: 'random build failed after retries' });
  } catch (e) {
    console.log(`[WikiSearchle-Solo] /api/solo/random error: ${e.message}`);
    res.status(500).json({ ok: false, error: 'random pick failed' });
  }
});

// Body: { word, foundTitleNorms?: [] } — foundTitleNorms advances rankTarget
// past the title words the client has already found so ranks track the next
// unrevealed title word.
app.post('/api/solo/guess', soloGuessRateLimit, async (req, res) => {
  try {
    // Empty references fall back to daily. Nonempty references must be opaque
    // handles for a loaded daily/weekly or cached random article.
    const sr = getSoloEntryForTitle(req.body && (req.body.articleHandle || req.body.articleTitle));
    const verifiedAccountId = await resolveUserFromCookie(req);
    if (!sr) return res.status(503).json({ error: 'no target' });
    // Premium gate: unlimited (random-article) solo requires Donor Class;
    // the daily and weekly puzzles stay free.
    if (!sr.isDaily && !sr.isWeekly && !sr.isArchive) {
      const identity = (req.body && req.body.identity) || {};
      const puid = verifiedAccountId || '';
      if (!puid || !(await isPremiumWebUser(puid))) {
        return res.status(402).json({ error: 'premium-required', premiumRequired: true, loggedIn: !!puid });
      }
    }
    const { round: spRound, meta: spMeta, public: spPublic } = sr;
    const raw = String(req.body && req.body.word || '').trim();
    if (!raw) return res.status(400).json({ error: 'missing word' });
    const generation = sr.mode + ':' + spMeta.setAt;
    let rewardProgress = null;
    if (verifiedAccountId && (sr.isDaily || sr.isWeekly)) {
      rewardProgress = req.body.progressProof ? soloRewardProof.read(req.body.progressProof, verifiedAccountId, generation) : soloRewardProof.fresh(verifiedAccountId, generation);
      if (!rewardProgress) return res.status(409).json({ error: 'progress_mismatch' });
    }
    const found = rewardProgress ? rewardProgress.titles : (Array.isArray(req.body.foundTitleNorms) ? req.body.foundTitleNorms : []);

    const norm = normalize(raw);
    if (!norm) return res.json({ word: raw, norm: '', rank: null, revealIds: [], points: 0, tier: 'common', isTitleWord: false });

    const remaining = spMeta.titleWordNorms.filter((n) => !found.includes(n));
    const nextTitleNorm = remaining[0] || spMeta.titleWordNorms[0];
    // Use canonical (singular) form as the actual Searchle target so
    // rankings are computed singular-vs-singular. titleWordNorms keeps the
    // raw plural for title-match bookkeeping.
    const titleCanons = spMeta.titleCanonicals || {};
    const rankTarget = titleCanons[nextTitleNorm] || nextTitleNorm;

    let rank = null;
    let canonical = norm;
    try {
      const batch = await rankBatch(rankTarget, [norm]);
      const ranks = (batch && batch.ranks) || {};
      const canons = (batch && batch.canonicals) || {};
      if (typeof ranks[norm] === 'number') {
        rank = ranks[norm];
        canonical = canons[norm] || norm;
      }
    } catch (e) { /* rank lookup failed — treat as miss */ }

    // Title match: exact raw norm, or canonical equivalence so "indictment"
    // (singular) counts as finding "indictments" (plural title word). Returns
    // the matched TITLE norm so the client pushes the right value to
    // foundTitleNorms, letting rankTarget advance correctly.
    let matchedTitleNorm = null;
    if (spMeta.titleWordNorms.includes(norm) && !found.includes(norm)) {
      matchedTitleNorm = norm;
    } else if (canonical) {
      const titleCanons = spMeta.titleCanonicals || {};
      for (const tn of spMeta.titleWordNorms) {
        if (found.includes(tn) || tn === norm) continue;
        if ((titleCanons[tn] || tn) === canonical) { matchedTitleNorm = tn; break; }
      }
    }
    const isTitleWord = !!matchedTitleNorm;

    // Reveal union: raw norm's tokens + (if canonical-matched) the title
    // norm's tokens, so typing the singular reveals the plural title + body
    // instances too.
    const revealSet = new Set(spPublic.normToIds.get(norm) || []);
    if (matchedTitleNorm && matchedTitleNorm !== norm) {
      for (const id of (spPublic.normToIds.get(matchedTitleNorm) || [])) revealSet.add(id);
    }
    const revealIds = Array.from(revealSet);

    const titleFindIndex = isTitleWord ? found.length : -1;
    const titleBonus = titleWordBonus(titleFindIndex);

    let points = 0, tier = 'common', digitCount = 0, isNumber = false;
    if (revealIds.length > 0) {
      const firstTok = spPublic.idToToken.get(revealIds[0]);
      isNumber = !!firstTok.isNumber;
      digitCount = firstTok.digitCount || 0;
      if (isNumber) {
        points = scoreNumber(digitCount);
        tier = digitCount >= 4 ? 'rare' : digitCount >= 2 ? 'uncommon' : 'common';
      } else {
        const s = await scoreWordSolo(norm);
        points = s.total;
        tier = rankTier(rank);
      }
      points += titleBonus;
    }

    // Library credit for logged-in players — mirrors MP 'hit' credit. Only
    // words that actually reveal something in the article count; misses and
    // number tokens don't enter the library.
    const ident = verifiedAccountId ? { platform: 'discord', platformUserId: verifiedAccountId, username: verifiedAccountId } : null;
    if (ident && !sr.isArchive && revealIds.length > 0 && !isNumber) {
      const pfm = String(ident.platform || '').trim().toLowerCase();
      const puid = String(ident.platformUserId || '').trim();
      if (pfm && /^[a-z]{1,16}$/.test(pfm) && puid && puid.length <= 64) {
        const uname = String(ident.username || '').trim().slice(0, 48) || null;
        const dname = String(ident.displayName || uname || 'player').trim().slice(0, 48);
        // Credit the raw guessed norm; if canonical-matched to a plural title
        // word, also credit the title norm so "indictment"/"indictments" both
        // enter the library as the article word.
        const creditWords = new Set([norm]);
        if (matchedTitleNorm && matchedTitleNorm !== norm) creditWords.add(matchedTitleNorm);
        for (const w of creditWords) {
          gameShared.reportLibraryWord(pfm, puid, w, 'wikisearchle', uname || dname, dname, null);
        }
      }
    }

    // The snapshot no longer carries unrevealed text, so ship the text for
    // exactly the tokens this guess earned. Nothing else is disclosed.
    const revealTexts = {};
    for (const id of revealIds) {
      const tok = spPublic.idToToken.get(id);
      if (tok && typeof tok.text === 'string') revealTexts[id] = tok.text;
    }
    const progressProof = rewardProgress ? soloRewardProof.advance(rewardProgress, { revealIds, titleNorm: matchedTitleNorm, points }).token : null;
    res.json({ word: raw, norm, canonical, titleNorm: matchedTitleNorm, rank, revealIds, revealTexts, points, tier, isTitleWord, titleBonus, isNumber, digitCount, titleWordCount: spMeta.titleWordNorms.length, progressProof });
  } catch (e) {
    console.log(`[WikiSearchle-Solo] /api/solo/guess error: ${e.message}`);
    res.status(500).json({ error: 'guess processing failed' });
  }
});

// Called by the solo client once the user has revealed every title word.
// Daily/weekly award coins equal to the XP earned via gameShared.rewardPlayer.
// Random articles are acknowledged without a coin reward.
app.post('/api/solo/complete', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const body = req.body || {};
    const sr = getSoloEntryForTitle(body.articleHandle || body.articleTitle);
    if (!sr) return res.status(503).json({ ok: false, error: 'no target' });
    if (!sr.isDaily && !sr.isWeekly) {
      return res.json({ ok: true, alreadyRedeemed: false, coins: 0, mode: sr.mode, isDaily: false, isWeekly: false });
    }

    const userId = await resolveUserFromCookie(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'auth_required' });
    if (sr.isDaily && soloMetaDateKey(sr.meta) !== edmontonDateKey())
      return res.status(409).json({ ok: false, error: 'obsolete_puzzle' });
    const progress = soloRewardProof.read(body.progressProof, userId, sr.mode + ':' + sr.meta.setAt);
    if (!progress || !sr.meta.titleWordNorms.every(norm => progress.titles.includes(norm)))
      return res.status(400).json({ ok: false, error: 'solve_required' });
    const score = Math.min(1000000, progress.score);
    const guessCount = progress.guessCount;
    if (!Number.isSafeInteger(score) || score <= 0) return res.status(400).json({ ok: false, error: 'invalid_reward' });

    const result = await soloRewardDelivery.claim(String(userId), rewardEntry(sr), score, guessCount);
    res.json(result);
  } catch (e) {
    console.log(`[WikiSearchle-Solo] /api/solo/complete error: ${e.message}`);
    res.status(e.retryable ? 503 : 500).json({ ok: false, error: e.retryable ? 'completion_status_unavailable' : 'complete failed' });
  }
});

// Admin endpoints — gated by x-admin-key = GAME_API_SECRET
app.get('/api/solo/admin/current', requireAdmin, (req, res) => {
  if (!weeklyMeta) return res.json({ set: false });
  res.json({
    set: true,
    key: weeklyMeta.key, setAt: weeklyMeta.setAt,
    cleanTitle: weeklyMeta.cleanTitle,
    titleWordNorms: weeklyMeta.titleWordNorms,
    titleWordCount: weeklyMeta.titleWordNorms.length,
  });
});
app.get('/api/solo/admin/search', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
  if (!q) return res.json({ results: [] });
  const results = [];
  for (const key of playablePool) {
    if (key.toLowerCase().includes(q)) {
      const entry = coverage.pages[key];
      results.push({ key, title: entry.title || key, titleWordCount: (entry.titleWords || []).length || 1 });
      if (results.length >= limit) break;
    }
  }
  res.json({ results });
});
app.post('/api/solo/admin/set-weekly', requireAdmin, async (req, res) => {
  const input = String((req.body && (req.body.url || req.body.key)) || '').trim();
  if (!input) return res.status(400).json({ error: 'missing url or key' });
  try {
    const { round, meta } = await buildRoundFromTitle(input);
    saveWeekly(meta);
    weeklyRound = round; weeklyMeta = meta;
    weeklyPublic = buildWeeklyPublic(round, meta);
    weeklyScoreCache.clear();
    console.log(`[WikiSearchle-Solo] Weekly target set: "${meta.cleanTitle}" (${meta.titleWordNorms.length} title words)`);
    res.json({ ok: true, cleanTitle: meta.cleanTitle, titleWordCount: meta.titleWordNorms.length, setAt: meta.setAt });
  } catch (e) {
    console.log(`[WikiSearchle-Solo] set-weekly failed: ${e.message}`);
    res.status(400).json({ error: e.message });
  }
});

loadDaily();
loadWeekly();

// --- HTTP API ---
// Per-platform cosmetics proxy — clients fetch a finder's equipped cosmetics
// (hero_badge, profile_border, etc.) so cards/podium/word-announce can render
// them on demand when the chat-relay piggyback is missing or stale. Mirrors
// /opt/wikirectangled/server.js's /api/cosmetics/:platform/:userId endpoint.
app.get('/api/cosmetics/:platform/:userId', async (req, res) => {
  try {
    let { platform, userId } = req.params;
    if (platform === 'web') platform = 'discord';
    const cosmetics = await gameShared.getPlayerCosmetics(platform, userId);
    res.json({ equipped: cosmetics || {} });
  } catch (e) {
    res.json({ equipped: {} });
  }
});

app.get('/api/state', (req, res) => {
  const sh = typeof req.query.session === 'string' ? req.query.session.toLowerCase().trim() : '';
  if (sh && /^[a-z0-9_-]{1,32}$/.test(sh)) {
    const sess = sessionManager.getSession(sh);
    if (!sess) return res.json({ error: 'No active session', isSession: true });
    return res.json(_wikisearchleSessionStateSnapshot(sess) || {});
  }
  res.json(wikisearchleStateSnapshot() || {});
});

// ── Monthly hint allowance (Donor / Super Fan perk) ─────────────────────
function getActiveRound(handle) {
  const round = handle && handle !== 'public' ? sessionManager.getSession(handle) : currentRound;
  return round && !round.won ? round : null;
}
function hintRoundWord(round) { return JSON.stringify([round.articleTitle, round.targetWord, round.rewardRoundId || null]); }
function getHintRound(handle) {
  const round = getActiveRound(handle);
  return round ? { startTime: round.startTime, state: { ...round, word: hintRoundWord(round), gameOver: !!round.won } } : null;
}
function candidatesForTitle(state) {
  if (!state || state.won) return [];
  const candidates = [], seen = new Set();let position = 0;
  const display = serializeRound(state).titleTokens;
  for (const token of state.titleTokens || []) {
    if (token.type !== 'word') continue;
    position++;
    if (token.isSkipped || token.revealed || !state.targetNormSet?.has(token.norm) || STOPLIST.has(token.norm) || seen.has(token.norm)) continue;
    seen.add(token.norm);
    const displayPosition = display.findIndex(entry => entry.targetSlotId === state.targetSlotIds?.get(token.norm));
    candidates.push({ type: 'title_word', word: token.text, norm: token.norm, position: displayPosition < 0 ? position : displayPosition + 1 });
  }
  return candidates;
}

function applyHintToState(state, hint) {
  if (!state || !hint || !hint.norm) return false;
  const norm = hint.norm;
  let token = null;
  for (const t of (state.titleTokens || [])) {
    if (t.type === 'word' && t.norm === norm) { token = t; break; }
  }
  if (!token) return false;
  if (!token.revealed) {
    token.revealed = true;
    state.titleWordsFound = (state.titleWordsFound || 0) + 1;
    state.revealed.add(norm);
    if (state.foundTitleNorms) state.foundTitleNorms.add(norm);
    const sid = state.targetSlotIds && state.targetSlotIds.get(norm);
    if (sid && state.foundSlotIds) state.foundSlotIds.add(sid);
    const tokens = state.wordIndex && state.wordIndex.get(norm);
    if (tokens) {
      for (const tt of tokens) {
        if (tt.isHiddenTarget) continue;
        if (!tt.revealed) { tt.revealed = true; state.revealedCount = (state.revealedCount || 0) + 1; }
      }
    }
  }
  return true;
}

app.get('/api/hints/remaining', async (req, res) => {
  const discordId = await resolveUserFromCookie(req);
  if (!discordId) return res.json({ ok: true, remaining: 0 });
  try {
    const r = await fetch(`${CHAT_RELAY_URL}/api/public/hints?discordId=${encodeURIComponent(discordId)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[WikiSearchle] hints remaining failed:', e.message);
    res.status(500).json({ ok: false, error: 'lookup_failed' });
  }
});

const hintJournal = createHintJournal({ file: path.join(__dirname, 'data', 'hint-applications.json') });
async function hintRelay(route, body) {
  const response = await fetch(CHAT_RELAY_URL + route, { method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_SECRET }, body: JSON.stringify(body) });
  if (!response.ok) throw Error('Hint transaction unavailable');
  return response.json();
}
const transactionalHints = createTransactionalHintHandler({
  resolveUser: async req => req._hintVerifiedAccount, secret: process.env.HINT_ROUND_ID_SECRET, gameId: 'wikisearchle',
  getRound: getHintRound, candidateBuilder: candidatesForTitle, relay: hintRelay,
  beforeDelivery: (purchase, identity) => hintJournal.reserve(identity, purchase),
  onDelivered: async (purchase, identity) => {
    const record = hintJournal.reserve(identity, purchase);
    if (record.state === 'done') return;
    hintJournal.mark(identity, 'confirmed');
    const round = getActiveRound(purchase.handle), key = round && require('crypto').createHmac('sha256', process.env.HINT_ROUND_ID_SECRET)
      .update(JSON.stringify(['wikisearchle', purchase.handle, round.startTime, hintRoundWord(round)])).digest('hex');
    if (!round || round.startTime !== purchase.startTime || key !== purchase.roundKey) { hintJournal.mark(identity, 'done'); return; }
    if (!applyHintToState(round, purchase.hint)) throw Error('Hint application target unavailable');
    if (round.sessionHandle) sessionManager.saveImmediate(true); else saveState(true);
    // Persist the reveal before any broadcast/finalization can expose it.
    if (roundNeedsCompletion(round)) finishCompletedRound(round);
    else if (round.rankTargetTitleNorm === purchase.hint.norm) {
      round.topGuesses = []; round.rankCache = new Map(); round.canonicalCache = new Map();
      await advanceRankTargetToNextTitleWord(round);
    }
    if (!isCurrentRound(round)) { hintJournal.mark(identity, 'done'); return; }
    if (round.sessionHandle) sessionManager.saveImmediate(true); else saveState(true);
    hintJournal.mark(identity, 'done');
    if (round.sessionHandle) broadcastSessionState(round); else broadcastState();
  },
});
async function runHintRequest(req, res) {
  const handle = String(req.body?.handle || 'public').trim().toLowerCase(), round = getActiveRound(handle);
  if (!round) return transactionalHints(req, res);
  const result = await roundActions.run(round, () => transactionalHints(req, res));
  if (result?.skipped) {
    if (result.busy) return res.status(503).json({ ok: false, error: 'hint_retry_required' });
    return transactionalHints(req, res);
  }
  return result;
}
app.post('/api/hints/use', async (req, res) => {
  const account = await resolveUserFromCookie(req);
  if (!account) return res.status(401).json({ ok: false, error: 'auth_required' });
  req._hintVerifiedAccount = account;
  try { return await runHintRequest(req, res); }
  catch (_) { return res.status(503).json({ ok: false, error: 'hint_retry_required' }); }
});
let hintRecoveryRunning = false;
const hintRecoveryTimer = setInterval(async () => {
  if (hintRecoveryRunning) return;
  hintRecoveryRunning = true;
  try {
    for (const record of hintJournal.pending()) {
      const req = { _hintVerifiedAccount: record.identity.discordId, body: { actionId: record.identity.actionId,
        handle: record.purchase.handle, expectedStartTime: record.purchase.startTime, recoverOnly: true } };
      const response = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.value = value; return this; } };
      await runHintRequest(req, response);
      if (response.statusCode === 200 && response.value && !response.value.ok && ['cancelled', 'closed'].includes(response.value.deliveryStatus)) hintJournal.mark(record.identity, 'done');
    }
  } catch (_) { console.warn('[WikiHints] Application recovery retained for retry'); }
  finally { hintRecoveryRunning = false; }
}, 30000);
hintRecoveryTimer.unref();

app.get('/api/player-stats/:key', (req, res) => {
  const key = String(req.params.key || '').toLowerCase();
  if (!key) return res.status(400).json({ error: 'missing key' });
  const stats = playerStatsLifetime[key];
  let currentRoundStats = null;
  if (currentRound && currentRound.playerStats && currentRound.playerStats[key]) {
    const cp = currentRound.playerStats[key];
    // SECURITY: do NOT include articleTitle / targetWord while the round is
    // still active — exposing them via the public stats popup let any
    // viewer click someone's stats to reveal the active target.
    // Lifetime stats below are populated only at round end so they're safe.
    const roundOver = !!currentRound.won;
    currentRoundStats = {
      points: cp.points || 0,
      articleTitle: roundOver ? (currentRound.articleTitle || null) : null,
      targetWord: roundOver ? (currentRound.targetWord || null) : null,
    };
  }
  if (!stats && !currentRoundStats) return res.status(404).json({ error: 'not found' });
  res.json({
    lifetime: stats || null,
    currentRound: currentRoundStats,
  });
});
app.get('/api/internal/account-stats/:identityKey', (req, res) => {
  if (req.headers['x-api-key'] !== API_SECRET) {
    return res.status(403).json({ ok: false, error: 'Unauthorized' });
  }
  const identityKey = normalizeAccountIdentity(req.params.identityKey);
  if (!identityKey) {
    return res.status(400).json({ ok: false, error: 'missing identityKey' });
  }
  const stats = getAccountLifetimeStats(identityKey);
  res.json({
    ok: true,
    identityKey,
    totalPoints: Number(stats && stats.totalPoints || 0),
    roundsPlayed: Number(stats && stats.roundsPlayed || 0),
    roundsWon: Number(stats && stats.roundsWon || 0),
    targetFinds: Number(stats && stats.targetFinds || 0),
    totalTitleWordsFound: Number(stats && stats.totalTitleWordsFound || 0),
    totalWordsFound: Number(stats && stats.totalWordsFound || 0),
    totalGuesses: Number(stats && stats.totalGuesses || 0),
    lastSeen: Number(stats && stats.lastSeen || 0),
    matchedPlayers: Number(stats && stats.matchedPlayers || 0),
  });
});
app.get('/api/debug/sockets', requireAdmin, (req, res) => {
  const sockets = [];
  io.of('/').sockets.forEach((socket) => {
    sockets.push({
      id: socket.id,
      ip: gameShared.getClientIP(socket) || 'unknown',
      userAgent: socket.handshake.headers['user-agent'],
    });
  });
  res.json({ count: sockets.length, sockets });
});

// --- Public ELO leaderboard ---
app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
  const sort = req.query.sort || 'elo';
  const entries = Object.entries(eloRatings)
    .filter(([, e]) => (e.roundsCounted || 0) >= 5)
    .map(([identityKey, e]) => {
      const matches = getAllStatsForIdentity(identityKey);
      const primary = matches[0] || {};
      return {
        identityKey,
        nickname: primary.nickname || identityKey,
        elo: e.elo,
        roundsCounted: e.roundsCounted,
        totalPoints: primary.totalPoints || 0,
        roundsPlayed: primary.roundsPlayed || 0,
        roundsWon: primary.roundsWon || 0,
      };
    });

  if (sort === 'points') entries.sort((a, b) => b.totalPoints - a.totalPoints);
  else if (sort === 'wins') entries.sort((a, b) => b.roundsWon - a.roundsWon);
  else entries.sort((a, b) => b.elo - a.elo);

  const players = entries.slice(0, limit).map((e, i) => ({ rank: i + 1, ...e }));
  res.json({ count: players.length, players });
});

// --- Word Tycoon ELO proxy (canonical source) ---
app.get('/api/elo/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
    const wtRes = await fetch(`${WORD_EMPIRES_URL}/api/elo/wikisearchle/leaderboard?limit=${limit}&minRounds=5`, {
      headers: { 'x-api-key': API_SECRET }
    });
    if (!wtRes.ok) throw new Error('WT ' + wtRes.status);
    const data = await wtRes.json();
    res.json(data);
  } catch (e) {
    // Fallback to local in-memory ELO if WT is unreachable
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
    const entries = Object.entries(eloRatings)
      .filter(([, e]) => (e.roundsCounted || 0) >= 5)
      .sort((a, b) => b[1].elo - a[1].elo)
      .slice(0, limit)
      .map(([identityKey, e], i) => {
        const matches = getAllStatsForIdentity(identityKey);
        const primary = matches[0] || {};
        return { rank: i + 1, identityKey, nickname: primary.nickname || identityKey, elo: e.elo, roundsCounted: e.roundsCounted };
      });
    res.json({ ok: true, leaderboard: entries, fallback: true });
  }
});

// --- Admin endpoints ---
app.get('/api/admin/leaderboard', requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
  const sort = req.query.sort || 'elo';
  const entries = Object.entries(eloRatings)
    .map(([identityKey, e]) => {
      const matches = getAllStatsForIdentity(identityKey);
      const primary = matches[0] || {};
      const suspicion = suspicionScores[identityKey] || { score: 0, flags: [], flagged: null };
      return {
        identityKey,
        nickname: primary.nickname || identityKey,
        platformUserId: primary.user?.platformUserId || null,
        elo: e.elo,
        roundsCounted: e.roundsCounted,
        totalPoints: primary.totalPoints || 0,
        roundsPlayed: primary.roundsPlayed || 0,
        roundsWon: primary.roundsWon || 0,
        suspicionScore: suspicion.score,
        flagged: suspicion.flagged,
        suspicionFlags: suspicion.flags,
      };
    });

  if (sort === 'points') entries.sort((a, b) => b.totalPoints - a.totalPoints);
  else if (sort === 'wins') entries.sort((a, b) => b.roundsWon - a.roundsWon);
  else entries.sort((a, b) => b.elo - a.elo);

  const players = entries.slice(0, limit).map((e, i) => ({ rank: i + 1, ...e }));
  res.json({ count: players.length, players });
});

app.get('/api/admin/cheaters', requireAdmin, (req, res) => {
  const minScore = Math.max(0, parseInt(req.query.minScore || '50', 10));
  const entries = Object.entries(suspicionScores)
    .filter(([, s]) => (s.score || 0) >= minScore)
    .map(([identityKey, s]) => {
      const matches = getAllStatsForIdentity(identityKey);
      const primary = matches[0] || {};
      return {
        identityKey,
        nickname: primary.nickname || identityKey,
        suspicionScore: s.score,
        flagged: s.flagged,
        flags: s.flags,
        roundsPlayed: primary.roundsPlayed || 0,
        totalPoints: primary.totalPoints || 0,
        recentRounds: (s.rollingWindow || []).slice(0, 10),
      };
    })
    .sort((a, b) => b.suspicionScore - a.suspicionScore);
  res.json({ count: entries.length, cheaters: entries });
});

app.get('/api/admin/player/:identityKey', requireAdmin, (req, res) => {
  const identityKey = req.params.identityKey;
  const matches = getAllStatsForIdentity(identityKey);
  const primary = matches[0] || {};
  const elo = eloRatings[identityKey] || { elo: 1200, roundsCounted: 0, history: [] };
  const suspicion = suspicionScores[identityKey] || { score: 0, flags: [], flagged: null, rollingWindow: [] };
  res.json({
    identityKey,
    nickname: primary.nickname || identityKey,
    user: primary.user || null,
    elo: elo.elo,
    roundsCounted: elo.roundsCounted,
    eloHistory: elo.history,
    totalPoints: primary.totalPoints || 0,
    roundsPlayed: primary.roundsPlayed || 0,
    roundsWon: primary.roundsWon || 0,
    targetFinds: primary.targetFinds || 0,
    totalGuesses: primary.totalGuesses || 0,
    suspicionScore: suspicion.score,
    flagged: suspicion.flagged,
    suspicionFlags: suspicion.flags,
    rollingWindow: suspicion.rollingWindow || [],
    matchedEntries: matches.map((m) => m.nickname),
  });
});

app.post('/api/admin/suspend/:identityKey', requireAdmin, (req, res) => {
  const identityKey = req.params.identityKey;
  const reason = req.body?.reason || 'admin-suspend';
  const matches = getAllStatsForIdentity(identityKey);
  let added = 0;
  for (const entry of matches) {
    const user = entry.user;
    if (!user) continue;
    const ids = [user.linkedDiscord, user.platformUserId, user.id].filter(Boolean);
    for (const id of ids) {
      const sid = String(id);
      if (!suspendedUsers.has(sid)) {
        suspendedUsers.add(sid);
        added++;
      }
    }
  }
  saveSuspendedUsers();
  console.log(`[WikiSearchle] Admin suspended identity=${identityKey} reason=${reason} idsAdded=${added}`);
  res.json({ ok: true, identityKey, added, reason });
});

app.post('/api/admin/unsuspend/:identityKey', requireAdmin, (req, res) => {
  const identityKey = req.params.identityKey;
  const matches = getAllStatsForIdentity(identityKey);
  let removed = 0;
  for (const entry of matches) {
    const user = entry.user;
    if (!user) continue;
    const ids = [user.linkedDiscord, user.platformUserId, user.id].filter(Boolean);
    for (const id of ids) {
      const sid = String(id);
      if (suspendedUsers.has(sid)) {
        suspendedUsers.delete(sid);
        removed++;
      }
    }
  }
  saveSuspendedUsers();
  res.json({ ok: true, identityKey, removed });
});

app.post('/api/admin/suspend-ip/:ip', requireAdmin, (req, res) => {
  const ip = req.params.ip;
  if (!ip) return res.status(400).json({ ok: false, message: 'Missing IP' });
  if (!suspendedIPs.has(ip)) {
    suspendedIPs.add(ip);
    saveSuspendedIPs();
  }
  console.log(`[WikiSearchle] Admin suspended IP=${ip}`);
  res.json({ ok: true, ip, suspended: true });
});

app.post('/api/admin/unsuspend-ip/:ip', requireAdmin, (req, res) => {
  const ip = req.params.ip;
  if (!ip) return res.status(400).json({ ok: false, message: 'Missing IP' });
  if (suspendedIPs.has(ip)) {
    suspendedIPs.delete(ip);
    saveSuspendedIPs();
  }
  res.json({ ok: true, ip, suspended: false });
});

app.get('/api/admin/suspended', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    users: Array.from(suspendedUsers),
    ips: Array.from(suspendedIPs),
  });
});

app.get('/api/health', (req, res) => res.json({
  ok: true,
  hasRound: !!currentRound,
  targetWord: currentRound ? (currentRound.won ? currentRound.targetWord : '(active)') : null,
  playablePool: playablePool.length,
}));

// --- Web-guess rate limit (per-socket token bucket) ---
const WEB_GUESS_RATE_CAP = 12;
const WEB_GUESS_MIN_INTERVAL_MS = 80;

// --- Client socket wiring ---
// Persistent redirect targets per streamer-handle. Chat-relay sets
// these via /api/session/redirect when the streamer switches away;
// any viewer who later loads /?session=<handle> gets the redirect
// modal at socket-connect time. Cleared via /api/session/clear-
// redirect when the streamer returns to this game.
const _streamerRedirectTargets = new Map();

function createMultiplayerWebHandler(socket, context, onGuess) {
  return createWebGuessHandler({ socket, context, resolveIdentity: resolveMultiplayerIdentity,
    isPremium: isPremiumWebUser, getPerks: id => gameShared.getWebPlayerPerks(id),
    getCosmetics: id => { const cached = readCachedCosmetics(id); if (!cached) refreshCosmeticsAsync(id); return cached; },
    isSuspended, onGuess, minInterval: WEB_GUESS_MIN_INTERVAL_MS, rateCap: WEB_GUESS_RATE_CAP });
}

io.on('connection', async (socket) => {
  const ip = gameShared.getClientIP(socket) || 'unknown';
  // Streamer-private session viewer: auth.session=<handle> arrives via the
  // client when the page is opened at /<handle> or /overlay/<handle>. Lazy-
  // create the session round so first viewer sees a live board immediately.
  const sessionHandleRaw = socket.handshake?.auth?.session;
  const sessionHandle = typeof sessionHandleRaw === 'string'
    ? sessionHandleRaw.toLowerCase().trim() : null;
  if (sessionHandle && /^[a-z0-9_-]{1,32}$/.test(sessionHandle)) {
    // Persistent redirect: if chat-relay told us the streamer
    // moved, send the modal to this socket and skip session-build
    // so we don't recreate a private round in a non-current game.
    const _redirTarget = _streamerRedirectTargets.get(sessionHandle);
    if (_redirTarget) {
      socket.emit('session-redirect', { handle: sessionHandle, ..._redirTarget });
      return;
    }
    socket._sessionHandle = sessionHandle;
    socket.join(_sessionRoom(sessionHandle));
    console.log('[WikiSearchle] Session client connected');
    try {
      const session = await sessionManager.getOrBuildSession(sessionHandle, () => buildSessionRound(sessionHandle), broadcastSessionRoundStart);
      if (session) {
        session.lastActivityAt = Date.now();
        socket.emit('wikisearchle-state', _wikisearchleSessionStateSnapshot(session));
        socket.emit('wikiword-state', serializeRound(session));
        socket.emit('wikisearchle-top', session.topGuesses);
      } else {
        socket.emit('wikisearchle-state', { error: 'Session unavailable', isSession: true });
      }
    } catch (err) {
      console.warn(`[Session] connect for "${sessionHandle}" failed: ${err.message}`);
    }
    // Session viewers can submit guesses too. Stamp streamerHandle on
    // the synthesized chat message so handleSessionChat operates on the
    // streamer's private round (not the public game).
    socket.on('submit-guess', createMultiplayerWebHandler(socket, 'session', async (msg, ip) => {
      const liveSession = await sessionManager.getOrBuildSession(sessionHandle, () => buildSessionRound(sessionHandle), broadcastSessionRoundStart);
      if (liveSession) await handleSessionChat({ ...msg, streamerHandle: sessionHandle }, ip, liveSession);
    }));
    socket.on('disconnect', () => {});
    return;
  }
  console.log('[WikiSearchle] Public client connected');
  socket.join('ws');
  if (currentRound) {
    socket.emit('wikisearchle-state', wikisearchleStateSnapshot());
    socket.emit('wikiword-state', serializeRound(currentRound));
    socket.emit('wikisearchle-top', currentRound.topGuesses);
  } else {
    socket.emit('wikisearchle-state', null);
    socket.emit('wikiword-state', null);
  }

  // Web guesses run through the same chat pipeline as TikTok chat.
  socket.on('submit-guess', createMultiplayerWebHandler(socket, 'mp', handleChat));
});

// ── Streamer-private session URLs ─────────────────────────────────────────
// /<handle>           → /?session=<handle>           (player view)
// /overlay/<handle>   → /overlay.html?session=<handle> (OBS browser source)
const SESSION_RESERVED_HANDLES = new Set([
  'api', 'admin', 'admin.html', 'about', 'about.html', 'overlay',
  'overlay.html', 'overlay-logo.html', 'overlay-unified.html',
  'index.html', 'public', 'js', 'css', 'img', 'data', 'sw.js',
  'manifest.json', 'sitemap.xml', 'robots.txt', 'favicon.ico',
  'searchle', 'solo', 'online', 'leaderboard', 'health',
]);
app.get(/^\/overlay\/[a-z0-9_-]{1,32}$/, (req, res) => {
  const handle = req.path.split('/').pop().toLowerCase();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  res.redirect(302, `/?session=${encodeURIComponent(handle)}&obs=1`);
});
app.get(/^\/[a-z0-9_-]{1,32}$/, (req, res, next) => {
  const handle = req.path.slice(1).toLowerCase();
  if (SESSION_RESERVED_HANDLES.has(handle)) return next();
  if (!_validStreamerHandles.has(handle)) return res.redirect(302, '/');
  const _disabled = _isPagePlayDisabled(handle) ? '&disabled=1' : '';
  const _self = req.query.streamer_self === '1' ? '&streamer_self=1' : '';
  res.redirect(302, `/?session=${encodeURIComponent(handle)}${_disabled}${_self}`);
});

// --- Relay connection (chat only — own rounds, no upstream game events) ---
let chatRelay = null;
function connectToChatRelay() {
  console.log(`[WikiSearchle] Connecting to Chat Relay at ${CHAT_RELAY_URL}...`);
  chatRelay = ioClient(CHAT_RELAY_URL, {
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity,
  });
  chatRelay.on('connect', () => {
    console.log('[WikiSearchle] Connected to Chat Relay');
    chatRelay.emit('app-register', { id: 'wikisearchle', name: 'WikiSearchle', port: PORT, apiKey: API_SECRET }, (ack) => {
      if (ack?.success) console.log('[WikiSearchle] Registered with Chat Relay');
    });
  });
  chatRelay.on('disconnect', () => console.log('[WikiSearchle] Disconnected from Chat Relay'));
  chatRelay.on('connect_error', (err) => console.log('[WikiSearchle] Chat Relay connect error (will retry):', err.message));
  chatRelay.on('chat-message', async (msg) => {
    const handle = msg && typeof msg.streamerHandle === 'string' ? msg.streamerHandle.toLowerCase().trim() : '';
    if (handle && /^[a-z0-9_-]{1,32}$/.test(handle)) {
      let session;
      try { session = await sessionManager.getOrBuildSession(handle, () => buildSessionRound(handle), broadcastSessionRoundStart); }
      catch (e) { console.warn(`[Session] "${handle}" build failed on chat: ${e.message}`); return; }
      if (session) handleSessionChat(msg, null, session);
      return;
    }
    handleChat(msg, null);
  });
  chatRelay.on('engagement', (event) => {
    try { handleSessionEngagement(event); }
    catch (err) { console.warn('[WikiSearchle] engagement handler failed:', err.message); }
  });
  // ── cosmetics-updated forward ──────────────────────────────────────────
  // Chat Relay broadcasts a `cosmetics-updated` event when a Word Tycoon
  // user equips/unequips a cosmetic. Without this forward, our own clients
  // would only learn about the change via the 60-second cosmeticsCache TTL.
  // Invalidate the in-process gameShared cache and re-broadcast to our io
  // so all connected browsers can drop their stale entry too.
  chatRelay.on('cosmetics-updated', (data) => {
    if (!data || !data.platform || !data.platformUserId) return;
    try {
      if (gameShared && typeof gameShared.invalidateCosmetics === 'function') {
        gameShared.invalidateCosmetics(data.platform, data.platformUserId, data.equipped);
      }
    } catch (e) { /* swallow — broadcast even if cache invalidation fails */ }
    if (io && typeof io.emit === 'function') io.emit('cosmetics-updated', data);
  });
}


// Admin: force-end a streamer session round (called by chat-relay on
// /api/streamer/disconnect so the streamer's round doesn't linger in
// memory after they hit Disconnect on the dashboard). Idle sweep would
// also reap it after 4h, but this gives immediate cleanup.
// Streamer-dashboard: read the current article title for this handle's
// private session. Read-only; admin-keyed. Returns null if no session
// or no current round yet.
app.get('/api/session/target', requireAdmin, (req, res) => {
  const handle = String((req.query && req.query.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const sess = sessionManager.getSession(handle);
  if (!sess) return res.json({ ok: true, handle, articleTitle: null, isWon: false });
  res.json({ ok: true, handle, articleTitle: sess.articleTitle || sess.targetWord || null, isWon: !!sess.won });
});

app.post('/api/session/end', requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = sessionManager.endSession(handle);
  res.json({ ok: true, had });
});

// Admin: tell the streamer's session viewers that the streamer
// moved to a different game. Emits a `session-redirect` socket
// event into the session room so any open <handle> tab can show
// a 'follow the streamer' modal. Does NOT end the session — the
// streamer might switch back, in which case the existing round
// resumes. Called by chat-relay's /api/streamer/game on switch.
app.post('/api/session/redirect', requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const targetUrl = String((req.body && req.body.targetUrl) || '').trim();
  const targetGameName = String((req.body && req.body.targetGameName) || '').trim();
  const targetGameId = String((req.body && req.body.targetGameId) || '').trim();
  if (!targetUrl) return res.status(400).json({ ok: false, error: 'targetUrl required' });
  _streamerRedirectTargets.set(handle, { targetUrl, targetGameName, targetGameId });
  io.to(_sessionRoom(handle)).emit('session-redirect', {
    handle, targetUrl, targetGameName, targetGameId,
  });
  res.json({ ok: true });
});

// Admin: streamer is now active in THIS game — clear any stale
// redirect target so viewers landing on /?session=<handle> aren't
// bounced to wherever the streamer USED to be. Called by chat-
// relay's /api/streamer/game switch handler on the new active game.
app.post('/api/session/clear-redirect', requireAdmin, express.json(), (req, res) => {
  const handle = String((req.body && req.body.handle) || '').toLowerCase().trim();
  if (!handle || !/^[a-z0-9_-]{1,32}$/.test(handle)) return res.status(400).json({ ok: false, error: 'Invalid handle' });
  const had = _streamerRedirectTargets.delete(handle);
  res.json({ ok: true, had });
});

function checkStaleRound() {
  if (!currentRound || currentRound.won) return;
  const age = Date.now() - new Date(currentRound.startTime).getTime();
  if (age > MAX_ROUND_AGE_MS) {
    console.log(`[WikiSearchle] Stale public round auto-ended after ${Math.round(age / 3600000)}h — target=${currentRound.targetWord}`);
    roundActions.run(currentRound, round => endRound(null, round)).catch(() => console.warn('[WikiSearchle] stale round finalization failed'));
  }
}

server.listen(PORT, () => {
  console.log(`[WikiSearchle] Server running at http://localhost:${PORT}`);
  connectToChatRelay();
  // Try to resume a prior round before picking a new one. If restore fails or
  // there's nothing to restore, pick a fresh random target.
  const restored = loadState();
  for (const row of sessionManager.listSessions()) {
    const session = sessionManager.getSession(row.handle);
    if (multiplayerRewards.recover(session)) { revealAll(session); sessionManager.scheduleSave(); }
  }
  console.log('[WikiMPRewards] Durable round delivery and serialized actions enabled');
  retryRoundCompletions();
  setInterval(retryRoundCompletions, 15000).unref();
  if (restored && currentRound && !currentRound.won) {
    const age = Date.now() - new Date(currentRound.startTime).getTime();
    if (age > MAX_ROUND_AGE_MS) {
      console.log(`[WikiSearchle] Resumed round is stale (${Math.round(age / 3600000)}h); auto-ending.`);
      roundActions.run(currentRound, round => endRound(null, round)).catch(() => console.warn('[WikiSearchle] stale round finalization failed'));
    } else {
      console.log('[WikiSearchle] Resumed saved round on boot.');
    }
  } else {
    // Small delay so Searchle has time to boot before we hit its rank API.
    setTimeout(startRound, 3000);
  }
  backfillEloAndSuspicion();
  setInterval(checkStaleRound, STALE_ROUND_CHECK_MS).unref();
});

// Uncaught exception safety — log the error and exit so PM2 can restart us.
// Without this, some errors would kill the process silently.
process.on('uncaughtException', (err) => {
  console.error('[WikiSearchle] uncaughtException:', err && err.stack || err);
  try { saveStateSync(); } catch (e) {}
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[WikiSearchle] unhandledRejection:', reason);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[WikiSearchle] Shutting down...');
  try { saveStateSync(); } catch (e) {}
  if (chatRelay) chatRelay.disconnect();
  if (restartTimer) clearTimeout(restartTimer);
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
