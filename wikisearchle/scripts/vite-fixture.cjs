// Isolated browser fixture. Never connects to the relay, rankings, or economy.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm'), crypto = require('node:crypto');
const { Server } = require('socket.io');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const scope = { ...require('../lib/redactor'), crypto, SOLO_HANDLE_KEY: 'local-preview-only' };
function slice(start, end) { const a = source.indexOf(start), b = source.indexOf(end, a); if (a < 0 || b <= a) throw Error('Fixture source changed'); return source.slice(a, b); }
vm.runInNewContext(slice('function soloHandle(', 'const gameShared =') + slice('function buildWeeklyPublic(', 'async function buildSoloEntryFromTitle('), scope);
const meta = {
  dateKey: '2026-10-04', setAt: '2026-10-04T18:00:00.000Z', cleanTitle: 'Solar Eclipse', titleWordNorms: ['solar', 'eclipse'], totalRankedWords: 100000,
  plaintext: 'The sky grows dark as the Moon passes between Earth and the Sun. For a short time, daylight fades and the stars may become visible. Observers gather along a narrow path to watch a remarkable alignment.\n\nA solar eclipse occurs when the Moon blocks the light of the Sun. The shadow travels across the surface of Earth, and people in different locations see different amounts of coverage. During totality, the bright outer atmosphere becomes visible around the dark lunar disk.\n\nThese events have inspired scientific study for centuries. Astronomers use careful calculations to predict the time and place of each appearance. Special glasses protect the eyes while viewing the partial phases. Clouds and weather can change the experience, but the movement of the shadow follows a predictable course.\n\nThe next opportunity depends on location. Some people travel great distances to stand in the path, while others watch a partial view from home. Even a brief moment of darkness can make the familiar landscape feel extraordinary.',
};
const user = { id: 'local-preview', username: 'Explorer', displayName: 'Explorer', platform: 'discord', platformUserId: 'local-preview' };
async function startFixture({ port = 0 } = {}) {
  let entry = scope.buildSoloEntryFromMeta(meta), guessCount = 0, top = [], revealed = new Set();
  const pages = new Map(); require('../src/seo-middleware').attach({ get: (route, handler) => pages.set(route, handler) });
  function article() {
    const snapshot = JSON.parse(JSON.stringify(entry.public.snapshot));
    for (const token of [...snapshot.titleTokens, ...snapshot.paragraphs.flat()]) {
      const raw = entry.public.idToToken.get(token.id);
      if (raw && revealed.has(raw.norm)) { token.text = raw.text; token.revealed = true; }
    }
    return { ...snapshot, startedAt: 1791136800000, won: false, revealProgress: { found: revealed.size, total: 145 } };
  }
  function state() { return { targetWord: '(active)', topGuesses: top, scoreboard: [], guessCount, lastAnnounce: null, totalRankedWords: 100000 }; }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/me/session') return send({ ok: true, user });
    if (url.pathname === '/api/me/equipped-cosmetics') return send({ ok: true, equipped: {} });
    if (url.pathname === '/api/state') return send(state());
    if (url.pathname === '/api/solo/status') return send({ daily: { available: true, dateKey: meta.dateKey }, random: { available: true }, weekly: { available: false } });
    if (url.pathname === '/api/solo/archive') return send({ today: meta.dateKey, puzzles: [{ dateKey: '2026-10-03' }], hasMore: false });
    if (['/api/solo/daily', '/api/solo/random', '/api/solo/archive/2026-10-03'].includes(url.pathname)) {
      return send({ available: true, ...entry.public.snapshot, dateKey: meta.dateKey, isDaily: url.pathname.endsWith('daily'), isArchive: url.pathname.includes('archive') });
    }
    if (url.pathname === '/api/solo/guess' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body), word = String(data.word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const ids = entry.public.normToIds.get(word) || [], texts = {};
      ids.forEach(id => { texts[id] = entry.public.idToToken.get(id).text; });
      const title = meta.titleWordNorms.includes(word);
      return send({ word, norm: word, canonical: word, rank: rank(word), revealIds: ids, revealTexts: texts,
        points: ids.length ? 30 : 0, tier: 'common', isTitleWord: title, titleNorm: title ? word : undefined, progressProof: 'fixture-progress' });
    }
    if (url.pathname.startsWith('/api/')) return send({ ok: false, user: null, equipped: {}, remaining: 0 });
    const handler = pages.get(url.pathname);
    if (handler) return handler({ method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams) },
      { set: (name, value) => res.setHeader(name, value), send: html => res.end(html) }, error => { res.statusCode = 500; res.end(String(error)); });
    const file = [path.join(root, 'dist'), path.join(root, 'public')].map(base => {
      const target = path.resolve(base, '.' + url.pathname);
      return target.startsWith(base + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
    }).find(Boolean);
    if (!file) { res.statusCode = 404; return res.end(); }
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  const realtime = new Server(server);
  realtime.on('connection', socket => {
    socket.emit('wikisearchle-state', state()); socket.emit('wikiword-state', article());
    socket.on('submit-guess', data => {
      const word = String(data.word || '').toLowerCase().replace(/[^a-z0-9]/g, ''); guessCount++;
      const ids = entry.public.normToIds.get(word) || [];
      if (ids.length) revealed.add(word);
      const guess = { word, rank: rank(word), user, nickname: 'Explorer' };
      if (!top.some(g => g.word === word)) top = [...top, guess].sort((a, b) => a.rank - b.rank).slice(0, 6);
      realtime.emit('wikisearchle-new-guess', guess); realtime.emit('wikisearchle-top', top);
      realtime.emit('wikiword-state', article());
      if (ids.length) realtime.emit('wikiword-reveal', { words: [word] });
      realtime.emit('wikisearchle-chip', { word, status: ids.length ? 'hit' : 'miss', user });
    });
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, realtime, user, origin: 'http://127.0.0.1:' + server.address().port,
    reset() { entry = scope.buildSoloEntryFromMeta(meta); revealed.clear(); top = []; guessCount = 0; },
    round() { realtime.emit('wikisearchle-round-start'); revealed.clear(); top = []; guessCount = 0; realtime.emit('wikisearchle-state', state()); realtime.emit('wikiword-state', article()); },
    close: () => new Promise(resolve => realtime.close(() => server.close(resolve))) };
}
function rank(word) { return { sky: 183, sun: 27, moon: 12, earth: 58, light: 221, science: 942, solar: 1, eclipse: 1 }[word] || 3785; }
module.exports = { startFixture, user };
