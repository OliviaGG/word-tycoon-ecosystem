const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PTBR_DIR = path.join(ROOT, 'data', 'pt-br');
const MODELS_DIR = path.join(PTBR_DIR, 'models');
const OUTPUT_DIR = path.join(PTBR_DIR, 'targets', 'generated');
const DIFFICULTY_OUTPUT_DIR = path.join(PTBR_DIR, 'targets', 'difficulty');
const DEFAULT_NOUN_LEXICON = path.join(
  PTBR_DIR,
  'raw',
  'kaikki',
  'kaikki.org-dictionary-Portuguese-by-pos-noun.jsonl',
);
const DEFAULT_PROPER_NAME_LEXICON = path.join(
  PTBR_DIR,
  'raw',
  'kaikki',
  'kaikki.org-dictionary-Portuguese-by-pos-name.jsonl',
);
const DEFAULT_ADJECTIVE_LEXICON = path.join(
  PTBR_DIR,
  'raw',
  'kaikki',
  'kaikki.org-dictionary-Portuguese-by-pos-adj.jsonl',
);
const DEFAULT_VERB_LEXICON = path.join(
  PTBR_DIR,
  'raw',
  'kaikki',
  'kaikki.org-dictionary-Portuguese-by-pos-verb.jsonl',
);
const EXPANDED_TARGETS_PATH = path.join(PTBR_DIR, 'targets', 'expanded-target-words.json');
const EXPANDED_REPORT_PATH = path.join(PTBR_DIR, 'targets', 'expanded-target-report.json');

const DIFFICULTY_TIERS = [
  {
    key: 'very-common',
    label: 'very easy',
    file: 'searchle-ptbr-very-easy-targets.json',
    includes: (zipf, opts) => zipf >= opts.veryEasyMinZipf,
  },
  {
    key: 'common',
    label: 'easy',
    file: 'searchle-ptbr-easy-targets.json',
    includes: (zipf, opts) => zipf >= opts.easyMinZipf,
  },
  {
    key: 'normal',
    label: 'normal',
    file: 'searchle-ptbr-normal-targets.json',
    includes: () => true,
  },
  {
    key: 'rare',
    label: 'rare',
    file: 'searchle-ptbr-rare-targets.json',
    includes: (zipf, opts) => zipf >= opts.rareMinZipf && zipf < opts.rareMaxZipf,
  },
  {
    key: 'very-rare',
    label: 'very rare',
    file: 'searchle-ptbr-very-rare-targets.json',
    includes: (zipf, opts) => zipf < opts.rareMinZipf,
  },
];

const SEED_WORDS = [
  'animal','cachorro','gato','cavalo','peixe','ave','cobra','macaco','elefante','leão','tigre',
  'casa','apartamento','quarto','cozinha','janela','porta','mesa','cadeira','cama','sofa','parede',
  'cidade','rua','bairro','praça','ponte','estrada','praia','floresta','montanha','rio','lago','ilha',
  'comida','arroz','feijão','carne','fruta','banana','maçã','laranja','pão','queijo','leite','café',
  'bebida','cerveja','vinho','água','suco','chocolate','bolo','pizza','sopa','salada','tempero',
  'corpo','cabeça','mão','braço','perna','olho','boca','coração','pele','sangue','cabelo',
  'família','mãe','pai','filho','filha','irmão','irmã','amigo','criança','adulto','pessoa',
  'escola','professor','aluno','livro','papel','caneta','aula','prova','universidade','biblioteca',
  'trabalho','dinheiro','loja','mercado','empresa','banco','preço','salário','negócio','produto',
  'futebol','jogo','bola','time','clube','estádio','corrida','dança','música','cinema','teatro',
  'computador','celular','teclado','tela','internet','programa','radio','televisão','camera','foto',
  'amor','medo','raiva','alegria','tristeza','sonho','memória','ideia','verdade','mentira','segredo',
  'tempo','chuva','sol','vento','noite','dia','verão','inverno','fogo','terra','mar','céu',
  'brasil','portugal','carnaval','samba','capoeira','história','cultura','idioma','palavra','contexto',
];

const STOP_TARGETS = new Set([
  'coisa','algo','pessoa','gente','tipo','forma','parte','modo','vez','ano','dia','tempo',
  'mundo','lugar','caso','grupo','área','area','meio','fim','lado','nível','nivel',
  'brasil','portugal','paulo','rio','janeiro','maria','joão','joao','josé','jose',
  'daquela','daquele','daquelas','daqueles','dessa','desse','dessas','desses',
  'naquela','naquele','naquelas','naqueles','nessa','nesse','nessas','nesses',
  'aquela','aquele','aquelas','aqueles','isso','isto','aquilo','qualquer',
  'debaixo','embaixo','cima','restante','repente','demais','assim',
  'agora','nunca','durante','sim','menos','além','alem','quase','tanto','porém','porem',
  'entanto','ontem','amanhã','amanha',
]);

const NUMERALS = new Set([
  'zero','um','uma','dois','duas','três','tres','quatro','cinco','seis','sete','oito',
  'nove','dez','onze','doze','treze','catorze','quatorze','quinze','vinte','trinta',
  'quarenta','cinquenta','sessenta','setenta','oitenta','noventa','cem','cento','mil',
  'milhão','milhao',
]);

const BAD_ENDINGS = [
  'mente',
];

const BAD_ENDING_ALLOWLIST = new Set([
  'semente',
]);

const BAD_GERUND_ENDINGS = [
  'ando','endo','indo',
];

const FIRST_PASS_REJECTS = new Set([
  'amarela','amarelo','vermelha','vermelho','branca','branco','preta','preto',
  'roxa','roxo','azul','verde','marrom','cinza','dourada','dourado','escura','escuro',
  'gostosa','gostoso','terrível','terrivel','quente','estranha','estranho','seco','seca',
  'parecida','parecido','sozinha','sozinho','gelada','gelado','imensa','imenso',
  'essencial','gorda','gordo','distante','moderna','moderno','ligada','ligado',
  'cansada','cansado','escondida','escondido','escolar','grávida','gravida',
  'sentada','sentado','fechada','fechado','coberta','coberto','adoro','adora',
  'imagina','estando','treinar','pouquinho',
  'bunda','caralho','buceta','porra','merda','bosta','puta','puto',
  'fria','frio','fresca','fresco','maluco','doido','doida','bonita','bonito',
  'bela','belo','pobre','inocente','óbvio','obvio','formal','mental','sensual',
  'espiritual','musical','habitual','incomum','externa','externo','privada','privado',
  'preferido','preferida','adequada','adequado','querido','querida','perigoso',
  'perigosa','divertido','divertida','elétrico','eletrico','agrícola','agricola',
  'noturno','noturna','ocidental','chinesa','inglesa','mágico','magico',
  'daquilo','sobretudo','demasiado','vira','vinha','sentia','pensava','falava',
  'corre','cresce','envolve','levanta','tomado','fazemos','vestida','escuta',
  'acorda','acompanhado','combina','solta','roubado','aproxima','ficará','ficara',
  'deixado','apanhar','arrumar','esconde','corta','provar','namorar','descer',
  'existir','descansar','nascer','cozinhar','gostava','soubesse',
  'iphone','ipad',
]);

const EXTRA_TARGET_REJECTS = new Set([
  'call','chat','design','feed','glitter','impeachment','print','smartphone','status','zoom',
  'acto','acção','actividade','actor','cancro','cassete','comité','desporto','ecrã','espectáculo',
  'golo','objectivo','selecção',
  'cacete','fetiche','orgasmo','nudez','pornografia','tesão',
  'autismo','diarreia','leucemia','malária','overdose','próstata','tumor',
  'fascismo','marxismo','nacionalismo','socialismo',
  'matança','ódio','traficante',
  'invés','porquê','pró','quê','uau',
  'papel','porquinho','veado',
]);

const BAD_NOUN_SENSE_TAGS = new Set([
  'abbreviation',
  'acronym',
  'alt-of',
  'archaic',
  'clipping',
  'dated',
  'derogatory',
  'euphemistic',
  'form-of',
  'humorous',
  'initialism',
  'misspelling',
  'nonstandard',
  'obsolete',
  'offensive',
  'pejorative',
  'plural',
  'rare',
  'slang',
  'vulgar',
]);

const BAD_NOUN_GLOSS_PATTERNS = [
  /\balternative (form|spelling) of\b/i,
  /\babbreviation of\b/i,
  /\bacronym of\b/i,
  /\binitialism of\b/i,
  /\bclipping of\b/i,
  /\bmisspelling of\b/i,
  /\bnonstandard spelling of\b/i,
  /\bplural of\b/i,
  /\bsurname\b/i,
  /\bgiven name\b/i,
];

const BAD_NOUN_ETYMOLOGY_PATTERNS = [
  /\bunadapted borrowing from English\b/i,
  /\bprobably from English\b/i,
];

const FOREIGN_LETTER_RE = /[kwy]/u;

function usage() {
  console.log('Usage:');
  console.log('  node tools/ptbr-target-lab.js generate <model> [--count=500] [--min-zipf=3.0] [--max-zipf=6.2]');
  console.log('       [--min-length=4] [--max-length=13] [--probe=1000] [--out-prefix=searchle-ptbr]');
  console.log('  node tools/ptbr-target-lab.js evaluate <model> <targets.json> [--top=8]');
  console.log('  node tools/ptbr-target-lab.js split-difficulty <model> <targets.json> [--easy-min-zipf=4.5]');
  console.log('       [--target-report=data/pt-br/targets/expanded-target-report.json] [--easy-min-score=0.4]');
  console.log('       [--very-easy-min-zipf=5.5] [--rare-min-zipf=3.0] [--rare-max-zipf=4.5]');
  console.log('       [--out-dir=data/pt-br/targets/difficulty]');
  console.log('  node tools/ptbr-target-lab.js expand-nouns <model> <seed-targets.json> [--count=2500]');
  console.log('       [--noun-jsonl=data/pt-br/raw/kaikki/kaikki.org-dictionary-Portuguese-by-pos-noun.jsonl]');
  console.log('       [--proper-jsonl=data/pt-br/raw/kaikki/kaikki.org-dictionary-Portuguese-by-pos-name.jsonl]');
  console.log('       [--adj-jsonl=data/pt-br/raw/kaikki/kaikki.org-dictionary-Portuguese-by-pos-adj.jsonl]');
  console.log('       [--verb-jsonl=data/pt-br/raw/kaikki/kaikki.org-dictionary-Portuguese-by-pos-verb.jsonl]');
  console.log('       [--easy-min-zipf=4.5] [--easy-min-score=0.35]');
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
    if (eq === -1) opts[arg.slice(2)] = true;
    else opts[arg.slice(2, eq)] = arg.slice(eq + 1);
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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function normalizeWord(word) {
  return String(word || '').trim().toLowerCase().normalize('NFC');
}

function wordFold(word) {
  return normalizeWord(word)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC');
}

function hasAccent(word) {
  return wordFold(word) !== word;
}

function findPython() {
  for (const cmd of ['python', 'py']) {
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf-8' });
    if (!res.error && res.status === 0) return cmd;
  }
  return null;
}

function loadWordfreqScores(words, language = 'pt') {
  const python = findPython();
  if (!python) throw new Error('Python was not found; install Python with wordfreq.');
  const code = [
    'import sys',
    'from wordfreq import zipf_frequency',
    `lang = ${JSON.stringify(language)}`,
    'for line in sys.stdin:',
    '    word = line.rstrip("\\n")',
    '    if word:',
    '        print(f"{word}\\t{zipf_frequency(word, lang):.4f}")',
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
  if (res.status !== 0) throw new Error(res.stderr || res.stdout);
  const scores = new Map();
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.lastIndexOf('\t');
    const word = line.slice(0, tab);
    const score = Number.parseFloat(line.slice(tab + 1));
    if (Number.isFinite(score)) scores.set(word, score);
  }
  return scores;
}

function readJsonl(filePath, onEntry) {
  const resolved = path.resolve(ROOT, filePath);
  const text = fs.readFileSync(resolved, 'utf-8');
  let lineNumber = 0;
  for (const line of text.split(/\r?\n/)) {
    lineNumber++;
    if (!line.trim()) continue;
    try {
      onEntry(JSON.parse(line), lineNumber);
    } catch (err) {
      throw new Error(`Could not parse ${path.relative(ROOT, resolved)}:${lineNumber}: ${err.message}`);
    }
  }
}

function hasBadNounSense(sense) {
  const tags = new Set(sense.tags || []);
  for (const tag of BAD_NOUN_SENSE_TAGS) {
    if (tags.has(tag)) return true;
  }
  const glossText = [
    ...(sense.glosses || []),
    ...(sense.raw_glosses || []),
  ].join(' ');
  return BAD_NOUN_GLOSS_PATTERNS.some(pattern => pattern.test(glossText));
}

function hasUsableNounSense(entry) {
  if (!Array.isArray(entry.senses) || entry.senses.length === 0) return true;
  return entry.senses.some(sense => !hasBadNounSense(sense));
}

function firstGloss(entry) {
  if (!Array.isArray(entry.senses)) return null;
  for (const sense of entry.senses) {
    if (hasBadNounSense(sense)) continue;
    const gloss = (sense.glosses || sense.raw_glosses || [])[0];
    if (gloss) return gloss;
  }
  return null;
}

function loadNounLexicon(jsonlPath) {
  const entries = new Map();
  const rejected = new Map();
  readJsonl(jsonlPath, entry => {
    if (entry.lang_code !== 'pt' || entry.pos !== 'noun') return;
    const original = String(entry.word || '').trim();
    const word = normalizeWord(original);
    let reason = null;
    if (!word) reason = 'blank';
    else if (original !== original.toLowerCase()) reason = 'proper-case';
    else if (!/^\p{L}+$/u.test(word)) reason = 'characters';
    else if (BAD_NOUN_ETYMOLOGY_PATTERNS.some(pattern => pattern.test(entry.etymology_text || ''))) reason = 'bad-etymology';
    else if (!hasUsableNounSense(entry)) reason = 'bad-sense';
    if (reason) {
      rejected.set(reason, (rejected.get(reason) || 0) + 1);
      return;
    }
    const existing = entries.get(word);
    const gloss = firstGloss(entry);
    if (!existing) {
      entries.set(word, {
        word,
        gloss,
        senses: Array.isArray(entry.senses) ? entry.senses.length : 0,
        brazilPronunciation: (entry.sounds || []).some(sound => (sound.tags || []).includes('Brazil')),
      });
      return;
    }
    existing.senses += Array.isArray(entry.senses) ? entry.senses.length : 0;
    existing.brazilPronunciation ||= (entry.sounds || []).some(sound => (sound.tags || []).includes('Brazil'));
    if (!existing.gloss && gloss) existing.gloss = gloss;
  });
  return {
    entries,
    rejected: Object.fromEntries([...rejected.entries()].sort((a, b) => b[1] - a[1])),
  };
}

function loadWordSetFromLexicon(jsonlPath, expectedPos) {
  const words = new Set();
  if (!jsonlPath || !fs.existsSync(path.resolve(ROOT, jsonlPath))) return words;
  readJsonl(jsonlPath, entry => {
    if (entry.lang_code !== 'pt' || entry.pos !== expectedPos) return;
    const original = String(entry.word || '').trim();
    const word = normalizeWord(original);
    if (!word) return;
    if (!/^\p{L}+$/u.test(word)) return;
    words.add(word);
  });
  return words;
}

function loadModel(modelName) {
  const dir = path.join(MODELS_DIR, modelName);
  const indexPath = path.join(dir, 'index.json');
  const vectorsPath = path.join(dir, 'vectors.bin');
  if (!fs.existsSync(indexPath) || !fs.existsSync(vectorsPath)) {
    throw new Error(`Missing model ${modelName}.`);
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
      const value = vectors[offset + d];
      sum += value * value;
    }
    magnitudes[i] = Math.sqrt(sum);
  }
  return { ...index, vectors, wordIndex, magnitudes };
}

function getVector(model, word) {
  const index = model.wordIndex.get(word);
  if (index === undefined) return null;
  const offset = index * model.dimensions;
  return model.vectors.subarray(offset, offset + model.dimensions);
}

function cosineVectors(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom ? dot / denom : 0;
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

function computeCentroid(model, words) {
  const centroid = new Float64Array(model.dimensions);
  let count = 0;
  for (const rawWord of words) {
    const word = normalizeWord(rawWord);
    const vector = getVector(model, word);
    if (!vector) continue;
    for (let d = 0; d < model.dimensions; d++) centroid[d] += vector[d];
    count++;
  }
  if (!count) throw new Error('None of the seed words were present in the model.');
  const result = new Float32Array(model.dimensions);
  let mag = 0;
  for (let d = 0; d < model.dimensions; d++) {
    result[d] = centroid[d] / count;
    mag += result[d] * result[d];
  }
  mag = Math.sqrt(mag) || 1;
  for (let d = 0; d < model.dimensions; d++) result[d] /= mag;
  return { centroid: result, seedCount: count };
}

function buildCanonicalByFold(model, freqScores) {
  const byFold = new Map();
  for (const word of model.words) {
    const folded = wordFold(word);
    const zipf = freqScores.get(word) || 0;
    const existing = byFold.get(folded);
    if (!existing) {
      byFold.set(folded, word);
      continue;
    }
    const existingZipf = freqScores.get(existing) || 0;
    const better = zipf > existingZipf + 0.05
      || (Math.abs(zipf - existingZipf) <= 0.05 && hasAccent(word) && !hasAccent(existing));
    if (better) byFold.set(folded, word);
  }
  return byFold;
}

function buildCanonicalWords(words, freqScores) {
  const byFold = new Map();
  for (const word of words) {
    const folded = wordFold(word);
    const zipf = freqScores.get(word) || 0;
    const existing = byFold.get(folded);
    if (!existing) {
      byFold.set(folded, word);
      continue;
    }
    const existingZipf = freqScores.get(existing) || 0;
    const better = zipf > existingZipf + 0.05
      || (Math.abs(zipf - existingZipf) <= 0.05 && hasAccent(word) && !hasAccent(existing));
    if (better) byFold.set(folded, word);
  }
  return byFold;
}

function singularCandidate(word) {
  const folded = wordFold(word);
  const forms = [];
  if (word.endsWith('ões')) forms.push(word.slice(0, -3) + 'ão');
  if (word.endsWith('ães')) forms.push(word.slice(0, -3) + 'ãe');
  if (word.endsWith('ais')) forms.push(word.slice(0, -3) + 'al');
  if (word.endsWith('eis')) forms.push(word.slice(0, -3) + 'el');
  if (word.endsWith('óis')) forms.push(word.slice(0, -3) + 'ol');
  if (word.endsWith('is')) forms.push(word.slice(0, -2) + 'il');
  if (word.endsWith('res')) forms.push(word.slice(0, -2));
  if (word.endsWith('zes')) forms.push(word.slice(0, -3) + 'z');
  if (word.endsWith('es')) forms.push(word.slice(0, -2));
  if (word.endsWith('s') && !folded.endsWith('us') && !folded.endsWith('is')) forms.push(word.slice(0, -1));
  return forms.filter(Boolean);
}

function isPluralWhenSingularExists(word, canonicalSet) {
  return singularCandidate(word).some(form => canonicalSet.has(form));
}

function isDiminutiveWhenBaseExists(word, canonicalSet) {
  const checks = [
    ['zinho', ''],
    ['zinha', ''],
    ['inhos', 'o'],
    ['inhas', 'a'],
    ['inho', 'o'],
    ['inha', 'a'],
  ];
  for (const [suffix, replacement] of checks) {
    if (!word.endsWith(suffix)) continue;
    const base = word.slice(0, -suffix.length) + replacement;
    if (base.length >= 4 && canonicalSet.has(base)) return true;
  }
  return false;
}

function targetRejectReason(word, canonicalSet, zipf, opts) {
  if (word.length < opts.minLength || word.length > opts.maxLength) return 'length';
  if (zipf < opts.minZipf || zipf > opts.maxZipf) return 'frequency';
  if (STOP_TARGETS.has(word) || NUMERALS.has(word)) return 'generic';
  if (FIRST_PASS_REJECTS.has(word)) return 'first-pass-reject';
  if (EXTRA_TARGET_REJECTS.has(word)) return 'extra-reject';
  if (!BAD_ENDING_ALLOWLIST.has(word) && BAD_ENDINGS.some(suffix => word.endsWith(suffix))) return 'ending';
  if (BAD_GERUND_ENDINGS.some(suffix => word.endsWith(suffix))) return 'gerund';
  if (isPluralWhenSingularExists(word, canonicalSet)) return 'plural';
  if (isDiminutiveWhenBaseExists(word, canonicalSet)) return 'diminutive';
  return null;
}

function loadTargetWords(targetPath) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, targetPath), 'utf-8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.candidates)) return raw.candidates.map(item => item.word);
  if (Array.isArray(raw.words)) return raw.words;
  throw new Error(`Unsupported target file shape: ${targetPath}`);
}

function loadTargetMetadata(reportPath) {
  if (!reportPath) return null;
  const resolved = path.resolve(ROOT, reportPath);
  if (!fs.existsSync(resolved)) return null;
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  if (!Array.isArray(raw.selected)) return null;
  const byWord = new Map();
  for (const item of raw.selected) {
    byWord.set(normalizeWord(item.word), item);
  }
  return byWord;
}

function statsForEntries(entries) {
  if (!entries.length) {
    return {
      count: 0,
      minZipf: null,
      medianZipf: null,
      maxZipf: null,
    };
  }
  const scores = entries.map(item => item.zipf).sort((a, b) => a - b);
  const middle = Math.floor(scores.length / 2);
  const median = scores.length % 2
    ? scores[middle]
    : (scores[middle - 1] + scores[middle]) / 2;
  return {
    count: entries.length,
    minZipf: Number(scores[0].toFixed(2)),
    medianZipf: Number(median.toFixed(2)),
    maxZipf: Number(scores[scores.length - 1].toFixed(2)),
  };
}

function tierCountsForEntries(entries) {
  return {
    veryCommon: entries.filter(item => item.zipf >= 5.5).length,
    common: entries.filter(item => item.zipf >= 4.5).length,
    normal: entries.length,
    rare: entries.filter(item => item.zipf >= 3.0 && item.zipf < 4.5).length,
    veryRare: entries.filter(item => item.zipf < 3.0).length,
  };
}

function rejectDifficultyTarget(rawWord, seen, model, canonicalSet, zipf, opts) {
  const original = String(rawWord || '').trim();
  const word = normalizeWord(original);
  if (!word) return { word, reason: 'blank' };
  if (original !== original.toLowerCase()) return { word, reason: 'proper-case' };
  if (seen.has(word)) return { word, reason: 'duplicate' };
  if (!/^\p{L}+$/u.test(word)) return { word, reason: 'characters' };
  if (!model.wordIndex.has(word)) return { word, reason: 'missing-model' };
  const baseReason = targetRejectReason(word, canonicalSet, zipf, opts);
  if (baseReason) return { word, reason: baseReason };
  return null;
}

function rejectExpandedNounTarget(word, model, canonicalSet, freqScores, opts) {
  const zipf = freqScores.get(word) || 0;
  if (!model.wordIndex.has(word)) return 'missing-model';
  if (opts.seedSet.has(word)) return null;
  if (opts.properNames.has(word)) return 'proper-name';
  if (opts.adjectives.has(word)) return 'adjective-homograph';
  if (opts.verbs.has(word)) return 'verb-homograph';
  if (FOREIGN_LETTER_RE.test(word)) return 'foreign-letter';
  return targetRejectReason(word, canonicalSet, zipf, opts);
}

function sweetSpot(value, center, radius) {
  return Math.max(0, 1 - Math.abs(value - center) / radius);
}

function nearestNeighbors(model, word, top = 8) {
  const targetIndex = model.wordIndex.get(word);
  if (targetIndex === undefined) return [];
  const folded = wordFold(word);
  const results = [];
  for (let i = 0; i < model.count; i++) {
    if (i === targetIndex) continue;
    const neighbor = model.words[i];
    if (wordFold(neighbor) === folded) continue;
    const score = cosineAt(model, targetIndex, i);
    if (results.length < top) {
      results.push({ word: neighbor, sim: score });
      results.sort((a, b) => b.sim - a.sim);
      continue;
    }
    if (score > results[results.length - 1].sim) {
      results[results.length - 1] = { word: neighbor, sim: score };
      results.sort((a, b) => b.sim - a.sim);
    }
  }
  return results;
}

function gerundForInfinitive(word) {
  if (word.endsWith('ar') && word.length > 5) return word.slice(0, -2) + 'ando';
  if (word.endsWith('er') && word.length > 5) return word.slice(0, -2) + 'endo';
  if (word.endsWith('ir') && word.length > 5) return word.slice(0, -2) + 'indo';
  return null;
}

function neighborRejectReason(word, neighbors) {
  const gerund = gerundForInfinitive(word);
  if (gerund && neighbors.some(n => n.word === gerund || n.word.startsWith(gerund.slice(0, -2)))) {
    return 'verb-neighborhood';
  }
  return null;
}

function generate(modelName, rawOpts) {
  const opts = {
    count: parseIntOption(rawOpts.count, 500),
    minZipf: parseFloatOption(rawOpts['min-zipf'], 3.0),
    maxZipf: parseFloatOption(rawOpts['max-zipf'], 6.2),
    minLength: parseIntOption(rawOpts['min-length'], 4),
    maxLength: parseIntOption(rawOpts['max-length'], 13),
    probe: parseIntOption(rawOpts.probe, 1000),
    outPrefix: rawOpts['out-prefix'] || 'searchle-ptbr',
  };

  console.log(`Loading ${modelName}...`);
  const model = loadModel(modelName);
  console.log(`  ${model.count.toLocaleString()} words, ${model.dimensions}d`);

  console.log('Scoring Portuguese frequencies...');
  const freqScores = loadWordfreqScores(model.words, 'pt');
  const canonicalByFold = buildCanonicalByFold(model, freqScores);
  const canonicalSet = new Set(canonicalByFold.values());
  const { centroid, seedCount } = computeCentroid(model, SEED_WORDS);
  console.log(`  Seed words in model: ${seedCount}/${SEED_WORDS.length}`);
  console.log(`  Fold-deduped candidates: ${canonicalSet.size.toLocaleString()}`);

  const scored = [];
  const rejected = new Map();
  for (const word of canonicalSet) {
    const zipf = freqScores.get(word) || 0;
    const reason = targetRejectReason(word, canonicalSet, zipf, opts);
    if (reason) {
      rejected.set(reason, (rejected.get(reason) || 0) + 1);
      continue;
    }
    const vector = getVector(model, word);
    if (!vector) continue;
    const centroidSim = cosineVectors(vector, centroid);
    const freqScore = sweetSpot(zipf, 4.35, 1.8);
    const lengthScore = sweetSpot(word.length, 7, 6);
    const baseScore = centroidSim * 0.72 + freqScore * 0.22 + lengthScore * 0.06;
    scored.push({ word, zipf, centroidSim, baseScore });
  }
  scored.sort((a, b) => b.baseScore - a.baseScore);

  const probeCount = Math.min(scored.length, Math.max(opts.probe, opts.count));
  console.log(`  Base candidates: ${scored.length.toLocaleString()}, probing nearest neighbors for top ${probeCount.toLocaleString()}...`);
  const probed = [];
  for (let i = 0; i < probeCount; i++) {
    if (i > 0 && i % 100 === 0) process.stdout.write(`\r  Probed ${i.toLocaleString()} / ${probeCount.toLocaleString()}`);
    const item = scored[i];
    const neighbors = nearestNeighbors(model, item.word, 8);
    if (neighborRejectReason(item.word, neighbors)) continue;
    const maxSim = neighbors[0] ? neighbors[0].sim : 0;
    if (maxSim < 0.42) continue;
    const density = Math.min(1, Math.max(0, (maxSim - 0.42) / 0.34));
    const duplicatePenalty = maxSim > 0.84 ? (maxSim - 0.84) * 0.4 : 0;
    probed.push({
      ...item,
      maxSim,
      score: item.baseScore + density * 0.16 - duplicatePenalty,
      neighbors,
    });
  }
  console.log(`\r  Probed ${probeCount.toLocaleString()} / ${probeCount.toLocaleString()}`);
  probed.sort((a, b) => b.score - a.score);

  const selected = probed.slice(0, opts.count);
  ensureDir(OUTPUT_DIR);
  const detailPath = path.join(OUTPUT_DIR, `${opts.outPrefix}-candidates.json`);
  const wordsPath = path.join(OUTPUT_DIR, `${opts.outPrefix}-target-words.json`);
  const txtPath = path.join(OUTPUT_DIR, `${opts.outPrefix}-target-words.txt`);
  const report = {
    generatedAt: new Date().toISOString(),
    model: modelName,
    options: opts,
    seedCount,
    sourceWordCount: model.count,
    canonicalWordCount: canonicalSet.size,
    rejected: Object.fromEntries([...rejected.entries()].sort((a, b) => b[1] - a[1])),
    candidates: selected.map(item => ({
      word: item.word,
      score: Number(item.score.toFixed(4)),
      zipf: Number(item.zipf.toFixed(2)),
      centroidSim: Number(item.centroidSim.toFixed(4)),
      maxSim: Number(item.maxSim.toFixed(4)),
      neighbors: item.neighbors.map(n => ({ word: n.word, sim: Number(n.sim.toFixed(4)) })),
    })),
  };
  fs.writeFileSync(detailPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(wordsPath, JSON.stringify(selected.map(item => item.word), null, 2));
  fs.writeFileSync(txtPath, selected.map(item => item.word).join('\n') + '\n');

  console.log(`\nWrote ${path.relative(ROOT, detailPath)}`);
  console.log(`Wrote ${path.relative(ROOT, wordsPath)}`);
  console.log(`Wrote ${path.relative(ROOT, txtPath)}`);
  console.log('\nTop 50 candidates:');
  for (const item of selected.slice(0, 50)) {
    const neighbors = item.neighbors.slice(0, 4).map(n => n.word).join(', ');
    console.log(`${item.word.padEnd(16)} score=${item.score.toFixed(3)} zipf=${item.zipf.toFixed(2)} max=${item.maxSim.toFixed(3)}  ${neighbors}`);
  }
}

function evaluate(modelName, targetPath, rawOpts) {
  const top = parseIntOption(rawOpts.top, 8);
  const model = loadModel(modelName);
  const targets = loadTargetWords(targetPath);
  for (const target of targets) {
    const word = normalizeWord(target);
    const neighbors = nearestNeighbors(model, word, top);
    console.log(`\n${word}`);
    if (!neighbors.length) {
      console.log('  missing or isolated');
      continue;
    }
    for (const neighbor of neighbors) {
      console.log(`  ${neighbor.word.padEnd(18)} ${neighbor.sim.toFixed(4)}`);
    }
  }
}

function splitDifficulty(modelName, targetPath, rawOpts) {
  const opts = {
    minZipf: parseFloatOption(rawOpts['min-zipf'], 2.5),
    maxZipf: parseFloatOption(rawOpts['max-zipf'], 8.0),
    minLength: parseIntOption(rawOpts['min-length'], 2),
    maxLength: parseIntOption(rawOpts['max-length'], 13),
    veryEasyMinZipf: parseFloatOption(rawOpts['very-easy-min-zipf'], 5.5),
    easyMinZipf: parseFloatOption(rawOpts['easy-min-zipf'], 4.5),
    easyMinScore: rawOpts['easy-min-score'] === undefined
      ? null
      : parseFloatOption(rawOpts['easy-min-score'], null),
    targetReport: rawOpts['target-report'] ? path.resolve(ROOT, rawOpts['target-report']) : null,
    rareMinZipf: parseFloatOption(rawOpts['rare-min-zipf'], 3.0),
    rareMaxZipf: parseFloatOption(rawOpts['rare-max-zipf'], 4.5),
    outDir: rawOpts['out-dir']
      ? path.resolve(ROOT, rawOpts['out-dir'])
      : DIFFICULTY_OUTPUT_DIR,
  };

  console.log(`Loading ${modelName}...`);
  const model = loadModel(modelName);
  const rawTargets = loadTargetWords(targetPath);
  const normalizedTargets = rawTargets.map(normalizeWord).filter(Boolean);
  const canonicalSet = new Set(normalizedTargets);
  const targetMetadata = loadTargetMetadata(opts.targetReport);

  console.log(`Scoring ${normalizedTargets.length.toLocaleString()} pt-BR targets with wordfreq...`);
  const freqScores = loadWordfreqScores(normalizedTargets, 'pt');
  const seen = new Set();
  const accepted = [];
  const rejected = [];

  for (const rawWord of rawTargets) {
    const word = normalizeWord(rawWord);
    const zipf = freqScores.get(word) || 0;
    const rejection = rejectDifficultyTarget(rawWord, seen, model, canonicalSet, zipf, opts);
    if (rejection) {
      rejected.push({
        word: rejection.word || String(rawWord || ''),
        reason: rejection.reason,
        zipf: Number(zipf.toFixed(2)),
      });
      continue;
    }
    seen.add(word);
    accepted.push({ word, zipf });
  }

  accepted.sort((a, b) => b.zipf - a.zipf || a.word.localeCompare(b.word, 'pt-BR'));
  ensureDir(opts.outDir);

  const tiers = {};
  for (const tier of DIFFICULTY_TIERS) {
    let entries = accepted.filter(item => tier.includes(item.zipf, opts));
    if ((tier.key === 'very-common' || tier.key === 'common') && targetMetadata && opts.easyMinScore !== null) {
      entries = entries.filter(item => {
        const metadata = targetMetadata.get(item.word);
        return metadata && (metadata.source === 'seed' || metadata.score >= opts.easyMinScore);
      });
    }
    const filePath = path.join(opts.outDir, tier.file);
    writeJson(filePath, entries.map(item => item.word));
    tiers[tier.key] = {
      label: tier.label,
      file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
      ...statsForEntries(entries),
      sample: entries.slice(0, 20).map(item => ({
        word: item.word,
        zipf: Number(item.zipf.toFixed(2)),
      })),
    };
  }

  const reportPath = path.join(opts.outDir, 'difficulty-report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    model: modelName,
    sourceTargets: path.relative(ROOT, path.resolve(ROOT, targetPath)).replace(/\\/g, '/'),
    note: 'Frequency controls difficulty. Noun-only status comes from the pt-BR target bank and reject filters; wordfreq does not provide part-of-speech tags.',
    thresholds: {
      'very-common': `zipf >= ${opts.veryEasyMinZipf}`,
      common: `zipf >= ${opts.easyMinZipf}`,
      normal: 'all accepted targets',
      rare: `${opts.rareMinZipf} <= zipf < ${opts.rareMaxZipf}`,
      'very-rare': `zipf < ${opts.rareMinZipf}`,
    },
    options: {
      minZipf: opts.minZipf,
      maxZipf: opts.maxZipf,
      minLength: opts.minLength,
      maxLength: opts.maxLength,
      veryEasyMinZipf: opts.veryEasyMinZipf,
      easyMinZipf: opts.easyMinZipf,
      easyMinScore: opts.easyMinScore,
      targetReport: opts.targetReport ? path.relative(ROOT, opts.targetReport).replace(/\\/g, '/') : null,
      rareMinZipf: opts.rareMinZipf,
      rareMaxZipf: opts.rareMaxZipf,
    },
    sourceCount: rawTargets.length,
    acceptedCount: accepted.length,
    rejected,
    tiers,
  };
  writeJson(reportPath, report);

  console.log('\nDifficulty pools:');
  for (const tier of DIFFICULTY_TIERS) {
    const stats = tiers[tier.key];
    const range = stats.count
      ? `Zipf ${stats.minZipf}-${stats.maxZipf}, median ${stats.medianZipf}`
      : 'empty';
    console.log(`  ${tier.key.padEnd(12)} ${String(stats.count).padStart(4)}  ${range}`);
  }
  if (rejected.length) {
    console.log(`\nRejected ${rejected.length} target(s):`);
    for (const item of rejected) {
      console.log(`  ${item.word}: ${item.reason} (zipf ${item.zipf})`);
    }
  }
  console.log(`\nWrote ${path.relative(ROOT, opts.outDir)}`);
}

function expandNouns(modelName, seedTargetPath, rawOpts) {
  const opts = {
    count: parseIntOption(rawOpts.count, 2500),
    easyMinZipf: parseFloatOption(rawOpts['easy-min-zipf'], 4.5),
    easyMinScore: parseFloatOption(rawOpts['easy-min-score'], 0.35),
    minZipf: parseFloatOption(rawOpts['min-zipf'], 3.0),
    maxZipf: parseFloatOption(rawOpts['max-zipf'], 6.2),
    minLength: parseIntOption(rawOpts['min-length'], 3),
    maxLength: parseIntOption(rawOpts['max-length'], 13),
    nounJsonl: rawOpts['noun-jsonl']
      ? path.resolve(ROOT, rawOpts['noun-jsonl'])
      : DEFAULT_NOUN_LEXICON,
    properJsonl: rawOpts['proper-jsonl']
      ? path.resolve(ROOT, rawOpts['proper-jsonl'])
      : DEFAULT_PROPER_NAME_LEXICON,
    adjJsonl: rawOpts['adj-jsonl']
      ? path.resolve(ROOT, rawOpts['adj-jsonl'])
      : DEFAULT_ADJECTIVE_LEXICON,
    verbJsonl: rawOpts['verb-jsonl']
      ? path.resolve(ROOT, rawOpts['verb-jsonl'])
      : DEFAULT_VERB_LEXICON,
    out: rawOpts.out ? path.resolve(ROOT, rawOpts.out) : EXPANDED_TARGETS_PATH,
    reportOut: rawOpts['report-out'] ? path.resolve(ROOT, rawOpts['report-out']) : EXPANDED_REPORT_PATH,
  };

  if (!fs.existsSync(opts.nounJsonl)) {
    throw new Error(`Missing noun lexicon: ${opts.nounJsonl}`);
  }

  console.log(`Loading ${modelName}...`);
  const model = loadModel(modelName);
  const seedTargets = loadTargetWords(seedTargetPath).map(normalizeWord).filter(Boolean);
  const seedSet = new Set(seedTargets);

  console.log(`Loading noun lexicon ${path.relative(ROOT, opts.nounJsonl)}...`);
  const nounLexicon = loadNounLexicon(opts.nounJsonl);
  console.log(`  Usable noun lemmas: ${nounLexicon.entries.size.toLocaleString()}`);

  const properNames = loadWordSetFromLexicon(opts.properJsonl, 'name');
  console.log(`  Proper-name exclusions: ${properNames.size.toLocaleString()}`);
  const adjectives = loadWordSetFromLexicon(opts.adjJsonl, 'adj');
  console.log(`  Adjective homograph exclusions: ${adjectives.size.toLocaleString()}`);
  const verbs = loadWordSetFromLexicon(opts.verbJsonl, 'verb');
  console.log(`  Verb homograph exclusions: ${verbs.size.toLocaleString()}`);

  const allNouns = new Set([...nounLexicon.entries.keys(), ...seedSet]);
  console.log(`Scoring ${allNouns.size.toLocaleString()} noun candidates with wordfreq...`);
  const freqScores = loadWordfreqScores([...allNouns], 'pt');
  const canonicalByFold = buildCanonicalWords(allNouns, freqScores);
  const canonicalSet = new Set([...canonicalByFold.values(), ...seedSet]);
  const { centroid, seedCount } = computeCentroid(model, SEED_WORDS);

  const scored = [];
  const rejected = new Map();
  for (const word of canonicalSet) {
    const reason = rejectExpandedNounTarget(word, model, canonicalSet, freqScores, {
      ...opts,
      adjectives,
      properNames,
      seedSet,
      verbs,
    });
    if (reason) {
      rejected.set(reason, (rejected.get(reason) || 0) + 1);
      continue;
    }
    const vector = getVector(model, word);
    if (!vector) continue;
    const zipf = freqScores.get(word) || 0;
    const lexiconEntry = nounLexicon.entries.get(word);
    const centroidSim = cosineVectors(vector, centroid);
    const freqScore = sweetSpot(zipf, 4.25, 1.75);
    const lengthScore = sweetSpot(word.length, 7, 6);
    const seedBoost = seedSet.has(word) ? 0.42 : 0;
    const brazilBoost = lexiconEntry && lexiconEntry.brazilPronunciation ? 0.03 : 0;
    const score = centroidSim * 0.38 + freqScore * 0.34 + lengthScore * 0.08 + seedBoost + brazilBoost;
    scored.push({
      word,
      zipf,
      score,
      centroidSim,
      source: seedSet.has(word) ? 'seed' : 'kaikki-noun',
      gloss: lexiconEntry ? lexiconEntry.gloss : null,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.zipf - a.zipf || a.word.localeCompare(b.word, 'pt-BR'));

  const selected = [];
  const selectedSet = new Set();
  const addSelected = item => {
    if (!item || selectedSet.has(item.word) || selected.length >= opts.count) return false;
    selected.push(item);
    selectedSet.add(item.word);
    return true;
  };
  const scoredByWord = new Map(scored.map(item => [item.word, item]));
  for (const word of seedTargets) {
    addSelected(scoredByWord.get(word));
  }
  const easyCandidates = scored
    .filter(item => item.zipf >= opts.easyMinZipf && item.score >= opts.easyMinScore && !selectedSet.has(item.word))
    .sort((a, b) => b.zipf - a.zipf || b.score - a.score || a.word.localeCompare(b.word, 'pt-BR'));
  for (const item of easyCandidates) {
    addSelected(item);
  }
  for (const item of scored) {
    if (selected.length >= opts.count) break;
    addSelected(item);
  }
  selected.sort((a, b) => b.score - a.score || b.zipf - a.zipf || a.word.localeCompare(b.word, 'pt-BR'));
  const candidateTierCounts = tierCountsForEntries(scored);
  const selectedTierCounts = tierCountsForEntries(selected);
  const easyPriorityCandidateCount = scored
    .filter(item => item.zipf >= opts.easyMinZipf && item.score >= opts.easyMinScore)
    .length;

  ensureDir(path.dirname(opts.out));
  writeJson(opts.out, selected.map(item => item.word));
  writeJson(opts.reportOut, {
    generatedAt: new Date().toISOString(),
    model: modelName,
    seedTargets: path.relative(ROOT, path.resolve(ROOT, seedTargetPath)).replace(/\\/g, '/'),
    nounLexicon: path.relative(ROOT, opts.nounJsonl).replace(/\\/g, '/'),
    properNameLexicon: path.relative(ROOT, opts.properJsonl).replace(/\\/g, '/'),
    adjectiveLexicon: path.relative(ROOT, opts.adjJsonl).replace(/\\/g, '/'),
    verbLexicon: path.relative(ROOT, opts.verbJsonl).replace(/\\/g, '/'),
    note: 'Expanded target bank uses Wiktextract/Kaikki noun POS entries, excludes proper-name entries, excludes non-seed adjective/verb homographs, then applies Searchle model coverage, wordfreq, and target-quality filters. This is stronger than embeddings alone but still benefits from native review before broad production use.',
    options: {
      count: opts.count,
      easyMinZipf: opts.easyMinZipf,
      easyMinScore: opts.easyMinScore,
      minZipf: opts.minZipf,
      maxZipf: opts.maxZipf,
      minLength: opts.minLength,
      maxLength: opts.maxLength,
    },
    seedCount: seedTargets.length,
    seedWordsInCentroid: seedCount,
    nounLexiconCount: nounLexicon.entries.size,
    canonicalCandidateCount: canonicalSet.size,
    acceptedCandidateCount: scored.length,
    selectedCount: selected.length,
    candidateTierCounts,
    selectedTierCounts,
    easyPriorityCandidateCount,
    nounLexiconRejected: nounLexicon.rejected,
    targetRejected: Object.fromEntries([...rejected.entries()].sort((a, b) => b[1] - a[1])),
    selectedStats: statsForEntries(selected),
    selected: selected.map(item => ({
      word: item.word,
      zipf: Number(item.zipf.toFixed(2)),
      score: Number(item.score.toFixed(4)),
      centroidSim: Number(item.centroidSim.toFixed(4)),
      source: item.source,
      gloss: item.gloss,
    })),
  });

  console.log('\nExpanded target bank:');
  console.log(`  Seed targets: ${seedTargets.length.toLocaleString()}`);
  console.log(`  Accepted candidates: ${scored.length.toLocaleString()}`);
  console.log(`  Selected targets: ${selected.length.toLocaleString()}`);
  console.log(`  Easy candidates selected: ${selectedTierCounts.common.toLocaleString()} / ${easyPriorityCandidateCount.toLocaleString()} priority candidates`);
  const selectedStats = statsForEntries(selected);
  console.log(`  Zipf range: ${selectedStats.minZipf}-${selectedStats.maxZipf}, median ${selectedStats.medianZipf}`);
  console.log(`\nWrote ${path.relative(ROOT, opts.out)}`);
  console.log(`Wrote ${path.relative(ROOT, opts.reportOut)}`);
  console.log('\nTop 50 selected targets:');
  for (const item of selected.slice(0, 50)) {
    console.log(`${item.word.padEnd(16)} zipf=${item.zipf.toFixed(2)} score=${item.score.toFixed(3)} ${item.source}`);
  }
}

function main() {
  const { args, opts } = parseOptions(process.argv.slice(2));
  const command = args[0];
  if (!command || command === '--help' || command === 'help' || opts.help) {
    usage();
    return;
  }
  if (command === 'generate') {
    if (!args[1]) throw new Error('generate requires a model name');
    generate(args[1], opts);
    return;
  }
  if (command === 'evaluate') {
    if (!args[1] || !args[2]) throw new Error('evaluate requires a model name and targets JSON path');
    evaluate(args[1], args[2], opts);
    return;
  }
  if (command === 'split-difficulty') {
    if (!args[1] || !args[2]) throw new Error('split-difficulty requires a model name and targets JSON path');
    splitDifficulty(args[1], args[2], opts);
    return;
  }
  if (command === 'expand-nouns') {
    if (!args[1] || !args[2]) throw new Error('expand-nouns requires a model name and seed targets JSON path');
    expandNouns(args[1], args[2], opts);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
