# Cross-Game Integration Guide

How to connect a new game server to the Word Tycoon ecosystem.

---

## Required Environment Variables

```bash
GAME_API_SECRET=<shared_secret>        # Required. Server exits if missing.
WORD_EMPIRES_URL=http://localhost:3020 # Word Tycoon base URL
```

---

## 1. Report Round Results to Word Tycoon ELO

After every round ends, POST results to Word Tycoon.

### Minimal Example (Node.js)

```js
const WORD_EMPIRES_URL = process.env.WORD_EMPIRES_URL || 'http://localhost:3020';
const API_SECRET = process.env.GAME_API_SECRET;

function getIdentityKey(user) {
  if (!user || typeof user !== 'object') return null;
  if (user.linkedDiscord) return `discord:${user.linkedDiscord}`;
  if (user.platformUserId && user.platform) return `${user.platform}:${user.platformUserId}`;
  return `nick:${String(user.displayName || '').toLowerCase()}`;
}

async function reportRoundToWordTycoon(gameName, round) {
  // Build participants array from your round data
  const participants = round.players
    .filter(p => p.points > 0)
    .sort((a, b) => b.points - a.points)
    .map((p, idx, arr) => ({
      identityKey: getIdentityKey(p.user),
      points: p.points,
      rank: idx + 1,
      rankOutOf: arr.length,
      guesses: p.guesses || 0,
      hits: p.hits || 0,
      firstHitMs: p.firstHitMs || null,
      wonRound: idx === 0,
      foundTarget: p.foundTarget || false,
      articleTitle: round.title || '?',
    }));

  if (participants.length < 2) return;

  try {
    const res = await fetch(`${WORD_EMPIRES_URL}/api/elo/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_SECRET,
      },
      body: JSON.stringify({ game: gameName, participants }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[${gameName}] ELO report failed: ${res.status} ${text}`);
    }
  } catch (e) {
    console.log(`[${gameName}] ELO report error: ${e.message}`);
  }
}
```

### Where to Call It

| Game | Hook | File |
|------|------|------|
| WikiSearchle | `aggregateRoundIntoStats(round)` | `server.js` |
| Searchle | `onWin` callback in `handleGuess()` | `server/server.js` |
| Erectangled | `handleGameComplete()` | `server.js` |
| Rectangled | `handleGameComplete()` | `server.js` |

---

## 2. Reward Players via Word Tycoon

Use `gameShared.rewardPlayer()` from the Chat Relay's `game-shared.js` module to award coins for wins.

```js
const gameShared = require('/opt/chat-relay/src/game-shared.js');
gameShared.init({ wordEmpiresUrl: WORD_EMPIRES_URL, apiSecret: API_SECRET, io });

gameShared.rewardPlayer(
  platform,           // 'web', 'tiktok', 'youtube', etc.
  platformUserId,     // user's canonical ID
  username,           // username or display name
  displayName,        // display name
  pot,                // coin amount
  'gamename',         // e.g. 'wikisearchle', 'searchle'
  'win',              // event type
  { guessCount, word, durationSeconds }  // metadata
);
```

---

## 3. IP Logging for Anti-Cheat

Log every connection + guess with the player's origin IP. This enables IP-based suspension when identity-based bans are evaded.

```js
// On socket connection
const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
console.log(`[Game] CONNECT ip=${ip} id=${socket.id}`);

// On guess
console.log(`[Game] GUESS_IP ip=${ip} platformUserId=${puid} nickname=${nickname} word=${word}`);
```

Add a debug endpoint to inspect active sockets:

```js
app.get('/api/debug/sockets', requireAdmin, (req, res) => {
  const sockets = Array.from(io.sockets.sockets.values()).map(s => ({
    id: s.id,
    ip: s.handshake.headers['x-forwarded-for'] || s.handshake.address,
    nickname: s.handshake.auth?.nickname || null,
  }));
  res.json({ count: sockets.length, sockets });
});
```

---

## 4. Identity Key Consistency

All games MUST use the same identity key format so ELO travels with the player:

```
discord:<17-20_digit_discord_id>
web:<platform_user_id>
tiktok:<platform_user_id>
youtube:<platform_user_id>
nick:<lowercase_display_name>
```

**Discord detection heuristic** (for games that don't receive `linkedDiscord` explicitly):
```js
function getIdentityKey(platform, platformUserId, displayName) {
  if (!platformUserId) return null;
  // platform='web' + numeric 17-20 digits = Discord-linked
  if (platform === 'web' && /^\d{17,20}$/.test(String(platformUserId))) {
    return `discord:${platformUserId}`;
  }
  if (platform && platformUserId) return `${platform}:${platformUserId}`;
  return `nick:${String(displayName || '').toLowerCase()}`;
}
```

---

## 5. Admin API Authentication

Word Tycoon and all games share the same admin secret:

```js
function requireAdmin(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.adminKey;
  if (key === process.env.GAME_API_SECRET) return next();
  res.status(403).json({ error: 'Unauthorized' });
}
```

Use `x-api-key: <GAME_API_SECRET>` for all admin requests.

---

## Full Endpoint Map

### Word Tycoon (port 3020)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/elo/update` | `x-api-key` | Receive round results from games |
| `GET /api/elo/:game/leaderboard` | Public | Per-game leaderboard |
| `GET /api/elo/global/leaderboard` | Public | Cross-game leaderboard |
| `GET /api/elo/cheaters` | `x-api-key` | Suspicion panel |
| `GET /api/elo/player/:identityKey` | `x-api-key` | Player profile |
| `POST /api/reward` | `x-api-key` | Reward coins |
| `POST /api/deduct` | `x-api-key` | Deduct coins |
| `POST /api/report-ip` | `x-api-key` | Log IP for anti-cheat |

### WikiSearchle (port 3029)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/leaderboard` | Public | Local per-game ELO leaderboard |
| `GET /api/admin/leaderboard` | `x-api-key` | Admin ELO panel |
| `GET /api/admin/cheaters` | `x-api-key` | Local suspicion panel |
| `GET /api/admin/player/:identityKey` | `x-api-key` | Local player profile |
| `POST /api/admin/suspend/:identityKey` | `x-api-key` | Ban by identity |
| `POST /api/admin/unsuspend/:identityKey` | `x-api-key` | Unban by identity |
| `POST /api/admin/suspend-ip/:ip` | `x-api-key` | Ban by IP |
| `POST /api/admin/unsuspend-ip/:ip` | `x-api-key` | Unban by IP |
| `GET /api/admin/suspended` | `x-api-key` | List all bans |
| `GET /api/debug/sockets` | `x-api-key` | Active socket inspection |
