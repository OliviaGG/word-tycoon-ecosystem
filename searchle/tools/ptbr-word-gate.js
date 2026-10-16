const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { once } = require('events');

const ROOT = path.resolve(__dirname, '..');
const PTBR_DIR = path.join(ROOT, 'data', 'pt-br');
const MODELS_DIR = path.join(PTBR_DIR, 'models');
const GATES_DIR = path.join(PTBR_DIR, 'gates');

const PORTUGUESE_WORD_RE = /^[a-z\u00e1\u00e0\u00e2\u00e3\u00e9\u00ea\u00ed\u00f3\u00f4\u00f5\u00fa\u00fc\u00e7]+$/u;

const STOP_WORDS = new Set([
  'que','para','com','uma','não','nao','por','mais','como','dos','das','sua','seu',
  'mas','são','sao','tem','muito','sobre','pelo','pela','também','tambem','nos',
  'está','esta','você','voce','ele','ela','até','ate','pode','mesmo','sem','entre',
  'quando','isso','ainda','todos','seus','suas','ter','nas','aos','era','onde',
  'meu','minha','tudo','sempre','aqui','vai','este','esse','esta','assim','apenas',
  'cada','foram','porque','pra','quem','depois','dois','três','tres','ser','foi',
  'sido','será','sera','seria','num','numa','nuns','numas','dum','duma','dele',
  'dela','eles','elas','lhe','lhes','teu','tua','teus','tuas','nosso','nossa',
  'nossos','nossas','vosso','vossa','tambem','tambem','algo','alguém','alguem',
  'ninguém','ninguem','nada','toda','todo','todas','todos','outro','outra','outros',
  'outras','qual','quais','quanto','quantos','quantas','cujo','cuja','cujos','cujas',
]);

const DOMAIN_NOISE = new Set([
  'utc','www','http','https','html','css','php','xml','url','urls','jpeg','jpg','png',
  'gif','pdf','login','logout','email','mail','site','sites','blog','blogs','tweet',
  'tweets','hashtag','hashtags','link','links','download','upload','online','offline',
  'cookie','cookies',
]);

const GLUED_PREFIXES = [
  'pelas','pelos','pela','pelo','das','dos','nas','nos','aos','da','do','na','no','ao',
];

const GLUED_SUFFIXES = [
  'porque','para','com','que','não','nao',
];

const GLUED_EXCEPTIONS = new Set([
  'aonde','demais','depois','dentro','dever','desde','doente','doença','doenca',
  'dourado','dormir','domingo','natal','nada','nunca','nobre','nossa','nosso',
  'normal','notícia','noticia','nominal','opera','obra','ordem','ouro','ontem',
  'outro','outra','apenas','agora','amor','animal','amigo','amiga','aprender',
]);

function usage() {
  console.log('Usage:');
  console.log('  node tools/ptbr-word-gate.js build <model> [--output=<name>] [--max-words=180000]');
  console.log('       [--min-zipf=2.5] [--glued-filter] [--glued-keep-zipf=3.0] [--no-wordfreq]');
  console.log('       [--min-length=3] [--max-length=16]');
  console.log('  node tools/ptbr-word-gate.js report <model>');
  console.log('');
  console.log('Example:');
  console.log('  node tools/ptbr-word-gate.js build fasttext-cc-pt --output=fasttext-cc-pt-gated');
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

function parseIntOption(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseFloatOption(value, fallback) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function bytesToSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
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

function loadModel(modelName) {
  const modelDir = path.join(MODELS_DIR, modelName);
  const indexPath = path.join(modelDir, 'index.json');
  const vectorsPath = path.join(modelDir, 'vectors.bin');
  if (!fs.existsSync(indexPath) || !fs.existsSync(vectorsPath)) {
    throw new Error(`Missing model ${modelName}. Build it with tools/ptbr-model-lab.js first.`);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const vectorBytes = fs.openSync(vectorsPath, 'r');
  return { modelDir, index, vectorFd: vectorBytes, vectorsPath };
}

function closeModel(model) {
  fs.closeSync(model.vectorFd);
}

function detectGluedPrefix(word, wordSet) {
  if (GLUED_EXCEPTIONS.has(word)) return null;
  for (const prefix of GLUED_PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    const rest = word.slice(prefix.length);
    if (rest.length < (prefix.length <= 1 ? 5 : 4)) continue;
    if (STOP_WORDS.has(rest)) continue;
    if (wordSet.has(rest)) return `${prefix}+${rest}`;
  }
  return null;
}

function detectGluedSuffix(word, wordSet) {
  if (GLUED_EXCEPTIONS.has(word)) return null;
  for (const suffix of GLUED_SUFFIXES) {
    if (!word.endsWith(suffix)) continue;
    const base = word.slice(0, -suffix.length);
    if (base.length < (suffix.length <= 2 ? 5 : 4)) continue;
    if (STOP_WORDS.has(base)) continue;
    if (wordSet.has(base)) return `${base}+${suffix}`;
  }
  return null;
}

function detectRepeatedToken(word) {
  if (word.length < 8 || word.length % 2 !== 0) return false;
  const half = word.length / 2;
  return word.slice(0, half) === word.slice(half);
}

function detectRepeatedEnding(word, wordSet) {
  if (word.length < 5) return false;
  const last = word[word.length - 1];
  const prev = word[word.length - 2];
  if (last !== prev) return false;
  return wordSet.has(word.slice(0, -1));
}

function baseRejectReason(word, wordSet, opts) {
  if (word.length < opts.minLength || word.length > opts.maxLength) return 'length';
  if (!PORTUGUESE_WORD_RE.test(word)) return 'shape';
  if (STOP_WORDS.has(word)) return 'stopword';
  if (DOMAIN_NOISE.has(word)) return 'domain-noise';
  if (detectRepeatedToken(word)) return 'repeated-token';
  if (detectRepeatedEnding(word, wordSet)) return 'repeated-ending';
  if (opts.gluedFilter) {
    const gluedPrefix = detectGluedPrefix(word, wordSet);
    if (gluedPrefix) return `glued-prefix:${gluedPrefix}`;
    const gluedSuffix = detectGluedSuffix(word, wordSet);
    if (gluedSuffix) return `glued-suffix:${gluedSuffix}`;
  }
  return null;
}

function findPython() {
  for (const cmd of ['python', 'py']) {
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf-8' });
    if (!res.error && res.status === 0) return cmd;
  }
  return null;
}

function loadWordfreqScores(words, language) {
  const python = findPython();
  if (!python) {
    throw new Error('Python was not found; rerun with --no-wordfreq or install Python with wordfreq.');
  }
  const code = [
    'import sys',
    'try:',
    '    from wordfreq import zipf_frequency',
    'except Exception as exc:',
    '    print("WORD_FREQ_IMPORT_ERROR\\t" + str(exc), file=sys.stderr)',
    '    raise',
    `lang = ${JSON.stringify(language)}`,
    'for line in sys.stdin:',
    '    word = line.rstrip("\\n")',
    '    if not word:',
    '        continue',
    '    print(f"{word}\\t{zipf_frequency(word, lang):.4f}")',
  ].join('\n');
  const res = spawnSync(python, ['-c', code], {
    input: words.join('\n'),
    encoding: 'utf-8',
    maxBuffer: 128 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`wordfreq scoring failed: ${res.stderr || res.stdout}`);
  }
  const scores = new Map();
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.lastIndexOf('\t');
    if (tab === -1) continue;
    const word = line.slice(0, tab);
    const score = Number.parseFloat(line.slice(tab + 1));
    if (Number.isFinite(score)) scores.set(word, score);
  }
  return scores;
}

async function writeVector(stream, buffer) {
  if (!stream.write(buffer)) await once(stream, 'drain');
}

function inc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function reasonCategory(reason) {
  const colon = reason.indexOf(':');
  return colon === -1 ? reason : reason.slice(0, colon);
}

function addSample(samples, reason, word) {
  if (!samples.has(reason)) samples.set(reason, []);
  const list = samples.get(reason);
  if (list.length < 12) list.push(word);
}

function buildAliases(words) {
  const aliases = {};
  for (const word of words) {
    const folded = wordFold(word);
    if (folded !== word) {
      if (!aliases[folded]) aliases[folded] = [];
      aliases[folded].push(word);
    }
  }
  return aliases;
}

async function buildGate(sourceModelName, rawOpts) {
  const wordfreq = rawOpts.wordfreq !== false && rawOpts['no-wordfreq'] !== true;
  const opts = {
    output: rawOpts.output || `${sourceModelName}-gated`,
    maxWords: parseIntOption(rawOpts['max-words'], 180000),
    minLength: parseIntOption(rawOpts['min-length'], 3),
    maxLength: parseIntOption(rawOpts['max-length'], 16),
    minZipf: parseFloatOption(rawOpts['min-zipf'], 2.5),
    gluedKeepZipf: parseFloatOption(rawOpts['glued-keep-zipf'], 3.0),
    gluedFilter: rawOpts['glued-filter'] === true || !wordfreq,
    language: rawOpts.language || 'pt',
    wordfreq,
  };

  const source = loadModel(sourceModelName);
  try {
    const { words, dimensions, count, language, sourceModel } = source.index;
    const sourceFormat = source.index.format;
    if (sourceFormat && sourceFormat !== 'float32') {
      throw new Error(`Unsupported source vector format "${sourceFormat}". Gate expects float32 vectors.`);
    }

    console.log(`Building pt-BR gate from ${sourceModelName}`);
    console.log(`  Source: ${count.toLocaleString()} words, ${dimensions}d`);
    console.log(`  Output: ${opts.output}, max ${opts.maxWords.toLocaleString()} words`);
    console.log(`  Filters: length ${opts.minLength}-${opts.maxLength}, wordfreq ${opts.wordfreq ? `>= ${opts.minZipf}` : 'disabled'}, glued ${opts.gluedFilter ? 'enabled' : 'disabled'}`);

    const wordSet = new Set(words);
    let freqScores = null;
    if (opts.wordfreq) {
      const t0 = Date.now();
      console.log('  Scoring words with Python wordfreq...');
      freqScores = loadWordfreqScores(words, opts.language);
      console.log(`  Scored ${freqScores.size.toLocaleString()} words in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    const outDir = path.join(MODELS_DIR, opts.output);
    ensureDir(outDir);
    const vectorsOut = path.join(outDir, 'vectors.bin');
    const stream = fs.createWriteStream(vectorsOut);
    const vectorBytes = dimensions * 4;
    const vectorBuffer = Buffer.allocUnsafe(vectorBytes);
    const keptWords = [];
    const rejected = new Map();
    const samples = new Map();
    let minKeptZipf = Infinity;
    let maxKeptZipf = -Infinity;
    let checked = 0;

    for (let i = 0; i < words.length; i++) {
      checked = i + 1;
      if (i > 0 && i % 50000 === 0) {
        process.stdout.write(`\r  Checked ${i.toLocaleString()} / ${words.length.toLocaleString()}, kept ${keptWords.length.toLocaleString()}`);
      }

      const word = words[i];
      let reason = baseRejectReason(word, wordSet, opts);
      const zipf = freqScores ? (freqScores.get(word) || 0) : NaN;
      if (reason && reason.startsWith('glued-') && freqScores && zipf >= opts.gluedKeepZipf) {
        reason = null;
      }
      if (!reason && freqScores && zipf < opts.minZipf) {
        reason = 'low-frequency';
      }

      if (reason) {
        const category = reasonCategory(reason);
        inc(rejected, category);
        addSample(samples, category, reason === category ? word : `${word} (${reason.slice(category.length + 1)})`);
        continue;
      }

      fs.readSync(source.vectorFd, vectorBuffer, 0, vectorBytes, i * vectorBytes);
      await writeVector(stream, Buffer.from(vectorBuffer));
      keptWords.push(word);
      if (freqScores) {
        minKeptZipf = Math.min(minKeptZipf, zipf);
        maxKeptZipf = Math.max(maxKeptZipf, zipf);
      }

      if (keptWords.length >= opts.maxWords) break;
    }

    stream.end();
    await once(stream, 'finish');
    console.log(`\r  Checked ${checked.toLocaleString()} / ${words.length.toLocaleString()}, kept ${keptWords.length.toLocaleString()}`);

    const index = {
      dimensions,
      count: keptWords.length,
      words: keptWords,
      language: language || 'pt-BR',
      sourceModel: sourceModel || sourceModelName,
      gatedFrom: sourceModelName,
    };
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));

    const aliases = buildAliases(keptWords);
    fs.writeFileSync(path.join(outDir, 'accent-aliases.json'), JSON.stringify(aliases, null, 2));

    const report = {
      language: 'pt-BR',
      sourceModel: sourceModelName,
      outputModel: opts.output,
      generatedAt: new Date().toISOString(),
      filters: opts,
      sourceWordCount: words.length,
      checkedWordCount: checked,
      keptWordCount: keptWords.length,
      rejected: Object.fromEntries([...rejected.entries()].sort((a, b) => b[1] - a[1])),
      samples: Object.fromEntries(samples.entries()),
      wordfreq: freqScores ? {
        language: opts.language,
        minZipf: opts.minZipf,
        minKeptZipf,
        maxKeptZipf,
      } : null,
      outputBytes: fs.statSync(vectorsOut).size,
    };
    fs.writeFileSync(path.join(outDir, 'gate-report.json'), JSON.stringify(report, null, 2));
    ensureDir(GATES_DIR);
    fs.writeFileSync(path.join(GATES_DIR, `${opts.output}.json`), JSON.stringify(report, null, 2));

    console.log(`  Wrote ${path.relative(ROOT, outDir)}`);
    console.log(`  Vectors: ${bytesToSize(fs.statSync(vectorsOut).size)}`);
    console.log(`  Aliases: ${Object.keys(aliases).length.toLocaleString()}`);
    console.log('  Top rejections:');
    for (const [reason, n] of [...rejected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`    ${reason}: ${n.toLocaleString()} (${(samples.get(reason) || []).join(', ')})`);
    }
  } finally {
    closeModel(source);
  }
}

function report(modelName) {
  const reportPath = path.join(MODELS_DIR, modelName, 'gate-report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`No gate report found for ${modelName}`);
  }
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  console.log(JSON.stringify(raw, null, 2));
}

async function main() {
  const { args, opts } = parseOptions(process.argv.slice(2));
  const command = args[0];
  if (!command || command === 'help' || command === '--help' || opts.help) {
    usage();
    return;
  }
  if (command === 'build') {
    if (!args[1]) throw new Error('build requires a source model name');
    await buildGate(args[1], opts);
    return;
  }
  if (command === 'report') {
    if (!args[1]) throw new Error('report requires a gated model name');
    report(args[1]);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
