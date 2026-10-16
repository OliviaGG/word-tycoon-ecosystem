# English solo content expansion — October 6, 2026

Subtextle's English solo catalog had 3,026 ranking files even though its historical index retained 6,492 target words. This expansion restores 821 missing, curated easy targets that already have historical game numbers. It also adds 284 targets to the very easy selection. Examples include music, story, friend, street, camera, window, guitar, restaurant, and museum.

The resulting solo catalog is 3,847 targets, before unrelated live multiplayer additions. Every restored target was already in the shared canonical target bank and Searchle easy whitelist.

A coordinated shared-bank update also adds nine new public multiplayer targets: basketball, television, electricity, photography, architecture, technology, literature, university, and government. These familiar nouns have current model vectors, canonical spelling, allowed policy status, and clear semantic neighbors. They are added to the easy whitelist and the 10-, 11-, or 12-letter bank buckets. Existing shorter target buckets stay unchanged, preserving the established five- and seven-letter daily/weekly selection inputs. The quality proof is recorded in `data/content-expansions/subtextle-2026-10-06-mp-quality.json`.

## Selection and preserved state

The generator uses a production snapshot of the Numberbatch and FastText model indexes, target bank, easy whitelist, blocked-word policy, morphology helpers, and Subtextle's dual-meaning exclusion list. Candidates must have at least four ASCII letters, remain unchanged by canonical singular/American normalization, have a current model vector, and have no existing playable file.

Every selected word already has an index number. Another 125 otherwise eligible easy words lack historical numbers and are recorded as deferred; adding those would need a separate numbering change. Intentional exclusions such as Twain, Calif, China, and proper-name ambiguities stay excluded.

Existing files, historical game numbers, completion keys, daily assignments, weekly assignments, and active sessions are preserved by the solo-file installation. The browser receives restored targets through the existing pool-file enumeration. That installation needs no frontend rebuild or service restart. The separate multiplayer bank update follows the normal restart order: mobile-relay first, then searchle-mobile so it reloads the new bank and easy list. Public multiplayer has no upper length limit that excludes these nine 10- to 12-letter targets.

## Reproduction

Use an isolated Windows snapshot directory containing the canonical production `server/` modules, `data/target-words.json`, `data/models/{numberbatch,fasttext}/{index.json,vectors.bin}`, and `relay/` copies of the canonical policy and frequency/dictionary/coverage data. Its `production-snapshot.json` records every required SHA-256, existing pool filenames, and the historical index. Preserve the checked-in addition plan when repeating this exact expansion.

```powershell
node scripts/expand-solo-pool.cjs plan --snapshot-root="C:\path\to\isolated-snapshot"
node scripts/expand-solo-pool.cjs generate --snapshot-root="C:\path\to\isolated-snapshot"
node scripts/expand-solo-pool.cjs verify --snapshot-root="C:\path\to\isolated-snapshot"
node --test test/expand-solo-pool.test.cjs
```

The generator verifies its canonical inputs and writes only `generated/` inside that snapshot. It rejects production paths and external output overrides. Its resumable addition plan fixes filenames. Complete rankings are stored without the obsolete 100,000-rank truncation; this snapshot produces 102,939 ranks per target. Large model and puzzle binaries stay outside Git; the checked-in plan and verified manifest record the exact content addition.

## Additive installation

Generate and verify full JSON ranking files locally before packaging. `scripts/solo-content-wire.cjs` can then encode a shared vocabulary plus one compressed UInt32 rank array per puzzle. Packing checks exact byte-for-byte round trips for every file. Transfer the compact files, `addition-manifest.json`, `production-snapshot.json`, the codec, and installer with SCP to `/tmp/subtextle-content-expansion-20261006/` and extract there. For example:

```powershell
node scripts/solo-content-wire.cjs pack "C:\path\to\isolated-snapshot\generated" "C:\path\to\wire-output"
```

On the server, decode only inside the uploaded `/tmp/` staging directory. This restores the already generated full JSON bytes; it does not load embedding models or compute rankings. Vocabulary, compressed payload, and restored JSON SHA-256 checks must all pass. The installer then validates the full original addition manifest:

```sh
node /tmp/subtextle-content-expansion-20261006/solo-content-wire.cjs unpack /tmp/subtextle-content-expansion-20261006
node /tmp/subtextle-content-expansion-20261006/install-solo-pool-additions.cjs /tmp/subtextle-content-expansion-20261006
node /tmp/subtextle-content-expansion-20261006/install-solo-pool-additions.cjs /tmp/subtextle-content-expansion-20261006 --install
```

The installer checks canonical input hashes, uploaded file hashes, complete ranking counts, answer rank one, and each preserved game number. It skips a word if live multiplayer already supplied a file. Each new file is installed atomically and exclusively; no existing file or index is overwritten. Installation reports record actual additions and preserved numbering. Install these solo files before applying the separate multiplayer bank update so the original snapshot checks still match.

## Validation

Five focused generation checks cover exclusion/policy enforcement, existing-game preservation, bank membership, morphology, missing vectors, incomplete/duplicate rankings, and production-root refusal. Two transport checks cover exact JSON serialization, including integer-like keys, and rejection of missing vocabulary entries, duplicate ranks, and truncated rank arrays. An integration check using the actual canonical `sp-manager.js` confirms restored games appear in the common-difficulty browser, load with answer rank one, and retain their original `game:<number>` completion keys. Its source index and pinned assignments remain byte-for-byte unchanged.
