const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { once } = require('events');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'pt-br');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const MODELS_DIR = path.join(DATA_DIR, 'models');

const DIMENSIONS = 300;
const MODEL_DEFS = {
  'fasttext-cc-pt': {
    description: 'fastText Common Crawl + Wikipedia Portuguese 300d',
    vendor: 'fastText',
    type: 'text-gz',
    url: 'https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.pt.300.vec.gz',
    rawPath: path.join(RAW_DIR, 'fasttext', 'cc.pt.300.vec.gz'),
    tokenFormat: 'plain',
    defaultMaxWords: 300000,
    approxDownload: '1.27 GB compressed',
    license: 'CC BY-SA 3.0',
  },
  'numberbatch-pt': {
    description: 'ConceptNet Numberbatch 19.08 Portuguese-only split',
    vendor: 'ConceptNet / Zenodo split',
    type: 'word2vec-zip',
    url: 'https://zenodo.org/api/records/4911598/files/numberbatch-19.08-pt.zip/content',
    rawPath: path.join(RAW_DIR, 'numberbatch', 'numberbatch-19.08-pt.zip'),
    extractedPath: path.join(RAW_DIR, 'numberbatch', 'numberbatch-19.08-pt.bin'),
    tokenFormat: 'plain',
    defaultMaxWords: 300000,
    approxDownload: '39 MB compressed Portuguese split',
    license: 'CC BY-SA 4.0',
  },
  'nilc-glove-300d': {
    description: 'NILC Portuguese GloVe 300d safetensors',
    vendor: 'NILC / Hugging Face',
    type: 'safetensors',
    url: 'https://huggingface.co/nilc-nlp/glove-300d',
    files: [
      {
        url: 'https://huggingface.co/nilc-nlp/glove-300d/resolve/main/vocab.txt',
        rawPath: path.join(RAW_DIR, 'nilc-glove-300d', 'vocab.txt'),
      },
      {
        url: 'https://huggingface.co/nilc-nlp/glove-300d/resolve/main/embeddings.safetensors',
        rawPath: path.join(RAW_DIR, 'nilc-glove-300d', 'embeddings.safetensors'),
      },
    ],
    tokenFormat: 'vocab+safetensors',
    defaultMaxWords: 300000,
    approxDownload: '1.13 GB model + 9 MB vocab',
    license: 'CC BY 4.0',
  },
};

const PORTUGUESE_WORD_RE = /^[a-z\u00e1\u00e0\u00e2\u00e3\u00e9\u00ea\u00ed\u00f3\u00f4\u00f5\u00fa\u00fc\u00e7]+$/u;
const DEFAULT_QUERIES = ['amor', 'comida', 'futebol', 'carnaval', 'dinheiro', 'praia', 'musica'];

function usage() {
  console.log('Usage:');
  console.log('  node tools/ptbr-model-lab.js list');
  console.log('  node tools/ptbr-model-lab.js download <model|all> [--force]');
    console.log('  node tools/ptbr-model-lab.js build <model> [--max-words=300000] [--min-length=3] [--max-length=16]');
  console.log('  node tools/ptbr-model-lab.js nearest <model> [word ...] [--top=25]');
  console.log('  node tools/ptbr-model-lab.js coverage <model> <targets.json>');
  console.log('');
  console.log('Models:');
  for (const [name, def] of Object.entries(MODEL_DEFS)) {
    console.log(`  ${name} - ${def.description}`);
  }
}

function parseOptions(argv) {
  const args = [];
  const opts = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq === -1) {
      opts[arg.slice(2)] = true;
    } else {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return { args, opts };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function bytesToSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function wordFold(word) {
  return String(word || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC');
}

function normalizeWord(word) {
  return String(word || '').trim().toLowerCase().normalize('NFC');
}

function isLikelyPtWord(word, minLength, maxLength) {
  return word.length >= minLength
    && word.length <= maxLength
    && PORTUGUESE_WORD_RE.test(word);
}

function parseNumber(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveModel(name) {
  const def = MODEL_DEFS[name];
  if (!def) {
    throw new Error(`Unknown pt-BR model "${name}". Run "node tools/ptbr-model-lab.js list".`);
  }
  return def;
}

function listModels() {
  for (const [name, def] of Object.entries(MODEL_DEFS)) {
    console.log(`\n${name}`);
    console.log(`  ${def.description}`);
    console.log(`  Vendor: ${def.vendor}`);
    console.log(`  Type: ${def.type}`);
    console.log(`  Download: ${def.approxDownload}`);
    console.log(`  License: ${def.license}`);
    const rawPaths = def.files ? def.files.map(f => f.rawPath) : [def.rawPath];
    for (const rawPath of rawPaths) {
      const exists = fs.existsSync(rawPath);
      const size = exists ? bytesToSize(fs.statSync(rawPath).size) : 'missing';
      console.log(`  Raw: ${path.relative(ROOT, rawPath)} (${size})`);
    }
    const outDir = path.join(MODELS_DIR, name);
    const built = fs.existsSync(path.join(outDir, 'index.json')) && fs.existsSync(path.join(outDir, 'vectors.bin'));
    console.log(`  Built: ${built ? path.relative(ROOT, outDir) : 'no'}`);
  }

  if (fs.existsSync(MODELS_DIR)) {
    const extraBuilt = fs.readdirSync(MODELS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !MODEL_DEFS[entry.name])
      .map(entry => entry.name)
      .sort();
    if (extraBuilt.length) {
      console.log('\nExtra built models');
      for (const name of extraBuilt) {
        const outDir = path.join(MODELS_DIR, name);
        const indexPath = path.join(outDir, 'index.json');
        const vectorsPath = path.join(outDir, 'vectors.bin');
        if (!fs.existsSync(indexPath) || !fs.existsSync(vectorsPath)) continue;
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        console.log(`  ${name} - ${index.count.toLocaleString()} words, ${index.dimensions}d (${bytesToSize(fs.statSync(vectorsPath).size)})`);
      }
    }
  }
}

function downloadUrl(url, dest, force) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest) && !force) {
      console.log(`Already downloaded: ${path.relative(ROOT, dest)} (${bytesToSize(fs.statSync(dest).size)})`);
      resolve();
      return;
    }

    ensureDir(path.dirname(dest));
    const tempPath = `${dest}.part`;
    const file = fs.createWriteStream(tempPath);
    const started = Date.now();

    function request(currentUrl, redirectsLeft) {
      const req = https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects while downloading ${url}`));
            return;
          }
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          request(nextUrl, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed for ${url}: HTTP ${res.statusCode}`));
          return;
        }

        const total = Number.parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) {
            const pct = ((downloaded / total) * 100).toFixed(1).padStart(5);
            process.stdout.write(`\r  ${pct}% ${bytesToSize(downloaded)} / ${bytesToSize(total)}`);
          } else if (downloaded % (32 * 1024 * 1024) < chunk.length) {
            process.stdout.write(`\r  Downloaded ${bytesToSize(downloaded)}`);
          }
        });
        res.pipe(file, { end: false });
        res.on('end', () => {
          file.end(() => {
            fs.renameSync(tempPath, dest);
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            console.log(`\nDownloaded ${path.relative(ROOT, dest)} in ${elapsed}s`);
            resolve();
          });
        });
      });
      req.on('error', reject);
    }

    file.on('error', reject);
    request(url, 5);
  });
}

async function downloadModel(name, force) {
  if (name === 'all') {
    for (const modelName of Object.keys(MODEL_DEFS)) {
      await downloadModel(modelName, force);
    }
    return;
  }
  const def = resolveModel(name);
  console.log(`\nDownloading ${name} - ${def.description}`);
  if (def.files) {
    for (const file of def.files) {
      await downloadUrl(file.url, file.rawPath, force);
    }
  } else {
    await downloadUrl(def.url, def.rawPath, force);
  }
}

function parsePlainToken(rawToken) {
  return normalizeWord(rawToken);
}

function parseConceptNetPtToken(rawToken) {
  if (!rawToken.startsWith('/c/pt/')) return null;
  const tail = rawToken.slice('/c/pt/'.length);
  if (tail.includes('/')) return null;
  if (tail.includes('_')) return null;
  return normalizeWord(decodeURIComponent(tail));
}

function findPython() {
  for (const cmd of ['python', 'py']) {
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf-8' });
    if (!res.error && res.status === 0) return cmd;
  }
  return null;
}

function parseToken(rawToken, tokenFormat) {
  if (tokenFormat === 'conceptnet-pt') return parseConceptNetPtToken(rawToken);
  return parsePlainToken(rawToken);
}

function parseVectorParts(parts, dimensions) {
  if (parts.length !== dimensions) return null;
  const buffer = Buffer.allocUnsafe(dimensions * 4);
  for (let i = 0; i < dimensions; i++) {
    const value = Number.parseFloat(parts[i]);
    if (!Number.isFinite(value)) return null;
    buffer.writeFloatLE(value, i * 4);
  }
  return buffer;
}

async function writeVector(stream, buffer) {
  if (!stream.write(buffer)) {
    await once(stream, 'drain');
  }
}

function writeModelMetadata(outDir, modelName, def, words, opts, extra = {}) {
  const index = {
    dimensions: DIMENSIONS,
    count: words.length,
    words,
    language: 'pt-BR',
    sourceModel: modelName,
  };
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));

  const aliases = {};
  for (const word of words) {
    const folded = wordFold(word);
    if (folded !== word) {
      if (!aliases[folded]) aliases[folded] = [];
      aliases[folded].push(word);
    }
  }
  fs.writeFileSync(path.join(outDir, 'accent-aliases.json'), JSON.stringify(aliases, null, 2));

  const metadata = {
    language: 'pt-BR',
    sourceModel: modelName,
    description: def.description,
    vendor: def.vendor,
    sourceUrl: def.url || (def.files && def.files.map(f => f.url)),
    tokenFormat: def.tokenFormat,
    generatedAt: new Date().toISOString(),
    filters: opts,
    wordCount: words.length,
    accentAliasCount: Object.keys(aliases).length,
    ...extra,
  };
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
}

async function buildTextGzModel(modelName, def, opts) {
  if (!fs.existsSync(def.rawPath)) {
    throw new Error(`Missing raw file: ${def.rawPath}. Run "node tools/ptbr-model-lab.js download ${modelName}" first.`);
  }

  const outDir = path.join(MODELS_DIR, modelName);
  ensureDir(outDir);

  const vectorsPath = path.join(outDir, 'vectors.bin');
  const vectorStream = fs.createWriteStream(vectorsPath);
  const words = [];
  const seen = new Set();
  let lines = 0;
  let skipped = 0;
  let duplicates = 0;
  let headerSeen = false;

  const input = fs.createReadStream(def.rawPath).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    lines++;
    if (!headerSeen) {
      headerSeen = true;
      const header = line.trim().split(/\s+/);
      if (header.length === 2 && Number.isFinite(Number(header[0])) && Number.isFinite(Number(header[1]))) {
        console.log(`  Header: ${Number(header[0]).toLocaleString()} rows, ${header[1]} dimensions`);
        continue;
      }
    }

    if (lines % 100000 === 0) {
      process.stdout.write(`\r  Processed ${lines.toLocaleString()} rows, kept ${words.length.toLocaleString()}`);
    }

    const space = line.indexOf(' ');
    if (space === -1) {
      skipped++;
      continue;
    }

    const word = parseToken(line.slice(0, space), def.tokenFormat);
    if (!word || !isLikelyPtWord(word, opts.minLength, opts.maxLength)) {
      skipped++;
      continue;
    }
    if (seen.has(word)) {
      duplicates++;
      continue;
    }

    const parts = line.slice(space + 1).trim().split(/\s+/);
    const buffer = parseVectorParts(parts, DIMENSIONS);
    if (!buffer) {
      skipped++;
      continue;
    }

    seen.add(word);
    words.push(word);
    await writeVector(vectorStream, buffer);

    if (words.length >= opts.maxWords) break;
  }

  vectorStream.end();
  await once(vectorStream, 'finish');

  console.log(`\r  Processed ${lines.toLocaleString()} rows, kept ${words.length.toLocaleString()}`);
  console.log(`  Skipped ${skipped.toLocaleString()} rows, duplicates ${duplicates.toLocaleString()}`);
  writeModelMetadata(outDir, modelName, def, words, opts, { rowsProcessed: lines, rowsSkipped: skipped, duplicates });
  console.log(`  Wrote ${path.relative(ROOT, outDir)} (${bytesToSize(fs.statSync(vectorsPath).size)} vectors)`);
}

function extractZipWithPython(zipPath, outPath) {
  if (fs.existsSync(outPath)) return;
  const python = findPython();
  if (!python) throw new Error('Python is required to extract ZIP_LZMA Numberbatch split.');
  ensureDir(path.dirname(outPath));
  const code = [
    'import sys, zipfile',
    'zip_path, out_path = sys.argv[1], sys.argv[2]',
    'with zipfile.ZipFile(zip_path) as zf:',
    '    names = [name for name in zf.namelist() if not name.endswith("/") and name.lower().endswith(".bin")]',
    '    if not names:',
    '        names = [name for name in zf.namelist() if not name.endswith("/") ]',
    '    if len(names) != 1:',
    '        raise SystemExit(f"expected one member, found {names}")',
    '    with zf.open(names[0]) as src, open(out_path, "wb") as dst:',
    '        while True:',
    '            chunk = src.read(1024 * 1024)',
    '            if not chunk:',
    '                break',
    '            dst.write(chunk)',
    '    print(names[0])',
  ].join('\n');
  const res = spawnSync(python, ['-c', code, zipPath, outPath], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(res.stderr || res.stdout);
  console.log(`  Extracted ${res.stdout.trim()} -> ${path.relative(ROOT, outPath)}`);
}

function readAsciiLine(buffer, start) {
  let pos = start;
  while (pos < buffer.length && buffer[pos] !== 0x0a) pos++;
  if (pos >= buffer.length) throw new Error('Unexpected EOF while reading word2vec header.');
  return { line: buffer.slice(start, pos).toString('ascii').trim(), next: pos + 1 };
}

function readToken(buffer, start) {
  let pos = start;
  while (pos < buffer.length && buffer[pos] !== 0x20) pos++;
  if (pos >= buffer.length) throw new Error('Unexpected EOF while reading word2vec token.');
  return { token: buffer.slice(start, pos).toString('utf-8'), next: pos + 1 };
}

async function buildWord2VecZipModel(modelName, def, opts) {
  if (!fs.existsSync(def.rawPath)) {
    throw new Error(`Missing raw file: ${def.rawPath}. Run "node tools/ptbr-model-lab.js download ${modelName}" first.`);
  }
  extractZipWithPython(def.rawPath, def.extractedPath);

  const outDir = path.join(MODELS_DIR, modelName);
  ensureDir(outDir);

  const source = fs.readFileSync(def.extractedPath);
  const header = readAsciiLine(source, 0);
  const [rowsRaw, dimsRaw] = header.line.split(/\s+/);
  const rowCount = Number.parseInt(rowsRaw, 10);
  const dimensions = Number.parseInt(dimsRaw, 10);
  if (!Number.isFinite(rowCount) || dimensions !== DIMENSIONS) {
    throw new Error(`Unsupported word2vec header: "${header.line}"`);
  }
  console.log(`  Header: ${rowCount.toLocaleString()} rows, ${dimensions} dimensions`);

  const vectorsPath = path.join(outDir, 'vectors.bin');
  const vectorStream = fs.createWriteStream(vectorsPath);
  const words = [];
  const seen = new Set();
  let skipped = 0;
  let duplicates = 0;
  let pos = header.next;
  const vectorBytes = DIMENSIONS * 4;

  for (let row = 0; row < rowCount && pos < source.length; row++) {
    if (row > 0 && row % 50000 === 0) {
      process.stdout.write(`\r  Processed ${row.toLocaleString()} rows, kept ${words.length.toLocaleString()}`);
    }
    const tokenInfo = readToken(source, pos);
    pos = tokenInfo.next;
    const word = parseToken(tokenInfo.token, def.tokenFormat);
    if (pos + vectorBytes > source.length) throw new Error('Unexpected EOF while reading word2vec vector.');
    const vector = source.subarray(pos, pos + vectorBytes);
    pos += vectorBytes;
    if (source[pos] === 0x0a) pos++;

    if (!word || !isLikelyPtWord(word, opts.minLength, opts.maxLength)) {
      skipped++;
      continue;
    }
    if (seen.has(word)) {
      duplicates++;
      continue;
    }

    seen.add(word);
    words.push(word);
    await writeVector(vectorStream, Buffer.from(vector));
    if (words.length >= opts.maxWords) break;
  }

  vectorStream.end();
  await once(vectorStream, 'finish');

  console.log(`\r  Processed ${Math.min(rowCount, words.length + skipped + duplicates).toLocaleString()} rows, kept ${words.length.toLocaleString()}`);
  console.log(`  Skipped ${skipped.toLocaleString()} rows, duplicates ${duplicates.toLocaleString()}`);
  writeModelMetadata(outDir, modelName, def, words, opts, { rowsProcessed: Math.min(rowCount, words.length + skipped + duplicates), rowsSkipped: skipped, duplicates });
  console.log(`  Wrote ${path.relative(ROOT, outDir)} (${bytesToSize(fs.statSync(vectorsPath).size)} vectors)`);
}

function readSafetensorsHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const lenBuf = Buffer.alloc(8);
  fs.readSync(fd, lenBuf, 0, 8, 0);
  const headerLength = Number(lenBuf.readBigUInt64LE(0));
  const headerBuf = Buffer.alloc(headerLength);
  fs.readSync(fd, headerBuf, 0, headerLength, 8);
  const header = JSON.parse(headerBuf.toString('utf-8'));
  return { fd, header, dataStart: 8 + headerLength };
}

async function buildSafetensorsModel(modelName, def, opts) {
  const vocabPath = def.files[0].rawPath;
  const tensorPath = def.files[1].rawPath;
  if (!fs.existsSync(vocabPath) || !fs.existsSync(tensorPath)) {
    throw new Error(`Missing NILC files. Run "node tools/ptbr-model-lab.js download ${modelName}" first.`);
  }

  const outDir = path.join(MODELS_DIR, modelName);
  ensureDir(outDir);

  const { fd, header, dataStart } = readSafetensorsHeader(tensorPath);
  const tensor = header.embeddings;
  if (!tensor || tensor.dtype !== 'F32' || !Array.isArray(tensor.shape) || tensor.shape[1] !== DIMENSIONS) {
    fs.closeSync(fd);
    throw new Error('Unsupported NILC safetensors layout. Expected F32 tensor named "embeddings" with 300 dimensions.');
  }

  const rowCount = tensor.shape[0];
  const rowBytes = DIMENSIONS * 4;
  const tensorOffset = dataStart + tensor.data_offsets[0];
  const vectorsPath = path.join(outDir, 'vectors.bin');
  const vectorStream = fs.createWriteStream(vectorsPath);
  const words = [];
  const seen = new Set();
  const rowBuffer = Buffer.allocUnsafe(rowBytes);
  let row = 0;
  let skipped = 0;
  let duplicates = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(vocabPath, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (row >= rowCount) break;
    if (row > 0 && row % 100000 === 0) {
      process.stdout.write(`\r  Processed ${row.toLocaleString()} vocab rows, kept ${words.length.toLocaleString()}`);
    }

    const word = normalizeWord(line);
    if (!word || !isLikelyPtWord(word, opts.minLength, opts.maxLength)) {
      skipped++;
      row++;
      continue;
    }
    if (seen.has(word)) {
      duplicates++;
      row++;
      continue;
    }

    fs.readSync(fd, rowBuffer, 0, rowBytes, tensorOffset + row * rowBytes);
    seen.add(word);
    words.push(word);
    await writeVector(vectorStream, Buffer.from(rowBuffer));
    row++;

    if (words.length >= opts.maxWords) break;
  }

  fs.closeSync(fd);
  vectorStream.end();
  await once(vectorStream, 'finish');

  console.log(`\r  Processed ${row.toLocaleString()} vocab rows, kept ${words.length.toLocaleString()}`);
  console.log(`  Skipped ${skipped.toLocaleString()} rows, duplicates ${duplicates.toLocaleString()}`);
  writeModelMetadata(outDir, modelName, def, words, opts, { rowsProcessed: row, rowsSkipped: skipped, duplicates });
  console.log(`  Wrote ${path.relative(ROOT, outDir)} (${bytesToSize(fs.statSync(vectorsPath).size)} vectors)`);
}

async function buildModel(modelName, rawOpts) {
  const def = resolveModel(modelName);
  const opts = {
    maxWords: parseNumber(rawOpts['max-words'], def.defaultMaxWords),
    minLength: parseNumber(rawOpts['min-length'], 3),
    maxLength: parseNumber(rawOpts['max-length'], 16),
  };
  console.log(`\nBuilding ${modelName} - ${def.description}`);
  console.log(`  Max words: ${opts.maxWords.toLocaleString()}, length ${opts.minLength}-${opts.maxLength}`);

  if (def.type === 'text-gz') {
    await buildTextGzModel(modelName, def, opts);
  } else if (def.type === 'word2vec-zip') {
    await buildWord2VecZipModel(modelName, def, opts);
  } else if (def.type === 'safetensors') {
    await buildSafetensorsModel(modelName, def, opts);
  } else {
    throw new Error(`Unsupported type: ${def.type}`);
  }
}

function loadBuiltModel(modelName) {
  const modelDir = path.join(MODELS_DIR, modelName);
  const indexPath = path.join(modelDir, 'index.json');
  const vectorsPath = path.join(modelDir, 'vectors.bin');
  if (!fs.existsSync(indexPath) || !fs.existsSync(vectorsPath)) {
    throw new Error(`Model not built: ${modelName}. Run "node tools/ptbr-model-lab.js build ${modelName}".`);
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const bytes = fs.readFileSync(vectorsPath);
  const aligned = new ArrayBuffer(bytes.length);
  new Uint8Array(aligned).set(bytes);
  const vectors = new Float32Array(aligned);
  const wordIndex = new Map();
  for (let i = 0; i < index.words.length; i++) wordIndex.set(index.words[i], i);

  const magnitudes = new Float32Array(index.count);
  for (let i = 0; i < index.count; i++) {
    let sum = 0;
    const offset = i * index.dimensions;
    for (let d = 0; d < index.dimensions; d++) {
      const v = vectors[offset + d];
      sum += v * v;
    }
    magnitudes[i] = Math.sqrt(sum);
  }

  let aliases = {};
  const aliasPath = path.join(modelDir, 'accent-aliases.json');
  if (fs.existsSync(aliasPath)) aliases = JSON.parse(fs.readFileSync(aliasPath, 'utf-8'));

  return { ...index, vectors, wordIndex, magnitudes, aliases };
}

function resolveQueryWord(model, query) {
  const normalized = normalizeWord(query);
  if (model.wordIndex.has(normalized)) return normalized;
  const folded = wordFold(normalized);
  const alias = model.aliases[folded];
  if (alias && alias.length === 1) return alias[0];
  return normalized;
}

function cosineAt(model, aIndex, bIndex) {
  const dims = model.dimensions;
  const aOffset = aIndex * dims;
  const bOffset = bIndex * dims;
  let dot = 0;
  for (let d = 0; d < dims; d++) {
    dot += model.vectors[aOffset + d] * model.vectors[bOffset + d];
  }
  const denom = model.magnitudes[aIndex] * model.magnitudes[bIndex];
  return denom ? dot / denom : -Infinity;
}

function nearest(modelName, queries, rawOpts) {
  const model = loadBuiltModel(modelName);
  const top = parseNumber(rawOpts.top, 25);
  const words = queries.length ? queries : DEFAULT_QUERIES;

  for (const query of words) {
    const word = resolveQueryWord(model, query);
    const targetIndex = model.wordIndex.get(word);
    if (targetIndex === undefined) {
      console.log(`\n${query}: missing from ${modelName}`);
      continue;
    }

    const scores = [];
    for (let i = 0; i < model.count; i++) {
      if (i === targetIndex) continue;
      scores.push({ word: model.words[i], score: cosineAt(model, targetIndex, i) });
    }
    scores.sort((a, b) => b.score - a.score);

    console.log(`\n${query}${word !== query ? ` -> ${word}` : ''}`);
    for (const item of scores.slice(0, top)) {
      console.log(`  ${item.word.padEnd(18)} ${item.score.toFixed(4)}`);
    }
  }
}

function coverage(modelName, targetsPath) {
  const model = loadBuiltModel(modelName);
  const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, targetsPath), 'utf-8'));
  const targets = Array.isArray(raw) ? raw : Object.values(raw).flat();
  const missing = [];
  const foldedHits = [];

  for (const target of targets) {
    const word = normalizeWord(target);
    if (model.wordIndex.has(word)) continue;
    const alias = model.aliases[wordFold(word)];
    if (alias && alias.length) {
      foldedHits.push({ target: word, aliases: alias.slice(0, 5) });
    } else {
      missing.push(word);
    }
  }

  console.log(`${targets.length.toLocaleString()} targets checked against ${modelName}`);
  console.log(`${(targets.length - missing.length).toLocaleString()} direct or accent-folded hits`);
  console.log(`${foldedHits.length.toLocaleString()} accent-folded hits`);
  console.log(`${missing.length.toLocaleString()} missing`);
  if (missing.length) {
    console.log(`Missing sample: ${missing.slice(0, 40).join(', ')}`);
  }
}

async function main() {
  const { args, opts } = parseOptions(process.argv.slice(2));
  const command = args[0];
  if (!command || command === 'help' || command === '--help' || opts.help) {
    usage();
    return;
  }

  if (command === 'list') {
    listModels();
    return;
  }
  if (command === 'download') {
    if (!args[1]) throw new Error('download requires a model name or all');
    await downloadModel(args[1], Boolean(opts.force));
    return;
  }
  if (command === 'build') {
    if (!args[1]) throw new Error('build requires a model name');
    await buildModel(args[1], opts);
    return;
  }
  if (command === 'nearest') {
    if (!args[1]) throw new Error('nearest requires a built model name');
    nearest(args[1], args.slice(2), opts);
    return;
  }
  if (command === 'coverage') {
    if (!args[1] || !args[2]) throw new Error('coverage requires a built model name and targets.json path');
    coverage(args[1], args[2]);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
