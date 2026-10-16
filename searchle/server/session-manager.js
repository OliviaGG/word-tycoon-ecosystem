// ===== Session Manager =====
// Per-streamer private game sessions. Durable accepted progress, one game-state
// per streamer handle, independent of the public game. Reuses ranking-engine and
// guess-processor so logic matches the public Searchle game exactly.
//
// Session lifetime:
//  - Created lazily on first viewer connect or first chat message tagged with the
//    session's streamSession id.
//  - Auto-restarts on win (new puzzle picked, fresh state, broadcast to room).
//  - Discarded when explicitly ended (streamer disconnect propagated from chat-relay)
//    after durable retirement. Accepted rounds recover after server restart.

const fs = require('fs');
const path = require('path');
const rankingEngine = require('./ranking-engine');
const languageProfiles = require('./language-profiles');
const { loadCuratedTargets } = require('./curated-targets');
const { resolveRelayOrShared } = require('./shared-resolver');

// Chat-relay public endpoint for per-stream custom fan-club title.
// Searchle calls this on session creation to cache the streamer's chosen
// override (e.g. "Pookie") so guess-processor can substitute it over the
// catalog default "Fan Club" for non-Discord-linked viewers — whose
// cosmetics skip chat-relay's enrichment + filter path and would
// otherwise show the unsubstituted catalog title.
const CHAT_RELAY_URL = process.env.CHAT_RELAY_URL || 'http://localhost:3000';
const FC_TITLE_REFRESH_MS = 5 * 60 * 1000;
const _fcTitleLastFetch = new Map(); // handle → ts

async function _refreshFcTitle(session, handle) {
  if (!session || !handle) return;
  const last = _fcTitleLastFetch.get(handle) || 0;
  if (Date.now() - last < FC_TITLE_REFRESH_MS) return;
  _fcTitleLastFetch.set(handle, Date.now());
  try {
    const url = `${CHAT_RELAY_URL}/api/streamer/${encodeURIComponent(handle)}/fc-title-public`;
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json();
    if (sessions.get(handle) !== session) return;
    if (data && (data.fcTitle === null || typeof data.fcTitle === 'string')) {
      session.fcTitle = data.fcTitle;
      scheduleSave();
    }
  } catch (_) {
    // Network / parse failure is non-fatal — fcTitle stays at its
    // previous cached value (or null), guess-processor falls back to
    // the catalog default. No throw, no log spam.
  }
}

// Map<sessionKey, sessionGame>. sessionKey is the streamer handle (lowercase).
const sessions = new Map();

// Per-session creation locks so two simultaneous chats don't both build a puzzle.
const _creating = new Map();
const _creationTokens = new Map();

// ─── Persistence ────────────────────────────────────────────────────────────
// Round progress saved to disk so deploys/restarts don't blow away streamers'
// active rounds. Rankings are NOT persisted (rebuilt on demand from
// targetWord — keeps the file small and rankingEngine.computeRankings is
// fast enough for the lazy-load on first access).
const SAVE_PATH = path.join(process.env.DATA_DIR || path.join(__dirname,'..','data'),'sessions.json');
let recovery=null;
const SAVE_TMP_PATH = SAVE_PATH + '.tmp';
const SAVE_DEBOUNCE_MS = 2000;
let _saveTimer = null;
let _saving = false;

function _serializeSession(s) {
  return {
    handle: s.handle,
    sessionId: s.sessionId,
    language: languageProfiles.normalizeLanguageId(s.language),
    targetWord: s.targetWord,
    totalRankedWords: s.totalRankedWords,
    guesses: s.guesses,
    guessedWords: [...s.guessedWords],
    guessedWordsRecent: s.guessedWordsRecent,
    hintLettersRevealed: Number(s.hintLettersRevealed) || 0,
    startTime: s.startTime,
    lastActivityAt: s.lastActivityAt,
    isWon: s.isWon,
    winner: s.winner,
    lastWinner: s.lastWinner,
    playerScores: [...s.playerScores.entries()],
    paidTopWords: [...s.paidTopWords],
    bestNonTop10Rank: Number.isFinite(s.bestNonTop10Rank) ? s.bestNonTop10Rank : null,
    // FIFO ring of recent target words so _pickSessionTarget can filter
    // them out and avoid the heavy-replay pattern that pure random
    // selection produces against a ~2000-word common pool. Persisted
    // so a service restart doesn't wipe the dedup state.
    recentTargets: Array.isArray(s.recentTargets) ? [...s.recentTargets] : [],
    // Cached per-session custom fan-club title (e.g. "Pookie" for
    // jorrybeaufart). Used by guess-processor to substitute the catalog
    // default "Fan Club" for users whose cosmetics come in unfiltered
    // (e.g. non-Discord-linked TikTok chatters that skip relay.js's
    // enrichment block). Refreshed periodically; persisted so the value
    // survives restarts without an extra round-trip on cold start.
    fcTitle: typeof s.fcTitle === 'string' ? s.fcTitle : null,
  };
}

function _deserializeSession(o) {
  return {
    handle: o.handle,
    sessionId: o.sessionId || null,
    language: languageProfiles.normalizeLanguageId(o.language),
    targetWord: o.targetWord || null,
    rankings: null, // recomputed lazily on first getOrCreateSession
    totalRankedWords: o.totalRankedWords || 0,
    guesses: Array.isArray(o.guesses) ? o.guesses : [],
    guessedWords: new Set(Array.isArray(o.guessedWords) ? o.guessedWords : []),
    guessedWordsRecent: Array.isArray(o.guessedWordsRecent) ? o.guessedWordsRecent : [],
    hintLettersRevealed: Number(o.hintLettersRevealed) || 0,
    startTime: o.startTime || null,
    lastActivityAt: typeof o.lastActivityAt === 'number' ? o.lastActivityAt : Date.now(),
    isWon: !!o.isWon,
    winner: o.winner || null,
    lastWinner: o.lastWinner || null,
    playerScores: new Map(Array.isArray(o.playerScores) ? o.playerScores : []),
    paidTopWords: new Set(Array.isArray(o.paidTopWords) ? o.paidTopWords : []),
    bestNonTop10Rank: o.bestNonTop10Rank === null || o.bestNonTop10Rank === undefined ? Infinity : o.bestNonTop10Rank,
    recentTargets: Array.isArray(o.recentTargets) ? o.recentTargets : [],
    fcTitle: typeof o.fcTitle === 'string' ? o.fcTitle : null,
  };
}

function _loadSessions() {
  if(!fs.existsSync(SAVE_PATH))return;
  const stat=fs.lstatSync(SAVE_PATH);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>12*1024*1024)throw Error('Unsafe legacy Searchle sessions');
  const data=JSON.parse(fs.readFileSync(SAVE_PATH,'utf8'));if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length>497)throw Error('Invalid legacy Searchle sessions');
  for(const [key,obj] of Object.entries(data)){
    if(!/^[a-z0-9_-]{1,32}$/.test(key)||obj?.handle!==key)throw Error('Invalid legacy Searchle session');
    const session=_deserializeSession(obj);if(!session.targetWord)throw Error('Missing legacy Searchle target');
    if(recovery.load('session:'+key))continue;
    recovery.start(session,'session:'+key,{handle:key},true);sessions.set(key,session);
  }
}
function setRecovery(value){
  recovery=value;sessions.clear();const scopes=recovery.journal.scopes().filter(scope=>scope.startsWith('session:'));
  if(!recovery.load('public')?.meta.classicSessionsMigrated)_loadSessions();
  for(const scope of scopes){const handle=scope.slice(8);if(!/^[a-z0-9_-]{1,32}$/.test(handle))throw Error('Invalid accepted Searchle session');const record=recovery.load(scope);if(record.meta.ended)continue;
    const session=_newSessionGame(handle,null);recovery.adopt(session,record);sessions.set(handle,session);
  }
}

function _doSaveAsync() {
  if (_saving) return;
  _saving = true;
  const data = {};
  for (const [key, s] of sessions) data[key] = _serializeSession(s);
  const json = JSON.stringify(data);
  fs.writeFile(SAVE_TMP_PATH, json, (err) => {
    if (err) { console.error('[Session] save tmp failed:', err.message); _saving = false; return; }
    fs.rename(SAVE_TMP_PATH, SAVE_PATH, (err2) => {
      if (err2) console.error('[Session] save rename failed:', err2.message);
      _saving = false;
    });
  });
}

function scheduleSave() {
  if(recovery?.isRunning())return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; _doSaveAsync(); }, SAVE_DEBOUNCE_MS);
}

// Boot: pull persisted sessions back into memory. Rankings rebuild lazily
// when getOrCreateSession is called for that handle.
// Compatibility state is migrated only after the authoritative journal opens.

// One-shot boot backfill: existing sessions on disk pre-date the
// recentTargets dedup ring, so their persisted history is empty. To
// avoid the first ~800 post-deploy rounds replaying words the streamer
// JUST saw, scan the PM2 log for prior "[Session] ... target=..." picks
// and seed each session's recentTargets in chronological order. Newest
// at end (matches the in-game FIFO push). Cap at 800 per handle to
// match the picker's trim. Non-fatal: any error here just leaves the
// dedup buffer empty and the picker still functions (just without the
// backfill warm-up).
function _backfillRecentTargets() {
  try {
    const LOG_PATH = process.env.SEARCHLE_LOG_PATH
      || '/home/deploy/.pm2/logs/searchle-mobile-out.log';
    if (!fs.existsSync(LOG_PATH)) return;
    const stat = fs.statSync(LOG_PATH);
    // Cap read to last ~5MB so we don't blow memory on huge logs.
    // PM2 logrotate usually keeps individual files smaller than this
    // but the tail-read guards the worst case.
    const READ_MAX = 5 * 1024 * 1024;
    let buf;
    if (stat.size > READ_MAX) {
      const fd = fs.openSync(LOG_PATH, 'r');
      const buffer = Buffer.alloc(READ_MAX);
      fs.readSync(fd, buffer, 0, READ_MAX, stat.size - READ_MAX);
      fs.closeSync(fd);
      buf = buffer.toString('utf8');
    } else {
      buf = fs.readFileSync(LOG_PATH, 'utf8');
    }
    // Matches BOTH log shapes that _initSessionGame + startNextSessionRound
    // emit, scoped to the [Session] tag so we don't pick up [Game] (public)
    // or any other log line that happens to contain target="...".
    const RE = /\[Session\] "([^"]+)" (?:started|next round): target="([^"]+)"/g;
    const byHandle = new Map();
    let m;
    while ((m = RE.exec(buf)) !== null) {
      const handle = m[1];
      const target = m[2];
      let arr = byHandle.get(handle);
      if (!arr) { arr = []; byHandle.set(handle, arr); }
      arr.push(target);
    }
    let seeded = 0;
    let totalEntries = 0;
    const CAP = 800;
    for (const [handle, history] of byHandle) {
      const s = sessions.get(handle);
      if (!s) continue;
      if (!Array.isArray(s.recentTargets)) s.recentTargets = [];
      // TOP UP rather than skip-when-non-empty. The session may have a
      // few persisted entries from rounds played since the dedup ring
      // shipped, but historic log entries (potentially hundreds of
      // rounds) are still needed to bring the buffer up to its cap.
      // Strategy: take the log's last CAP entries, then de-dup against
      // what's already persisted and PREPEND new ones (oldest first) so
      // persisted entries stay at the tail = newest. Total trimmed to
      // CAP overall.
      const already = new Set(s.recentTargets);
      const tail = history.slice(-CAP);
      const additions = [];
      for (const w of tail) {
        if (!already.has(w)) additions.push(w);
      }
      if (additions.length === 0) continue;
      // Prepend additions (chronologically older), keep persisted entries
      // at the end (newer), trim from front to CAP.
      let merged = additions.concat(s.recentTargets);
      if (merged.length > CAP) merged = merged.slice(merged.length - CAP);
      s.recentTargets = merged;
      seeded++;
      totalEntries += additions.length;
    }
    if (seeded) {
      console.log(`[Session] Backfilled recentTargets for ${seeded} session(s) from log (+${totalEntries} entries)`);
    }
  } catch (err) {
    console.warn('[Session] recentTargets backfill failed (non-fatal):', err.message);
  }
}
// Legacy log backfill is an upgrade tool; primary records already own dedup state.

// One-shot retro substitution: existing playerScores entries from before
// this code shipped have raw "Fan Club" titles persisted. We can't fetch
// each session's fcTitle synchronously at boot (it's a network call), so
// kick off an async pass that walks each loaded session, refreshes its
// fcTitle from chat-relay, then sweeps playerScores applying the
// substitution to any __fanClubOnly title that still shows the catalog
// default. Non-blocking — boot continues immediately.
async function _retroSubstituteFcTitles() {
  for (const [handle, session] of sessions) {
    try {
      await _refreshFcTitle(session, handle);
      if (!session.fcTitle) continue;
      let touched = 0;
      for (const [, entry] of session.playerScores) {
        const t = entry && entry.cosmetics && entry.cosmetics.title;
        if (!t || !t.__fanClubOnly || typeof t.title !== 'string') continue;
        if (t.title === session.fcTitle) continue;
        // Mutate in place — these are private session-owned objects
        // (per-session playerScores entries), not the shared cache.
        entry.cosmetics = {
          ...entry.cosmetics,
          title: { ...t, title: session.fcTitle },
        };
        touched++;
      }
      if (touched > 0) {
        console.log(`[Session] "${handle}" retro fcTitle substitution: ${touched} entries → "${session.fcTitle}"`);
        scheduleSave();
      }
    } catch (e) {
      console.warn(`[Session] retro fcTitle for "${handle}" failed:`, e.message);
    }
  }
}
// Delay by a tick so dependencies (fetch wiring, etc.) are fully ready.
setTimeout(() => { _retroSubstituteFcTitles().catch(() => {}); }, 250);

// One-shot retro display-name sanitization. Mirrors the regex applied
// in chat-relay's tiktok-direct.js mapUser — strips decorative bracket
// characters (Javanese rerenggan ꧁꧂, box drawing, geometric shapes,
// math brackets, etc.) that render with oversized line-box metrics and
// expand alt-mode's top card / podium card height. Without this pass,
// existing playerScores entries persisted before the sanitizer shipped
// would keep displaying with brackets until the user chats again.
const _NAME_STRIP_RE = new RegExp(
  '[' +
  '\\u{A9C1}-\\u{A9CE}' +
  '\\u{2500}-\\u{257F}' +
  '\\u{2580}-\\u{259F}' +
  '\\u{25A0}-\\u{25FF}' +
  '\\u{2980}-\\u{29FF}' +
  '\\u{27C0}-\\u{27EF}' +
  '\\u{2768}-\\u{2775}' +
  '\\u{A789}-\\u{A78A}' +
  '\\u{27E6}-\\u{27EB}' +
  '\\u{2E00}-\\u{2E7F}' +
  '\\u{FE3D}-\\u{FE44}' +
  '\\u{FF5F}-\\u{FF60}' +
  '\\u{3010}-\\u{3019}' +
  '\\u{2E26}-\\u{2E29}' +
  ']',
  'gu'
);
function _sanitizeName(name) {
  if (typeof name !== 'string' || name.length === 0) return name;
  const stripped = name.replace(_NAME_STRIP_RE, '').replace(/\s{2,}/g, ' ').trim();
  return stripped.length > 0 ? stripped : name;
}
function _retroSanitizeDisplayNames() {
  let total = 0;
  for (const [handle, session] of sessions) {
    if (!session.playerScores) continue;
    let touched = 0;
    for (const [, entry] of session.playerScores) {
      if (!entry || typeof entry.displayName !== 'string') continue;
      const cleaned = _sanitizeName(entry.displayName);
      if (cleaned !== entry.displayName) {
        entry.displayName = cleaned;
        touched++;
      }
    }
    if (touched > 0) {
      console.log(`[Session] "${handle}" retro display-name sanitize: ${touched} entries`);
      total += touched;
    }
  }
  if (total > 0) scheduleSave();
}
setTimeout(() => { try { _retroSanitizeDisplayNames(); } catch (_) {} }, 500);

// Pause-and-resume: when a streamer switches games mid-round, the old
// game's session lingers in memory so they can switch back and continue
// where they left off. To prevent unbounded memory growth from truly
// abandoned sessions, sweep handles idle longer than IDLE_TTL_MS.
// "Activity" = chat/guess coming in or a viewer (re)connecting (both flow
// through getOrCreateSession). State polls do NOT count.
const IDLE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // every 30 min

function _newSessionGame(handle, sessionId) {
  return {
    handle,
    sessionId,
    language: 'en',
    targetWord: null,
    rankings: null,
    totalRankedWords: 0,
    guesses: [],
    guessedWords: new Set(),
    guessedWordsRecent: [],
    // Like-for-Hint: how many leading letters of the target the hint system
    // has revealed this round (0 until the top-10 words are exhausted). Reset
    // on every new round so letter progress never leaks across words.
    hintLettersRevealed: 0,
    startTime: null,
    lastActivityAt: Date.now(),
    isWon: false,
    winner: null,
    lastWinner: null,
    // Session-scoped scoring (mirrors public game-manager.js fields).
    playerScores: new Map(),
    paidTopWords: new Set(),
    bestNonTop10Rank: Infinity,
    // Dedup ring populated by _pickSessionTarget. Newest at end, oldest
    // at front. Trimmed per pick (see _pickSessionTarget for sizing).
    recentTargets: [],
    // Custom fan-club title (e.g. "Pookie") fetched from chat-relay on
    // session creation. Used by guess-processor to substitute over the
    // catalog "Fan Club" default. null = use catalog default.
    fcTitle: null,
  };
}

// ─── Session scoring (parallel to game-manager.awardForGuess/getPodium) ───
// Mirrors the public point-based scoring exactly so a viewer's session
// experience matches the public game's: top-10 first-finder tiers
// (100k → 10k), proximity baseline for rank 11–10000, and climb bonus
// when a guess improves the session's best non-top-10 rank.
const RANK_REWARDS = { 1: 100000, 2: 90000, 3: 80000, 4: 70000, 5: 60000, 6: 50000, 7: 40000, 8: 30000, 9: 20000, 10: 10000 };
const MAX_CLIMB_BONUS = 5000;

function _proximityPoints(rank) {
  if (!Number.isFinite(rank)) return 0;
  if (rank <= 50) return 100;
  if (rank <= 200) return 60;
  if (rank <= 1000) return 30;
  if (rank <= 5000) return 15;
  if (rank <= 10000) return 5;
  return 0;
}

function _climbBonus(currentBest, newRank) {
  if (!Number.isFinite(newRank) || newRank < 11 || newRank > 10000) return 0;
  const oldBest = (Number.isFinite(currentBest) && currentBest <= 10001) ? currentBest : 10001;
  if (newRank >= oldBest) return 0;
  const fractionClosed = 1 - (newRank / oldBest);
  return Math.floor(MAX_CLIMB_BONUS * fractionClosed);
}

function _computeRankAward(rank, alreadyTaken, currentBestNonTop10) {
  if (rank >= 1 && rank <= 10) {
    if (!alreadyTaken) return RANK_REWARDS[rank];
    return _proximityPoints(rank);
  }
  return _proximityPoints(rank) + _climbBonus(currentBestNonTop10, rank);
}

function _identityKeyFor(user) {
  if (!user) return null;
  if (user.linkedDiscord) return 'discord:' + user.linkedDiscord;
  const puid = user.platformUserId || user.id;
  if (user.platform && puid) return user.platform + ':' + puid;
  return null;
}

function awardForGuess(session, rank, user) {
  const key = _identityKeyFor(user);
  if (!key || !session) return { pts: 0, total: 0 };
  const isTopSlot = rank >= 1 && rank <= 10;
  const slotTaken = isTopSlot ? session.paidTopWords.has(rank) : false;
  const currentBest = session.bestNonTop10Rank;
  const pts = _computeRankAward(rank, slotTaken, currentBest);
  if (pts <= 0) {
    const existing = session.playerScores.get(key);
    return { pts: 0, total: existing ? existing.xp : 0 };
  }
  if (isTopSlot && !slotTaken) session.paidTopWords.add(rank);
  if (rank >= 11 && rank <= 10000 && rank < currentBest) {
    session.bestNonTop10Rank = rank;
  }
  let entry = session.playerScores.get(key);
  if (!entry) {
    entry = {
      identityKey: key,
      displayName: user.displayName || user.username || 'Player',
      profilePic: user.profilePic || null,
      platform: user.platform || null,
      platformUserId: user.platformUserId || user.id || null,
      linkedDiscord: user.linkedDiscord || null,
      cosmetics: user.cosmetics || null,
      isFanClub: !!user.isFanClub, isSuperfan: !!user.isSuperfan, isDonor: !!user.isDonor,
      xp: 0,
    };
    session.playerScores.set(key, entry);
  } else {
    if (user.displayName) entry.displayName = user.displayName;
    if (user.profilePic) entry.profilePic = user.profilePic;
    if (user.cosmetics) entry.cosmetics = user.cosmetics;
    if (user.isFanClub && !entry.isFanClub) entry.isFanClub = true;
    if (user.isSuperfan && !entry.isSuperfan) entry.isSuperfan = true;
    if (user.isDonor && !entry.isDonor) entry.isDonor = true;
  }
  entry.xp += pts;
  return { pts, total: entry.xp };
}

function getPodium(session, limit = 7) {
  if (!session || !session.playerScores) return [];
  const all = [...session.playerScores.values()];
  all.sort((a, b) => b.xp - a.xp);
  return all.slice(0, limit).map((e, i) => ({
    rank: i + 1,
    identityKey: e.identityKey,
    displayName: e.displayName,
    profilePic: e.profilePic,
    platform: e.platform,
    platformUserId: e.platformUserId,
    linkedDiscord: e.linkedDiscord,
    cosmetics: e.cosmetics || null,
    isFanClub: !!e.isFanClub, isSuperfan: !!e.isSuperfan, isDonor: !!e.isDonor,
    xp: e.xp,
  }));
}

// Map the chat-relay's word-frequency preference to a Zipf range used to
// filter the target pool. 'normal' = no filter (preserves prior behavior).
// Zipf scale: 7-8 ultra common, 5-6 common, 3-4 uncommon, <3 obscure.
//
// Note: 'very-common' and 'common' use CURATED whitelists (hand-filtered
// concrete nouns: ~1000 and ~2000 respectively) instead of raw Zipf
// ranges — the raw cutoffs include too many function/abstract words
// ("there", "will", "fact", "way") that have no semantic clues for
// Searchle. The lists live at /opt/chat-relay/data/word-bank/searchle-
// {very-easy,easy}-targets.json. See git log around 2026-05-20.
const DIFFICULTY_ZIPF = {
  'very-common': null, // handled via curated whitelist below
  'common':      null, // handled via curated whitelist below
  'normal':      null,
  'rare':        { min: 3.0, max: 4.5 },
  'very-rare':   { min: -Infinity, max: 3.0 },
};

// Difficulty → { file path, Zipf fallback if file missing }.
const WHITELIST_CONFIG = {
  'very-common': {
    file: process.env.SEARCHLE_VERY_EASY_TARGETS
      || resolveRelayOrShared('data/word-bank/searchle-very-easy-targets.json'),
    fallbackZipfMin: 5.5,
  },
  'common': {
    file: process.env.SEARCHLE_EASY_TARGETS
      || resolveRelayOrShared('data/word-bank/searchle-easy-targets.json'),
    fallbackZipfMin: 4.5,
  },
};
const _whitelistCache = new Map(); // difficulty → Set<word>
function _loadDifficultyWhitelist(difficulty) {
  if (_whitelistCache.has(difficulty)) return _whitelistCache.get(difficulty);
  const cfg = WHITELIST_CONFIG[difficulty];
  if (!cfg) { _whitelistCache.set(difficulty, new Set()); return _whitelistCache.get(difficulty); }
  try {
    const fs = require('fs');
    const raw = fs.readFileSync(cfg.file, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) {
      const words = difficulty === 'common' ? [...arr, ...loadCuratedTargets()] : arr;
      const set = new Set(words.map(w => String(w).toLowerCase()));
      _whitelistCache.set(difficulty, set);
      console.log(`[Session] Loaded ${difficulty} whitelist: ${set.size} words from ${cfg.file}`);
      return set;
    }
  } catch (e) {
    console.warn(`[Session] ${difficulty} whitelist load failed:`, e.message);
  }
  _whitelistCache.set(difficulty, new Set()); // sentinel — empty = fall back to Zipf
  return _whitelistCache.get(difficulty);
}

function _pickSessionTarget(targetWords, wordFrequency, session, language = 'en') {
  // Sessions DO need history tracking — the previous version did a pure
  // random pick every round, producing 5-6× replays of the same word
  // across ~440 rounds against a ~2000-word pool (matches the
  // expected ~440²/2·2000 ≈ 48 duplicate pairs for random-with-
  // replacement). Now we filter out the session's recentTargets ring so
  // viewers don't see the same target on back-to-back-to-back games.
  const lang = languageProfiles.normalizeLanguageId(language);
  const languagePool = languageProfiles.getTargetPool(lang, wordFrequency);
  const fullPool = Array.isArray(languagePool) && languagePool.length > 0 ? languagePool : targetWords;
  if (!fullPool.length) return null;

  // Apply the streamer's difficulty filter — only the word pool changes;
  // dictionary acceptance (what viewers can guess) is unchanged.
  let pool = fullPool;

  if (lang !== 'en') {
    // Non-English profiles already choose a difficulty-specific target file.
  } else if (WHITELIST_CONFIG[wordFrequency]) {
    const whitelist = _loadDifficultyWhitelist(wordFrequency);
    if (whitelist.size > 0) {
      const filtered = fullPool.filter(w => whitelist.has(String(w).toLowerCase()));
      if (filtered.length >= 1) pool = filtered;
      else console.warn(`[Session] ${wordFrequency} whitelist had 0 overlap with ${fullPool.length} target words — using full pool.`);
    } else {
      // Whitelist file missing — fall back to a Zipf cutoff so behavior
      // is still tiered even if the curated list isn't deployed.
      const minZ = WHITELIST_CONFIG[wordFrequency].fallbackZipfMin;
      if (typeof rankingEngine.getZipf === 'function') {
        const filtered = fullPool.filter(w => {
          const z = rankingEngine.getZipf(w);
          return Number.isFinite(z) && z >= minZ;
        });
        if (filtered.length >= 1) pool = filtered;
      }
    }
  } else {
    const range = DIFFICULTY_ZIPF[wordFrequency || 'normal'];
    if (range && typeof rankingEngine.getZipf === 'function') {
      const filtered = fullPool.filter(w => {
        const z = rankingEngine.getZipf(w);
        return Number.isFinite(z) && z >= range.min && z < range.max;
      });
      if (filtered.length >= 1) pool = filtered;
      else console.warn(`[Session] difficulty="${wordFrequency}" yielded 0 candidates from ${fullPool.length} — using full pool.`);
    }
  }

  // Dedup against the session's recentTargets ring. Build a Set ONCE so
  // the inner filter is O(1) per word rather than O(n) on the array.
  // Safety fallback: if the filter would empty the pool (e.g. very-rare
  // difficulty with a tiny candidate set), drop the dedup and use the
  // unfiltered pool so we never throw or hang.
  const recent = (session && Array.isArray(session.recentTargets))
    ? new Set(session.recentTargets) : new Set();
  let dedupedPool = pool;
  if (recent.size > 0) {
    const filtered = pool.filter(w => !recent.has(w));
    if (filtered.length > 0) dedupedPool = filtered;
  }

  // Pick a valid target. Try up to 8 fresh random samples (each O(1))
  // before falling back to a single deterministic pick — this avoids
  // pathological loops if the ranking engine somehow can't validate
  // anything in the deduped pool.
  let picked = null;
  for (let i = 0; i < 8; i++) {
    const candidate = dedupedPool[Math.floor(Math.random() * dedupedPool.length)];
    if (rankingEngine.isValidTarget(candidate, languageProfiles.getRankingOptions(lang))) { picked = candidate; break; }
  }
  if (!picked) picked = dedupedPool[Math.floor(Math.random() * dedupedPool.length)];

  // Push to the session's dedup ring and trim. Cap = 60% of the pool,
  // bounded at 800 absolute. With 2000-word common pool → 800 history,
  // meaning ~800 unique rounds before a word can repeat. Smaller pools
  // (rare/very-rare ~200-400) shrink the cap proportionally so we
  // never starve the picker.
  if (session && Array.isArray(session.recentTargets) && picked) {
    session.recentTargets.push(picked);
    const cap = Math.min(800, Math.max(1, Math.floor(pool.length * 0.6)));
    while (session.recentTargets.length > cap) session.recentTargets.shift();
  }
  return picked;
}

async function _initSessionGame(s, config, targetWords, wordFrequency, language = 'en', isCurrent = () => true) {
  const owner=recovery?.current(s),candidate={...s,language:languageProfiles.normalizeLanguageId(language),recentTargets:[...(s.recentTargets||[])]};
  const word=_pickSessionTarget(targetWords,wordFrequency,candidate,candidate.language);if(!word)throw Error('No target words available');
  const rankings=await rankingEngine.computeRankings(word,config,languageProfiles.getRankingOptions(candidate.language));
  if (!isCurrent()) throw Error('Searchle session changed while preparing creation');
  if(owner&&(sessions.get(s.handle)!==s||recovery.current(s)?.roundId!==owner.roundId))throw Error('Searchle session changed while preparing replacement');
  if (!sessions.has(s.handle) && sessions.size >= 497) throw Error('Searchle session capacity reached');
  Object.assign(candidate,{targetWord:word,rankings,totalRankedWords:rankings.size,guesses:[],guessedWords:new Set(),guessedWordsRecent:[],hintLettersRevealed:0,startTime:new Date().toISOString(),lastActivityAt:Date.now(),isWon:false,winner:null,playerScores:new Map(),paidTopWords:new Set(),bestNonTop10Rank:Infinity});
  if(recovery){const record=recovery.start(candidate,'session:'+s.handle);Object.assign(s,candidate);recovery.adopt(s,record);}else Object.assign(s,candidate);
  return s;
}

function _sweepIdleSessions() {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (s && (now - (s.lastActivityAt || 0)) > IDLE_TTL_MS) {
      console.log(`[Session] sweeping idle session "${key}" (${Math.round((now - s.lastActivityAt) / 60000)}m idle)`);
      try { endSession(key); } catch { console.warn('[Session] Durable retirement deferred'); }
    }
  }
}
setInterval(_sweepIdleSessions, SWEEP_INTERVAL_MS).unref();

async function getOrCreateSession({ handle, sessionId, config, targetWords, wordFrequency, language }) {
  if (!handle) return null;
  const key = String(handle).toLowerCase();
  const requestedLanguage = languageProfiles.normalizeLanguageId(language);

  // Existing live game (not yet won, rankings loaded) — return as-is.
  const existing = sessions.get(key);
  if(!/^[a-z0-9_-]{1,32}$/.test(key))throw Error('Invalid Searchle handle');
  if(existing?.isWon)return existing;
  if(existing&&languageProfiles.normalizeLanguageId(existing.language)!==requestedLanguage){
    if(_creating.has(key))return _creating.get(key);
    const pending=_initSessionGame(existing,config,targetWords,wordFrequency,requestedLanguage);_creating.set(key,pending);
    try{return await pending;}finally{if (_creating.get(key) === pending) _creating.delete(key);}
  }
  if (existing && !existing.isWon && existing.targetWord && existing.rankings) {
    existing.lastActivityAt = Date.now();
    // Opportunistic refresh of the streamer's custom fcTitle. Throttled
    // by FC_TITLE_REFRESH_MS so this is cheap on every-guess re-entry.
    _refreshFcTitle(existing, key).catch(() => {});
    return existing;
  }

  // Persisted session restored from disk — has targetWord but rankings
  // weren't serialized. Rebuild rankings, then resume the round.
  if (existing && !existing.isWon && existing.targetWord && !existing.rankings) {
    if (_creating.has(key)) return _creating.get(key);
    const promise = (async () => {
      existing.language = languageProfiles.normalizeLanguageId(existing.language || requestedLanguage);
      const owner = recovery?.current(existing);
      const rankings = await rankingEngine.computeRankings(existing.targetWord, config, languageProfiles.getRankingOptions(existing.language));
      if (sessions.get(key) !== existing || owner && recovery.current(existing)?.roundId !== owner.roundId) throw Error('Searchle session changed while restoring rankings');
      existing.rankings = rankings;
      existing.lastActivityAt = Date.now();
      // Refresh fcTitle on cold-resume too — value persists across
      // restarts so we usually skip the network call, but the streamer
      // may have changed it while the service was down.
      _refreshFcTitle(existing, key).catch(() => {});
      console.log(`[Session] "${key}" resumed from disk: target="${existing.targetWord}" (${existing.totalRankedWords.toLocaleString()} ranked words, ${existing.guesses.length} guesses${existing.fcTitle ? `, fcTitle="${existing.fcTitle}"` : ''})`);
      scheduleSave();
      return existing;
    })();
    _creating.set(key, promise);
    try { return await promise; } finally { if (_creating.get(key) === promise) _creating.delete(key); }
  }

  // Coalesce concurrent creations.
  if (_creating.has(key)) return _creating.get(key);

  if (!existing) {
    const preparing = [..._creationTokens.keys()].filter(handle => !sessions.has(handle)).length;
    if (sessions.size + preparing >= 497) throw Error('Searchle session capacity reached');
  }
  const token = {};
  _creationTokens.set(key, token);
  const promise = (async () => {
    const s = existing || _newSessionGame(key, sessionId || null);
    if (sessionId) s.sessionId = sessionId;
    if(!existing&&sessions.size>=497)throw Error('Searchle session capacity reached');
    await _initSessionGame(s, config, targetWords, wordFrequency, requestedLanguage,
      () => _creationTokens.get(key) === token && sessions.get(key) === existing);
    // Fetch the streamer's custom fcTitle override (Pookie etc.) so
    // guess-processor can substitute it for the catalog "Fan Club"
    // default. Awaited so the first guess after session-start has it
    // ready; subsequent re-entries hit the throttle cache.
    sessions.set(key,s);
    _refreshFcTitle(s,key).catch(()=>{});
    console.log(`[Session] "${key}" started: target="${s.targetWord}" (${s.totalRankedWords.toLocaleString()} ranked words, language=${s.language || 'en'}, difficulty=${wordFrequency || 'normal'}${s.fcTitle ? `, fcTitle="${s.fcTitle}"` : ''})`);
    scheduleSave();
    return s;
  })();

  _creating.set(key, promise);
  try {
    return await promise;
  } finally {
    if (_creating.get(key) === promise) _creating.delete(key);
    if (_creationTokens.get(key) === token) _creationTokens.delete(key);
  }
}

function getSession(handle) {
  if (!handle) return null;
  return sessions.get(String(handle).toLowerCase()) || null;
}

function endSession(handle) {
  if (!handle) return false;
  const key = String(handle).toLowerCase();
  const had = sessions.has(key);
  if(had&&recovery)recovery.retire('session:'+key);
  const canceled = _creating.has(key);
  _creationTokens.delete(key);
  _creating.delete(key);
  _fcTitleLastFetch.delete(key);
  sessions.delete(key);
  if (had) {
    console.log(`[Session] "${key}" ended`);
    scheduleSave();
  }
  return had || canceled;
}

function listSessions() {
  return [...sessions.values()].map(s => ({
    handle: s.handle,
    sessionId: s.sessionId,
    targetWord: s.isWon ? s.targetWord : null,
    guessCount: s.guesses.length,
    isWon: s.isWon,
    startTime: s.startTime,
  }));
}

// Public-facing state shape mirrors getGameState() from game-manager but lighter:
// no recent games, no leaderboard, no win counts (all are public-game concepts).
function buildSessionState(session) {
  if (!session) return null;
  return {
    targetWord: session.isWon ? session.targetWord : null,
    guesses: session.guesses,
    totalRankedWords: session.totalRankedWords,
    startTime: session.startTime,
    isWon: session.isWon,
    winner: session.winner,
    lastWinner: session.lastWinner,
    podium: getPodium(session, 7),
    isSession: true,
    sessionHandle: session.handle,
    language: languageProfiles.normalizeLanguageId(session.language),
    // Session puzzles are never daily and don't count toward the public daily.
    isDaily: false,
    // Session has its own jackpot pool, independent of public game's setting.
    jackpotEnabled: true,
    completion: recovery?.current(session)?.completion || null,
  };
}

// Calculate session-local jackpot. Same formula as the public game so wins feel
// consistent, but uses the session's guess count and start time.
function calculateSessionPot(session) {
  const guesses = session.guesses.length;
  const seconds = (Date.now() - new Date(session.startTime).getTime()) / 1000;
  let guessBonus = guesses <= 1000 ? guesses * 10 : 10000 * Math.pow(guesses / 1000, 1.5);
  let timeBonus = seconds <= 600 ? (seconds / 600) * 10000 : 10000 * Math.pow(seconds / 600, 1.5);
  return Math.max(3000, Math.round(guessBonus + timeBonus));
}

function setSessionWinner(session, guess, word) {
  session.isWon = true;
  session.winner = guess.user;
  const guessCount = session.guesses.length;
  const durationSeconds = session.startTime
    ? Math.max(0, Math.round((Date.now() - new Date(session.startTime).getTime()) / 1000))
    : null;
  // XP winner = top of podium by accumulated XP (NOT necessarily the
  // target finder). With proximity + climb scoring, a player who got
  // many ranked guesses can outrun the person who finally hit rank 1.
  // Falls back to the target finder if the podium is empty (shouldn't
  // happen — target finder gets 100k for completing the round).
  const podiumSnap = getPodium(session, 7);
  const xpWinner = podiumSnap[0] || guess.user;
  session.lastWinner = {
    user: xpWinner,             // XP winner (top podium entry)
    word,
    guessCount,
    targetFinder: guess.user,   // actual target word guesser
    podium: podiumSnap,
  };
  scheduleSave();
  return { guessCount, durationSeconds, pot: calculateSessionPot(session) };
}

// Called after a session win to begin a fresh round in the same session. No
// preload step (sessions are short-lived; the brief delay during ranking
// computation matches the streamer-visible "next game" pacing).
async function startNextSessionRound(session, config, targetWords, wordFrequency, language) {
  await _initSessionGame(session, config, targetWords, wordFrequency, language || session.language);
  console.log(`[Session] "${session.handle}" next round: target="${session.targetWord}" (language=${session.language || 'en'}, difficulty=${wordFrequency || 'normal'})`);
  scheduleSave();
  return session;
}

// Streamer-chosen target. Resets the session round to a brand-new puzzle
// using the streamer's word instead of a random pull from `targetWords`.
// Validates format + that the ranking engine can build a vector for it
// (ranking-engine returns false when the word isn't in the trained vocab,
// which would otherwise leave the session stuck on an unrankable target).
async function startSessionRoundWithWord(session, word, config) {
  if (!session || !word) throw new Error('Missing session or word');
  const owner=recovery?.current(session);
  const language = languageProfiles.normalizeLanguageId(session.language);
  const normalized = languageProfiles.normalizeGuessText(word, language);
  if (!normalized || normalized.length < 2 || normalized.length > 32) throw new Error('Word must be 2-32 letters');
  if (!rankingEngine.isValidTarget(normalized, languageProfiles.getRankingOptions(language))) {
    throw new Error(`"${normalized}" isn't a valid Searchle target — pick a more common word`);
  }
  const rankings = await rankingEngine.computeRankings(normalized, config, languageProfiles.getRankingOptions(language));
  if(owner&&(sessions.get(session.handle)!==session||recovery.current(session)?.roundId!==owner.roundId))throw Error('Searchle session changed while preparing replacement');
  const candidate={...session,language,targetWord:normalized,rankings,totalRankedWords:rankings.size,guesses:[],guessedWords:new Set(),guessedWordsRecent:[],hintLettersRevealed:0,startTime:new Date().toISOString(),lastActivityAt:Date.now(),isWon:false,winner:null,playerScores:new Map(),paidTopWords:new Set(),bestNonTop10Rank:Infinity};
  if(recovery){const record=recovery.start(candidate,'session:'+session.handle);Object.assign(session,candidate);recovery.adopt(session,record);}else Object.assign(session,candidate);
  scheduleSave();
  console.log(`[Session] "${session.handle}" target manually set: "${normalized}"`);
  return session;
}

// ── Like-for-Hint reveal ────────────────────────────────────────────
// Highest word rank the hint system will ever reveal outright. Once every
// word in ranks 2..TOP_WORD_HINT_RANK has surfaced (guessed OR hint-revealed),
// the hint escalates to a letter-by-letter reveal of the target itself rather
// than handing out ever-more-distant words (rank 11, 12, ...).
const TOP_WORD_HINT_RANK = 10;

// A hint is the platform speaking, not a player, so its chip wears the Word
// Tycoon logo. Without a profilePic the grid falls back to the first
// alphanumeric of the display name ("💡 5 Likes" → a bare "5" in the avatar
// disc). Same asset chat-relay uses as its default avatar (WT_LOGO_URL in
// src/relay.js), so hints read as platform-issued everywhere they surface.
const HINT_AVATAR_URL = 'https://wordtycoon.live/portal/img/logo.png';

function _hintLikeLabel(count) {
  const c = Number(count) || 0;
  if (c >= 1000) return `${Math.round(c / 1000)}K Likes`;
  return c > 0 ? `${c} Likes` : 'Like Hint';
}

// Two-phase reveal:
//   Phase 1 (word): reveal the closest UNGUESSED word within the top 10
//     (ranks 2..10), never the target (rank 1) — no auto-win. Injects a
//     synthetic "found" guess so it renders in the guess list like a normal
//     reveal; caller emits it over `new-guess`.
//   Phase 2 (letters): once ranks 2..10 are all surfaced, reveal the target
//     one leading letter at a time, STOPPING one letter short so the audience
//     still has to land the final guess. Letter reveals surface only on the
//     stream overlay burst (no in-game guess is injected).
// Returns a typed result:
//   { mode:'word', guess }                         — injected guess
//   { mode:'letters', masked, revealed, length }   — masked "T H _ _ _"
//   null                                            — nothing left to reveal
function revealHintWord(session, opts = {}) {
  if (!session || session.isWon || !session.rankings || !session.targetWord) return null;

  // Phase 1 — reveal words within the top 10, WEAKEST first: start at the
  // farthest unguessed rank (#10) and walk inward toward #2 on each hint.
  // Revealing #2 outright ends rounds almost instantly (it's the answer's
  // nearest neighbor), so every hint looked like "#2"; easing in from #10
  // keeps rounds alive and makes the escalation visible. rankings is a
  // Map<word, rank> with rank 1 = target. One linear pass; hints are rare.
  let bestWord = null;
  let bestRank = -Infinity;
  for (const [word, rank] of session.rankings) {
    if (rank <= 1 || rank > TOP_WORD_HINT_RANK) continue;  // never the answer; cap at top 10
    if (rank <= bestRank) continue;
    if (session.guessedWords.has(word)) continue;
    bestWord = word;
    bestRank = rank;
    if (rank === TOP_WORD_HINT_RANK) break;   // nothing farther than the cap
  }

  if (bestWord) {
    session.guessedWords.add(bestWord);
    const guess = {
      word: bestWord,
      rank: bestRank,
      user: {
        id: null,
        platformUserId: 'like-hint',
        displayName: `💡 ${opts.label || _hintLikeLabel(opts.count)}`,
        username: null,
        profilePic: HINT_AVATAR_URL,
        platform: 'system',
        customColor: '#c084fc',
        cosmetics: {},
        linkedDiscord: null,
        isFanClub: false, isSuperfan: false, isDonor: false,
        isHint: true,
      },
      isHint: true,
      timestamp: new Date().toISOString(),
    };
    session.guesses.push(guess);
    scheduleSave();
    return { mode: 'word', guess };
  }

  // Phase 2 — letter-by-letter reveal of the target, one letter short.
  const target = String(session.targetWord || '');
  const maxReveal = Math.max(0, target.length - 1);   // stop 1 short of the full word
  const already = Number(session.hintLettersRevealed) || 0;
  if (already >= maxReveal) return null;              // nothing new without giving it away
  const revealed = already + 1;
  session.hintLettersRevealed = revealed;
  scheduleSave();
  return {
    mode: 'letters',
    masked: _maskWord(target, revealed),
    revealed,
    length: target.length,
  };
}

// "ocean", 2 → "O C _ _ _" (spaced so the overlay burst reads clearly).
function _maskWord(word, revealedCount) {
  return [...String(word)]
    .map((ch, i) => (i < revealedCount ? ch.toUpperCase() : '_'))
    .join(' ');
}

module.exports = {
  setRecovery, allSessions:()=>[...sessions.values()],
  getOrCreateSession,
  getSession,
  endSession,
  listSessions,
  buildSessionState,
  setSessionWinner,
  startNextSessionRound,
  startSessionRoundWithWord,
  awardForGuess,
  getPodium,
  scheduleSave,
  revealHintWord,
};
