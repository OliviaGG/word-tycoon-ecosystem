// Patch only GuessList entrance hooks in a fresh canonical deployment capture.
// Preserve all unrelated recovery, cosmetics, physics and virtualization code.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {parseAst} = require('rollup/dist/parseAst.js');
const [input, output] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) {
  throw new Error('Usage: node tools/build-guess-entrances-production.cjs <canonical-root> <separate-output>');
}
const repo = path.join(__dirname, '..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const checks = new Map();
const checked = name => {
  const data = fs.readFileSync(path.join(input, name));
  checks.set(name.replaceAll('\\', '/'), hash(data));
  return data.toString('utf8');
};
function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (node.type) callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) value.forEach(v => visit(v, callback));
    else if (value && typeof value === 'object') visit(value, callback);
  }
}
function checkModule(name) {
  const file = 'dist/assets/' + name;
  if (checks.has(file)) return;
  const ast = parseAst(checked(file));
  for (const node of ast.body) {
    if (node.source?.value?.startsWith('./')) checkModule(node.source.value.slice(2));
  }
}
function write(name, data) {
  fs.mkdirSync(path.dirname(path.join(output, name)), {recursive:true});
  fs.writeFileSync(path.join(output, name), data);
}
const helperFile = 'client/src/ui/GuessEntranceEffects.js';
const helper = fs.readFileSync(path.join(repo, helperFile), 'utf8');
parseAst(helper);
const helperAsset = 'guess-entrance-effects-' + hash(helper).slice(0,12) + '.js';
write('dist/assets/' + helperAsset, helper);
write(helperFile, helper);
const sourceFile = 'client/src/ui/GuessList.js';
checked(sourceFile);
const source = fs.readFileSync(path.join(repo, sourceFile), 'utf8');
if (!source.includes('queueGuessEntrance(this, guess.word);') || !source.includes('tickGuessEntrances(this);')) {
  throw new Error('Source entrance hooks missing');
}
write(sourceFile, source);
checked('client/src/ui/canvas-water/GuessEntryCanvas.js');
checked('dist/surface-ui.css');
const changes = [];
for (const mode of ['index', 'sp']) {
  const htmlFile = 'dist/' + mode + '.html';
  const beforeHtml = checked(htmlFile);
  for (const match of beforeHtml.matchAll(/(?:src|href)="\/assets\/([^"/]+)"/g)) {
    if (match[1].endsWith('.js')) checkModule(match[1]);
    else checked('dist/assets/' + match[1]);
  }
  const oldAsset = [...beforeHtml.matchAll(/<script[^>]*type="module"[^>]*src="\/assets\/([^"/]+)"/g)].at(-1)?.[1];
  if (!oldAsset) throw new Error('No main module in ' + htmlFile);
  const before = checked('dist/assets/' + oldAsset), ast = parseAst(before);
  const lists = ast.body.filter(n => n.type === 'ClassDeclaration' &&
    ['_materializeEntry','_enforceMaterializedCap','updateList'].every(name => n.body.body.some(m => m.key.name === name)));
  if (lists.length !== 1 || before.includes('__queueGuessEntrance')) throw new Error('Unexpected canonical GuessList');
  const list = lists[0], update = list.body.body.find(m => m.key.name === 'update');
  const updateList = list.body.body.find(m => m.key.name === 'updateList');
  const calls = [], entries = [];
  visit(updateList, n => {
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' &&
        n.callee.object.type === 'ThisExpression' && n.callee.property.name === '_enforceMaterializedCap') calls.push(n);
    if (n.type === 'NewExpression' && n.arguments[4]?.type === 'ObjectExpression' &&
        n.arguments[4].properties.some(p => p.key.name === 'rankColorTransition')) entries.push(n);
  });
  if (calls.length !== 1 || entries.length !== 1 || entries[0].arguments[0].type !== 'Identifier') {
    throw new Error('Ambiguous live entry insertion');
  }
  const call = calls[0], guess = entries[0].arguments[0].name;
  const edits = [
    {start:update.value.body.end-1, end:update.value.body.end-1, text:';__tickGuessEntrances(this);'},
    {start:call.start, end:call.end, text:`(__queueGuessEntrance(this,${guess}.word),${before.slice(call.start,call.end)})`},
  ].sort((a,b) => b.start-a.start);
  let patched = before;
  for (const edit of edits) patched = patched.slice(0,edit.start)+edit.text+patched.slice(edit.end);
  const importLine = `import {queueGuessEntrance as __queueGuessEntrance,tickGuessEntrances as __tickGuessEntrances} from "./${helperAsset}";\n`;
  patched = importLine + patched;
  parseAst(patched);
  // Reverse the exact edits to prove unrelated bytes did not change.
  let restored = patched.slice(importLine.length);
  restored = restored.replace(';__tickGuessEntrances(this);','');
  restored = restored.replace(`(__queueGuessEntrance(this,${guess}.word),${before.slice(call.start,call.end)})`,before.slice(call.start,call.end));
  if (restored !== before) throw new Error('Bundle preservation failed');
  const asset = 'guess-entrances-' + (mode === 'index' ? 'mp' : 'sp') + '-' + hash(patched).slice(0,12) + '.js';
  write('dist/assets/' + asset, patched);
  const afterHtml = beforeHtml.replaceAll('/assets/' + oldAsset, '/assets/' + asset);
  if (afterHtml.replaceAll('/assets/' + asset, '/assets/' + oldAsset) !== beforeHtml) throw new Error('HTML preservation failed');
  write(htmlFile, afterHtml);
  changes.push({mode,oldAsset,asset,list:list.id.name});
}
write('baseline-sha256.txt',[...checks].map(([name,digest]) => digest+'  '+name).join('\n')+'\n');
write('release.json',JSON.stringify({helperAsset,checkedFiles:checks.size,changes},null,2)+'\n');
console.log(JSON.stringify({helperAsset,checkedFiles:checks.size,changes}));
