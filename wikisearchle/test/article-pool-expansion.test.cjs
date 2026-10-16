'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  titleNorms, runtimeEligible, collectCandidates, appendEntries, validateBody,
  validateCandidates, quotas, classifyTopic, isUnsafe,
  assertOutputPaths, pacedFetcher,
  importRuntimeCache, parserHelpers,
  importValidatedCandidates, sha256,
  wordNetKnown,
} = require('../scripts/expand-article-pool.cjs');

const tiering = {
  articleHasAtLeastOneEasyTitleWord: entry => !entry.blocked,
  classifyTitleWords: entry => ({ findable: entry.titleWordNorms, skipped: entry.proper ? ['name'] : [] }),
  orderByRankTier: norms => norms,
};
function page(title, overrides = {}) {
  return { status: 'exists', title, titleWords: title.split(' '), titleWordNorms: title.toLowerCase().split(' '), length: 3000, ...overrides };
}
function candidate(title, topic = 'science') {
  const entry = page(title);
  return { entry, slug: title.toLowerCase().replaceAll(' ', '_'), topic, titleWordNorms: titleNorms(entry), rankAnchor: titleNorms(entry)[0] };
}
function article(title) {
  return { title, plaintext: `${title} is an ordinary subject with a substantial explanation. ` + 'A useful description supplies clear context for players. '.repeat(12) };
}

test('expansion retains runtime availability, popularity, and tier gates', () => {
  assert.equal(runtimeEligible(page('Solar energy'), tiering), true);
  assert.equal(runtimeEligible(page('Solar energy', { status: 'missing' }), tiering), false);
  assert.equal(runtimeEligible(page('Solar energy', { backfillStatus: 'not-found' }), tiering), false);
  assert.equal(runtimeEligible(page('Solar energy', { source: 'category-crawl', views12mo: 49999 }), tiering), false);
  assert.equal(runtimeEligible(page('Solar energy', { source: 'category-crawl', views12mo: 50000 }), tiering), true);
  assert.equal(runtimeEligible(page('Solar energy', { blocked: true }), tiering), false);
});

test('curation excludes existing and duplicate slugs, proper names, and model gaps', () => {
  const baseline = { pool: [{ title: 'Solar energy', slug: 'solar_energy', topic: 'science' }] };
  const coverage = { pages: {
    existing: page('Solar energy'), first: page('Wind power'), duplicate: page('Wind power'),
    named: page('Wind forest', { proper: true }), unknown: page('Unrankable'),
    unsafe: page('Sexual assault'), tooLong: page('A very lengthy five word technical title'),
  } };
  const result = collectCandidates(coverage, baseline, { tiering, rankTargets: new Set(['solar', 'wind', 'power']) });
  assert.deepEqual(result.candidates.map(row => row.slug), ['wind_power']);
  assert.equal(result.rejected['no model anchor'], 1);
  assert.equal(result.rejected['proper title word'], 1);
  assert.equal(result.rejected['sampler suitability'], 1);
});

test('target words follow runtime tokenizer and stoplist rather than pool metadata', () => {
  assert.deepEqual(titleNorms(page('The solar-energy system', { titleWords: ['The', 'solar', 'energy', 'system'], titleWordNorms: ['incorrect'] })), ['solar', 'energy', 'system']);
  assert.deepEqual(titleNorms(page('All your energy and energy')), ['energy']);
  assert.equal(classifyTopic(page('Seaweed', { shortdesc: 'Species of marine plant' })), 'living');
  assert.equal(classifyTopic(page('Pasta', { shortdesc: 'Type of food' })), 'food');
  assert.equal(classifyTopic(page('Megabat', { shortdesc: 'Family of fruit bats' })), 'living');
  assert.equal(classifyTopic(page('Linux', { shortdesc: 'Family of Unix-like operating systems' })), 'tech');
  assert.equal(classifyTopic(page('Reality television', { shortdesc: 'Genre of television programming' })), 'film_tv_games');
  assert.equal(isUnsafe(page('Massacre')), true);
  assert.equal(isUnsafe(page('Woman on top', { shortdesc: 'Sex position' })), true);
  assert.equal(isUnsafe(page('Grapefruit')), false);
});

test('additive output keeps every baseline entry intact and updates its metadata', () => {
  const original = { title: 'Existing', slug: 'existing', topic: 'science', tier: 1, custom: { pinned: true } };
  const baseline = { generatedAt: 'original-date', pool: [original], totalSelected: 1 };
  const addition = { title: 'Wind power', slug: 'wind_power', topic: 'science', tier: 2 };
  const output = appendEntries(baseline, [addition]);
  assert.equal(output.pool[0], original);
  assert.deepEqual(output.pool.slice(0, baseline.pool.length), baseline.pool);
  assert.equal(output.generatedAt, baseline.generatedAt);
  assert.equal(output.totalSelected, 2);
  assert.equal(output.summary[0].taken, 2);
  assert.deepEqual(baseline.pool, [original]);
  assert.throws(() => appendEntries(baseline, [addition, addition]), /Duplicate/);
  assert.throws(() => appendEntries(baseline, [original]), /Duplicate/);
});

test('body validation rejects redirects, short prose, absent exact title tokens, and malformed cache', () => {
  const row = candidate('Solar energy');
  assert.equal(validateBody(row, article('Solar energy')).ok, true);
  assert.equal(validateBody(row, article('Alternative energy')).reason, 'redirected title');
  assert.equal(validateBody(row, { title: row.entry.title, plaintext: 'Solar energy is useful.' }).reason, 'clean body below 400 chars');
  assert.equal(validateBody(row, { title: row.entry.title, plaintext: 'energy '.repeat(100) }).reason, 'title words absent from MP body');
  row.cachedText = 'Solar energy is a malformed one-paragraph cached article.';
  assert.equal(validateBody(row, article(row.entry.title)).reason, 'cached article validation');
});

test('topic budgets remain bounded with concurrent validation and unavailable subjects', async () => {
  const rows = [candidate('Solar energy'), candidate('Wind power'), candidate('Stone', 'everyday')];
  const cache = {};
  let requests = 0;
  const count = 6;
  const result = await validateCandidates(rows, { count, cache, concurrency: 3,
    fetchArticle: async title => { requests++; if (title === 'Wind power') throw Error('temporary failure'); return article(title); },
  });
  assert.equal(requests, 2, 'Each topic stops at its budget');
  assert.equal(result.accepted.length, 2);
  assert.equal(result.accepted.filter(row => row.entry.topic === 'science').length, 1);
  assert.equal(Object.values(quotas(count)).reduce((sum, quota) => sum + quota, 0), count);
  const rerun = await validateCandidates(rows, { count, cache, fetchArticle: async () => { throw Error('unexpected refetch'); } });
  assert.equal(rerun.accepted.length, 2, 'Successful source evidence is reused without network requests');
});

test('Wikipedia failures remain reviewable instead of becoming accepted entries', async () => {
  const row = candidate('Solar energy');
  const result = await validateCandidates([row], { count: 11, cache: {}, fetchArticle: async () => { throw Error('timeout'); } });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reason, 'Wikipedia unavailable');
});

test('output guards protect source files, aliases, and deployed application paths', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-pool-guard-'));
  const baseline = path.join(directory, 'baseline.json');
  fs.writeFileSync(baseline, '{"pool":[]}');
  try {
    assert.throws(() => assertOutputPaths([baseline], [baseline]), /overwrite an input/);
    assert.throws(() => assertOutputPaths([baseline], [path.join(directory, '.', 'baseline.json')]), /overwrite an input/);
    const output = path.join(directory, 'output.json');
    assert.throws(() => assertOutputPaths([baseline], [output, output]), /must be distinct/);
    assert.throws(() => assertOutputPaths([baseline], ['/opt/wikisearchle/data/article-pool.json']), /deployed application/);
    assert.throws(() => assertOutputPaths([baseline], ['/opt/chat-relay/data/wikipedia-coverage.json']), /deployed application/);
    assertOutputPaths([baseline], [output, path.join(directory, 'manifest.json')]);
    assert.equal(fs.readFileSync(baseline, 'utf8'), '{"pool":[]}', 'Refusal never changes the source');
  } finally { fs.unlinkSync(baseline); fs.rmdirSync(directory); }
});

test('paced transport retries transient throttles and propagates permanent errors', async () => {
  let attempts = 0;
  const fetchArticle = pacedFetcher(async title => {
    if (++attempts < 3) throw Error('Wikipedia HTTP 429');
    return article(title);
  }, { intervalMs: 0, cooldownMs: 0 });
  assert.equal((await fetchArticle('Solar energy')).title, 'Solar energy');
  assert.equal(attempts, 3);
  const permanent = pacedFetcher(async () => { throw Error('Wikipedia HTTP 404'); }, { intervalMs: 0, cooldownMs: 0 });
  await assert.rejects(permanent('Missing'), /HTTP 404/);
});

test('compatible runtime cache requires fresh evidence and cannot replace a checked article', () => {
  const now = Date.parse('2026-10-06T15:00:00Z');
  const cache = { solar_energy: { title: 'Solar energy', plaintext: 'already checked' } };
  const runtime = { entries: {
    same: { ...article('Solar energy'), fetchedAt: now - 1000 },
    fresh: { ...article('Wind power'), fetchedAt: now - 1000 },
    stale: { ...article('Water power'), fetchedAt: now - 7 * 24 * 60 * 60 * 1000 },
    future: { ...article('Water cycle'), fetchedAt: now + 1 },
    missingDate: article('Solar power'),
  } };
  assert.equal(importRuntimeCache(runtime, cache, now), 1);
  assert.equal(cache.solar_energy.plaintext, 'already checked');
  assert.equal(cache.wind_power.source, 'matching-runtime-cache');
  assert.equal(cache.water_power, undefined);
  assert.equal(cache.water_cycle, undefined);
  assert.equal(parserHelpers('const STOP_HEADINGS\r\nbody\r\nasync function fetchLeadSection'), 'const STOP_HEADINGS\nbody\n');
});

test('offline curation never fetches absent or failed evidence', async () => {
  const rows = [candidate('Solar energy'), candidate('Wind power')];
  const result = await validateCandidates(rows, { count: 6,
    cache: { solar_energy: { error: 'earlier timeout' }, wind_power: { ...article('Wrong title'), checkedAt: new Date().toISOString() } }, offlineOnly: true,
    fetchArticle: async () => { assert.fail('Offline curation made a network request'); },
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.tested, 0);
  assert.equal(result.skippedWithoutEvidence, 2);
});

test('shared curation reuses only body evidence matching its accepted manifest', () => {
  const body = article('Wind power');
  const accepted = [{ entry: { title: body.title }, checks: { cleanedBodySha256: sha256(body.plaintext), cleanedBodyChars: body.plaintext.length } }];
  const cache = {};
  const checkedAt = new Date().toISOString();
  assert.equal(importValidatedCandidates(accepted, { 'Wind power': { body } }, cache, checkedAt).size, 1);
  assert.equal(cache.wind_power.source, 'verified-shared-curation');
  const changed = { ...body, plaintext: body.plaintext + ' changed' };
  assert.equal(importValidatedCandidates(accepted, { 'Wind power': { body: changed } }, {}, checkedAt).size, 0);
});

test('WordNet curation accepts focused gerunds through known base verbs', () => {
  const dictionary = { _internal: { _wnLookup: word => new Set(['bleach', 'run', 'make']).has(word) } };
  assert.equal(wordNetKnown('bleaching', dictionary), true);
  assert.equal(wordNetKnown('running', dictionary), true);
  assert.equal(wordNetKnown('making', dictionary), false, 'Short ambiguous forms do not bypass curation');
  assert.equal(wordNetKnown('unfindable', dictionary), false);
});
