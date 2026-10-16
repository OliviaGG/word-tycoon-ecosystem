# Daily Claim Streak System

## Overview

Daily claim streaks reward players for logging in and claiming rewards every day. The system is Discord-only — players must have a Discord-linked account to participate.

## Backend

### Database Tables

- `streak_state` — current streak snapshot per Discord user
  - `discord_user_id` (PK)
  - `current_streak` — active streak (resets to 0 if missed)
  - `longest_streak` — all-time best
  - `last_claim_date` — ISO date of last claim
  - `total_claims` — lifetime claim count
  - `total_xp_from_claims` — cumulative XP earned
  - `milestone_titles_awarded` — JSON map of earned titles

- `daily_claims` — audit log of each claim
  - `discord_user_id`, `claim_date` (UNIQUE)
  - `xp_awarded`, `streak_day`, `is_milestone`, `milestone_type`

### Streak Rules

| Scenario | Result |
|----------|--------|
| First claim ever | Streak = 1 |
| Claimed yesterday | Streak += 1 |
| Claimed 2 days ago | Grace day 1 — streak continues |
| Claimed 3 days ago | Grace day 2 — streak continues |
| Claimed 4+ days ago | Streak resets to 1 |
| Claimed today | Already claimed, no reward |

**2-day grace window:** You can miss up to 2 consecutive days and still continue your streak when you claim again. The streak counter keeps growing — it never wraps or resets unless you miss 3+ days.

### Milestones

Milestones repeat every 30 days using a cycle day:

| Cycle Day | Bonus XP | Extra Reward |
|-----------|----------|--------------|
| 3 | 500 | 1 uncommon cosmetic |
| 7 | 1,500 | 3 loot boxes + "Weekly Warrior" title (once-ever) |
| 14 | 3,000 | 5 loot boxes |
| 30 | 10,000 | 5 loot boxes + "Monthly Legend" title (once-ever) |

A player on day 33 hits the day-3 milestone again, day 37 hits day-7, etc.

Titles are awarded **once ever** — subsequent cycles still give XP and loot boxes, but not duplicate titles.

### XP Scaling

Base claim XP = 150, scaled by player's business progression tier:

```
scaled = floor(150 * (1 + 0.25 * log2(progressionMult)))
capped at 500 XP
```

## API Endpoints

### Status Check
```
GET /api/daily-claim/status?discordId=<id>
Headers: x-api-key: <secret>
```

Returns:
```json
{
  "canClaim": true,
  "currentStreak": 12,
  "longestStreak": 30,
  "previewXp": { "scaled": 245, "tierLabel": "Pizza" },
  "nextMilestone": { "day": 14, "daysAway": 2, "bonusXp": 3000 },
  "nextProfileLogoUnlock": { ... },
  "cosmeticChance": 0.20
}
```

### Process Claim
```
POST /api/daily-claim
Body: { "discordId": "..." }
Headers: x-api-key: <secret>
```

Returns claim result with XP breakdown, milestone awards, cosmetic drops, and unlocked profile logos.

### Player Game Stats
```
GET /api/player-game-stats/:discordId?game=<optional>
```

Returns per-game win counts across all linked accounts.

### Daily/Weekly Progress
```
GET /api/daily-progress/:platform/:userId
```

Returns daily and weekly challenge completion status for portal UIs.

## Discord Command

```
!streak
```

Shows current streak, longest streak, whether today's claim is available, and next milestone countdown.

## GOAT Leaderboard Integration

The `/api/goat` endpoint now includes:
- `currentStreak` — active daily claim streak
- `longestStreak` — all-time best

Only Discord-linked players have streak data. Unlinked players show 0.
