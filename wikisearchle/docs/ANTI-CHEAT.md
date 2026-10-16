# Anti-Cheat System

WikiSearchle anti-cheat consists of three layers:

1. **Identity-based suspension** — bans by Discord ID / platform user ID
2. **IP-based suspension** — bans by origin IP (catches anonymous evasion)
3. **Rolling-window suspicion scoring** — algorithmic detection of cheaters

---

## Suspension System

### Identity Suspension

Bans are stored in `data/suspended-users.json` as an array of IDs:

```json
["838862323350634526"]
```

**How it works:**
- `isSuspended(user, ip)` checks `user.linkedDiscord`, `user.platformUserId`, and `user.id`
- If any match a suspended ID, the guess/chat is silently dropped
- Web guessers receive a `wikisearchle-suspension` socket event

**Auto-populated at startup:**
```js
suspendedUsers.add('838862323350634526');  // uhrel
```

### IP Suspension

Bans are stored in `data/suspended-ips.json` as an array of IPs:

```json
["143.44.225.52"]
```

**How it works:**
- `isSuspended(user, ip)` normalizes the IP: `String(ip).split(',')[0].trim()`
- This handles Cloudflare `x-forwarded-for` chains like `143.44.225.52, 172.71.218.220`
- The **first** IP in the chain is the client's real origin IP
- If the IP matches, the guess is blocked regardless of nickname or platform ID

**Why IP bans are needed:**

| Scenario | Identity ban | IP ban |
|----------|-------------|--------|
| Logged-in Discord user | ✅ Blocks | ✅ Blocks |
| Anonymous web user (`platformUserId=anon`) | ❌ Misses | ✅ Blocks |
| New anonymous account (`Anon82`, `Anon83`) | ❌ Misses | ✅ Blocks |
| Platform chat (TikTok/YouTube) | ✅ Blocks | N/A (relay IP) |

### Admin Endpoints

```http
POST /api/admin/suspend/:identityKey
POST /api/admin/unsuspend/:identityKey
POST /api/admin/suspend-ip/:ip
POST /api/admin/unsuspend-ip/:ip
GET  /api/admin/suspended
```

All require `x-api-key: <GAME_API_SECRET>`.

### Case Study: uhrel → Anon82 Evasion

**Timeline:**

1. `discord:838862323350634526` (nickname `uhrel`) suspected of cheating
2. Identity suspended via `POST /api/admin/suspend/discord:838862323350634526`
3. uhrel continued playing via anonymous web mode (`platformUserId=anon`)
4. New nickname `Anon82` appeared — same IP `143.44.225.52`, same spam-guess patterns
5. IP `143.44.225.52` added to `suspendedIPs`
6. All `Anon82` (and any future anonymous accounts from that IP) blocked

**Evidence linking Anon82 to uhrel:**

| Evidence | Detail |
|----------|--------|
| Same IP | `143.44.225.52` — 100% of guesses |
| Same device | Android Chrome via Cloudflare |
| Timing | Anon82 appeared immediately after uhrel suspension |
| Same patterns | Mass multi-word spam dumps (68× identical template) |
| Performance | 5 wins / 8 rounds, sub-second first hits |
| Failed evasion | `Anon79` also appeared once from same IP before settling on `Anon82` |

---

## Suspicion Scoring

Local to WikiSearchle (also mirrored on Word Tycoon centralized API).

### Rolling Window

- Stores last **50 rounds** per identity in `data/suspicion-scores.json`
- Window is per-game (on WT) or global (on WikiSearchle local)

### Rules

| Rule | Trigger | Points |
|------|---------|--------|
| `guess-accuracy` | hits/guesses > 0.40 | +30 |
| `win-rate` | wins / Σ(1/N) > 2.5 | +25 |
| `first-hit-latency` | median firstHitMs < 3000ms (≥20 samples) | +25 |
| `target-find-rate` | targets / Σ(1/N) > 2.5 | +15 |
| `points-per-guess` | (points - targetBonuses) / guesses > 2500 | +5 |

**Flag levels:**
- `null` — score < 50
- `"suspicious"` — score 50–74
- `"high-risk"` — score ≥ 75

### Cold Start

Newly deployed systems need **~50 rounds** per player before rules fire. All existing players start at `score: 0`.

### Admin Endpoints

```http
GET /api/admin/cheaters?minScore=50
GET /api/admin/player/:identityKey
```

---

## Files

| File | Purpose |
|------|---------|
| `data/suspended-users.json` | Banned identity IDs |
| `data/suspended-ips.json` | Banned origin IPs |
| `data/suspicion-scores.json` | Rolling-window suspicion data |
| `server.js` | `isSuspended()`, `handleChat()`, admin routes |

---

## Logging

All guesses are logged for audit even if blocked:

```
[WikiSearchle] GUESS_IP ip=143.44.225.52, 172.71.214.211 platformUserId=anon nickname=Anon82 word=travel
[WikiSearchle] Suspended user blocked: Anon82 (no-id) ip=143.44.225.52, 172.71.214.211
```

This allows retroactive investigation even if a ban was applied after the fact.
