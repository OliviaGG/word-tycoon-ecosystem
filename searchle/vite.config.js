import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

export default defineConfig({
  plugins: [{
    name: 'preserve-canonical-subtextle-ui',
    configResolved(config) {
      if (config.command !== 'build' || resolve(config.root, config.build.outDir) !== resolve(__dirname, 'dist')) return;
      for (const name of ['index.html', 'sp.html', 'alt.html']) {
        const html = resolve(__dirname, 'dist', name);
        if (existsSync(html) && /\/assets\/(?:recovery-preserved|win-media|widget-win|guess-panel|avatar-border|main-header)-/.test(readFileSync(html, 'utf8'))) {
          throw new Error('Subtextle dist contains canonical production UI fixes absent from source. Build to a separate --outDir for validation, then patch freshly captured canonical bundles. Read AGENTS.md before deployment.');
        }
      }
    },
  }],
  root: 'client',
  // Absolute base: assets are referenced as /assets/... instead of ./assets/...
  // Relative paths ('./') break when index.html is served under a sub-path
  // like /stream/index.html — Vite-generated <script src="./assets/main.js">
  // would resolve to /stream/assets/main.js which doesn't exist. Absolute '/'
  // always resolves to /assets/ regardless of the URL path. Searchle is
  // always deployed at root so this is the correct choice.
  base: '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'client/index.html'),
        admin: resolve(__dirname, 'client/admin.html'),
        sp: resolve(__dirname, 'client/sp.html'),
        alt: resolve(__dirname, 'client/alt.html'),
      }
    }
  },
  server: {
    port: 3015,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3019',
        ws: true
      },
      '/api': 'http://localhost:3019',
      '/sp-pool': 'http://localhost:3019'
    }
  }
});
