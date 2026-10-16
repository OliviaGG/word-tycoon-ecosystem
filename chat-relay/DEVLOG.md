# Word Tycoon Ecosystem — Development Log

## Session: March 12, 2026

### March 12 — Multi-Task Update + Security Audit

#### Task 1: Word Mine SP — Sync with MP Features
- SP engine (`sp-engine.js`) updated to use dynamic thresholds from server instead of hardcoded values
- Variable bonus letter count (no longer assumes exactly 3)
- Auto-skip for 0-word tiers (ported from MP game.js)
- Server (`server.js`) now includes thresholds in pool mine endpoint (`/api/mines/:id`)
- Save/restore state preserves `depthThresholds`

#### Task 2: Frequency Data Rebuild
- Rebuilt `frequency.json` using `tools/build-frequency-expanded.js`
- **121,042 entries** (up from 24,323): wordfreq=93,006 primary, en_50k=9 fallback, inflections=28,027
- 68.3% dictionary coverage (was ~14%)
- Sources: `wordfreq-full.json` (7+ corpora), `en_50k.txt` (capped Zipf 4.0), inflection derivation (-1.0 Zipf)

#### Task 3: Squaredle + Spelling Bee — Frequency Update
- No code changes needed — both consume frequency.json from Chat Relay
- Squaredle loaded 240,427 words on restart (expanded coverage)
- Spelling Bee loaded 128,852 words with 6,285 targets

#### Task 4: Betweenly — Larger Arrows and Numbers
- Both `game.css` (OBS overlay) and `play.css` (player mode) updated:
  - `.bnd-arrow`: 0.85–0.9rem → 1.4rem
  - `.bnd-distance`: 0.6rem → 1.0rem
  - `.bnd-label`: 0.6–0.65rem → 0.85rem
  - Responsive (max-width 400px): arrows now visible (was `display:none`), 0.9rem

#### Task 5: Cosmetics "New" Badge Fix
- **Bug 1**: `markAllCosmeticsSeen()` called BEFORE `renderCosmetics()` — fixed: render first, mark seen after 3s delay
- **Bug 2**: Aggressive seeding on page load marked ALL owned cosmetics as seen — removed
- **Bug 3**: Filter element ID `cosmetic-filter` → `cosmetic-category-filter` (wrong ID reference)

#### Task 6: Pizza Prestige XP Scaling
- First prestige (0→1) keeps base XP curve unchanged
- Each subsequent prestige doubles XP requirement: `pMult = 2^(prestigeLevel-1)` for prestige > 1
- Updated both GET endpoint and collect/level-up loop in Word Tycoon server.js

#### Task 7: Word Color/Glow Default Visibility
- New users now have `word_color` and `word_glow` OFF by default
- Server: `DEFAULT_VISIBILITY = { word_color: false, word_glow: false }` in game-engine.js
- Portal: `DEFAULT_OFF = { word_color: true, word_glow: true }` in portal.js visibility settings

#### Task 8: Security Audit + Fixes
- Full security audit across recent changes (5 files, 10 findings)
- **Fixed (3 MEDIUM)**: Unescaped `c.rarity` and `c.buff.label` in innerHTML, CSS injection in cosmetic previews
- Added `escapeHtml()` wrapping and `sanitizeCssValue()` function for CSS property sanitization
- **Noted (LOW)**: SP dictionary exposure (inherent to architecture), CORS wildcard, mine solve caching

### Files Modified (March 12)

| File | Summary |
|------|---------|
| `C:\Word Mine\public\js\sp-engine.js` | Dynamic thresholds, auto-skip, variable bonus |
| `C:\Word Mine\server.js` | Thresholds for pool mines |
| `C:\Chat Relay\data\word-bank\frequency.json` | Rebuilt: 24,323 → 121,042 entries |
| `C:\Betweenle\public\game.css` | Larger arrows/numbers (OBS) |
| `C:\Betweenle\public\play.css` | Larger arrows/numbers (player) |
| `C:\Chat Relay\public\portal\js\portal.js` | New badge fix, visibility defaults, security fixes |
| `C:\Word Tycoon\src\pizza-config.js` | Prestige XP scaling |
| `C:\Word Tycoon\server.js` | Pass prestige_level to xpForLevel |
| `C:\Word Tycoon\src\game-engine.js` | Default visibility filter |

---

## Session: March 10–11, 2026

### March 10 — Searchle MP Word Replay Bug Fix

**Critical bug**: Searchle MP was replaying already-won words via the daily word path. "spiky" was played **7 times** on March 10 alone.

**Root cause**: `startGameWithWord()` in `game-manager.js` did NOT check the `wonWords` set. The daily word flow (`startNextGame()` → `startGameWithWord()`) bypassed won-word exclusion. Combined with `dailyPlayed` being an in-memory flag that resets on every PM2 restart, this caused the daily word to be replayed on every server restart.

**Fixes applied**:
1. `game-manager.js` `startGameWithWord()` — added `wonWords.has()` check, rejects already-won words (returns false)
2. `server.js` `startNextGame()` — sets `dailyPlayed = true` when daily word is rejected, preventing repeated retry attempts
3. `game-manager.js` `startGameWithWord()` — clears `_preloaded = null` to avoid stale preloaded data
4. Cleaned 27 duplicate win history entries (663 → 636) caused by the replay bug

**Files modified**: `C:\Searchle 3.0\server\game-manager.js`, `C:\Searchle 3.0\server\server.js`
**Deployed**: Both files SCP'd to production, PM2 restarted, verified via logs

---

## Session: March 9–10, 2026

### March 9 — Ecosystem Audit Round 2

Full audit across all 16 game servers, 175 issues found and fixed:

- **Security**: Cosmetics-broadcast auth added, game proxy key injection removed, secret logging removed (Betweenly/Wordle)
- **Auth**: Wordle MP switched Google→GitHub OAuth, CORS origins fixed
- **Consolidation**: Duplicate cosmetics cache consolidated, Searchle `reportLibraryWord` → `gameShared`
- **Fixes**: Squaredle PM2 limit 200→400MB, Squaredle reportLibraryWord username fix, PixeLetters dead CSS ref removed, Searchle weekly numbering stability fix
- **Cleanup**: `google-oauth.js` deleted (dead code), overlay settings persistence, session secret fallback, dead files removed

### March 10 — Dictionary Expansion + Searchle Model Upgrade

#### Dictionary Expansion
- 5-letter dictionary expanded from 8,636 → 12,986 words via SOWPODS + Wordle dictionary merge
- 30 missing target words fixed across other lengths
- All games verified using shared word bank

#### Searchle Embedding Model Upgrade
- **Problem**: 3-model system (GloVe + Word2Vec + FastText) had 50% model disagreement, 115 semantically isolated words
- **Solution**: Replaced with ConceptNet Numberbatch + FastText (2-model RRF)
- **Numberbatch**: Knowledge-graph-enhanced embeddings (IsA, PartOf, RelatedTo), SimLex-999 score 0.64 vs GloVe 0.37
- **Results**: Isolated words dropped from 115 → 1, memory ~508MB (down from ~650MB)
- **New tools**: `tools/isolation-scan.js` (semantic isolation analysis), `tools/convert-float16.js` (float32→float16 conversion)
- **Files modified**: `server/ranking-engine.js`, `server/config.js`, `tools/build-model.js`
- **Deployed**: Model files + config to production, verified via PM2 logs

### Files Modified (March 9–10)

| File | Summary |
|------|---------|
| `C:\Chat Relay\data\word-bank\dictionary.json` | 5-letter words expanded 8,636→12,986 |
| `C:\Chat Relay\data\word-bank\targets.json` | 30 missing targets added |
| `C:\Searchle 3.0\server\ranking-engine.js` | Default models changed to Numberbatch+FastText |
| `C:\Searchle 3.0\server\config.js` | activeModels and modelWeights updated |
| `C:\Searchle 3.0\tools\build-model.js` | Added Numberbatch model definition |
| `C:\Searchle 3.0\tools\convert-float16.js` | New: float32→float16 converter |
| `C:\Searchle 3.0\tools\isolation-scan.js` | New: semantic isolation scanner |
| `C:\Searchle 3.0\data\models\numberbatch\` | New: built model (359K words, 300d, float16) |

---

## Session: March 1–6, 2026

### Overview

Massive multi-day development sprint covering the entire Word Tycoon ecosystem: 8 word games, the Chat Relay hub, the Word Tycoon economy server, and the player portal at `wordtycoon.live/me`. Work ranged from new game modes, new features, critical security fixes, and a full ecosystem audit.

---

## Table of Contents

1. [New Features](#1-new-features)
2. [Security Fixes](#2-security-fixes)
3. [Server Hardening](#3-server-hardening)
4. [Portal Overhaul](#4-portal-overhaul)
5. [Bug Fixes](#5-bug-fixes)
6. [Ecosystem Audit](#6-ecosystem-audit)
7. [Deployment Log](#7-deployment-log)
8. [Files Modified](#8-files-modified)

---

## 1. New Features

### 1.1 Daily & Weekly Challenge System

All 8 games now support daily and/or weekly challenge modes launched from the portal overview.

- **Daily challenges** (6 games): Searchle, Word 500, Wordle, Betweenly, PixeLetters, Figural
- **Weekly challenges** (2 games): Spelling Bee, Squaredle (converted from daily to weekly with cosmetic reward)
- Portal pills launch games directly into the correct mode via `?mode=daily` or `?mode=weekly`
- Daily completions sync to server and persist across devices (`POST /api/sp-daily/complete/:gameId`)
- Weekly completions tracked separately (`POST /api/sp-weekly/complete/:gameId`)
- 5-minute TTL on sync flag handles midnight date rollover
- Countdown timer shows hours:minutes:seconds until UTC midnight reset

### 1.2 Reward Display on Portal

- **Daily section**: Subtitle "Complete for a Loot Box 🎁", completed pills show "🎁 Loot Box" in gold
- **Weekly section**: Subtitle "Complete for a Cosmetic 🎰 • X days left", completed pills show "🎰 Cosmetic"
- Uncompleted pills show "Play" for both daily and weekly

### 1.3 Daily Loot Box System

Procedural cosmetic generation system in Word Tycoon:

- SHA-256 seeded RNG (date + userId) for deterministic daily rewards
- Rarity distribution: Common 60%, Uncommon 25%, Rare 10%, Epic 3.5%, Legendary 1.2%, Ultra 0.3%
- 7 cosmetic categories: borders, auras, name colors, word colors, backgrounds, titles, badges
- Database tables: `generated_cosmetics`, `hasGeneratedCosmeticForDate()`, `insertGeneratedCosmetic()`
- Endpoint: `/api/daily-loot/status/:discordUserId`

### 1.4 Spelling Bee & Squaredle → Weekly Challenges

Converted from daily to weekly puzzle rotation:

- `fetchWeeklyWord()` uses deterministic weekly seed from Word Bank API
- `/api/sp/weekly` endpoint on both game servers
- Legacy `/api/sp/daily` redirects to weekly for backward compat
- Weekly completion awards a cosmetic via `checkAndAwardWeeklyCosmetic()`

### 1.5 Cross-Device Game State Sync

All SP games save/restore game state to server for logged-in users:

- `POST /api/sp-state/:gameId` — save state (50KB max)
- `GET /api/sp-state/:gameId` — restore state
- `DELETE /api/sp-state/:gameId` — clear state
- Init race condition fixed across all games: `fetchDaily(cb)` callback pattern ensures daily word loads before state restore

### 1.6 Shared Word Bank — Weekly Word API

Added to `src/word-bank.js`:

- `getWeekStart()` — ISO week start (Monday) calculation
- `getWeeklyWord(gameId)` — deterministic weekly word using game-specific seed
- `GET /api/word-bank/weekly/:gameId` — REST endpoint
- `uniqueLetters` parameter for Spelling Bee (7 unique letters required)

### 1.7 Portal Consolidated Game View

Replaced 16 individual game entries with 8 combined cards (SP + MP per game):

- "Word Games" tab replaces individual game tabs (Searchle, Word500, etc.)
- Each card shows both Online and SP stats
- Player count badges on live games
- Pizza Shop removed from tabs, accessible only through Businesses page

### 1.8 GOAT (Hall of Fame) Page

- New page at `wordtycoon.live/goat`
- Top players across all games
- Stats synced from Word Tycoon database

### 1.9 Self-Service Account Linking

- Google OAuth added alongside Discord OAuth (later swapped to GitHub OAuth due to Google verification requirements)
- Users can link/unlink accounts from portal
- Auto-link via Discord Connections API (TikTok, YouTube, Twitch)
- Cross-link flow: logged in as Provider A → link Provider B → session switches to Discord anchor

### 1.10 Word Frequency System

- `data/word-bank/frequency.json` — 24,323 words with Zipf scores from wordfreq-en-25000
- API: `GET /api/word-bank/common`, `GET /api/word-bank/frequency/:word`
- Used by Spelling Bee and Squaredle for rare word classification

---

## 2. Security Fixes

### 2.1 CRITICAL: Store Vulnerability

**Problem**: Admin cosmetic grant endpoints were publicly accessible through the game reverse proxy. One IP (`70.65.71.220`) attempted GET on the grant endpoint. Users could potentially buy all cosmetics without paying.

**Fix**: Added API key middleware to all admin endpoints on Word Tycoon. Authentication required for all grant/revoke operations.

### 2.2 CRITICAL: Purchase Bug — No Money Deduction

**Problem**: Cosmetic purchases were not deducting coins from player accounts.

**Fix**: Atomic conditional deduction `UPDATE players SET coins = coins - ? WHERE discord_id = ? AND coins >= ?`. The `WHERE coins >= ?` clause prevents negative balance exploits.

### 2.3 Prototype Pollution via GameId

**Problem**: `gameId` from URL params (`/api/sp-state/:gameId`) used directly as object key with no validation. Attacker could use `__proto__`, `constructor`, etc.

**Fix**: Whitelist validation — `VALID_SP_GAME_IDS` Set with all 10 valid game IDs. Rejects anything not in the set.

```javascript
const VALID_SP_GAME_IDS = new Set([
  'word500-sp', 'searchle-sp', 'wordle-sp', 'betweenly-sp',
  'pixeletters-sp', 'figural-sp', 'spellingbee-sp', 'squaredle-sp',
  'spellingbee-sp-weekly', 'squaredle-sp-weekly'
]);
```

### 2.4 Word 500 SP Keyboard Information Leak

**Problem**: Word 500 SP mode keyboard was revealing information about the secret word through letter coloring before the player had guessed.

**Fix**: Keyboard only updates colors based on player's actual guesses.

---

## 3. Server Hardening

Applied to `C:\Chat Relay\server.js` — all SP game endpoints:

### 3.1 File Locking

Concurrent read-modify-write operations on JSON files (daily completions, game state) could cause data loss when two requests hit simultaneously.

```javascript
const fileLocks = {};
function withFileLock(filePath, fn) {
  if (!fileLocks[filePath]) fileLocks[filePath] = Promise.resolve();
  const prev = fileLocks[filePath];
  const next = prev.then(fn, fn);
  fileLocks[filePath] = next.catch(() => {});
  return next;
}
```

All SP endpoints (`/api/sp-daily/complete`, `/api/sp-weekly/complete`, `/api/sp-state`) now use `await withFileLock()`.

### 3.2 Atomic Writes

Prevents partial/corrupt writes on crash:

```javascript
function saveJsonFile(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}
```

### 3.3 Error Logging + Corrupt File Backup

```javascript
function loadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('[SP] Failed to load', filePath, ':', e.message);
      const backupPath = filePath + '.corrupt.' + Date.now();
      fs.copyFileSync(filePath, backupPath);
    }
    return {};
  }
}
```

### 3.4 State Size Limit

50KB max per game per user to prevent disk exhaustion:

```javascript
const MAX_STATE_SIZE = 50 * 1024;
if (JSON.stringify(state).length > MAX_STATE_SIZE) {
  return res.status(413).json({ error: 'State too large' });
}
```

### 3.5 Word Tycoon Server Hardening

- API key middleware on admin endpoints
- `Number.isFinite()` guards on all coin operations
- NaN validation on rewards
- Reward cap per game
- Rate limiting on sensitive endpoints
- CORS whitelist
- Localhost binding for inter-service communication
- XSS sanitization on pizza shop name input
- Prestige cap at 10 levels
- Total multiplier cap (1500x)

---

## 4. Portal Overhaul

### 4.1 Visibility Change Handler

Pauses intervals when tab is hidden, resumes and re-syncs on focus:

```javascript
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    clearInterval(dailyCountdownInterval);
    clearInterval(liveGamesInterval);
  } else {
    dailyCountdownInterval = setInterval(updateDailyCountdown, 1000);
    syncCompletionsFromServer().then(function() {
      renderDailyTracker();
      renderWeeklyTracker();
    });
  }
});
```

### 4.2 Sync TTL

`spSyncDone` flag now has 5-minute TTL so completions re-sync on midnight rollover:

```javascript
var SP_SYNC_TTL = 5 * 60 * 1000;
async function syncCompletionsFromServer() {
  if (spSyncDone && (Date.now() - spSyncTimestamp < SP_SYNC_TTL)) return;
  // ...fetch and sync...
  spSyncDone = true;
  spSyncTimestamp = Date.now();
}
```

### 4.3 Duplicate Shop Fetch Elimination

`loadCosmetics()` now checks `shopCatalog.length` before fetching `/api/me/shop`.

### 4.4 Null Guards

Added null checks for preview DOM elements (`preview-avatar`, stats elements) and all Searchle stat functions.

### 4.5 Responsive CSS

Added 380px breakpoint for very small screens — `ov-stats-grid` and `games-grid` switch to single column.

### 4.6 Chat Widget Socket.IO Guard

```javascript
function connectSocket() {
  if (typeof io !== 'function') {
    console.warn('[Chat Widget] Socket.IO not loaded, retrying in 2s...');
    setTimeout(connectSocket, 2000);
    return;
  }
  chatSocket = io(window.location.origin, { ... });
}
```

---

## 5. Bug Fixes

| # | Bug | Root Cause | Fix |
|---|-----|-----------|-----|
| 1 | Pizza collect showing "failed" | Displaying total balance not uncollected amount | Show pending coins, 5s collect interval |
| 2 | Duplicate cosmetics equipped | No one-per-type enforcement | Added type uniqueness constraint |
| 3 | Cosmetic buff showing 2 numbers | Display logic showing both buff value and label | Simplified to label only |
| 4 | Wordle rejecting common words | Using target list as dictionary (not full word list) | Dictionary now fetched from word bank's full dictionary endpoint |
| 5 | Daily game reset on word length change | Length change triggered new game instead of restoring saved state | Always restore daily from saved state |
| 6 | SP login prompt showing when logged in | Session check happening after UI render | Check session before rendering login UI |
| 7 | Portal `loadSearchleStats()` null crash | DOM elements removed by tab consolidation, function still referenced them | Added null guards, early return if elements missing |
| 8 | Portal `loadSearchleSPStats()` null crash | Same as above — catch block also referenced null elements | Added null guards throughout |
| 9 | Searchle auto-restart broken | Game not generating new word after completion | Fixed game manager restart logic |
| 10 | OAuth redirect loops | Callback URLs redirecting to OAuth again | Fixed redirect targets |
| 11 | Portal intervals never cleared | `setInterval` running forever, even on hidden tabs | Visibility change handler clears on hide |
| 12 | Stats sync discrepancy | Wins split across linked platform accounts | Account merge consolidates stats |
| 13 | Word 500 using obscure target words | Legacy word list included archaic/Scrabble-only words | Switched to curated word bank targets |
| 14 | Init race condition (all games) | Daily word fetch async, game state restore happened before word loaded | `fetchDaily(cb)` callback pattern |

---

## 6. Ecosystem Audit

### Methodology

Three parallel agents scanned the entire codebase:
1. **Portal agent** — portal.js, portal.css, index.html deep review
2. **Game SP engines agent** — all 8 game SP engines
3. **Server endpoints agent** — Chat Relay server.js, Word Tycoon server.js, data flow

### Issues Addressed (12)

| Issue | Category | Resolution |
|-------|----------|------------|
| Server data race conditions | Critical | File locking |
| Silent data loss on JSON parse | Critical | Error logging + backup |
| GameId prototype pollution | Critical | Whitelist validation |
| No state size limit | High | 50KB max |
| Non-atomic file writes | High | tmp + rename pattern |
| Portal interval memory leak | High | Visibility change handler |
| spSyncDone no TTL | Medium | 5-minute TTL |
| Duplicate shop fetch | Medium | Cache check |
| Preview null pointer | Medium | Null guards |
| SearchleSP stats null crash | Medium | Null guards |
| Chat widget io() not loaded | Medium | Retry with guard |
| CSS responsive gap at 380px | Low | Added breakpoint |

### False Positives / Non-Issues (5)

Issues flagged by review agents that were verified as already handled or not bugs:

| Flagged Issue | Why It's Not a Bug |
|---------------|-------------------|
| Spelling Bee SP "missing implementations" | All functions exist (lines 1440, 1452, 1459), `fetchServerCompletions` called from `checkSession()` line 554 |
| `clearGameStateFromServer()` "missing session check" | All 4 games already have `if (!userSession) return;` |
| Portal "event listener leak" on `innerHTML =` | `innerHTML =` replaces DOM nodes, destroying old listeners |
| Squaredle "endpoint mismatch" (`squaredle-sp-weekly`) | Data keys are actually consistent across client and server |
| Dead DOM `#live-games` container | Used by `renderLiveGames()` which toggles display |

### Deferred Issues (Not Addressed This Session)

- Mixed `var`/`let`/`const` across games (cosmetic, low priority)
- `serverCompletedDates` as `{}` instead of `Set` (works, suboptimal)
- Inconsistent error response formats across endpoints
- Some games still using legacy SP endpoints instead of word bank API

---

## 7. Deployment Log

All deployments to production droplet at `64.23.145.183` via SCP.

### PM2 Restarts Required

| Service | PM2 Name | When |
|---------|----------|------|
| Chat Relay | `mobile-relay` | After server.js hardening |
| Word Tycoon | `word-tycoon` | After security fixes, loot box system |
| Spelling Bee | `spellingbee` | After weekly conversion |
| Squaredle | `squaredle` | After weekly conversion |
| Wordle | `wordle` | After word bank fix |

### Static Files (No Restart Needed)

Portal files (`index.html`, `portal.js`, `portal.css`, `chat-widget.js`) deployed 8+ times during the session, cache-busted from `?v=3` to `?v=11`.

### Final Production State

- All 8 games running with daily/weekly challenge support
- Portal v=11 with zero console errors
- Server hardened with file locking, atomic writes, validation
- Word Tycoon secured with API keys, rate limiting, input validation

---

## 8. Files Modified

### Chat Relay (`C:\Chat Relay\`)

| File | Summary |
|------|---------|
| `server.js` | SP endpoints, file locking, atomic writes, gameId validation, state limits, weekly endpoints |
| `src/word-bank.js` | Weekly word API, `getWeekStart()`, `getWeeklyWord()` |
| `public/portal/index.html` | Tab consolidation, daily/weekly subtitle divs, cache bust v3→v11 |
| `public/portal/js/portal.js` | Daily/weekly renderers, reward display, visibility handler, sync TTL, null guards |
| `public/portal/css/portal.css` | Reward chip styles, countdown, responsive 380px breakpoint |
| `public/chat-widget.js` | Socket.IO load guard with retry |

### Word Tycoon (`C:\Word Tycoon\`)

| File | Summary |
|------|---------|
| `server.js` | API key auth, NaN validation, reward caps, rate limiting, CORS, pizza collect fix |
| `src/database.js` | Weekly completions table, generated cosmetics table, atomic deduction, prestige cap |
| `src/game-engine.js` | Weekly cosmetic award, multiplier cap, frenzy centralization |
| `src/cosmetics.js` | Full procedural loot box generation system |
| `src/pizza-config.js` | Rebalanced progression |

### Game Servers

| Game | Files | Summary |
|------|-------|---------|
| Spelling Bee | `server.js`, `public/js/sp-engine.js` | Daily→weekly conversion |
| Squaredle | `server.js`, `public/sp-engine.js` | Daily→weekly conversion |
| Wordle | `server.js`, `public/sp-engine.js` | Word bank dictionary fix |
| Word 500 | `public/play.js` | Daily state management, mode launch |
| Betweenly | `public/sp-engine.js` | Game state sync |
| PixeLetters | `public/sp-engine.js` | Game state sync |
| Figural | `public/sp-engine.js` | Game state sync |
| Searchle | Multiple server + client files | Cosmetics, SP mode, relay updates |
