# Occasional guess entrances — 2026-10-04

Any new live guess has an 8% chance of a brief glint, lift or pop layered over
the existing slide into the list. Cosmetic ownership does not affect selection.
There is one active flourish at a time and a ten-second cooldown per list.
Initial/restored snapshots and rank reorders do not select effects.

`client/src/ui/GuessEntranceEffects.js` stores pending choices by word in a
WeakMap controller for each list. Offscreen guesses wait for their first strict
visible appearance, including after dematerialization. Choices are consumed
at that appearance even during cooldown, preventing delayed/repeated effects.
The pending map is bounded to 64 choices and holds no rows or canvases.

Finite Web Animations operate on chip, portrait wrapper and name children.
The glint adds a temporary, non-interactive decorative layer. List placement
and secondary transforms retain their original owners; equipped artwork,
avatar effects and text colors stay intact. Completed/canceled animations and
layers are removed. Hidden documents, detached/deleted rows, rows leaving the
viewport and reduced-motion preferences cancel active flourishes. Reduced
motion suppresses new choices. Unsupported animation APIs leave the normal
slide available.

The two hooks in `GuessList.js` select only on new live insertion and tick
after physics/materialization. Production uses
`tools/build-guess-entrances-production.cjs` with a fresh canonical capture,
never a vanilla Vite build. It inserts these same two hooks in each existing
multiplayer/solo bundle and imports one shared hashed helper. Reversing the
edits proves all unrelated bundle bytes remain identical. Existing shared
modules, CSS, recovery, header and cosmetic implementations are retained.

Separate source Vite build and actual production-class browser checks passed:
multiplayer, solo, OBS, all three effects, selection rate, cooldown, snapshot
silence, offscreen virtualization, no scroll replay, cosmetic retention,
finite cleanup, reduced-motion changes, round clearing and phone scaling.
Evidence: `C:/Word Tycoon/output/subtextle-rare-entrances-20261004/`.
