// ===== Board Pool (erecTangled / Sproutle) =====
// Grid generation runs a fixed retry loop (up to 1500 attempts on a 9x7) that
// takes ~5s and blocks the event loop, so a round used to freeze the server
// every time it restarted. This pool builds boards ahead of time,
// asynchronously, and hands one over instantly when a round ends.
//
// Contract:
//   takeOrBuild()  → a ready Game if one is warm, otherwise builds one inline
//                    (blocking, same as before) so callers always get a board.
//                    Either way it re-primes the pool for next time.
//   prime()        → top the pool back up to POOL_DEPTH, one build at a time.
//
// Staleness: a pooled board is checked against the CURRENT dictionary at take
// time, by confirming every required (common) word is still in the trie. A word
// removed from the Word Bank must never survive in a board's required list or
// the round becomes uncompletable.
//
// Note this deliberately does NOT compare Trie identity. wordlist swaps in a
// brand-new Trie every 15 minutes whether or not the words changed, so identity
// comparison would discard the entire pool on every refresh and rebuild all of
// it — ~53s of CPU per 15 minutes at depth 10. Checking the words themselves
// costs a few hundred trie lookups and is free when nothing actually changed.
// MAX_BOARD_AGE_MS is the backstop that eventually recycles boards so newly
// ADDED dictionary words work their way in.

const { Game } = require('./game');

const POOL_DEPTH = 10;                          // warm boards kept per size
const MAX_KEYS = 4;                             // distinct sizes pooled at once
const MAX_BOARD_AGE_MS = 6 * 60 * 60 * 1000;    // recycle after 6h

const READY = new Map();    // key -> [{ game, builtAt }]  (oldest first)
const BUILDING = new Map(); // key -> in-flight refill chain
const LAST_USED = new Map(); // key -> timestamp, for LRU eviction

function _key(rows, cols, minWordLength) {
    return `${rows}x${cols}:${minWordLength}`;
}

// Drop the least-recently-used size pools once more than MAX_KEYS exist, so
// an admin cycling through MP grid sizes can't accumulate pools indefinitely.
function _evictExtraKeys() {
    while (READY.size > MAX_KEYS) {
        let oldestKey = null;
        let oldestAt = Infinity;
        for (const key of READY.keys()) {
            const at = LAST_USED.get(key) || 0;
            if (at < oldestAt) { oldestAt = at; oldestKey = key; }
        }
        if (!oldestKey) return;
        const dropped = (READY.get(oldestKey) || []).length;
        READY.delete(oldestKey);
        LAST_USED.delete(oldestKey);
        console.log(`[BoardPool] evicted unused size ${oldestKey} (${dropped} board(s))`);
    }
}

// A board is usable if it hasn't aged out and every word it will REQUIRE
// players to find is still in the live dictionary.
function _isUsable(entry, wordlist) {
    if (Date.now() - entry.builtAt > MAX_BOARD_AGE_MS) return false;
    const trie = wordlist.getTrie();
    if (!trie) return false;
    for (const word of entry.game.commonWords.keys()) {
        if (!trie.has(word)) return false;
    }
    return true;
}

/**
 * Take a warm board for this size, or null if none is ready. Stale boards are
 * discarded rather than returned. The caller owns the returned Game; its
 * startTime is reset to now.
 */
function take(wordlist, rows, cols, minWordLength) {
    const key = _key(rows, cols, minWordLength);
    LAST_USED.set(key, Date.now());
    const list = READY.get(key);
    if (!list || list.length === 0) return null;

    let discarded = 0;
    while (list.length > 0) {
        const entry = list.shift();
        if (_isUsable(entry, wordlist)) {
            if (discarded > 0) {
                console.log(`[BoardPool] ${key} discarded ${discarded} stale board(s)`);
            }
            entry.game.startTime = Date.now();
            return entry.game;
        }
        discarded++;
    }
    console.log(`[BoardPool] ${key} discarded ${discarded} stale board(s) — pool empty`);
    return null;
}

/**
 * Top the pool back up to POOL_DEPTH for this size. Builds run one at a time
 * so filling a cold pool can't saturate the CPU. Returns the in-flight chain;
 * callers can ignore it — failures are logged, never thrown.
 */
function prime(wordlist, rows, cols, minWordLength) {
    const key = _key(rows, cols, minWordLength);
    if (BUILDING.has(key)) return BUILDING.get(key);
    if (!wordlist.getTrie()) return Promise.resolve(); // wordlist not loaded yet
    if ((READY.get(key) || []).length >= POOL_DEPTH) return Promise.resolve();

    const chain = (async () => {
        // Re-checked each pass, so a take() mid-refill extends the run.
        while ((READY.get(key) || []).length < POOL_DEPTH) {
            const startedAt = Date.now();
            const game = new Game();
            await game.initializeAsync(rows, cols, minWordLength, wordlist.getTrie(), wordlist.getTargetSet(), {
                frequencyMap: wordlist.getFrequencyMap()
            });
            const list = READY.get(key) || [];
            list.push({ game, builtAt: Date.now() });
            READY.set(key, list);
            if (!LAST_USED.has(key)) LAST_USED.set(key, Date.now());
            _evictExtraKeys();
            console.log(`[BoardPool] ${key} ${list.length}/${POOL_DEPTH} warm (+1 in ${((Date.now() - startedAt) / 1000).toFixed(1)}s, ${game.commonWords.size} common)`);
        }
    })()
        .catch(err => console.error(`[BoardPool] ${key} build failed:`, err.message))
        .finally(() => BUILDING.delete(key));

    BUILDING.set(key, chain);
    return chain;
}

/**
 * The normal entry point: hand back a board now, and top the pool back up.
 * Falls back to a blocking build only when the pool is cold — at boot, or if
 * demand has drained all POOL_DEPTH boards faster than they rebuild.
 */
function takeOrBuild(wordlist, rows, cols, minWordLength) {
    const warm = take(wordlist, rows, cols, minWordLength);
    if (warm) {
        prime(wordlist, rows, cols, minWordLength);
        return warm;
    }

    console.log(`[BoardPool] ${_key(rows, cols, minWordLength)} cold — building inline`);
    const game = new Game();
    game.initialize(rows, cols, minWordLength, wordlist.getTrie(), wordlist.getTargetSet(), {
        frequencyMap: wordlist.getFrequencyMap()
    });
    prime(wordlist, rows, cols, minWordLength);
    return game;
}

/** Warm-board count per size — for logging / admin visibility. */
function stats() {
    const out = {};
    for (const [key, list] of READY) out[key] = list.length;
    return out;
}

module.exports = { take, prime, takeOrBuild, stats, POOL_DEPTH };
