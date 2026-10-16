const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { startFixture } = require('./vite-fixture.cjs');
(async () => {
  const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
  assert.ok(fs.existsSync(path.join(dist, '.vite/manifest.json')), 'Run npm run build first');
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json')));
  for (const mode of ['online', 'solo']) assert.ok(manifest[mode + '/index.html']?.isEntry, mode);
  const fixture = await startFixture();
  try {
    for (const url of ['/daily', '/solo', '/online', '/?session=sample', '/?session=sample&obs=1']) {
      const response = await fetch(fixture.origin + url), html = await response.text();
      assert.equal(response.status, 200, url); assert.ok(html.includes('data-vite-ui="true"'), url);
      assert.ok(!html.includes('/@vite') && !html.includes('Local preview ·'), 'Production contains dev content');
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
      assert.ok(assets.length >= 3, url);
      for (const asset of assets) { const r = await fetch(fixture.origin + asset); assert.equal(r.status, 200, asset); assert.ok((await r.text()).length > 100); }
    }
    const worker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
    for (const asset of fs.readdirSync(path.join(dist, 'assets'))) assert.ok(worker.includes('/assets/' + asset), asset + ' missing from PWA shell');
    const guess = await fetch(fixture.origin + '/api/solo/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word: 'moon' }) });
    assert.ok((await guess.json()).revealIds.length > 0);
    console.log('Vite production routes, bundles, fixture API, and PWA asset manifest passed.');
  } finally { await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
