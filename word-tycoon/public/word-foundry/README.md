# Word Foundry

Word Foundry is a mobile-first idle word game served by Word Tycoon's existing
static middleware at `/word-foundry/`.

## Core loop

1. Buy individual letter tiles from a six-slot market.
2. Use owned, currently available tiles to build a curated 3–7 letter word.
3. Each active word locks its physical tiles into a production line and earns
   cash per second.
4. Upgrade individual lines or combine different word lengths for a portfolio
   multiplier.
5. Dismantle a line to return its tiles and retool the floor.
6. Spend cash on more letters and research, complete orders, then publish a new
   Edition for a permanent Fame multiplier.

New foundries begin with `$0.00` and six free common tiles: `E A R N S T`.
Those letters can immediately form words such as EARN, NEAR, RATE, STAR, and
TEA. The first market purchase must therefore be funded by word production.

## Long-play systems

- Five escalating research tracks: global output, production capacity,
  long-word output, market discounts, and offline capacity.
- Upgradeable word lines with escalating costs and 50% more output per level.
- A portfolio bonus that rewards running words of different lengths together.
- First-discovery cash bonuses and a persistent word collection. Archive
  milestones at 5, 15, 30, 60, 100, and 175 discoveries add permanent output.
- One deterministic daily client brief with a focused word constraint and an
  automatic cash payout when the matching word enters production.
- Three daily orders that rotate at midnight in `America/Edmonton`.
- Sixteen persistent achievements with one-time cash rewards.
- Edition prestige: cash, tiles, words, and research reset; Fame, discoveries,
  achievements, daily progress, and lifetime records persist.
- Publishing starts at $60,000 of Edition production and scales by 2.75× per
  Edition, preventing the early prestige loop from collapsing into rapid resets.
- Fame permanently increases every word's output by 10% per point.
- A six-node Fame Works tree turns earned Fame into permanent production,
  market, line-cost, archive, offline, and capacity upgrades without reducing
  Fame's lifetime output multiplier. Branch prerequisites create longer-term
  build choices across Editions.
- Offline earnings start at eight hours. Research and the permanent Night
  Network upgrade can extend the cap as far as 36 hours.
- A three-tier Press Manager is hired and trained with Fame. It periodically
  upgrades the cheapest active word line while holding a cash reserve, persists
  through Editions, and performs the same server-validated work during offline
  accrual.

## App behavior

The UI is designed as a portrait phone app with four bottom tabs: Foundry,
Market, Research, and Goals. It includes an installable web app manifest, a
network-first service worker for offline fallback, app-style toasts and sheets,
safe-area padding, keyboard support, reduced-motion support, and browser-local
autosave under `word-foundry.save.v1`.
App sections can also be opened directly with `?tab=foundry`, `market`,
`research`, or `goals` for testing and shareable help links.

Signed-in Word Tycoon accounts use a server-authoritative economy. The browser
sends action intent such as selected tile IDs or an upgrade ID to Chat Relay's
session-gated `/api/word-foundry/action` endpoint. Chat Relay resolves the
account from its signed-in session and forwards the action internally; the
browser never sends or chooses an account identifier. Word Tycoon owns the
canonical state, validates the action with the shared game engine, accrues from
the server clock, and returns the resulting state. Action IDs make mutations
safe to replay after an uncertain network response.

Canonical Foundry state is stored in Word Tycoon's `word_foundry_states` table.
Guests and local development continue to use browser-local storage and the
same deterministic engine. If the account service is unavailable, signed-in
mutations pause instead of falling back to a client-authored balance.
The internal Word Tycoon routes accept only Chat Relay's localhost relay
credential; the broader game-server API key cannot read or mutate Foundry
account state.

Version-one through version-four prototype saves migrate
automatically into the current progression model. The app reuses
`public/wordfall/words.js` as its 5,616-word offline dictionary.

Run the deterministic engine and economy tests with:

```powershell
npm run test:word-foundry
```

Print the deterministic first-hour, first-Edition, and seven-day pacing report
with:

```powershell
npm run simulate:word-foundry
```

This game remains intentionally separate from shared Word Tycoon balances.
Foundry cash and Fame are now authoritative, but they do not award or spend
shared coins. Any future bridge to the shared economy still needs a separately
audited conversion or reward rule.
