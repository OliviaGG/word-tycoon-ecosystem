# WikiContexto Vite frontend

Local rebuild prepared October 4, 2026 from a fresh `/opt/wikisearchle` snapshot.
Both Solo and Online retain the current navy, cyan, and gold identity, game
contracts, progress keys, account ownership, reward proofs, premium gates, and
multiplayer events. Deployed October 4, 2026 to both `wikicontexto.com` and
`wikisearchle.com` through the existing `wikisearchle` service.

## Run and review

Requires Node 20.19+ or 22.12+. The local and canonical server runtimes are Node 24.

```powershell
npm ci
npm run demo
```

Open `http://127.0.0.1:5175/daily` and `/online`. This Vite development preview
uses an isolated sample article and fixture account, never the live game,
rankings, or reward bridge. Stop it with Ctrl+C. Source edits refresh through
Vite. For the compiled release:

```powershell
npm run build
npm run preview:demo
```

The compiled fixture runs at `http://127.0.0.1:4328/daily` and `/online`.

For normal backend development, `npm run dev` proxies game HTTP/Socket.IO to
`http://127.0.0.1:3029` and account/auth requests to `http://127.0.0.1:3000`.
Override those origins with `WKX_API_URL` and `WKX_AUTH_URL`. Frontend account
requests use the same origin; production nginx remains responsible for the
existing auth proxy and host-scoped cookies.

## Source structure

- `client/online/index.html`, `client/solo/index.html`: HTML shells and SEO.
- `client/src/online/`: extracted multiplayer game, auth, toolbar, guess input,
  premium/session gates, and OBS handling.
- `public/solo/solo.js`: the existing Solo engine, bundled by the Solo entry.
- `public/js/`: existing shared guess, cosmetic, loading, tutorial, and shell
  controllers, imported as modules by both entries where applicable.
- `client/src/styles/`: extracted page styles plus a shared material palette.
- `client/src/shared/motion.js`: explicit article-entry, live-reveal, title-find,
  and rank-reordering animation lifecycle.
- `vite.config.mjs`: mode entries, development routing/proxies, production
  static copying, and generated service-worker precache entries.

The per-mode CSS aggregates preserve the canonical stylesheet order. Importing
each legacy stylesheet independently lets shared CSS split ahead of page CSS
in production and restores old theme defaults; keep the aggregate order.

The old `public/index.html` and `public/solo/index.html` remain a rollback
frontend. Online feature work now belongs in `client/src/online` and the new
HTML shell. Standalone/unified OBS pages continue using their existing shared
controllers; the compiled Online `?obs=1` entry remains supported.

## Visual behavior

Static fine grain and beveled panels add depth without a continuous animation
loop. Gold and found-title tiles use inset lighting. Live article reveals
animate only visible new tokens, bounded to 24 per update and 32 active effects.
Existing rows move smoothly when their rank changes. Restored reveals and
socket snapshots do not replay those animations. Hidden pages, pagehide,
reduced motion, and OBS suppress or cancel effects. HMR disposes its observers
and event listeners.

Mobile Online input now uses actual viewport pixels, with 16px text and 44px
buttons. Both modes hide the mobile scroll gutter so the scaled game canvas
fits the viewport. Existing card artwork, cosmetics, rank fill, and rare
entrance effects retain their original controllers.

## Build and production integration

`npm run build` emits `dist/online/index.html`, `dist/solo/index.html`, hashed
bundles, a Vite manifest, and the existing public app assets. The generated
`dist/sw.js` precaches the hashed bundles under `wkx-shell-v19-vite`. Auth,
game API, sockets, and admin traffic retain their network-only behavior.
Development serves an unregistering worker rather than caching HMR/source.

The existing Express/SEO layer prefers built entries when present, preserving
`/solo`, `/daily`, `/online`, archive links, and root session/OBS links. Assets
under `/assets` receive immutable caching. No Vite process is needed on Hetzner.
Set `WIKICONTEXTO_LEGACY_UI=1` and restart to use the preserved frontend.

Before deployment, recheck the canonical hashes against the saved baseline;
the rebuild must not replace intervening server changes. Build locally, stage
the release through `/tmp`, back up changed canonical files, and deploy the
source/build together. Restart only `wikisearchle`, verify public routes and
account/session flows, then commit/push the canonical mirror and update Obsidian
operations notes. Keep older hashed assets available through the rollout to
support tabs that already loaded an older HTML entry.

## Validation

```powershell
$env:CHAT_RELAY_DIR = 'C:\Chat Relay'
npm test
npm run test:vite
```

The reward tests require their companion Chat Relay source. This checkout's
verification used a read-only canonical fetch in `tmp/canonical-relay` via
`CHAT_RELAY_DIR`, rather than an assumed sibling checkout.

129 automated checks passed: existing account/reward protections, daily/archive
state, round transitions, PWA policies, and six new motion lifecycle checks.
Production route, bundle, sample-guess, and worker-manifest smoke checks passed.
Browser review covered Vite development and compiled Solo/Online, 390px and
320px phone widths, light/dark themes, live guess sorting/reveals, title
progression, and saved Solo progress after reload, without JavaScript errors.
Physical Android keyboard, resume/Back, and real provider sign-in remain
device/release QA.

Evidence: `C:\Word Tycoon\output\wikicontexto-vite-20261004`.

## October 4 production release

The fresh canonical snapshot matched all 83 files in the reviewed baseline.
118 file preimages/absence checks guarded the staged release. All 102 source
and build files matched their expected hashes after installation. Existing
files were backed up in `/opt/wikisearchle/backups/vite-20261004` before the
`wikisearchle` restart. Runtime dependency versions are unchanged; the new
lockfile adds Vite's development dependencies.

All 129 tests passed again before deployment. The live release passed 38 HTTP
checks across both domains, including route selection, same-origin account
responses, unchanged game API responses, bundle hashes, immutable asset
caching, and the generated worker. A real anonymous Socket.IO connection
received both multiplayer snapshots without submitting a guess. Live browser
review confirmed Solo readiness, multiplayer readiness, and 320px/390px
multiplayer controls with 16px input text and 44px buttons, without page errors.
No live guesses or purchases were submitted.

Physical Android keyboard/resume/Back and provider sign-in remain device QA.
The release does not require a new Android package: the existing TWA loads the
updated web frontend. Keep the legacy public HTML and release backups available.

## October 4 stream embed socket fix

The October 4 workaround directed pages served through `/game/wikisearchle/`
to the standalone game domain because the host's root socket endpoint belongs
to Chat Relay. Its legacy HTML shim only wraps a standalone Socket.IO script
tag, which the Vite bundle no longer uses. The October 9 fix below keeps the
explicit game routing while sharing the room's authenticated origin.

Routing regression tests cover private/public embeds, invalid sessions, and
direct pages. Nine routing/round-reset tests plus built-route/worker checks
passed. The deployed embed and actual server OBS overlay were verified with
the active round restored and live TikTok guesses arriving. The overlay source
was refreshed after the `wikisearchle` restart; the broadcast kept running.
The SEO HTML cache requires that restart to expose changed bundle names.

## October 9 live-room sign-in fix

Pages served through `/game/wikisearchle/` connect to the same-origin
`/game/wikisearchle/socket.io` proxy with credentials and retain `auth.session`.
Their account API requests and game handshake now carry the same Word Tycoon
cookies. The former direct connection to `wikicontexto.com` could show a signed-in
page while the server rejected a guess as unauthenticated. Direct game pages and
Vite development keep `/socket.io`; server cookie verification remains required.
