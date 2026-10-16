import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const outDir = path.join(root, 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };

function frontendRoutes() {
  return {
    name: 'wikicontexto-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        // Dev workers must never retain source modules or Vite's HMR client.
        if (url.pathname === '/sw.js') {
          res.setHeader('Content-Type', 'text/javascript');
          res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));");
          return;
        }
        const route = url.pathname.replace(/\/$/, '') || '/';
        let page;
        if (['/solo', '/daily', '/solo/index.html'].includes(route)) page = '/solo/index.html';
        if (['/online', '/index.html'].includes(route) || (route === '/' && (url.searchParams.has('session') || url.searchParams.has('obs')))) page = '/online/index.html';
        if (page) { req.url = page + url.search; return next(); }
        const aliases = { '/': 'home.html', '/about': 'about.html', '/previous-dailies': 'previous-dailies.html' };
        const file = path.resolve(publicDir, aliases[route] || '.' + url.pathname);
        if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      // Copy the existing app shell, artwork, guides, and OBS assets. Vite owns
      // the two game HTML entries; static copying must not overwrite them.
      fs.cpSync(publicDir, outDir, { recursive: true, filter: source => {
        const relative = path.relative(publicDir, source).replaceAll('\\', '/');
        return !/\.bak(?:[.-]|$)/.test(relative) && !['index.html', 'solo/index.html'].includes(relative);
      }});
      fs.copyFileSync(path.join(outDir, 'online/index.html'), path.join(outDir, 'index.html'));
      const assets = fs.readdirSync(path.join(outDir, 'assets')).filter(name => /\.(js|css|svg)$/.test(name));
      const worker = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8')
        .replace('const SHELL = [', 'const SHELL = [\n' + assets.map(name => `  '/assets/${name}',`).join('\n'));
      fs.writeFileSync(path.join(outDir, 'sw.js'), worker);
    },
  };
}

export default defineConfig({
  root: path.join(root, 'client'),
  publicDir: false,
  plugins: [frontendRoutes()],
  server: {
    host: '127.0.0.1', port: 5175, strictPort: true,
    fs: { allow: [root] },
    proxy: {
      '/api/me': { target: process.env.WKX_AUTH_URL || 'http://127.0.0.1:3000', changeOrigin: true },
      '/api/auth': { target: process.env.WKX_AUTH_URL || 'http://127.0.0.1:3000', changeOrigin: true },
      '/auth': { target: process.env.WKX_AUTH_URL || 'http://127.0.0.1:3000', changeOrigin: true },
      '/api': { target: process.env.WKX_API_URL || 'http://127.0.0.1:3029', changeOrigin: true },
      '/socket.io': { target: process.env.WKX_API_URL || 'http://127.0.0.1:3029', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir, emptyOutDir: true, manifest: true, target: 'es2020',
    rolldownOptions: { input: { online: path.join(root, 'client/online/index.html'), solo: path.join(root, 'client/solo/index.html') } },
  },
});
