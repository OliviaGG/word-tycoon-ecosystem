// Patch the fresh canonical entrypoints; preserve all existing renderer fixes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseAst } = require('rollup/dist/parseAst.js');
const [input, output] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) {
  throw new Error('Usage: node tools/build-solo-ui-production.cjs <fresh-canonical-root> <separate-output>');
}
const root = path.resolve(__dirname, '..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const changes = [];
const dependencies = new Map();
function dependency(file) {
  if (!dependencies.has(file)) dependencies.set(file, { file, before: hash(fs.readFileSync(path.join(input, file))) });
}
function write(file, data) {
  fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
  fs.writeFileSync(path.join(output, file), data);
  const before = path.join(input, file);
  changes.push({ file, before: fs.existsSync(before) ? hash(fs.readFileSync(before)) : null, after: hash(data) });
}
function visit(node, cb) {
  if (!node || typeof node !== 'object') return;
  if (node.type) cb(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(n => visit(n, cb));
    else if (value && typeof value === 'object') visit(value, cb);
  }
}
const signal = ';window.__subtextleGameReady=true;document.dispatchEvent(new CustomEvent("subtextle-game-ready"));';
function patchReady(before, source = false) {
  if (before.includes('__subtextleGameReady')) throw new Error('Canonical already has ready hooks');
  const positions = { solo: [], online: [], completed: [] };
  visit(parseAst(before), node => {
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.property.name === 'onGameReady' && node.right.body?.type === 'BlockStatement') {
      positions.solo.push(node.right.body.end - 1);
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.property.name === 'onWeeklyCompleted' && node.right.body?.type === 'BlockStatement') {
      positions.completed.push(node.right.body.end - 1);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'on' && node.arguments[0]?.value === 'game-state' && node.arguments[1]?.body?.type === 'BlockStatement') {
      positions.online.push(node.arguments[1].body.end - 1);
    }
  });
  if (positions.solo.length !== 1 || positions.online.length !== 1 || positions.completed.length !== 1) throw new Error('Unexpected renderer callbacks: ' + JSON.stringify(positions));
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const insertion = source ? '  window.__subtextleGameReady = true;' + eol + '    document.dispatchEvent(new CustomEvent(\'subtextle-game-ready\'));' + eol + '  ' : signal;
  let after = before;
  for (const position of Object.values(positions).flat().sort((a, b) => b - a)) {
    after = after.slice(0, position) + insertion + after.slice(position);
  }
  parseAst(after);
  if (after.split(insertion).join('') !== before) throw new Error('Unrelated bundle bytes changed');
  return after;
}
const assets = {};
for (const name of ['game-status.css', 'game-loading.js']) {
  const data = fs.readFileSync(path.join(root, 'client/public', name));
  assets[name] = name.replace('.', '-' + hash(data).slice(0, 12) + '.');
  write('client/public/' + name, data);
  write('dist/' + name, data);
  write('dist/assets/' + assets[name], data);
}
function addUI(html, production) {
  if (html.includes('subtextle-game-loading')) throw new Error('Canonical already has loading UI');
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const css = production ? '/assets/' + assets['game-status.css'] : '/game-status.css';
  const js = production ? '/assets/' + assets['game-loading.js'] : '/game-loading.js';
  if (!html.includes('</head>') || !html.includes('<body>')) throw new Error('Unexpected HTML');
  // Initialize phone sizing while large deferred game modules are still loading.
  html = html.replace(/(<script src="\/(?:assets\/review-prompts-[^"/]+\.js|prompt-ui\.js[^"/]*)") defer(><\/script>)/, '$1$2');
  const overlay = '  <script>if(/OBS/i.test(navigator.userAgent)||new URLSearchParams(location.search).has("obs"))document.documentElement.dataset.subtextleOverlay="true";</script>';
  return html.replace('</head>', '  <link rel="stylesheet" href="' + css + '">' + eol + overlay + eol + '  <script src="' + js + '" defer></script>' + eol + '</head>')
    .replace('<body>', '<body>' + eol + '  <div id="subtextle-game-loading" role="status" aria-live="polite">Loading...</div>');
}
for (const mode of ['index', 'sp', 'alt']) {
  const file = 'dist/' + mode + '.html';
  let html = fs.readFileSync(path.join(input, file), 'utf8');
  for (const match of html.matchAll(/(?:href|src)="(\/(?!\/)[^"?#]+)(?:[?#][^"]*)?"/g)) {
    const assetFile = 'dist' + match[1];
    if (fs.existsSync(path.join(input, assetFile)) && fs.statSync(path.join(input, assetFile)).isFile()) dependency(assetFile);
  }
  const oldAsset = [...html.matchAll(/<script[^>]*type="module"[^>]*src="\/assets\/([^"/]+)"/g)].at(-1)?.[1];
  if (!oldAsset) throw new Error('Missing entrypoint: ' + mode);
  const before = fs.readFileSync(path.join(input, 'dist/assets', oldAsset), 'utf8');
  for (const node of parseAst(before).body.filter(node => node.type === 'ImportDeclaration')) {
    if (node.source.value.startsWith('./')) dependency('dist/assets/' + node.source.value.slice(2));
  }
  const after = patchReady(before);
  const asset = 'game-ready-' + mode + '-' + hash(after).slice(0, 12) + '.js';
  write('dist/assets/' + asset, after);
  html = html.replaceAll('/assets/' + oldAsset, '/assets/' + asset);
  write(file, addUI(html, true));
  write('client/' + mode + '.html', addUI(fs.readFileSync(path.join(input, 'client', mode + '.html'), 'utf8'), false));
}
for (const file of ['client/src/main.js', 'client/src/alt-main.js']) {
  write(file, patchReady(fs.readFileSync(path.join(input, file), 'utf8'), true));
}
write('tools/build-solo-ui-production.cjs', fs.readFileSync(__filename));
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify({ assets, changes, dependencies: [...dependencies.values()] }, null, 2) + '\n');
console.log(JSON.stringify({ assets, changedFiles: changes.length, preservedRendererBytes: true }));
