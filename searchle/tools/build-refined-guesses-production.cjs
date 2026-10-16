// Add a scoped row stylesheet to a fresh canonical dist capture. Existing
// module/CSS bytes, solo recovery, header and win-card fixes remain intact.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [input, output] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) {
  throw new Error('Usage: node tools/build-refined-guesses-production.cjs <canonical-root> <separate-output>');
}
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const checks = new Map();
const checked = name => {
  const data = fs.readFileSync(path.join(input, name));
  checks.set(name.replaceAll('\\', '/'), hash(data));
  return data.toString('utf8');
};
function checkModule(name) {
  const file = 'dist/assets/' + name;
  if (checks.has(file)) return;
  const code = checked(file);
  for (const match of code.matchAll(/(?:from\s*|import\s*)["']\.\/([^"']+\.js)["']/g)) {
    checkModule(match[1]);
  }
}
const source = path.join(__dirname, '../client/public/refined-guesses.css');
const css = fs.readFileSync(source);
const asset = 'refined-guesses-' + hash(css).slice(0, 12) + '.css';
checked('dist/surface-ui.css');
checked('client/styles/main.css');
fs.mkdirSync(path.join(output, 'dist/assets'), { recursive: true });
fs.mkdirSync(path.join(output, 'client/public'), { recursive: true });
fs.writeFileSync(path.join(output, 'dist/assets', asset), css);
fs.writeFileSync(path.join(output, 'client/public/refined-guesses.css'), css);
for (const page of ['index.html', 'sp.html']) {
  const file = 'dist/' + page;
  const before = checked(file);
  if (!before.includes('/surface-ui.css?')) {
    throw new Error('Unexpected canonical HTML in ' + file);
  }
  for (const match of before.matchAll(/(?:src|href)="\/assets\/([^"/]+)"/g)) {
    if (match[1].endsWith('.js')) checkModule(match[1]);
    else checked('dist/assets/' + match[1]);
  }
  const link = '  <link rel="stylesheet" href="/assets/' + asset + '">\n';
  const oldLinks = [...before.matchAll(/  <link rel="stylesheet" href="\/assets\/refined-guesses-[a-f0-9]+\.css">\n/g)];
  if (oldLinks.length > 1) throw new Error('Duplicate refined stylesheet links');
  const oldLink = oldLinks[0]?.[0];
  const after = oldLink ? before.replace(oldLink, link) : before.replace('</head>', link + '</head>');
  if (after.replace(link, oldLink || '') !== before) throw new Error('HTML preservation failed');
  fs.writeFileSync(path.join(output, file), after);
  const sourceFile = 'client/' + page;
  checked(sourceFile);
  const localSource = fs.readFileSync(path.join(__dirname, '..', sourceFile));
  if (!localSource.toString('utf8').includes('/refined-guesses.css?v=20261004-4')) {
    throw new Error('Source stylesheet link missing in ' + sourceFile);
  }
  fs.writeFileSync(path.join(output, sourceFile), localSource);
}
if (fs.existsSync(path.join(input, 'client/public/refined-guesses.css'))) checked('client/public/refined-guesses.css');
fs.writeFileSync(path.join(output, 'baseline-sha256.txt'),
  [...checks].map(([name, digest]) => digest + '  ' + name).join('\n') + '\n');
console.log(JSON.stringify({asset, checkedFiles: checks.size, changedHtml: ['index.html', 'sp.html'], javascriptChanged: false}));
