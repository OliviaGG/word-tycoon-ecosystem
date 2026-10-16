#!/usr/bin/env node
// Build the LLM-article generation pool: a balanced 10K subset of the
// 27K coverage pool, drawn from 13 topical buckets with tier-priority
// sampling (multi-word titles favored, singles only used as fallback).
//
// Output: data/article-pool.json — array of pool entries shaped as:
//   { title, slug, topic, tier, source, titleWordNorms, views12mo }
//
// Reads:  $CHAT_RELAY_DIR/data/wikipedia-coverage.json (default /opt/chat-relay)
// Writes: ./data/article-pool.json (relative to wikisearchle root)

const fs = require('fs');
const path = require('path');

const RELAY_DIR = process.env.CHAT_RELAY_DIR || '/opt/chat-relay';
const COVERAGE_PATH = path.join(RELAY_DIR, 'data', 'wikipedia-coverage.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'article-pool.json');

const STOPLIST = new Set(['a','an','the','and','or','but','of','in','on','at','to','for','with','by','as','from','is','are','was','were','be','it','its','this','that']);

function normalize(s) { return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

// Livestream-incompatible content: skip outright. Conservative — we'd
// rather miss a few clean articles than ship sexual/graphic-violence
// topics that derail a public game.
function isUnsafe(e) {
  const sd = (e.shortdesc || '').toLowerCase();
  const cats = (e.categories || []).join(' ').toLowerCase();
  const all = sd + ' ' + cats;
  if (/sexual|pornograph|fetish|erotic|sadomas|bdsm|incest|pedophil|prostitution|orgasm|orgy/.test(all)) return true;
  if (/genocide|holocaust|massacre|ethnic cleansing|atrocity/.test(all)) return true;
  if (/suicide|self.harm|self.mutilation/.test(all)) return true;
  if (/(child|infant) (abuse|sexual abuse)/.test(all)) return true;
  if (/(rape|sexual assault)/.test(all)) return true;
  return false;
}

// Topic classifier: shortdesc + categories + source heuristics. Order
// matters — more-specific patterns before broader ones. Returns one of
// 13 bucket names; "everyday" catches concept-level entries without a
// stronger signal.
function classify(e) {
  const sd = (e.shortdesc || '').toLowerCase();
  const cats = (e.categories || []).join(' ').toLowerCase();
  const cat = (e.category || '').toLowerCase();
  const all = sd + ' ' + cats + ' ' + cat;

  const peopleYearRe = /\(\d{3,4}[\s\-–](?:\d{3,4})?\)|\(b\.\s*\d{3,4}\)|\(d\.\s*\d{3,4}\)|\(born \d{3,4}\)|\(died \d{3,4}\)/;
  if (peopleYearRe.test(sd)) return 'people';

  if (cat === 'film' || cat === 'tv-series') return 'film_tv_games';

  if (/\b(film|television|tv series|tv show|miniseries|sitcom|netflix|streaming series|movie|anime|cartoon series|video game|board game|tabletop game)\b/.test(all)) return 'film_tv_games';
  if (/\b(album|song|band|musician|composer|singer|rapper|orchestra|symphony|opera|jazz|rock band|pop music|hip-hop|guitarist|pianist|drummer|musical instrument|record label|music genre)\b/.test(all)) return 'music';
  if (/_music_| music_|music_genre|music_groups|orchestras|musicians|albums|songs/.test(cats)) return 'music';
  if (/\b(species of|genus of|family of|breed of|bird|mammal|fish|insect|reptile|amphibian|plant|tree|flower|fungus|bacterium|dinosaur|spider|crustacean|mollusk|virus|cell|tissue|organ|skeleton|muscle|hormone|enzyme|gene|dna|rna|protein|biology|biological|anatomy)\b/.test(all)) return 'living';
  if (/_species|_genus|_animals|_plants|fauna_of|flora_of/.test(cats)) return 'living';
  if (/\b(dish|cuisine|food|beverage|drink|cocktail|wine|beer|cheese|fruit|vegetable|recipe|cooking|culinary|coffee|tea|spice|bread|pastry|dessert|sauce|grain|meat|seafood|herb|condiment|baking|brewing)\b/.test(all)) return 'food';
  if (/\b(athlete|footballer|football player|basketball player|baseball player|tennis player|olympic|championship|sport|league|tournament|chess player|hockey player|cricket|rugby|boxing|wrestler|martial art|track and field|athletics)\b/.test(all)) return 'sports';
  if (/\b(scientist|chemist|physicist|biologist|astronomer|theory|theorem|element|chemical|molecule|compound|equation|particle|telescope|laboratory|disease|medical|medicine|psychology|psychiatry|astronomy|cosmology|relativity|thermodynamics|electromagnetism|quantum|nuclear|atom|radiation|wavelength|spectrum|circuit|frequency|matter|energy|gravitational|orbital|planet|galaxy|nebula|star|stellar|geometric|algebra|calculus|geometry|statistics|probability|differential|integral|trigonometry|matrix|topology)\b/.test(all)) return 'science';
  if (/\b(software|programming|technology|engineering|computer|internet|algorithm|database|operating system|aircraft|spacecraft|automobile|machine|invention|engine|motor|telecommunication|robot|electronic|semiconductor|transistor|protocol|microprocessor|hardware|gadget|sensor|application)\b/.test(all)) return 'tech';
  if (/\b(city|town|village|country|capital|province|state|district|river|lake|mountain|island|continent|region|county|peninsula|desert|forest|park|valley|sea|ocean|geography|climate|biome|ecosystem|landform|topography|territory|nation)\b/.test(all)) return 'geography';
  if (/cities_in|towns_in|villages_in|rivers_of|mountains_of|countries|capitals/.test(cats)) return 'geography';
  if (/\b(war|battle|revolution|empire|dynasty|treaty|kingdom|historical event|ancient|medieval|conquest|crusade|colonial|civilization|monarchy|reign|emperor of|king of|invasion of|fall of|rise of|era|antiquity)\b/.test(all)) return 'history';
  if (/\b(politician|writer|author|poet|novelist|painter|actor|actress|director|filmmaker|philosopher|theologian|monarch|emperor|prince|princess|saint|economist|historian|sculptor|architect|journalist|activist|diplomat|general|admiral|judge|jurist|inventor|chef)\b/.test(all)) return 'people';
  if (/(american|british|french|german|italian|russian|chinese|japanese|indian|spanish|polish|canadian|australian|swedish|dutch|brazilian|mexican|egyptian|greek|roman|persian|arab|turkish|austrian|hungarian|czech|portuguese|norwegian|finnish|danish|irish|scottish|welsh|swiss|belgian|argentine|chilean|peruvian|venezuelan|colombian|nigerian|kenyan|south african|israeli|iranian|iraqi|saudi|korean|vietnamese|thai|indonesian|filipino|malaysian|singaporean) /.test(sd)) return 'people';
  if (/\b(painting|sculpture|novel|poem|poetry|book|literature|literary|architecture|building|cathedral|temple|monument|art movement|artistic|theatre|theater|drama|fiction|nonfiction|essay|publication|magazine|newspaper|journal|publishing|short story|novella|prose|verse|comedy|tragedy|epic|saga|myth|folklore|fairy tale)\b/.test(all)) return 'arts';
  if (/\b(political|economic|cultural|social|ideology|movement|religion|religious|philosophical|sociology|anthropology|institution|organization|tradition|custom|ritual|ceremony|education|law|legal|legislation|government|democracy|economy|economics|society|community|family|marriage|wedding|funeral|holiday|festival)\b/.test(all)) return 'society';
  return 'everyday';
}

function uniqueWordCount(e) {
  const src = Array.isArray(e.titleWordNorms) && e.titleWordNorms.length
    ? e.titleWordNorms
    : (Array.isArray(e.titleWords) ? e.titleWords.map(normalize) : String(e.title || '').split(/\s+/).map(normalize));
  const filtered = src.filter(n => n && !STOPLIST.has(n));
  return new Set(filtered).size;
}

function acceptForDeck(p) {
  if (p.backfillStatus === 'not-found') return false;
  if (p.source === 'category-crawl') return typeof p.views12mo === 'number' && p.views12mo >= 50000;
  return true;
}

// Topic targets — see chat for rationale. Sports merges into film_tv_games.
const TOPIC_TARGETS = {
  everyday: 1014,
  film_tv_games: 1014,
  people: 1014,
  science: 1014,
  living: 1014,
  society: 975,
  arts: 905,
  food: 676,
  music: 674,
  tech: 609,
  geography: 594,
  history: 500,
};
// Sports as a sub-topic gets folded into film_tv_games.
const TOPIC_FOLD = { sports: 'film_tv_games' };

function main() {
  console.log('Loading coverage from ' + COVERAGE_PATH);
  const c = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf-8'));
  const keys = Object.keys(c.pages);
  console.log('Total entries: ' + keys.length);

  // Bucket every eligible entry.
  const byTopic = {};
  let unsafeFiltered = 0;
  let ineligible = 0;
  for (const key of keys) {
    const e = c.pages[key];
    if (e.status !== 'exists') { ineligible++; continue; }
    if (!acceptForDeck(e)) { ineligible++; continue; }
    if (isUnsafe(e)) { unsafeFiltered++; continue; }
    let topic = classify(e);
    if (TOPIC_FOLD[topic]) topic = TOPIC_FOLD[topic];
    const tier = uniqueWordCount(e);

    // Skip pathological entries with zero target words (after stop-list filter).
    if (tier === 0) { ineligible++; continue; }

    const titleNorms = (Array.isArray(e.titleWordNorms) ? e.titleWordNorms : []).filter(n => n && !STOPLIST.has(n));
    if (!titleNorms.length) {
      // Fall back to deriving from titleWords if titleWordNorms is empty.
      const fallback = (Array.isArray(e.titleWords) ? e.titleWords : String(e.title || key).split(/\s+/))
        .map(normalize).filter(n => n && !STOPLIST.has(n));
      if (!fallback.length) { ineligible++; continue; }
      titleNorms.push(...fallback);
    }

    if (!byTopic[topic]) byTopic[topic] = [];
    byTopic[topic].push({
      title: e.title || key,
      slug: slugify(e.title || key),
      topic,
      tier,
      source: e.source || 'unknown',
      titleWordNorms: titleNorms,
      views12mo: typeof e.views12mo === 'number' ? e.views12mo : 0,
      shortdesc: e.shortdesc || null,
    });
  }

  console.log('Ineligible: ' + ineligible);
  console.log('Unsafe-filtered: ' + unsafeFiltered);
  console.log('');

  // For each topic, sample tier-priority. Within a tier, sort by views12mo
  // descending so the most-played articles fill first (gives the new-content
  // experience the biggest impact for the most rounds).
  const pool = [];
  const summary = [];
  for (const [topic, target] of Object.entries(TOPIC_TARGETS)) {
    const entries = byTopic[topic] || [];
    if (entries.length === 0) {
      summary.push({ topic, target, taken: 0, available: 0, byTier: {} });
      continue;
    }

    // Group by tier (6+ collapses).
    const tiers = { '6+': [], '5': [], '4': [], '3': [], '2': [], '1': [] };
    for (const e of entries) {
      const k = e.tier >= 6 ? '6+' : String(e.tier);
      tiers[k].push(e);
    }
    // Sort each tier by views12mo desc → popular-first within a tier.
    for (const k of Object.keys(tiers)) {
      tiers[k].sort((a, b) => (b.views12mo || 0) - (a.views12mo || 0));
    }

    const taken = [];
    const byTierTaken = {};
    const order = ['6+', '5', '4', '3', '2', '1'];
    for (const tk of order) {
      if (taken.length >= target) break;
      const need = target - taken.length;
      const slice = tiers[tk].slice(0, need);
      taken.push(...slice);
      byTierTaken[tk] = slice.length;
    }

    pool.push(...taken);
    summary.push({ topic, target, taken: taken.length, available: entries.length, byTier: byTierTaken });
  }

  // Persist.
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    sourceCoverage: COVERAGE_PATH,
    totalSelected: pool.length,
    topicTargets: TOPIC_TARGETS,
    topicFold: TOPIC_FOLD,
    summary,
    pool,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log('Wrote ' + pool.length + ' entries to ' + OUT_PATH);
  console.log('');
  console.log('Per-topic summary:');
  console.log('  topic              target    taken   avail    6+    5    4    3    2    1');
  for (const s of summary) {
    const t = (n) => String(n || 0).padStart(5);
    const row = [
      s.topic.padEnd(18),
      String(s.target).padStart(6),
      String(s.taken).padStart(8),
      String(s.available).padStart(7),
      t(s.byTier['6+']),
      t(s.byTier['5']),
      t(s.byTier['4']),
      t(s.byTier['3']),
      t(s.byTier['2']),
      t(s.byTier['1']),
    ];
    console.log('  ' + row.join(' '));
  }
}

main();
