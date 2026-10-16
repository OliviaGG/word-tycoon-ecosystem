'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function encode(payload, vocabulary) {
  if (payload.totalRankedWords !== vocabulary.length || Object.keys(payload.rankings).length !== vocabulary.length)
    throw Error('Vocabulary size differs');
  const bytes = Buffer.alloc(vocabulary.length * 4);
  const seen = new Uint8Array(vocabulary.length + 1);
  for (let i = 0; i < vocabulary.length; i++) {
    const rank = payload.rankings[vocabulary[i]];
    if (!Number.isSafeInteger(rank) || rank < 1 || rank > vocabulary.length || seen[rank]) throw Error('Invalid ranking permutation');
    seen[rank] = 1;
    bytes.writeUInt32LE(rank, i * 4);
  }
  return bytes;
}
function decode(bytes, vocabulary, word) {
  if (bytes.length !== vocabulary.length * 4) throw Error('Rank array length differs');
  const entries = new Array(vocabulary.length);
  for (let i = 0; i < vocabulary.length; i++) {
    const rank = bytes.readUInt32LE(i * 4);
    if (!rank || rank > entries.length || entries[rank - 1]) throw Error('Invalid or duplicate rank');
    entries[rank - 1] = [vocabulary[i], rank];
  }
  return Buffer.from(JSON.stringify({ targetWord: word, rankings: Object.fromEntries(entries), totalRankedWords: entries.length }));
}
function pack(generated, out) {
  if (process.platform !== 'win32') throw Error('Pack locally on Windows');
  const plan = json(path.join(generated, 'addition-plan.json'));
  fs.mkdirSync(out, { recursive: true });
  const first = json(path.join(generated, 'sp-pool', plan.additions[0].filename));
  const vocabulary = Object.keys(first.rankings).sort();
  const vocabularyBytes = Buffer.from(JSON.stringify(vocabulary));
  fs.writeFileSync(path.join(out, 'vocabulary.json.gz'), zlib.gzipSync(vocabularyBytes, { level: 6 }));
  const files = [];
  for (const [index, item] of plan.additions.entries()) {
    const original = fs.readFileSync(path.join(generated, 'sp-pool', item.filename));
    const bytes = encode(JSON.parse(original), vocabulary);
    const reconstructed = decode(bytes, vocabulary, item.word);
    if (!original.equals(reconstructed)) throw Error(`Byte round trip differs: ${item.word}`);
    const compressed = zlib.gzipSync(bytes, { level: 6 });
    const filename = `${item.filename}.ranks.gz`;
    fs.writeFileSync(path.join(out, filename), compressed);
    files.push({ word: item.word, filename: item.filename, wireFilename: filename,
      sha256: sha(original), bytes: original.length, wireSha256: sha(compressed), wireBytes: compressed.length });
    if ((index + 1) % 100 === 0) console.log(JSON.stringify({ packed: index + 1, total: plan.additions.length }));
  }
  const manifest = { version: 1, vocabularySha256: sha(vocabularyBytes), vocabularyWords: vocabulary.length,
    files, totalOriginalBytes: files.reduce((sum, item) => sum + item.bytes, 0),
    totalWireBytes: files.reduce((sum, item) => sum + item.wireBytes, 0) };
  fs.writeFileSync(path.join(out, 'wire-manifest.json'), JSON.stringify(manifest));
  console.log(JSON.stringify({ originalBytes: manifest.totalOriginalBytes, wireBytes: manifest.totalWireBytes, files: files.length }));
}
function unpack(stage) {
  if (process.platform === 'win32' || !path.resolve(stage).startsWith('/tmp/subtextle-content-expansion-'))
    throw Error('Unpack only into uploaded /tmp staging');
  const manifest = json(path.join(stage, 'wire-manifest.json'));
  const vocabularyBytes = zlib.gunzipSync(fs.readFileSync(path.join(stage, 'vocabulary.json.gz')));
  if (sha(vocabularyBytes) !== manifest.vocabularySha256) throw Error('Vocabulary checksum differs');
  const vocabulary = JSON.parse(vocabularyBytes);
  if (vocabulary.length !== manifest.vocabularyWords || new Set(vocabulary).size !== vocabulary.length) throw Error('Invalid vocabulary');
  const out = path.join(stage, 'sp-pool');
  fs.mkdirSync(out, { recursive: true });
  for (const [index, item] of manifest.files.entries()) {
    if (!/^[a-z]{4,}$/.test(item.word) || !new RegExp(`^pool_\\d+_${item.word}\\.json$`).test(item.filename)
      || item.wireFilename !== `${item.filename}.ranks.gz`) throw Error('Unsafe wire filename');
    const compressed = fs.readFileSync(path.join(stage, item.wireFilename));
    if (sha(compressed) !== item.wireSha256) throw Error(`Wire checksum differs: ${item.word}`);
    const bytes = decode(zlib.gunzipSync(compressed), vocabulary, item.word);
    if (sha(bytes) !== item.sha256 || bytes.length !== item.bytes) throw Error(`Decoded checksum differs: ${item.word}`);
    const output = path.join(out, item.filename);
    if (fs.existsSync(output)) {
      if (sha(fs.readFileSync(output)) !== item.sha256) throw Error(`Existing staged file differs: ${item.word}`);
    } else fs.writeFileSync(output, bytes, { flag: 'wx' });
    if ((index + 1) % 100 === 0) console.log(JSON.stringify({ unpacked: index + 1, total: manifest.files.length }));
  }
  console.log(JSON.stringify({ decoded: manifest.files.length, byteIdentical: true }));
}
module.exports = { encode, decode };
if (require.main === module) {
  const [mode, input, output] = process.argv.slice(2);
  if (mode === 'pack' && input && output) pack(path.resolve(input), path.resolve(output));
  else if (mode === 'unpack' && input) unpack(path.resolve(input));
  else throw Error('Use pack <generated> <wire-output> or unpack <uploaded-stage>');
}
