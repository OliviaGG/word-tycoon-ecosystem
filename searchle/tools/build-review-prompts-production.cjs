// Patch fresh canonical HTML without replacing its production-only game bundles.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function patchHtml(html, css, js) {
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  if (html.includes('/prompt-ui.css') || html.includes('/assets/review-prompts-')) throw Error('Already patched');
  const before = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
  html = html.replace('</head>', `  <link rel="stylesheet" href="${css}">${eol}  <script src="${js}" defer></script>${eol}</head>`);
  if (/var _guessSubmissionPending\s*=\s*false;/.test(html)) {
    html = html.replace(/var _guessSubmissionPending\s*=\s*false;/, `var _guessSubmissionPending = false;
    var _guessButtonLabel = guessBtn ? guessBtn.textContent : 'ENTER';
    function setGuessPending(pending) {
      if (!guessBtn) return;
      guessBtn.textContent = pending ? 'Checking…' : _guessButtonLabel;
      guessBtn.setAttribute('aria-busy', String(pending));
    }`.replace(/\n/g, eol));
    html = html.replace('_guessSubmissionPending = true;', '_guessSubmissionPending = true;' + eol + '      setGuessPending(true);');
    const callback = '        _guessSubmissionPending = false;';
    if (!html.includes(callback)) throw Error('Submission callback missing');
    html = html.replace(callback, callback + eol + '        setGuessPending(false);');
  }
  const after = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)]
    .map(match => match[1]).filter(value => !value.includes('/review-prompts-'));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Canonical game asset references changed');
  return html;
}
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node tools/build-review-prompts-production.cjs canonical-dist output');
  fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
  const assets = {};
  for (const ext of ['css', 'js']) {
    const body = fs.readFileSync(path.join(__dirname, '../client/public/prompt-ui.' + ext));
    const name = 'review-prompts-' + hash(body).slice(0, 12) + '.' + ext;
    fs.writeFileSync(path.join(output, 'assets', name), body);
    assets[ext] = '/assets/' + name;
  }
  const baseline = {};
  for (const name of ['index.html', 'sp.html', 'alt.html']) {
    const original = fs.readFileSync(path.join(input, name), 'utf8');
    baseline['dist/' + name] = hash(original);
    fs.writeFileSync(path.join(output, name), patchHtml(original, assets.css, assets.js));
  }
  fs.writeFileSync(path.join(output, 'baseline-sha256.json'), JSON.stringify(baseline, null, 2));
  console.log(JSON.stringify({ assets, html: Object.keys(baseline) }));
}
module.exports = { patchHtml };
