#!/usr/bin/env node
'use strict';

// Offline, additive curation. This script never changes a running game, daily,
// deck, account, reward, or shared coverage file. Its output is a replacement
// curated pool plus a reviewable manifest; deployment is a separate operation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalize, STOPLIST } = require('../lib/redactor');
const { validate, hasWord } = require('../lib/article-validator');
const { fetchLeadSection } = require('../lib/wikipedia');

const SCHEMA_VERSION = 1;
const MIN_BODY_CHARS = 400;
const TOPIC_WEIGHTS = {
  everyday: 1.2, science: 1.3, living: 1.3, food: 1.1, tech: 1,
  geography: 1, society: 1, arts: 1, history: 0.8, music: 0.6,
  film_tv_games: 0.7,
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function slugify(title) {
  return String(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '').slice(0, 80);
}

function titleNorms(entry) {
  const raw = Array.isArray(entry.titleWords) && entry.titleWords.length
    ? entry.titleWords : String(entry.title || '').split(/\s+/);
  return [...new Set(raw.map(word => normalize(String(word)))
    .filter(word => word && !STOPLIST.has(word)))];
}

// Keep the existing sampler's livestream suitability rules. Include the title
// as well, because older coverage entries sometimes have no short description.
function isUnsafe(entry) {
  const all = [entry.title, entry.shortdesc, ...(entry.categories || [])]
    .join(' ').toLowerCase();
  return /\bsex\b|sexual|genital|masturba|pornograph|fetish|erotic|sadomas|bdsm|incest|pedophil|prostitution|orgasm|orgy|love chair/.test(all)
    || /genocide|holocaust|massacre|ethnic cleansing|atrocity/.test(all)
    || /suicide|self.harm|self.mutilation/.test(all)
    || /(child|infant) (abuse|sexual abuse)|\brape\b|sexual assault/.test(all);
}

function classifyTopic(entry) {
  const text = [entry.shortdesc || (entry.categories || []).join(' ') || entry.title]
    .join(' ').replace(/_/g, ' ').toLowerCase();
  if (/\b(operating systems?|computer programming|programming language|programming paradigm)\b/.test(text)) return 'tech';
  if (/^(genus|family|order|species|breed)\b/.test(text) && !/\b(edible|food|cereal|crop|grain)\b/.test(text)) return 'living';
  if (/\b(television programming|television series|film genre|video game|board game)\b/.test(text)) return 'film_tv_games';
  if (/\b(chemistry|physics|mathematical|mathematics|quantum|gamma function|expected value|binary star|inner moon)\b/.test(text)) return 'science';
  if (/\b(adrenal gland|amino acid|blood vessel|cell wall|microbial cyst|animal husbandry)\b/.test(text)) return 'living';
  if (/\b(bell pepper|eggs as food|drinking water)\b/.test(text)) return 'food';
  if (/\b(data lake|electric battery|image scanner|magnetic tape|human.computer interaction|extended reality)\b/.test(text)) return 'tech';
  if (/\b(dish|cuisine|food|beverage|drink|cocktail|wine|beer|cheese|fruit|vegetable|recipe|cooking|culinary|coffee|tea|spice|bread|pastry|dessert|sauce|grain|meat|seafood|herb|condiment|baking|brewing)\b/.test(text)) return 'food';
  if (/\b(species|genus|family of|breed|bird|mammal|fish|insect|reptile|amphibian|plant|tree|flower|fungus|bacterium|dinosaur|spider|crustacean|mollusk|mollusc|virus|cell|tissue|organ|skeleton|muscle|hormone|enzyme|gene|dna|rna|protein|biology|biological|anatomy|fauna|flora|ecology|ecosystem)\b/.test(text)) return 'living';
  if (/\b(software|programming|technology|engineering|computer|internet|algorithm|database|operating system|aircraft|spacecraft|automobile|machine|invention|engine|motor|telecommunication|robot|electronic|semiconductor|transistor|protocol|microprocessor|hardware|gadget|sensor|application|computing|encoding)\b/.test(text)) return 'tech';
  if (/\b(theory|theorem|element|chemical|molecule|compound|equation|particle|telescope|laboratory|disease|medical|medicine|psychology|psychiatry|astronomy|cosmology|relativity|thermodynamics|electromagnetism|quantum|nuclear|atom|radiation|wavelength|spectrum|circuit|frequency|matter|energy|gravitational|orbital|planet|galaxy|nebula|star|stellar|geometric|algebra|calculus|geometry|statistics|probability|differential|integral|trigonometry|matrix|topology|scientific|physics|phenomenon|phenomena)\b/.test(text)) return 'science';
  if (/\b(city|town|village|country|capital|province|state|district|river|lake|mountain|island|continent|region|county|peninsula|desert|forest|park|valley|sea|ocean|geography|climate|biome|landform|topography|territory|nation|weather|geological|geology)\b/.test(text)) return 'geography';
  if (/\b(film|television|tv series|tv show|miniseries|sitcom|netflix|streaming series|movie|anime|cartoon series|video game|board game|tabletop game|sport|sporting|athletic|recreation|game|championship|baseball|basketball|football|tournament|league)\b/.test(text)) return 'film_tv_games';
  if (/\b(album|song|single|band|orchestra|symphony|opera|jazz|rock band|pop music|hip-hop|musical instrument|music genre|music|musical)\b/.test(text)) return 'music';
  if (/\b(war|battle|revolution|empire|dynasty|treaty|kingdom|historical event|ancient|medieval|conquest|crusade|colonial|civilization|monarchy|reign|invasion|antiquity|historical|history)\b/.test(text)) return 'history';
  if (/\b(painting|sculpture|novel|poem|poetry|book|literature|literary|architecture|building|cathedral|temple|monument|art movement|artistic|theatre|theater|drama|fiction|nonfiction|essay|publication|magazine|newspaper|journal|publishing|short story|novella|prose|verse|comedy|tragedy|epic|saga|myth|folklore|fairy tale|art)\b/.test(text)) return 'arts';
  if (/\b(political|economic|cultural|social|ideology|movement|religion|religious|philosophical|sociology|anthropology|institution|organization|tradition|custom|ritual|ceremony|education|law|legal|legislation|government|democracy|economy|economics|society|community|family|marriage|wedding|funeral|holiday|festival|philosophy|linguistic|language)\b/.test(text)) return 'society';
  return 'everyday';
}

function runtimeEligible(entry, tiering, minViews = 50000) {
  return entry && entry.status === 'exists' && entry.backfillStatus !== 'not-found'
    && (entry.source !== 'category-crawl'
      || (typeof entry.views12mo === 'number' && entry.views12mo >= minViews))
    && tiering.articleHasAtLeastOneEasyTitleWord(entry);
}

function wordNetKnown(word, tiering) {
  if (!tiering._internal) return true;
  const lookup = tiering._internal._wnLookup;
  if (lookup(word)) return true;
  // Focused gerunds are a supported T2 title class. WordNet stores some
  // inflected forms only under their base verb (bleaching -> bleach).
  if (word.endsWith('ing') && word.length > 6) {
    const base = word.slice(0, -3);
    const forms = [base, base + 'e'];
    if (base.length > 2 && base.at(-1) === base.at(-2)) forms.push(base.slice(0, -1));
    return forms.some(form => lookup(form));
  }
  return false;
}

function candidateReason(entry, tiering, rankTargets) {
  if (!runtimeEligible(entry, tiering)) return 'runtime filter';
  if (isUnsafe(entry)) return 'sampler suitability';
  const norms = titleNorms(entry);
  if (!norms.length || norms.length > 4 || norms.some(word => !/^[a-z]{3,}$/.test(word))) return 'complex title';
  if (typeof entry.views12mo === 'number' && entry.views12mo > 0 && entry.views12mo < 50000) return 'low measured popularity';
  // New entries are concepts with short, guessable titles. Keep production's
  // existing mixed-title behavior; do not relax its gates to increase a count.
  const classified = tiering.classifyTitleWords({ ...entry, titleWordNorms: norms });
  if (classified.skipped.length) return 'proper title word';
  const rawWords = Array.isArray(entry.titleWords) ? entry.titleWords : String(entry.title).split(/\s+/);
  if (rawWords.slice(1).some(word => /^[A-Z]/.test(word) && !STOPLIST.has(normalize(word)))) return 'capitalized entity title';
  if (norms.some(word => !wordNetKnown(word, tiering))) return 'title outside WordNet';
  if (/\b(?:national|state|historic|historical) (?:park|monument|site|trail|memorial)|\sv\.\s|^list of |^outline of |^history of /i.test(entry.title)) return 'specialized title';
  if (typeof entry.length === 'number' && entry.length < 1500) return 'short source';
  const preferred = tiering.orderByRankTier(norms, rawWords);
  const anchors = preferred.filter(word => rankTargets.has(word));
  if (!anchors.length) return 'no model anchor';
  return null;
}

function candidateScore(entry, frequency, cached) {
  const source = entry.source || 'legacy';
  const sourceScore = source.startsWith('popular-') ? 100
    : source === 'vital-articles-level-4' ? 90
      : source === 'vital-articles-level-5' ? 65 : source === 'legacy' ? 80 : 45;
  const norms = titleNorms(entry);
  const meanZipf = norms.reduce((sum, word) => sum + (frequency[word] || 0), 0) / Math.max(norms.length, 1);
  return sourceScore + Math.min(Math.log10(Math.max(entry.views12mo || 0, 1)), 7) * 5
    + meanZipf * 8 - norms.length * 4 + (cached ? 12 : 0);
}

function collectCandidates(coverage, baseline, { tiering, rankTargets, frequency = {}, cached = new Map() }) {
  const existing = new Set((baseline.pool || []).map(entry => entry.slug));
  const seen = new Set();
  const rejected = {};
  const candidates = [];
  for (const [coverageKey, entry] of Object.entries(coverage.pages || {})) {
    const slug = slugify(entry.title || coverageKey);
    if (existing.has(slug) || seen.has(slug)) continue;
    const reason = candidateReason(entry, tiering, rankTargets);
    if (reason) { rejected[reason] = (rejected[reason] || 0) + 1; continue; }
    seen.add(slug);
    const norms = titleNorms(entry);
    candidates.push({
      coverageKey, entry, slug, topic: classifyTopic(entry), titleWordNorms: norms,
      rankAnchor: tiering.orderByRankTier(norms, entry.titleWords || []).find(word => rankTargets.has(word)),
      score: candidateScore(entry, frequency, cached.has(slug)),
      cachedText: cached.get(slug)?.text || null,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return { candidates, rejected };
}

function quotas(count) {
  const total = Object.values(TOPIC_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const result = {};
  let remainder = count;
  for (const [topic, weight] of Object.entries(TOPIC_WEIGHTS)) {
    result[topic] = Math.floor(count * weight / total);
    remainder -= result[topic];
  }
  for (const topic of Object.keys(result)) {
    if (remainder-- <= 0) break;
    result[topic]++;
  }
  return result;
}

function validateBody(candidate, fetched) {
  if (!fetched || typeof fetched.plaintext !== 'string') return { ok: false, reason: 'no source body' };
  if (slugify(fetched.title) !== candidate.slug) return { ok: false, reason: 'redirected title' };
  if (fetched.plaintext.length < MIN_BODY_CHARS) return { ok: false, reason: 'clean body below 400 chars' };
  const missing = candidate.titleWordNorms.filter(word => !hasWord(fetched.plaintext, word));
  if (missing.length) return { ok: false, reason: 'title words absent from MP body', missing };
  // Cached text is used by online play only; Solo needs the Wikipedia body.
  if (candidate.cachedText) {
    const result = validate(candidate.cachedText, {
      title: candidate.entry.title, titleWordNorms: candidate.titleWordNorms,
    });
    if (!result.ok) return { ok: false, reason: 'cached article validation', hard: result.hard };
  }
  return {
    ok: true, bodyChars: fetched.plaintext.length, bodySha256: sha256(fetched.plaintext),
    cachedArticleSha256: candidate.cachedText ? sha256(candidate.cachedText) : null,
  };
}

function poolEntry(candidate) {
  return {
    title: candidate.entry.title, slug: candidate.slug, topic: candidate.topic,
    tier: candidate.titleWordNorms.length, source: candidate.entry.source || 'unknown',
    titleWordNorms: candidate.titleWordNorms,
    views12mo: typeof candidate.entry.views12mo === 'number' ? candidate.entry.views12mo : 0,
    shortdesc: candidate.entry.shortdesc || null,
  };
}

function appendEntries(baseline, additions) {
  if (!baseline || !Array.isArray(baseline.pool)) throw new Error('Invalid baseline pool');
  const slugs = new Set(baseline.pool.map(entry => entry.slug));
  const pool = baseline.pool.slice();
  for (const entry of additions) {
    if (!entry.slug || slugs.has(entry.slug)) throw new Error(`Duplicate or missing addition slug: ${entry.slug}`);
    slugs.add(entry.slug);
    pool.push(entry);
  }
  const byTopic = {};
  for (const entry of pool) {
    const topic = entry.topic || 'unknown';
    if (!byTopic[topic]) byTopic[topic] = { topic, taken: 0, byTier: {} };
    byTopic[topic].taken++;
    const tier = entry.tier >= 6 ? '6+' : String(entry.tier || 1);
    byTopic[topic].byTier[tier] = (byTopic[topic].byTier[tier] || 0) + 1;
  }
  return { ...baseline, totalSelected: pool.length, summary: Object.values(byTopic), pool };
}

function playableCount(coverage, pool, tiering) {
  const slugs = new Set(pool.pool.map(entry => entry.slug));
  return Object.values(coverage.pages).filter(entry => runtimeEligible(entry, tiering)
    && slugs.has(slugify(entry.title || ''))).length;
}

async function validateCandidates(candidates, {
  count, cache, fetchArticle = fetchLeadSection, concurrency = 3, onProgress = () => {},
  offlineOnly = false,
}) {
  const grouped = {};
  const budgets = quotas(count);
  for (const candidate of candidates) (grouped[candidate.topic] ||= []).push(candidate);
  const accepted = [];
  const rejected = [];
  let tested = 0;
  let skippedWithoutEvidence = 0;
  // Each topic has a fixed budget. Avoid backfilling a thin topic with a large
  // unrelated bucket: a smaller, balanced output is preferable to a padded one.
  const topics = Object.keys(budgets);
  let nextTopic = 0;
  async function worker() {
    while (nextTopic < topics.length) {
      const topic = topics[nextTopic++];
      let topicAccepted = 0;
      for (const candidate of grouped[topic] || []) {
        if (topicAccepted >= budgets[topic]) break;
        let evidence = cache[candidate.slug];
        const checkedAt = Date.parse(evidence?.checkedAt || '');
        const currentEvidence = evidence && evidence.title === candidate.entry.title && !evidence.error
          && Number.isFinite(checkedAt) && checkedAt <= Date.now()
          && Date.now() - checkedAt < 7 * 24 * 60 * 60 * 1000;
        if (offlineOnly && !currentEvidence) { skippedWithoutEvidence++; continue; }
        if (!currentEvidence) {
          try {
            const fetched = await fetchArticle(candidate.entry.title);
            evidence = { ...fetched, checkedAt: new Date().toISOString() };
          } catch (error) {
            evidence = { title: candidate.entry.title, checkedAt: new Date().toISOString(), error: error.message };
          }
          cache[candidate.slug] = evidence;
        }
        const validation = evidence.error
          ? { ok: false, reason: 'Wikipedia unavailable', error: evidence.error }
          : validateBody(candidate, evidence);
        tested++;
        if (validation.ok) {
          topicAccepted++;
          accepted.push({
            entry: poolEntry(candidate), coverageKey: candidate.coverageKey,
            rankAnchor: candidate.rankAnchor, checkedAt: evidence.checkedAt, ...validation,
          });
        } else rejected.push({ title: candidate.entry.title, slug: candidate.slug, topic, ...validation });
        if (tested % 50 === 0) onProgress({ tested, accepted: accepted.length, topic });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, topics.length) }, worker));
  accepted.sort((a, b) => a.entry.topic.localeCompare(b.entry.topic) || a.entry.slug.localeCompare(b.entry.slug));
  return { accepted, rejected, tested, skippedWithoutEvidence, quotas: budgets };
}

function parserHelpers(source) {
  const normalized = source.replace(/\r\n/g, '\n');
  const start = normalized.indexOf('const STOP_HEADINGS');
  const end = normalized.indexOf('async function fetchLeadSection');
  if (start < 0 || end <= start) throw new Error('Cannot identify Wikipedia parser helpers');
  return normalized.slice(start, end);
}

function importRuntimeCache(runtimeCache, cache, now = Date.now()) {
  let imported = 0;
  for (const evidence of Object.values(runtimeCache.entries || {})) {
    if (!evidence || !evidence.title || typeof evidence.plaintext !== 'string'
      || !Number.isFinite(evidence.fetchedAt) || evidence.fetchedAt > now
      || now - evidence.fetchedAt >= 7 * 24 * 60 * 60 * 1000) continue;
    const slug = slugify(evidence.title);
    if (cache[slug] && !cache[slug].error) continue;
    cache[slug] = { title: evidence.title, plaintext: evidence.plaintext,
      checkedAt: new Date(evidence.fetchedAt).toISOString(), source: 'matching-runtime-cache' };
    imported++;
  }
  return imported;
}

function importValidatedCandidates(accepted, validationCache, cache, checkedAt) {
  const verifiedTitles = new Set();
  for (const row of accepted) {
    const body = validationCache[row.entry?.title]?.body;
    if (!body || body.title !== row.entry.title || typeof body.plaintext !== 'string'
      || sha256(body.plaintext) !== row.checks?.cleanedBodySha256
      || body.plaintext.length !== row.checks?.cleanedBodyChars) continue;
    const slug = slugify(body.title);
    if (!cache[slug] || cache[slug].error) cache[slug] = {
      title: body.title, plaintext: body.plaintext, checkedAt, source: 'verified-shared-curation',
    };
    verifiedTitles.add(body.title);
  }
  return verifiedTitles;
}

// Wikimedia limits are shared by the developer machine's outbound IP. Space
// requests across workers, and pause everyone after a throttle response.
function pacedFetcher(fetchArticle, { intervalMs = 2000, cooldownMs = 30000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let nextRequestAt = 0;
  let cooldownUntil = 0;
  return async title => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const startAt = Math.max(Date.now(), nextRequestAt, cooldownUntil);
      nextRequestAt = startAt + intervalMs;
      const waitMs = startAt - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      // A different worker can discover a throttle during our scheduled wait.
      if (cooldownUntil > Date.now()) await sleep(cooldownUntil - Date.now());
      try { return await fetchArticle(title); }
      catch (error) {
        if (!/HTTP 429|HTTP 503|timed out|ETIMEDOUT/.test(error.message) || attempt === 2) throw error;
        cooldownUntil = Date.now() + cooldownMs * (attempt + 1);
      }
    }
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Value required for --${key}`);
    args[key] = argv[++i];
  }
  return args;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }

function resolvedPath(file) {
  const absolute = path.resolve(file);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, absolute));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertOutputPaths(inputs, outputs) {
  const sourcePaths = new Set(inputs.filter(Boolean).map(resolvedPath));
  const outputPaths = new Set();
  for (const file of outputs) {
    const resolved = resolvedPath(file);
    if (sourcePaths.has(resolved)) throw new Error(`Output would overwrite an input: ${file}`);
    if (outputPaths.has(resolved)) throw new Error(`Output paths must be distinct: ${file}`);
    if (/(?:^|[\\/])opt[\\/](?:wikisearchle|chat-relay|searchle|wikirectangled)(?:[\\/]|$)/i.test(resolved)) {
      throw new Error(`Curation cannot write into a deployed application: ${file}`);
    }
    outputPaths.add(resolved);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  for (const key of ['baseline', 'coverage', 'relay', 'rank-indexes', 'output', 'manifest', 'cache']) {
    if (!args[key]) throw new Error(`Required: --${key}`);
  }
  assertOutputPaths([
    args.baseline, args.coverage, args['cached-candidates'], ...args['rank-indexes'].split(';'),
    path.resolve(args.relay, 'data/word-bank/frequency.json'),
    args['body-cache-source'], args['body-cache-parser'],
    args['validated-candidates'], args['validation-cache'],
    args['retain-manifest'],
  ], [args.output, args.manifest, args.cache]);
  const baselineBytes = fs.readFileSync(args.baseline);
  const coverageBytes = fs.readFileSync(args.coverage);
  const baseline = readJson(args.baseline), coverage = readJson(args.coverage);
  const tiering = require(path.resolve(args.relay, 'src/rank-target-tiering.js'));
  const frequency = readJson(path.resolve(args.relay, 'data/word-bank/frequency.json'));
  const indexes = args['rank-indexes'].split(';').map(file => ({ file, json: readJson(file), sha256: sha256(fs.readFileSync(file)) }));
  const rankTargets = new Set(indexes.flatMap(index => index.json.words || []));
  if (!rankTargets.size) throw new Error('Empty model vocabulary');
  const cachedList = args['cached-candidates'] ? readJson(args['cached-candidates']) : [];
  const cached = new Map(cachedList.map(entry => [entry.slug, entry]));
  const discovered = collectCandidates(coverage, baseline, { tiering, rankTargets, frequency, cached });
  console.log(`Candidates passing unchanged runtime gates and additional curation: ${discovered.candidates.length}`);
  const count = Number(args.count || 500);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('Count must be 1..10000');
  const cache = fs.existsSync(args.cache) ? readJson(args.cache) : {};
  const bodyEvidenceSources = [];
  let verifiedSharedTitles = new Set();
  if (args['body-cache-source'] || args['validated-candidates']) {
    if (!args['body-cache-parser']) throw new Error('Runtime-cache reuse requires --body-cache-parser');
    const ownHelpers = parserHelpers(fs.readFileSync(path.join(__dirname, '../lib/wikipedia.js'), 'utf8'));
    const otherHelpers = parserHelpers(fs.readFileSync(args['body-cache-parser'], 'utf8'));
    if (ownHelpers !== otherHelpers) throw new Error('Runtime-cache Wikipedia parser differs from WikiContexto');
    if (args['body-cache-source']) bodyEvidenceSources.push({ type: 'matching-runtime-cache', parserHelpersSha256: sha256(ownHelpers),
      sha256: sha256(fs.readFileSync(args['body-cache-source'])),
      imported: importRuntimeCache(readJson(args['body-cache-source']), cache),
      available: Object.values(cache).filter(row => row.source === 'matching-runtime-cache').length });
    if (args['validated-candidates']) {
      if (!args['validation-cache']) throw new Error('Shared curation requires --validation-cache');
      const verified = importValidatedCandidates(readJson(args['validated-candidates']), readJson(args['validation-cache']), cache,
        fs.statSync(args['validation-cache']).mtime.toISOString());
      for (const candidate of discovered.candidates) if (verified.has(candidate.entry.title)) candidate.score += 200;
      verifiedSharedTitles = verified;
      discovered.candidates.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
      bodyEvidenceSources.push({ type: 'verified-shared-curation', parserHelpersSha256: sha256(ownHelpers),
        acceptedManifestSha256: sha256(fs.readFileSync(args['validated-candidates'])),
        validationCacheSha256: sha256(fs.readFileSync(args['validation-cache'])), verified: verified.size });
    }
  }
  const results = await validateCandidates(discovered.candidates, {
    count, cache, concurrency: Number(args.concurrency || 2),
    offlineOnly: args['offline-only'] === 'true',
    fetchArticle: pacedFetcher(fetchLeadSection, { intervalMs: Number(args['interval-ms'] || 2000) }),
    onProgress(progress) { writeJson(args.cache, cache); console.log(JSON.stringify(progress)); },
  });
  // An already reviewed batch stays additive when a second shared batch is
  // ready. Revalidate its exact entries and append eligible shared titles;
  // topic quotas must not evict entries already approved for this expansion.
  const combined = new Map(results.accepted.map(row => [row.entry.slug, row]));
  const candidateBySlug = new Map(discovered.candidates.map(row => [row.slug, row]));
  let retainedCount = 0;
  if (args['retain-manifest']) {
    const previous = readJson(args['retain-manifest']);
    if (previous.baseline.sha256 !== sha256(baselineBytes)) throw new Error('Retained manifest uses a different pool baseline');
    for (const row of previous.additions) {
      const candidate = candidateBySlug.get(row.entry.slug);
      const body = candidate && validateBody(candidate, cache[candidate.slug]);
      if (!candidate || !body.ok || JSON.stringify(poolEntry(candidate)) !== JSON.stringify(row.entry)) {
        throw new Error(`Retained addition no longer validates: ${row.entry.title}`);
      }
      combined.set(row.entry.slug, row);
      retainedCount++;
    }
  }
  const sharedAccepted = [], sharedRejected = [];
  for (const title of verifiedSharedTitles) {
    const candidate = discovered.candidates.find(row => row.entry.title === title);
    if (!candidate) { sharedRejected.push({ title, reason: 'additional metadata curation' }); continue; }
    const validation = validateBody(candidate, cache[candidate.slug]);
    if (!validation.ok) { sharedRejected.push({ title, ...validation }); continue; }
    const row = { entry: poolEntry(candidate), coverageKey: candidate.coverageKey,
      rankAnchor: candidate.rankAnchor, checkedAt: cache[candidate.slug].checkedAt, ...validation };
    combined.set(candidate.slug, row);
    sharedAccepted.push(title);
  }
  results.accepted = [...combined.values()].sort((a, b) => a.entry.topic.localeCompare(b.entry.topic) || a.entry.slug.localeCompare(b.entry.slug));
  writeJson(args.cache, cache);
  const output = appendEntries(baseline, results.accepted.map(row => row.entry));
  const createdAt = new Date().toISOString();
  output.expansion = { schemaVersion: SCHEMA_VERSION, createdAt, baselineSha256: sha256(baselineBytes), addedCount: results.accepted.length };
  writeJson(args.output, output);
  const manifest = {
    schemaVersion: SCHEMA_VERSION, createdAt,
    baseline: { sha256: sha256(baselineBytes), poolEntries: baseline.pool.length, playable: playableCount(coverage, baseline, tiering) },
    coverage: { sha256: sha256(coverageBytes), entries: Object.keys(coverage.pages).length },
    rankIndexes: indexes.map(index => ({ model: path.basename(path.dirname(index.file)), sha256: index.sha256, words: index.json.words.length })),
    output: { sha256: sha256(fs.readFileSync(args.output)), poolEntries: output.pool.length, playable: playableCount(coverage, output, tiering) },
    quality: { minimumBodyChars: MIN_BODY_CHARS, evidenceMaxAgeDays: 7, titleWordsPresent: true,
      unchangedRuntimeGates: true, offlineModelMembership: true, liveRankWarmups: 0, cachedTextValidator: true,
      newTitleCriteria: ['1-4 alphabetic content words', 'no skipped proper title words', 'WordNet title vocabulary', 'no interior-capital entity titles', 'at least50000annual views when measured', 'existing sampler suitability screen'] },
    requestedCount: count, candidateCount: discovered.candidates.length, metadataRejections: discovered.rejected,
    testedCount: results.tested, skippedWithoutEvidence: results.skippedWithoutEvidence,
    bodyEvidenceSources, quotas: results.quotas,
    retainedCount, sharedCuration: { examined: verifiedSharedTitles.size, accepted: sharedAccepted.length, rejected: sharedRejected },
    additions: results.accepted, rejected: results.rejected,
    cachedReview: { examined: cachedList.length,
      metadataEligible: discovered.candidates.filter(row => cached.has(row.slug)).length,
      accepted: results.accepted.filter(row => row.cachedArticleSha256).length },
  };
  writeJson(args.manifest, manifest);
  console.log(JSON.stringify({ before: manifest.baseline, after: manifest.output, added: results.accepted.length, tested: results.tested, rejected: results.rejected.length }));
}

module.exports = {
  slugify, titleNorms, isUnsafe, classifyTopic, runtimeEligible, candidateReason,
  collectCandidates, quotas, validateBody, poolEntry, appendEntries, playableCount,
  validateCandidates, sha256,
  pacedFetcher,
  assertOutputPaths,
  parserHelpers, importRuntimeCache,
  importValidatedCandidates,
  wordNetKnown,
};
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
