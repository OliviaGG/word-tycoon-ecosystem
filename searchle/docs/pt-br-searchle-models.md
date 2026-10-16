# pt-BR Searchle Model Lab

Goal: build a Brazilian Portuguese Searchle mode using language-specific semantic models, target words, validation, and frequency gates. Do not translate guesses at runtime.

## Recommended Runtime Model

As of 2026-05-28, pt-BR Searchle should use:

- `numberbatch-pt-gated`
- `nilc-glove-300d-gated`
- RRF `k = 200`
- weights:
  - `numberbatch-pt-gated`: `1`
  - `nilc-glove-300d-gated`: `1.25`

This is wired in `server/config.js` under `languageProfiles['pt-br']`.

`fasttext-cc-pt-gated` remains valuable as a target-bank generation and sanity-check model, but the ranking bake-off showed that Numberbatch + NILC gives better player-facing guess rankings for the current probe set.

## Candidate Sources

1. `fasttext-cc-pt`
   - Source: [fastText Common Crawl + Wikipedia Portuguese text vectors](https://fasttext.cc/docs/en/crawl-vectors.html).
   - Why: broad vocabulary, frequency-sorted text format, strong coverage for inflected Portuguese forms.
   - Caution: license is CC BY-SA 3.0, so derived distributed vectors need attribution/share-alike handling.

2. `numberbatch-pt`
   - Source: [ConceptNet Numberbatch](https://github.com/commonsense/conceptnet-numberbatch), using the Portuguese-only split at [Zenodo record 4911598](https://zenodo.org/records/4911598).
   - Why: commonsense/knowledge-graph signal improves conceptual neighbor rankings.
   - Caution: standalone coverage is smaller than fastText/NILC; use as a blend source.

3. `nilc-glove-300d`
   - Source: [NILC Portuguese GloVe 300d safetensors](https://huggingface.co/nilc-nlp/glove-300d).
   - Why: strong Portuguese corpus signal; the gated build beat fastText as a single ranking model in the Searchle probe benchmark.
   - Caution: not strictly pt-BR, and raw top neighbors can include European/official-register terms before gating.

## Commands

```powershell
node tools/ptbr-model-lab.js list
node tools/ptbr-model-lab.js download fasttext-cc-pt
node tools/ptbr-model-lab.js build fasttext-cc-pt --max-words=300000
node tools/ptbr-word-gate.js build fasttext-cc-pt --output=fasttext-cc-pt-gated --max-words=180000 --min-zipf=2.5
node tools/ptbr-model-lab.js nearest fasttext-cc-pt amor comida futebol carnaval
node tools/ptbr-model-lab.js download numberbatch-pt
node tools/ptbr-model-lab.js build numberbatch-pt
node tools/ptbr-word-gate.js build numberbatch-pt --output=numberbatch-pt-gated --max-words=180000 --min-zipf=2.5
node tools/ptbr-model-lab.js download nilc-glove-300d
node tools/ptbr-model-lab.js build nilc-glove-300d
node tools/ptbr-word-gate.js build nilc-glove-300d --output=nilc-glove-300d-gated --max-words=180000 --min-zipf=2.5
npm run eval:ptbr
```

Generated files are ignored under `data/pt-br/raw/` and `data/pt-br/models/`.

## First fastText Build

On 2026-05-28, `fasttext-cc-pt` was downloaded and built locally with:

```powershell
node tools/ptbr-model-lab.js build fasttext-cc-pt --max-words=300000
```

Result:

- Raw download: `data/pt-br/raw/fasttext/cc.pt.300.vec.gz`, 1,271,093,660 bytes.
- Built model: 300,000 words, 300 dimensions, 343 MB `vectors.bin`.
- Build scan: 554,307 rows processed, 149,772 skipped, 104,534 duplicates.
- Accent aliases: 45,018 folded forms.

Neighbor quality is good enough to keep testing. Examples:

- `comida`: `comidinha`, `comidas`, `bebida`, `alimento`, `refeição`, `comer`.
- `futebol`: `basquete`, `clube`, `futebolístico`, `craque`.
- `carnaval`: `carnavalesco`, `folia`, `samba`, `desfile`.
- `contexto`: `âmbito`, `cenário`, `contextual`, `panorama`, `sentido`.

Noise is also visible:

- Glued web tokens: `daescola`, `detrabalho`, `apalavra`, `obrasil`.
- Typos/variants: `dinhero`, `trablho`, `notbook`.
- Morphological crowding: plurals and diminutives can dominate near-neighbor slots.

Conclusion: fastText is viable as the primary semantic source, but pt-BR Searchle needs a Portuguese frequency/dictionary gate before using model rankings for gameplay.

## First Word Gate

On 2026-05-28, a first gated model was built with:

```powershell
node tools/ptbr-word-gate.js build fasttext-cc-pt --output=fasttext-cc-pt-gated --max-words=180000 --min-zipf=2.5
```

Result:

- Source checked: 300,000 fastText words.
- Kept: 57,059 words.
- Built vectors: 65.3 MB.
- Accent aliases: 9,139 folded forms.
- Frequency: Python `wordfreq`, Portuguese language code `pt`, minimum Zipf `2.5`.
- Extra filters: stopwords, domain/web noise, repeated endings, repeated tokens.

Rejected examples:

- Web garbage: `mercadolíder`, `inglêspanhol`, `avaliaçãomais`, `automáticassim`.
- Typos/noise: `notbook`, `dinhero`.
- Glued tokens removed by frequency: `daescola`, `detrabalho`, `apalavra`, `obrasil`.

Preserved examples:

- Accented/common terms: `refeição`, `carnaval`, `folia`, `futebolístico`, `empresa`, `artigo`, `através`, `segundo`, `danúbio`, `caiaque`, `âmbito`.

Gated neighbor probes:

- `comida`: `comidinha`, `comidas`, `bebida`, `alimento`, `refeição`, `comer`, `alimentação`, `culinária`.
- `futebol`: `basquete`, `clube`, `futebolístico`, `basquetebol`, `craque`, `hóquei`, `vôlei`.
- `carnaval`: `carnavalesco`, `folia`, `samba`, `desfile`, `micareta`, `feriadão`.
- `contexto`: `âmbito`, `cenário`, `contextual`, `momento`, `enfoque`, `panorama`, `sentido`.
- `brasil`: `país`, `brasileiro`, `portugal`, `nordeste`, `uruguai`, `argentina`, `méxico`.

This is the first artifact that looks usable for gameplay evaluation. It should still be paired with a curated pt-BR target list rather than used blindly.

## Ranking Bake-Off

On 2026-05-28, a probe benchmark was added:

- Probes: `data/pt-br/eval/searchle-ranking-probes.json`
- Report: `data/pt-br/eval/ranking-eval-report.json`
- K sweeps: `ranking-eval-report-k30.json`, `ranking-eval-report-k100.json`, `ranking-eval-report-k200.json`, `ranking-eval-report-k500.json`

The benchmark uses 38 common pt-BR targets and 227 expected human guesses. It scores Searchle playability: expected guesses near the target should land in low ranks. This is not a native-speaker gold standard, but it is much better than eyeballing nearest-neighbor lists.

Built/gated model sizes:

- `fasttext-cc-pt-gated`: 57,059 words, 65.3 MB vectors.
- `numberbatch-pt-gated`: 36,861 words, 42.2 MB vectors.
- `nilc-glove-300d-gated`: 57,179 words, 65.4 MB vectors.

Best result:

- `numberbatch-pt-gated + nilc-glove-300d-gated@1.25`
- RRF `k=200`
- Quality score: `64.61`
- Expected coverage: `226/227`
- Hit@50: `0.762`
- Hit@100: `0.921`
- Median expected-rank: `18`
- Mean expected-rank: `57.8`

Baseline/current-model comparisons from the same probe set:

- `fasttext-cc-pt-gated`: score `48.26`, hit@50 `0.511`, hit@100 `0.718`, median `46`.
- `numberbatch-pt-gated`: score `42.91`, hit@50 `0.480`, hit@100 `0.621`, median `58`.
- `nilc-glove-300d-gated`: score `57.37`, hit@50 `0.656`, hit@100 `0.771`, median `25`.
- `fasttext-cc-pt-gated + numberbatch-pt-gated`: score `52.82`, hit@50 `0.626`, hit@100 `0.753`, median `30`.
- `numberbatch-pt-gated + nilc-glove-300d-gated@1.25` at RRF `k=200`: score `64.61`, hit@50 `0.762`, hit@100 `0.921`, median `18`.

Target pool coverage for the winning runtime combo:

- Very easy: 20/20.
- Easy: 1,326/1,326.
- Normal: 2,500/2,500.
- Rare: 1,884/1,884.
- Very rare: 1/1.

Decision: use Numberbatch + NILC for pt-BR runtime rankings. Keep fastText available for target generation and regression comparison.

## First Target Candidate Pass

On 2026-05-28, a target lab was added and run with:

```powershell
node tools/ptbr-target-lab.js generate fasttext-cc-pt-gated --count=500 --probe=1800 --min-zipf=3.0 --max-zipf=6.2
```

Generated files:

- `data/pt-br/targets/generated/searchle-ptbr-candidates.json`
- `data/pt-br/targets/generated/searchle-ptbr-target-words.json`
- `data/pt-br/targets/generated/searchle-ptbr-target-words.txt`

The target lab:

- Builds a centroid from 153 pt-BR seed words.
- Dedupes accent variants by folded spelling.
- Uses `wordfreq` to keep words in a playable frequency band.
- Rejects plurals when a singular exists.
- Rejects diminutives when a base form exists.
- Rejects obvious function words, gerunds, adverbs, web junk, profanity, and first-pass adjective/verb noise.
- Probes nearest neighbors so isolated words do not become targets.

Current output:

- Source model words: 57,059.
- Fold-deduped forms: 55,530.
- Base candidates after filters: 23,138.
- Generated review list: 500 candidates.

Top candidates include:

`pedaço`, `vizinho`, `garrafa`, `barriga`, `cachorro`, `frango`, `prato`, `bebida`, `feijão`, `sorvete`, `laranja`, `peixe`, `cadeira`, `arroz`, `cerveja`, `chocolate`, `bicicleta`, `barco`, `rapaz`, `vidro`, `menino`, `sofá`, `fruta`, `copo`, `suco`, `passeio`, `gato`, `cigarro`, `pizza`, `roupa`.

Important caveat: this is still a review list, not a launch target bank. The first 100-150 candidates look much cleaner than the full 500. Deeper into the list, some adjective/abstract/verb-ish terms still appear and should be hand-reviewed before shipping.

## Safe Target Bank

Because John does not speak pt-BR, do not ship the generated 500-word review list directly.

Use:

- `data/pt-br/targets/safe-target-words.json`

This is a manually conservative list of 514 target words selected from the model/generator output and common pt-BR seed words. It intentionally removes words that need Portuguese review:

- verbs and conjugated forms;
- adjectives and adverbs;
- profanity and adult/drug terms;
- abstract/meta words;
- weak model targets such as `papel`, `rio`, `cobra`, `vento`, `manga`, and `ferramenta`;
- ambiguous or culturally risky terms when a safer target is available.

Validation on 2026-05-28:

- 514 targets.
- 0 missing from `fasttext-cc-pt-gated`.
- 0 duplicates.
- 0 below Zipf 2.5 in `wordfreq`.
- Weak/ambiguous model targets removed from the first draft include `papel`, `rio`, `cobra`, `vento`, `manga`, `ferramenta`, `zebra`, `neve`, `tubarão`, `dado`, `meia`, `volta`, `serra`, `cabo`, `sítio`, and adjective-first targets such as `frio`.
- Lowest nearest-neighbor score is about 0.52, with most targets comfortably higher.

This remains the conservative seed bank for the expanded target pipeline.

## Difficulty Frequency Pools

Use frequency data for difficulty, not for part of speech. `wordfreq` can tell us how common `casa` is, but it cannot tell us whether a word is being used as a noun, verb, proper noun, or adjective. Noun-only status comes from `safe-target-words.json` plus the reject filters in `tools/ptbr-target-lab.js`; Zipf frequency then assigns accepted noun targets to Searchle-style difficulty pools.

Commands:

```powershell
npm run targets:ptbr:expand
npm run targets:ptbr:difficulty
```

`targets:ptbr:expand` builds a larger target pool from the safe seed list plus Kaikki/Wiktextract POS dumps:

- Portuguese nouns: `data/pt-br/raw/kaikki/kaikki.org-dictionary-Portuguese-by-pos-noun.jsonl`
- Portuguese proper names: `data/pt-br/raw/kaikki/kaikki.org-dictionary-Portuguese-by-pos-name.jsonl`
- Portuguese adjectives: `data/pt-br/raw/kaikki/kaikki.org-dictionary-Portuguese-by-pos-adj.jsonl`
- Portuguese verbs: `data/pt-br/raw/kaikki/kaikki.org-dictionary-Portuguese-by-pos-verb.jsonl`

The raw POS dumps are ignored by git. Download them from the Kaikki Portuguese dictionary POS pages before rebuilding locally. The expanded bank excludes proper-name entries and excludes non-seed words that also appear as adjective or verb entries.

Contexto benchmark note: Contexto's official client does not ship a public static pt-BR answer list. Its browser bundle calls `https://api.contexto.me/machado/...`; third-party tools also derive data from that API. Do not copy Contexto answers, top-500 neighbor lists, or third-party Contexto solver databases into Searchle. Use Contexto only as a style benchmark: common, guessable nouns with enough semantic texture for clues.

Generated files:

- `data/pt-br/targets/expanded-target-words.json`
- `data/pt-br/targets/expanded-target-report.json`
- `data/pt-br/targets/difficulty/searchle-ptbr-very-easy-targets.json`
- `data/pt-br/targets/difficulty/searchle-ptbr-easy-targets.json`
- `data/pt-br/targets/difficulty/searchle-ptbr-normal-targets.json`
- `data/pt-br/targets/difficulty/searchle-ptbr-rare-targets.json`
- `data/pt-br/targets/difficulty/searchle-ptbr-very-rare-targets.json`
- `data/pt-br/targets/difficulty/difficulty-report.json`

The thresholds mostly mirror `server/session-manager.js`, with one pt-BR streamer-mode adjustment:

- `very-common`: Zipf `>= 5.5`
- `common`: Zipf `>= 4.0` for the curated pt-BR easy whitelist
- `normal`: all accepted expanded targets
- `rare`: Zipf `>= 3.0` and `< 4.5`
- `very-rare`: Zipf `< 3.0`

The strict Searchle fallback cutoff of Zipf `>= 4.5` only produced about 615-668 vetted pt-BR noun targets, depending on the expansion scoring pass. The pt-BR easy whitelist uses Zipf `>= 4.0` plus an embedding-score floor (`--easy-min-score=0.4` in the difficulty split) so the streamer-facing easy pool is large enough without admitting obvious function words and POS-edge junk.

Current expanded target bank on 2026-05-28:

- Seed targets: 514.
- Expanded targets: 2,500.
- Auto-added targets: 1,986.
- Auto-added target overlap with proper-name, adjective, and verb POS sets: 0.
- Zipf range: 2.99-5.99, median 4.07.

Current difficulty split on 2026-05-28:

- Very easy: 20 targets.
- Easy: 1,326 targets.
- Normal: 2,500 targets.
- Rare: 1,884 targets.
- Very rare: 1 target.

The exact Searchle `very-rare` cutoff is still not useful yet for pt-BR because the expanded noun bank intentionally excludes obscure targets; build a dedicated rare-noun expansion before enabling that streamer option.

## Target Words

Translated English targets are useful as a seed list, not as the product list. Every translated target needs Portuguese review because:

- Common English targets can translate into rare, formal, regional, or multi-word Portuguese.
- Accents change player input behavior.
- Some semantic neighborhoods are culturally different even when the dictionary translation is correct.
- Searchle target quality depends on model coverage and neighbor quality, not just whether the word is valid.

Use translated targets plus native pt-BR common nouns/concepts, then run model coverage and neighbor checks. Keep slang/trendy terms in an optional streamer/event list until they prove stable and guessable.

## Searchle Integration Notes

- Runtime profile added in `server/config.js` and `server/language-profiles.js`.
- pt-BR uses `data/pt-br/models/fasttext-cc-pt-gated` with English frequency gate disabled for that model.
- Streamer sessions read `searchleLanguage` from Chat Relay and can run English or `pt-br` without changing public multiplayer.
- Solo can run pt-BR via `/sp?lang=pt-br`; the browser uses server-ranked guesses for that mode instead of English precomputed pool files.
- pt-BR guess validation keeps Unicode letters and skips English plural/British-spelling normalization.
- Keep public multiplayer English-only until the pt-BR streamer/solo target bank has more live playtest data.
