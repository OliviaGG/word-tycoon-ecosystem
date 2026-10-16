# Handoff Prompt — paste this into a fresh Claude Code session

---

You are picking up **WiKirecTangled**, a new game that crosses RecTangled
(Squaredle-style letter-grid word search) with WikiSearchle (find words that
appear in a hidden Wikipedia article). The MVP boots and plays — your job is
to extend it into a fully-featured game by working through the roadmap.

## First: orient yourself

1. Read `AGENTS.md` end-to-end. It contains the architecture, the design
   decisions and *why*s, the gotchas, and a numbered roadmap of every feature
   that's intentionally missing.
2. Skim the existing code: `server.js`, `src/game.js`, `src/grid.js`,
   `src/article.js`. They're small (~200 lines each) and well-commented.
3. Run it locally to confirm it boots:
   ```bash
   cd C:\WiKirecTangled && npm install && npm start
   ```
   Open http://localhost:3017 and play one round so you have a feel for the
   game before you change anything.
4. Look at the screenshot the visual design is based on (described in
   AGENTS.md → "What This Is"). Layout fidelity matters — when you add UI,
   keep the dark teal palette, orange title chips, green target reveals,
   chunky Fredoka grid letters.

## Then: work the roadmap

The roadmap in AGENTS.md is **ordered by dependency**. Items 1–3 (persistence,
identity, ELO) unlock everything downstream. Default execution order:

```
#1 Persistence  →  #2 Identity  →  #3 ELO reporting  →  #4 Chat Relay
       ↓
#5 Mobile  →  #6 PWA  →  #7 Admin  →  #8 Cosmetics
       ↓
#9 Jackpot/Frenzy  →  #10 OBS overlay  →  #11 Daily puzzles
       ↓
#12 Article body reveal  →  #13 Deploy  →  #14 SEO
```

You can pull items out of order if the user asks for one specifically, but
flag the dependency (e.g. "#7 Admin needs #2 Identity to be useful").

## Working rules (these matter)

- **Before each roadmap item**: state in 3–5 bullets what you're going to do,
  which files you'll touch, and what to watch for. Wait for approval before
  implementing UI changes — visual rework is expensive.
- **Use the source projects as reference** — the roadmap tells you which
  RecTangled or WikiSearchle file to crib from for each item. Read the
  reference file, then write fresh code; don't blind-copy without
  understanding the intent.
- **Don't break the MVP** — the game must always boot and play one full
  round end-to-end after your changes. Run `npm start` and submit at least
  one guess via the browser before declaring an item done.
- **Update AGENTS.md as you go** — when you complete a roadmap item, mark it
  done and remove it from the Roadmap section (move a one-line note to a new
  "Done" section if it's worth keeping). When you discover a new gotcha, add
  it to Gotchas. The handoff document only stays useful if it stays current.
- **Comments**: sparse, explain *why*. The codebase already follows this —
  match the style.
- **No new dependencies without asking** — package.json is intentionally tiny
  (express + socket.io). If you need sql.js for #1 or socket.io-client for
  #4, that's fine; for anything else, ask first.

## Global rules from `~/.claude/CLAUDE.md` that apply

- **Deployed = deployed AND verified live**: after any deploy, curl the live
  URL for HTTP 200 *and* curl at least one bundled asset path. Don't say
  shipped until both pass.
- **Editing rules for backend / multi-definition files**: before editing a
  route or handler in `server.js`, grep for every definition of the path or
  function name and identify the live one. RecTangled has dead code paths;
  WiKirecTangled doesn't yet but watch for them as you copy code over.
- **Caching first when debugging stale data**: if a fix doesn't take effect,
  check in-memory caches, browser storage, service workers, and PM2 reload
  before assuming the code is wrong.
- **LLM API calls** (you'll hit this if you add features that use Anthropic
  / OpenAI): wrap in try/except with retry+backoff on overload + a
  user-facing fallback message.
- **Bug-fix hygiene**: enumerate edge cases the fix might affect; run any
  existing tests; write a quick reproduction check before claiming done.
- **Visual / UX work**: describe the design in 3–5 bullets and wait for
  approval *before* building. This applies to every UI roadmap item (#5, #6,
  #7, #8, #10, #12).

## What success looks like

A complete pass through the roadmap delivers:

- Persisted game history + leaderboards across server restarts
- Real player identity (Discord / Twitch / web sessions) with cosmetics
- Word Tycoon ELO + coin economy integration
- Chat Relay-driven chat-message guessing (live streaming play)
- Polished mobile + desktop + OBS overlay layouts
- PWA-installable with a service worker and proper icons
- Admin panel for moderation
- Jackpot + frenzy mechanics
- Daily/weekly/archive puzzles
- WikiSearchle-style article body reveal
- Live at `wikirectangled.com` with SEO + structured data

Each step should land as a discrete, deployable improvement. Don't try to
batch multiple roadmap items into one change.

## Start

Open `AGENTS.md`, skim the existing source, then ask the user which roadmap
item to start on (or default to #1 if they say "your call").
