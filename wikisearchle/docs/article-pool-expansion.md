# Additive article curation

`curation/article-pool-20261006.json` is the complete, byte-exact deployable pool
snapshot: all 10,003 prior entries followed by 294 validated additions. Its
SHA-256 is `54ba7b28ceb7551dfc46d03b3183a419f4d2e31bdc91545aeb982258b3a56e6d`.
The scoped `.gitattributes` entry preserves those exact bytes on Windows
checkouts. `curation/article-pool-expansion-20261006.json` records the additions,
quality checks, source hashes, and expected 9,055 playable coverage entries.
The snapshot makes the ignored runtime pool reproducible from GitHub alone;
copy it to the configured runtime `data/article-pool.json` through the normal
deployment flow.

`scripts/expand-article-pool.cjs` prepares a larger curated article pool without
changing daily puzzles, round snapshots, decks, accounts, or rewards. Take fresh
read-only snapshots from canonical Hetzner before running it. The existing pool
entries remain intact and in their original order.

New articles must pass the production availability, category-popularity, and
shared title-tier gates. Additional curation selects short concept titles with
WordNet vocabulary (including focused gerunds with known base verbs), a target present in the active Searchle model indexes, and
at least 50,000 annual views when a positive measured count exists. Named titles,
complex titles, and topics excluded by the existing livestream sampler are
omitted. The generated topic quotas limit concentration in a single subject.

Every accepted article has at least 400 characters of prose from the actual
Wikipedia runtime parser, with all title goals present as exact words. Cached
rewritten text must also pass the article validator. Evidence is reused for at
most seven days. A compatible WikiRec runtime cache can supply body evidence
only when its parser helper source matches WikiContexto exactly. Shared curation
evidence must match the accepted manifest's body hash and length.

Example preparation in PowerShell, using snapshots and output files under a
separate staging directory:

```powershell
$stage = 'C:\Word Tycoon\output\article-expansion'
$indexes = "$stage\models\numberbatch\index.json;$stage\models\fasttext\index.json"
node scripts/expand-article-pool.cjs `
  --baseline "$stage\article-pool.baseline.json" `
  --coverage "$stage\wikipedia-coverage.json" `
  --relay 'C:\Chat Relay' `
  --rank-indexes $indexes `
  --count 500 `
  --offline-only true `
  --body-cache-source "$stage\wikirec-article-cache.json" `
  --body-cache-parser "$stage\wikirec-lib-wikipedia.js" `
  --output "$stage\article-pool.expanded.json" `
  --manifest "$stage\expansion-manifest.json" `
  --cache "$stage\body-evidence.json"
```

Optional `--cached-candidates` accepts an array of `{ slug, entry, text }` from
the existing rewritten-article cache. Optional `--validated-candidates` and
`--validation-cache` reuse a verified WikiRec curation batch against the same
expanded coverage snapshot. Neither option writes shared coverage.
`--retain-manifest` keeps a previously reviewed batch while appending a second
shared batch, revalidating every retained entry. Topic quotas cannot evict
already reviewed additions.

Offline mode performs no network requests. Remove `--offline-only true` to fetch
missing article bodies, with two-second request spacing and shared cooldowns
for throttles/timeouts. Coordinate Wikipedia traffic with any other running
curation process. A smaller verified batch is preferable to weakening checks
or adding unverified entries.

Review the manifest's additions, exclusions, topic counts, input/output SHA-256
hashes, and expected playable count. Outputs cannot overwrite inputs or each
other, and the script refuses writes under deployed `/opt` application roots.
Keep full body caches in staging; commit the curation script, tests, and the
accepted metadata manifest rather than Wikipedia prose caches.

Deploy the prepared pool through the repository's normal local-to-SCP flow,
after matching its recorded baseline hash against Hetzner. If coverage was also
expanded, deploy that canonical shared snapshot first. Restart WikiContexto so
it reloads its pool and automatically reconciles saved decks; do not delete deck
or daily files. Check `/api/health` against the manifest's expected count and
confirm the pinned daily metadata still has the same file hash.

Validation:

```powershell
$env:CHAT_RELAY_DIR = 'C:\Chat Relay'
node --test test/*.test.cjs
```
