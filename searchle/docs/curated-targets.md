# Subtextle curated targets

Public English Subtextle uses the shared relay target bank, filtered through its
common-word whitelist, plus `data/curated-public-targets.json`. The supplement has
the shape `{ "version": 1, "words": ["example"] }`. The same additions enter solo
and English streamer Common mode. Normal mode retains the broader archive, and
Very common and Portuguese pools keep their existing definitions.

Keep the supplement separate from Chat Relay's shared target and difficulty
files. Those files also determine seeded puzzles in other games. Appending to
the Subtextle supplement preserves their contents and selection order.

## Curation

Choose familiar common nouns with useful semantic clues. Reject proper names,
brands, function words with incidental noun senses, obscure terminology, vague
abstractions, and unsuitable stream content. A WordNet noun flag alone is
insufficient. Each addition needs an explicit semantic review as well as:

- At least four lowercase ASCII letters and membership in the relay dictionary.
- A WordNet noun sense and active English embedding-model coverage.
- Exact equality after the live singular and American-spelling normalization.
- Compliance with shared blocked-word and Subtextle dual-meaning exclusions.
- Absence from the current public catalog and permanent online won history.

For the October 2026 expansion, Zipf 4.2 and above is preferred. Familiar nouns
from 3.5 to 4.19 are individually reviewed reserves. These thresholds document
this selection; they are not new runtime difficulty rules. Review the generated
semantic neighbors before choosing the final release.

## Preparing and publishing

Generate missing solo puzzles locally from a checksummed canonical snapshot:

```
node scripts/generate-curated-solo.cjs generate --snapshot-root=<local-snapshot> --selection=<reviewed-selection.json>
```

Each payload must contain the complete contiguous ranking permutation with its
answer at rank one. `solo-content-wire.cjs` compresses these payloads and checks
that decoding reproduces their exact original bytes.

Stage the reviewed catalog, evidence, rankings, and manifests under `/tmp/`.
Run `install-curated-online.cjs` without `--install` for a full preflight. Stop
`searchle-mobile` before installing: its in-memory solo index otherwise can
overwrite disk additions. The installer merges the fresh stopped-process index,
preserves existing word numbers and daily/weekly pins, and assigns new IDs above
all historical IDs and vacancies. It rechecks current won history and creates
backups and a rollback journal. Existing solo files are never replaced.

Install the reviewed loader sources while the service remains stopped, then
restart Subtextle and verify the actual public pool and all content checksums.
The verifier expects a new Subtextle PID and an unchanged PM2 restart counter
for this stopped-service start. Use `--expected-subtextle-restarts=1` only when
verifying a restart of an already running service.
The shared relay catalogs are unchanged, so this flow does not restart the relay.
Mirror the deployed source, catalog, and release evidence in the existing
`searchle` GitHub repository using a normal push.
