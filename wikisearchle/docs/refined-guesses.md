# Refined guess cards — 2026-10-04

The current live Subtextle implementation in `/opt/searchle` supplied the navy
finish, slanted panel contour, panel measurement and occasional entrances.
Wikicontexto uses cached DOM rows rather than Subtextle's spring/virtual pool.
`public/js/refined-guesses.js` adapts those behaviors to its existing renderers;
`public/css/refined-guesses.css` loads after the older themes.

Surfaces: online (including private session and `?obs=1` variants), solo,
`overlay.html` and `overlay-unified.html`. Wikicontexto has no separate pinned
guess surface. Ranking, log-scale horizontal fill and sorting stay under the
existing renderers. Cached rows update their displayed rank without replacement.

Every player gets the same slanted panel. Plain artwork meets the row's top,
bottom and right rims. Username measurements set its preferred width, capped at
half the row; long guesses can reduce it to an avatar. Resize/font observations
refresh the actual layout boundary (`panel.offsetLeft`). One continuous polygon
stops plain rank fill just before that slant, sealing its antialiased edge. The
panel background remains anchored while its contents animate. OBS measurements
use layout pixels rather than transformed screen coordinates.

Equipment paints the panel surface/frame, with avatar borders, name effects and
titles retaining their existing applier. Hero render assets resolve against the
hub; video layers persist across rank updates and are released on replacement
or removal. Removing equipment clears artwork/frame/glows and restores the plain
mask. Multiplayer equipment broadcasts update existing rows immediately. The
solo client retains its authenticated equipment refresh and identity handling.

Only a new live guess is eligible for an entrance: an 8% roll selects glint,
lift or pop; each list has a ten-second cooldown. Pending choices survive an
offscreen first appearance, without moving rows or changing list layout. The
first visible appearance consumes a choice even during cooldown. Snapshot/REST
restoration seeds seen words and clears effects; scrolling/reordering/recreating
a seen word cannot replay it. Reduced motion, hidden pages, removal and viewport
exit stop effects. Page teardown releases observers, animation layers and media;
back/forward cache retains the controllers after stopping active effects.

Validation: `node scripts/verify-refined-guesses.cjs` uses fixture-only hooks into
the actual page renderers. It checks desktop, 390/320px phones, 1080×1920 OBS,
light theme, layout/compact sizing, rank updates, real Super Fan and Donor Class
equipment, unequip broadcasts, persistent artwork, fill/rim pixel comparisons
at rest and in motion, all three entrances, probability boundary, cooldown,
offscreen first appearance, scrolling replay, snapshots, reduced motion and
removal cleanup. Evidence is written to `tmp/refined-verification/`.

Deployment is a selective static-file update from a fresh canonical capture,
with SHA-256 preimage checks and backups before SCP/copy. No build replaces live
code. The local branch was advanced through the six existing GitHub commits after
confirming their runtime files match Hetzner, retaining canonical hint recovery,
entitlement policy, solo credentials and Edmonton-week fixes.
The PWA cache version and changed asset URLs are bumped with the release.
