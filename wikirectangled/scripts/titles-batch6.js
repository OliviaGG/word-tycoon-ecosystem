// Batch 6 — same shape as batch5. Uses /tmp/wkt-batch6-raw.txt for input.
// EXTRA: also pre-filters against the Searchle-unrankable-words list (saved by
// the purge script) so we don't re-add articles we just purged.
const fs = require('fs');
const https = require('https');
const PATH = '/opt/chat-relay/data/wikipedia-coverage.json';
const RAW_PATH = '/tmp/wkt-batch6-raw.txt';
const UNRANKABLE_PATH = '/opt/chat-relay/data/searchle-unrankable-words.json';

const STOPLIST = new Set([
  'the','a','an','and','or','but','if','then','else','of','to','in','on','at','by','for','with','as','is','are','was','were','be','been','being','am','has','have','had','do','does','did','will','would','shall','should','can','could','may','might','must','this','that','these','those','it','its','they','them','their','there','here','he','she','we','you','your','his','her','him','me','my','our','who','whom','whose','which','what','when','where','why','how','not','no','so','than','too','very','just','also','such','into','from','about','after','before','over','under','between','through','during','while','because','although','though','since','until','one','two','three','first','second','new','old','other','some','any','all','each','every','most','many','much','more','less','few','several','both','either','neither',
]);

function parseRaw(raw) {
  const out = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*\d+\.\s*\[[A-Z]+\]\s*(.+?)\s*$/);
    if (!m) continue;
    out.push(m[1]);
  }
  return out;
}
function preFilter(title, unrankable) {
  const cleaned = title.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const words = cleaned.split(/[^A-Za-z]+/).filter(Boolean);
  const norms = words.map((w) => w.toLowerCase()).filter((n) => !STOPLIST.has(n));
  const placeable = norms.filter((n) => n.length >= 4 && n.length <= 9);
  if (placeable.length < 4) return null;
  const total = placeable.reduce((a, w) => a + w.length, 0);
  if (total > 45) return null;
  if (unrankable && placeable.some((n) => unrankable.has(n))) return null;
  return { title: cleaned, words, norms: placeable };
}
function fetchSummary(title) {
  return new Promise((resolve) => {
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_'));
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = https.get(url, { headers: { 'User-Agent': 'wikirec-batch/1.6 (https://wikirectangled.com)' } }, (res) => {
      const code = res.statusCode;
      if (code === 404) { res.resume(); return done({ ok: false, reason: '404' }); }
      if (code === 429) { res.resume(); return done({ ok: false, reason: '429' }); }
      if (code !== 200) { res.resume(); return done({ ok: false, reason: 'http-' + code }); }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.type === 'disambiguation') return done({ ok: false, reason: 'disambig' });
          const canonicalTitle = (j.titles && j.titles.canonical && j.titles.canonical.replace(/_/g, ' ')) || j.title || title;
          const extract = j.extract || '';
          done({ ok: true, canonicalTitle, extract, length: extract.length });
        } catch (e) { done({ ok: false, reason: 'parse' }); }
      });
    });
    req.setTimeout(15000, () => { req.destroy(); done({ ok: false, reason: 'timeout' }); });
    req.on('error', (e) => done({ ok: false, reason: 'net-' + e.code }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const raw = fs.readFileSync(RAW_PATH, 'utf8');
  const titles = parseRaw(raw);
  console.log('Parsed', titles.length, 'titles');

  let unrankable = null;
  try {
    if (fs.existsSync(UNRANKABLE_PATH)) {
      const data = JSON.parse(fs.readFileSync(UNRANKABLE_PATH, 'utf8'));
      unrankable = new Set(data.words || []);
      console.log('Loaded', unrankable.size, 'known-unrankable words');
    } else {
      console.log('No unrankable-words file yet — pre-filter will skip that check');
    }
  } catch (e) { console.log('failed to load unrankable list:', e.message); }

  const coverage = JSON.parse(fs.readFileSync(PATH, 'utf8'));
  const existingKeys = new Set(Object.keys(coverage.pages));

  const candidates = [];
  for (const t of titles) {
    if (existingKeys.has(t)) continue;
    const f = preFilter(t, unrankable);
    if (!f) continue;
    candidates.push({ raw: t, ...f });
  }
  console.log('Pre-filter passed:', candidates.length, '/', titles.length);

  const reasons = {};
  let added = 0;
  const accepted = {};
  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx];
    let r = await fetchSummary(c.raw);
    if (!r.ok && (r.reason === '429' || r.reason === 'timeout' || (r.reason || '').startsWith('net-'))) {
      await sleep(2500);
      r = await fetchSummary(c.raw);
    }
    if (!r.ok) { reasons[r.reason] = (reasons[r.reason] || 0) + 1; await sleep(250); continue; }
    const key = r.canonicalTitle;
    if (existingKeys.has(key) || accepted[key]) { reasons.dup = (reasons.dup || 0) + 1; await sleep(250); continue; }
    if (r.length < 200) { reasons['body-short'] = (reasons['body-short'] || 0) + 1; await sleep(250); continue; }
    const f = preFilter(key, unrankable);
    if (!f) { reasons['canonical-prefilter'] = (reasons['canonical-prefilter'] || 0) + 1; await sleep(250); continue; }
    accepted[key] = {
      status: 'exists',
      title: key,
      length: Math.max(r.length * 3, 500),
      titleWords: f.words,
      titleWordNorms: f.norms,
    };
    added++;
    if (added % 25 === 0) console.log(' ', added, 'added so far');
    await sleep(250);
  }
  console.log('Result: added', added, 'reasons:', reasons);

  // Re-read coverage right before writing — purge may have run between our
  // initial read and now; merge against the freshest version.
  const freshCoverage = JSON.parse(fs.readFileSync(PATH, 'utf8'));
  const freshKeys = new Set(Object.keys(freshCoverage.pages));
  const TS = Math.floor(Date.now() / 1000);
  fs.writeFileSync('/tmp/wikipedia-coverage.json.bak-batch6-' + TS, fs.readFileSync(PATH));
  let actuallyAdded = 0;
  for (const [k, v] of Object.entries(accepted)) {
    if (freshKeys.has(k)) continue;
    freshCoverage.pages[k] = v;
    actuallyAdded++;
  }
  freshCoverage.stats.batch6MergedAt = new Date().toISOString();
  freshCoverage.stats.batch6Added = actuallyAdded;
  freshCoverage.stats.totalPages = Object.keys(freshCoverage.pages).length;
  freshCoverage.stats.updatedAt = new Date().toISOString();
  fs.writeFileSync(PATH, JSON.stringify(freshCoverage));
  console.log('actually added (after re-read):', actuallyAdded, 'totalPages now:', freshCoverage.stats.totalPages);
})();
