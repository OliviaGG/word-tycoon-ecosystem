# WikiSearchle ELO System

Local per-game ELO computation that runs alongside the centralized Word Tycoon ELO API. Both systems can coexist — local ELO provides redundancy and immediate leaderboard updates, while WT ELO provides cross-game tracking.

---

## How It Works

After every round ends, `aggregateRoundIntoStats(round)` calls:
1. `updateEloForRound(currentRound)` — local ELO update
2. `updateSuspicionForRound(currentRound)` — local suspicion update
3. `reportRoundToWordTycoon(currentRound)` — POST to Word Tycoon

---

## Identity Keys

```js
function getIdentityKey(user) {
  if (!user || typeof user !== 'object') return null;
  if (user.linkedDiscord) return `discord:${user.linkedDiscord}`;
  if (user.platformUserId && user.platform) return `${user.platform}:${user.platformUserId}`;
  return `nick:${String(user.displayName || '').toLowerCase()}`;
}
```

| Player Type | Example Key |
|-------------|-------------|
| Discord-linked web | `discord:123456789012345678` |
| TikTok chat | `tiktok:7401234567890` |
| YouTube chat | `youtube:UCx...` |
| Anonymous web | `nick:anon82` |

**No migration:** Linking Discord does **not** transfer `nick:` ELO to `discord:`. Clean break by design.

---

## ELO Math

Same as Word Tycoon centralized system:

```
K = 40  (roundsCounted < 10)
K = 32  (roundsCounted < 30)
K = 24  (roundsCounted < 100)
K = 16  (otherwise)

delta = Σ_over_opponents (K / (N - 1)) * (actual - expected)
where actual = 1 if A.points > B.points, 0 otherwise
      expected = 1 / (1 + 10^((B.elo - A.elo) / 400))
```

Minimum 3 players with points > 0 for ELO to update.

---

## Files

| File | Purpose |
|------|---------|
| `data/elo-ratings.json` | Local ELO ratings |
| `data/suspicion-scores.json` | Local suspicion data |
| `data/player-stats.json` | Lifetime stats + rolling window |
| `server.js` | `updateEloForRound()`, `updateSuspicionForRound()` |

---

## Public Leaderboard

```http
GET /api/leaderboard?limit=25&sort=elo
```

- `sort` — `elo` (default), `points`, `wins`
- Filter: `roundsCounted >= 5`

## Admin Endpoints

```http
GET /api/admin/leaderboard
GET /api/admin/cheaters
GET /api/admin/player/:identityKey
POST /api/admin/suspend/:identityKey
```

All require `x-api-key: <GAME_API_SECRET>`.
