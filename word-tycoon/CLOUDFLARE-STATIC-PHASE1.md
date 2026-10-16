# Cloudflare Static Phase 1

Last updated: 2026-04-05

This is the first static-content migration slice after confirming the CMS is already on Cloudflare.

## Verified Current State

`cmswordtycoon.org` is already on Cloudflare.

Verified locally on 2026-04-05:

- DNS resolves to Cloudflare IPs
- HTTPS response includes `Server: cloudflare`
- local Worker config already routes `cmswordtycoon.org`

Relevant local config:

- `C:\word-tycoon-cms\demos\cloudflare\wrangler.jsonc`

## Static Migration Goal

Move the low-risk public/static pages from `wordtycoon.live` off the Droplet first, without touching the live Node/Socket.IO game origins.

## Important Discovery

The authoritative static page files are currently present on the Droplet, but not all of them exist in this local `C:\Word Tycoon` snapshot.

Live source on Droplet:

- `/opt/word-tycoon/public/privacy.html`
- `/opt/word-tycoon/public/terms.html`
- `/opt/word-tycoon/public/games.html`
- `/opt/word-tycoon/public/searchle.html`
- `/opt/word-tycoon/public/rectangled.html`
- `/opt/word-tycoon/public/erectangled.html`
- `/opt/word-tycoon/public/betweenly.html`
- `/opt/word-tycoon/public/pixeletters.html`
- `/opt/word-tycoon/public/figural.html`
- `/opt/word-tycoon/public/spellingbee.html`
- `/opt/word-tycoon/public/word5000.html`
- `/opt/word-tycoon/public/wordfall.html`
- `/opt/word-tycoon/public/robots.txt`
- `/opt/word-tycoon/public/sitemap.xml`

Local repo snapshot currently missing at least:

- `privacy.html`
- `terms.html`
- `games.html`
- the game landing pages above
- `robots.txt`
- `sitemap.xml`

So the first real step is not deployment. It is source recovery/backfill.

## Phase 1A: Backfill Static Source into Repo

Before any Cloudflare static cutover:

- copy the authoritative static files from the Droplet into the repo
- make the repo the source of truth again
- verify the copied files match what is currently live

Suggested local destination:

- `C:\Word Tycoon\public\...`

Backfill set:

- `privacy.html`
- `terms.html`
- `games.html`
- `searchle.html`
- `rectangled.html`
- `erectangled.html`
- `betweenly.html`
- `pixeletters.html`
- `figural.html`
- `spellingbee.html`
- `word5000.html`
- `wordfall.html`
- `robots.txt`
- `sitemap.xml`

Definition of done:

- local repo contains the same static pages currently live on the server
- future edits happen from source control, not ad hoc on-server copies

## Phase 1B: Move Lowest-Risk Pages First

After source backfill, move these first:

1. `/privacy`
2. `/terms`
3. `/robots.txt`
4. `/sitemap.xml`

Reason:

- these are fully static
- low interaction risk
- easy to validate and easy to roll back

## Phase 1C: Move Game Landing Pages

Next static candidates:

- `/games`
- `/games/searchle`
- `/games/rectangled`
- `/games/erectangled`
- `/games/betweenly`
- `/games/pixeletters`
- `/games/figural`
- `/games/spellingbee`
- `/games/word5000`
- `/games/wordfall`

Reason:

- these are informational/landing pages
- they do not need the live game server runtime
- they reduce nginx alias/static burden on the Droplet

## Recommended Hosting Shape

For this static phase, use one of:

- Cloudflare Pages, or
- a Worker static-assets project

The key rule is:

- only move pages that are truly static
- leave auth, API, websocket, and game-play routes on the Droplet

## Validation Checklist

After each moved page:

- route returns `200`
- page HTML matches expected live content
- CSS/JS/assets still load
- no broken internal links
- no auth/session expectations were accidentally introduced
- Cloudflare cache behavior is correct

## Rollback

Each route should be cut over one small group at a time.

Rollback should be:

- switch routing for that page back to the Droplet/nginx origin

Do not delete the Droplet copy until the Cloudflare copy has been verified.

## Practical Next Step

The next actual execution step is:

1. backfill the static source files from `/opt/word-tycoon/public` into `C:\Word Tycoon\public`
2. verify them
3. then prepare the first Cloudflare static slice for:
   - `/privacy`
   - `/terms`
   - `/robots.txt`
   - `/sitemap.xml`
