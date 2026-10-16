# WiKirecTangled

Multiplayer word game crossing **RecTangled** (Squaredle-style letter-grid
search) with **WikiSearchle** (find words from a hidden Wikipedia article).
One round = one article + one grid. Players race to find the article's title
words and a small list of "target" words ranked by article frequency. A
colored fill on each unfound target card grows toward green as guesses get
"closer" (anagrams, partial matches).

## Run

```bash
npm install
npm start                  # → http://localhost:3017
```

See `AGENTS.md` for architecture, design decisions, env vars, API surface,
and the active roadmap. Read it before editing.

For a fresh-Claude handoff, point a new agent at `HANDOFF_PROMPT.md`.

## Pages

- `/` — public multiplayer
- `/solo` — daily puzzle + practice (per-player)
- `/streamer/<handle>` — read-only viewer for a streamer's private chat room
