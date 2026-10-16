# Refined guess rows — 2026-10-04

Normal and pinned guesses in online, solo and OBS use the supplied navy mockup:
rounded continuous rims, a restrained inset rank/word capsule, and a thin slanted
player frame. Avatars are 140 scene pixels and names use 92% of the row text size.
The existing renderer scales the row, and its username measurements adapt to
these sizes. Rank fill heights and responsive panel limits remain unchanged.

`client/public/refined-guesses.css` loads after surface-ui in index and sp.
Equipped hero surfaces, frame colors/glows, avatar borders/glows, names and titles
retain their inline effects. A transparent finish above the artwork gives both
plain and equipped panels the same bevel. Frame and surface backgrounds have no
important overrides. Avatar cosmetics can still extend beyond the row.

Production is patched with `tools/build-refined-guesses-production.cjs` from a
fresh canonical capture. It adds one stylesheet and one link to each HTML entry;
all previous JS and CSS files remain byte-identical. It emits preimage SHA-256
checks for the entry points, source HTML, styling and reachable module graph.
Do not replace canonical dist with the source-validation Vite build.

Verified with canonical online/solo constructors: plain rows, actual Super Fan
and Donor Class sets, pinned widths, long words/names, desktop, phone, OBS,
cosmetic clearing, explicit viewer visibility, reduced motion and rank updates.
The separate Vite source build passes. Browser evidence and deployment inputs:
`C:/Word Tycoon/output/subtextle-refined-guesses-20261004/`.

Follow-up: the player panel now meets the row's top edge, with matching 36px
outer and 33px inner right corners. The plain frame is transparent and its
surface starts with the row's navy color, so it blends into the top. Equipped
frame colors and artwork still paint inline. The shared outer rim supplies the
top highlight; the panel retains its transparent finish and bottom bevel.
Follow-up evidence: `C:/Word Tycoon/output/subtextle-refined-guesses-20261004/top-blend/`.

Plain panels also reach the bottom and right rim with no inset or separate
bottom bevel. Inline panel paints, glow filters and render layers retain the
cosmetic frame inset; removing those effects restores the flush plain surface.
Edge-blend evidence: `C:/Word Tycoon/output/subtextle-refined-guesses-20261004/edge-blend/`.

Edge sealing: matching layout bounds still left a visible rank-color seam
through the surface's antialiased bottom edge, and secondary motion shifted
the entire player panel enough to expose the fill on the right. Plain player
panels now stay anchored to the row while entrance effects animate their
children. The existing sizing observer publishes the actual flex boundary as
`--guess-water-width`; one continuous polygon stops the fill at the panel's
55px slant and follows its beveled tip. Canvas border-radius retains the
rounded outer corners, and rank fill heights remain intact.
Equipped panel paints, glows and render layers retain their original fill,
frame inset and secondary motion. Clearing cosmetics restores the plain mask.

`tools/build-guess-edge-seal-production.cjs` applies the stylesheet patch and
inserts only the flex-boundary measurement into each canonical sizing helper.
Reverse-edit assertions retain every unrelated module byte, including rare
entrances and recovery. Fresh captures are guarded by SHA-256 before deploy.
Pixel comparisons with/without the rank canvas reproduced the original edge
leak and show no colored edge pixels after the fix, at desktop/phone scales,
stationary and moving, orange/green ranks, online/solo and OBS. Super Fan,
Donor Class, clearing, compact/pinned sizing and an entrance-effect cleanup
also pass. Evidence: `C:/Word Tycoon/output/subtextle-refined-guesses-20261004/edge-seal/`.

Seam follow-up: the two touching mask layers left a thin vertical cut in the
plain rank fill at the start of the slant when the scene was scaled. The fill
now uses a single clip polygon that follows the plain surface's exact contour.
Equipped rows retain their existing rounded clip. The stylesheet-only
production patch preserves all compiled JavaScript bytes.
Evidence: `C:/Word Tycoon/output/plain-guess-fill-20261004/`.
