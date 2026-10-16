const { startFixture } = require('./vite-fixture.cjs');
(async () => {
  const built = process.argv.includes('--built');
  const fixture = await startFixture({ port: built ? 4328 : 4329 });
  if (built) {
    console.log('Compiled WikiContexto preview: ' + fixture.origin + '/daily and /online');
    return;
  }
  process.env.WKX_API_URL = fixture.origin;
  process.env.WKX_AUTH_URL = fixture.origin;
  process.env.VITE_WKX_DEMO = '1';
  const { createServer } = await import('vite');
  const dev = await createServer({ configFile: require('node:path').resolve(__dirname, '../vite.config.mjs') });
  await dev.listen();
  console.log('WikiContexto local preview: http://127.0.0.1:5175/daily and /online');
  async function close() { await dev.close(); await fixture.close(); process.exit(0); }
  process.on('SIGINT', close); process.on('SIGTERM', close);
})();
