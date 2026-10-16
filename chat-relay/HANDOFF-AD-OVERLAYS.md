# Handoff: Ad Vertical Overlay System

## What Was Done This Session

### 1. Identified the correct overlay files
The "long vertical ad overlay" lives in **Chat Relay** (`C:\Chat Relay\public\ad-vertical-*.html`), NOT in Word Tycoon. There are 17 files total — one per game + a generic.

### 2. Fixed hero badge color theming (ad-vertical-searchle.html first, then all)
The overlay listens for `game-win` Socket.IO events and re-themes itself based on the winner's equipped `hero_badge` cosmetic.

**Problems fixed:**
- `themeFromColor()` was multiplying already-dark badge gradient colors (e.g. `#3d0a0a`) by 0.6-0.85, producing near-invisible letter tones
- Blue channel was systematically favored (`b*0.85` vs `r*0.70`), skewing warm badges toward muddy blue-brown
- Body background was synthetically derived from extracted colors instead of using the badge's actual gradient

**Solution:**
- Body background now uses the raw badge gradient directly (like `win-overlay.html` does for its card)
- Added `normalizeColor()` — scales extracted color to full brightness (max channel = 255) before deriving letter tones
- `tonesFromColor()` uses equal per-channel multipliers (no blue bias)
- Added `ov-gradient-flow` keyframe for animated rare+ badges
- Badge `backgroundSize` and `animation` CSS properties are applied to body

### 3. Resized from 1080x1920 to 2000x2000
- Square canvas for flexible OBS positioning
- Ad strip centered horizontally (`left: 50%; transform: translateX(-50%)`)
- Ripple canvas covers full 2000x2000 area with 6 blobs

### 4. Created new game overlays + updated all existing ones
All 17 files now use the same template:
- 2000x2000px square canvas
- 100px ad strip centered down the middle
- Hero badge color theming via Socket.IO
- Ripple canvas animation
- Seamless scroll loop (Block 1 + Block 2)

**New files created:**
- `ad-vertical-erectangled.html` (www.erectangled.com)
- `ad-vertical-word5000.html` (www.word5000.com)

**All files deployed to:** `deploy@wordtycoon.live:/opt/chat-relay/public/`

---

## Architecture

### Data Flow
```
Game server emits game-win → Chat Relay server.js enriches winner.cosmetics
  → relay.getUserCosmetics(linkedDiscord) fetches /api/cosmetics/discord/:id from Word Tycoon
  → returns { equipped: { hero_badge: { background: 'linear-gradient(...)', backgroundSize, animation } } }
  → io.to('win-overlay').emit('game-win', data)
  → ad overlay receives, applies badge gradient to body + derives letter tones
```

### Key Files
- `C:\Chat Relay\public\ad-vertical-*.html` — the 17 overlay files
- `C:\Chat Relay\server.js` lines 6081-6107 — game-win enrichment + win-overlay room
- `C:\Chat Relay\src\relay.js` lines 24-43 — getUserCosmetics() fetches from Word Tycoon API
- `C:\Word Tycoon\src\cosmetics.js` lines 220-239 — hero_badge definitions with CSS gradients
- `C:\Word Tycoon\src\game-engine.js` lines 1826-1870 — getPlayerCosmeticsForAPI()
- `C:\Chat Relay\public\win-overlay.html` lines 379-384 — reference "good" implementation

### Hero Badge CSS Shape
```js
{ background: 'linear-gradient(135deg, #06091e, #0d2857, #2980b9, ...)',
  backgroundSize: '400% 400%',
  animation: 'ov-gradient-flow 30s ease infinite' }
```

### Color Normalization Logic
```
extractColor(gradient) → brightest hex [r,g,b]
normalizeColor(r,g,b)  → scale so max channel = 255 (preserves hue)
tonesFromColor(r,g,b)  → toneA(85%), toneB(70%), toneC(95%), toneD(75%) — equal per-channel
```

---

## What Still Needs Attention

1. **TikTok direct bridge** — `tiktok-direct.js` can't connect because TikTok reports `@jorrybeaufart` as not online. A connect watchdog was added but the upstream issue persists.

2. **Win overlay on Searchle OBS** — User mentioned wanting to remove the hero badge background from the Searchle OBS overlay (win-overlay.html) since it's now shown on the ad overlay instead. This has NOT been done yet.

3. **Other game ad overlays may need game-specific ribbon text tweaks** — The ribbon content (e.g. "Guess Meaning", "Word Search") was auto-generated and may not perfectly describe each game.
