#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseDfPk, calculateBackupGrowth } = require('./smoke-capacity');

const execFileAsync = promisify(execFile);
const STATE_DIR = path.join(__dirname, '..', 'tmp');
const STATE_PATH = path.join(STATE_DIR, 'smoke-ecosystem-last.json');
const DEFAULT_SERVICE_REGISTRY_PATH = path.join(__dirname, 'service-registry.json');
const WARN_THRESHOLDS = {
  hostAvailableGB: Number(process.env.SMOKE_WARN_HOST_AVAILABLE_GB || 100),
  hostFreePercent: Number(process.env.SMOKE_WARN_HOST_FREE_PERCENT || 20),
  backupGrowthGBPerDay: Number(process.env.SMOKE_WARN_BACKUP_GROWTH_GB_PER_DAY || 2),
  wordTycoonRssMB: Number(process.env.SMOKE_WARN_WORD_TYCOON_RSS_MB || 2400),
  searchleRssMB: Number(process.env.SMOKE_WARN_SEARCHLE_RSS_MB || 1700),
  pm2RestartDelta: Number(process.env.SMOKE_WARN_PM2_RESTART_DELTA || 0),
  pm2NodeMajor: Number(process.env.SMOKE_WARN_PM2_NODE_MAJOR || 24)
};

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--ssh-target' && argv[i + 1]) {
      args.sshTarget = argv[++i];
    } else if (arg === '--word-tycoon-url' && argv[i + 1]) {
      args.wordTycoonUrl = argv[++i];
    } else if (arg === '--chat-relay-url' && argv[i + 1]) {
      args.chatRelayUrl = argv[++i];
    } else if (arg === '--searchle-url' && argv[i + 1]) {
      args.searchleUrl = argv[++i];
    } else if (arg === '--api-key' && argv[i + 1]) {
      args.apiKey = argv[++i];
    } else if (arg === '--service-registry' && argv[i + 1]) {
      args.serviceRegistryPath = argv[++i];
    }
  }
  return args;
}

function buildConfig(argv) {
  const args = parseArgs(argv);
  return {
    json: args.json,
    sshTarget: args.sshTarget || process.env.ECO_SMOKE_SSH_TARGET || '',
    apiKey: args.apiKey || process.env.GAME_API_SECRET,
    chatRelayUrl: args.chatRelayUrl || process.env.CHAT_RELAY_HEALTH_URL || 'https://wordtycoon.live/api/health',
    searchleUrl: args.searchleUrl || process.env.SEARCHLE_HEALTH_URL || 'https://subtextle.com/api/health',
    portalUrl: process.env.PORTAL_HOME_URL || 'https://wordtycoon.live/',
    publicWordTycoonBaseUrl: process.env.PUBLIC_WORD_TYCOON_BASE_URL || 'https://wordtycoon.live',
    searchleHomeUrl: process.env.SEARCHLE_HOME_URL || 'https://subtextle.com/',
    searchleModelsUrl: process.env.SEARCHLE_MODELS_URL || 'https://subtextle.com/api/models',
    searchleStateUrl: process.env.SEARCHLE_STATE_URL || 'https://subtextle.com/api/game/state',
    wordTycoonUrl: args.wordTycoonUrl || process.env.WORD_TYCOON_HEALTH_URL || '',
    serviceRegistryPath: args.serviceRegistryPath || process.env.SERVICE_REGISTRY_PATH || DEFAULT_SERVICE_REGISTRY_PATH
  };
}

function okResult(name, details = {}) {
  return { name, ok: true, details, warnings: [] };
}

function failResult(name, error, details = {}) {
  return {
    name,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    details,
    warnings: []
  };
}

function addWarning(result, message) {
  if (!result.warnings) result.warnings = [];
  result.warnings.push(message);
  return result;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}${text ? ` :: ${text.slice(0, 200)}` : ''}`);
  }
  if (!json || typeof json !== 'object') {
    throw new Error(`Non-JSON response from ${url}`);
  }
  return json;
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}${text ? ` :: ${text.slice(0, 200)}` : ''}`);
  }
  return text;
}

async function fetchStatus(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  return {
    status: res.status,
    statusText: res.statusText,
    contentType: res.headers.get('content-type') || '',
    text
  };
}

async function sshJson(target, url, { headers = {} } = {}) {
  const headerFlags = Object.entries(headers).flatMap(([key, value]) => ['-H', `${key}:${value}`]);
  const remoteCommand = ['curl', '-sS', ...headerFlags, url];
  const { stdout } = await execFileAsync('ssh', [target, ...remoteCommand], { maxBuffer: 1024 * 1024 * 10 });
  return JSON.parse(stdout);
}

async function sshPm2Status(target) {
  const { stdout } = await execFileAsync('ssh', [target, 'pm2', 'jlist'], { maxBuffer: 1024 * 1024 * 20 });
  return JSON.parse(stdout);
}

async function sshDiskCapacity(target, checkedPath = '/opt/word-tycoon') {
  const { stdout } = await execFileAsync('ssh', [target, 'df', '-Pk', checkedPath], { maxBuffer: 1024 * 1024 });
  return parseDfPk(stdout, checkedPath);
}

function loadServiceRegistry(registryPath) {
  const raw = fs.readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(raw);
  if (!Array.isArray(registry.services) || registry.services.length === 0) {
    throw new Error(`Service registry has no services: ${registryPath}`);
  }
  return {
    targetNodeMajor: Number(registry.targetNodeMajor || WARN_THRESHOLDS.pm2NodeMajor),
    services: registry.services
  };
}

function summarizeMemory(memory = {}) {
  return {
    rssMB: memory.rss ?? null,
    heapUsedMB: memory.heapUsed ?? null,
    externalMB: memory.external ?? null
  };
}

async function checkChatRelay(config) {
  const payload = await fetchJson(config.chatRelayUrl);
  if (!payload.ok) throw new Error('Chat Relay health returned ok=false');
  if (!payload.wordTycoonReachable) throw new Error('Chat Relay cannot reach Word Tycoon');
  return okResult('chat-relay', {
    url: config.chatRelayUrl,
    sessions: payload.sessions?.count ?? null,
    appsRegistered: payload.appsRegistered ?? null,
    memory: summarizeMemory(payload.memoryMB)
  });
}

async function checkSearchle(config) {
  const payload = await fetchJson(config.searchleUrl);
  if (!payload.ok) throw new Error('Searchle health returned ok=false');
  if (!payload.models || payload.models.activeModelCount < 1) {
    throw new Error('Searchle reports no active models');
  }
  const result = okResult('searchle', {
    url: config.searchleUrl,
    connectedPlayers: payload.connectedPlayers ?? null,
    activeModels: payload.models?.activeModels || [],
    totalEstimatedMB: payload.models?.totalEstimatedMB ?? null,
    memory: summarizeMemory(payload.memoryMB)
  });
  if ((result.details.memory?.rssMB ?? 0) > WARN_THRESHOLDS.searchleRssMB) {
    addWarning(result, `Searchle RSS above threshold (${result.details.memory.rssMB} MB > ${WARN_THRESHOLDS.searchleRssMB} MB)`);
  }
  return result;
}

async function checkPublicPages(config) {
  const portalHtml = await fetchText(config.portalUrl);
  const searchleHtml = await fetchText(config.searchleHomeUrl);
  if (!/<!doctype html>/i.test(portalHtml)) {
    throw new Error('Portal home did not return HTML');
  }
  if (!/<!doctype html>/i.test(searchleHtml)) {
    throw new Error('Searchle home did not return HTML');
  }
  return okResult('public-pages', {
    portalUrl: config.portalUrl,
    searchleHomeUrl: config.searchleHomeUrl
  });
}

async function checkSearchlePublicApis(config) {
  const models = await fetchJson(config.searchleModelsUrl);
  const state = await fetchJson(config.searchleStateUrl);

  if (!Array.isArray(models.activeModels) || models.activeModels.length < 1) {
    throw new Error('Searchle models endpoint reported no active models');
  }
  if (!Array.isArray(state.guesses)) {
    throw new Error('Searchle game state missing guesses array');
  }
  if (!Array.isArray(state.searchleLeaderboard)) {
    throw new Error('Searchle game state missing searchleLeaderboard array');
  }

  return okResult('searchle-public-apis', {
    modelsUrl: config.searchleModelsUrl,
    stateUrl: config.searchleStateUrl,
    activeModels: models.activeModels,
    guessCount: state.guesses.length,
    leaderboardSize: state.searchleLeaderboard.length
  });
}

async function checkWordTycoon(config) {
  let payload;
  let source;
  if (config.wordTycoonUrl) {
    payload = await fetchJson(config.wordTycoonUrl);
    source = config.wordTycoonUrl;
  } else if (config.sshTarget) {
    payload = await sshJson(config.sshTarget, 'http://127.0.0.1:3020/api/health');
    source = `${config.sshTarget}:127.0.0.1:3020/api/health`;
  } else {
    throw new Error('No Word Tycoon direct health source configured; set --word-tycoon-url or --ssh-target');
  }

  if (!payload.ok) throw new Error('Word Tycoon health returned ok=false');
  if (!payload.databases?.ledger) throw new Error('Word Tycoon health missing ledger block');
  let hostDisk = null;
  let hostDiskError = null;
  if (config.sshTarget) {
    try {
      hostDisk = await sshDiskCapacity(config.sshTarget);
    } catch (error) {
      hostDiskError = error instanceof Error ? error.message : String(error);
    }
  }
  const result = okResult('word-tycoon', {
    source,
    players: payload.players?.total ?? null,
    backupsGB: payload.backups
      ? Number((Object.values(payload.backups).reduce((sum, entry) => sum + Number(entry.totalSizeMB || 0), 0) / 1024).toFixed(2))
      : null,
    memory: summarizeMemory(payload.memoryMB),
    mainDbSizeMB: payload.databases?.main?.fileSizeMB ?? null,
    ledgerDbSizeMB: payload.databases?.ledgerMirror?.fileSizeMB ?? null,
    archiveDbSizeMB: payload.databases?.ledger?.archiveDbSizeMB ?? null,
    hostDisk,
    hostDiskError
  });
  if (hostDiskError) {
    addWarning(result, `Host disk capacity check failed: ${hostDiskError}`);
  } else if (
    hostDisk &&
    (hostDisk.availableGB < WARN_THRESHOLDS.hostAvailableGB || hostDisk.freePercent < WARN_THRESHOLDS.hostFreePercent)
  ) {
    addWarning(
      result,
      `Host disk reserve low (${hostDisk.availableGB} GB / ${hostDisk.freePercent}% free; minimums ${WARN_THRESHOLDS.hostAvailableGB} GB / ${WARN_THRESHOLDS.hostFreePercent}%)`
    );
  }
  if ((result.details.memory?.rssMB ?? 0) > WARN_THRESHOLDS.wordTycoonRssMB) {
    addWarning(result, `Word Tycoon RSS above threshold (${result.details.memory.rssMB} MB > ${WARN_THRESHOLDS.wordTycoonRssMB} MB)`);
  }
  return result;
}

async function checkWordTycoonPublicBoundary(config) {
  const base = config.publicWordTycoonBaseUrl.replace(/\/+$/, '');
  const relayHealth = await fetchJson(`${base}/api/health`);
  if (!relayHealth.ok) throw new Error('Public /api/health returned ok=false');
  if (relayHealth.service === 'mobile-tycoon') {
    throw new Error('Public /api/health exposes the Word Tycoon economy service directly');
  }
  if (!relayHealth.wordTycoonReachable) {
    throw new Error('Public Chat Relay health cannot reach Word Tycoon');
  }

  const blockedChecks = [
    {
      name: 'reward',
      status: await fetchStatus(`${base}/api/reward`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
    },
    {
      name: 'balance',
      status: await fetchStatus(`${base}/api/balance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
    },
    {
      name: 'cosmetics',
      status: await fetchStatus(`${base}/api/cosmetics/discord/_smoke_nonexistent_user_`)
    }
  ];

  const exposed = blockedChecks.filter((check) => check.status.status !== 404);
  if (exposed.length) {
    throw new Error(`Public economy endpoint exposure changed: ${exposed.map((check) => `${check.name}=${check.status.status}`).join(', ')}`);
  }

  const goat = await fetchJson(`${base}/api/goat?sort=coins&limit=1`);
  if (!goat.ok || !Array.isArray(goat.players)) {
    throw new Error('Public GOAT endpoint did not return player data');
  }

  return okResult('word-tycoon-public-boundary', {
    baseUrl: base,
    publicHealthOwner: 'chat-relay',
    blockedEconomyEndpoints: blockedChecks.map((check) => ({ name: check.name, status: check.status.status })),
    goatPlayers: goat.players.length
  });
}

async function checkWordTycoonAdmin(config) {
  if (!config.sshTarget) {
    return okResult('word-tycoon-admin', { skipped: true, reason: 'no ssh target provided' });
  }
  if (!config.apiKey) {
    return okResult('word-tycoon-admin', { skipped: true, reason: 'GAME_API_SECRET not provided' });
  }

  const headers = { 'x-api-key': config.apiKey };
  const ledger = await sshJson(config.sshTarget, 'http://127.0.0.1:3020/api/admin/ledger/maintenance/status', { headers });
  const backups = await sshJson(config.sshTarget, 'http://127.0.0.1:3020/api/admin/backups/prune-report', { headers });

  if (!ledger.ok) throw new Error('Ledger maintenance status returned ok=false');
  if (!backups.ok) throw new Error('Backup prune report returned ok=false');
  return okResult('word-tycoon-admin', {
    eligibleHotRows: ledger.eligibleHotRows ?? null,
    startupSnapshotTarget: backups.configured?.categories?.startup?.keep ?? null,
    shutdownSnapshotTarget: backups.configured?.categories?.['pre-shutdown']?.keep ?? null,
    reclaimableSizeMB: backups.configured?.reclaimableSizeMB ?? null
  });
}

async function checkPm2(config) {
  if (!config.sshTarget) {
    return okResult('pm2-service-registry', { skipped: true, reason: 'no ssh target provided' });
  }

  const registry = loadServiceRegistry(config.serviceRegistryPath);
  const processes = await sshPm2Status(config.sshTarget);
  const byName = new Map(processes.map((proc) => [proc.name, proc]));
  const expected = registry.services.filter((service) => service.enabled !== false);
  const required = expected.filter((service) => service.required !== false);
  const missing = required.filter((service) => !byName.has(service.name)).map((service) => service.name);
  const bad = required
    .map((service) => byName.get(service.name))
    .filter((proc) => proc && proc.pm2_env?.status !== 'online');

  if (missing.length || bad.length) {
    throw new Error(`PM2 issue: missing=${missing.join(',') || 'none'} bad=${bad.map((proc) => proc.name).join(',') || 'none'}`);
  }

  const result = okResult('pm2-service-registry', {
    registryPath: config.serviceRegistryPath,
    targetNodeMajor: registry.targetNodeMajor,
    checkedServices: expected.length,
    services: expected.map((service) => {
      const proc = byName.get(service.name);
      const memoryMB = proc?.monit?.memory ? Math.round(proc.monit.memory / (1024 * 1024)) : null;
      const maxMemoryRestartMB = proc?.pm2_env?.max_memory_restart
        ? Math.round(Number(proc.pm2_env.max_memory_restart) / (1024 * 1024))
        : null;
      return {
        name: service.name,
        tier: service.tier || null,
        status: proc?.pm2_env?.status || null,
        restarts: proc?.pm2_env?.restart_time ?? null,
        nodeVersion: proc?.pm2_env?.node_version || null,
        port: proc?.pm2_env?.PORT ? Number(proc.pm2_env.PORT) : null,
        expectedPort: service.port ?? null,
        script: proc?.pm2_env?.pm_exec_path || null,
        expectedScript: service.script || null,
        memoryMB,
        memoryWarnMB: service.memoryWarnMB ?? null,
        maxMemoryRestartMB,
        minMaxMemoryRestartMB: service.minMaxMemoryRestartMB ?? null
      };
    })
  });

  for (const service of result.details.services) {
    const major = Number(String(service.nodeVersion || '').split('.')[0]);
    if (major && major !== registry.targetNodeMajor) {
      addWarning(result, `${service.name} is running Node ${service.nodeVersion}; target major is ${registry.targetNodeMajor}`);
    }
    if (service.expectedPort !== null && service.port !== service.expectedPort) {
      addWarning(result, `${service.name} port mismatch (${service.port ?? 'none'} != ${service.expectedPort})`);
    }
    if (service.expectedScript && service.script !== service.expectedScript) {
      addWarning(result, `${service.name} script mismatch (${service.script || 'none'} != ${service.expectedScript})`);
    }
    if (service.memoryWarnMB !== null && service.memoryMB !== null && service.memoryMB > service.memoryWarnMB) {
      addWarning(result, `${service.name} PM2 memory above registry threshold (${service.memoryMB} MB > ${service.memoryWarnMB} MB)`);
    }
    if (
      service.minMaxMemoryRestartMB !== null &&
      service.maxMemoryRestartMB !== null &&
      service.maxMemoryRestartMB < service.minMaxMemoryRestartMB
    ) {
      addWarning(result, `${service.name} PM2 max-memory-restart below registry floor (${service.maxMemoryRestartMB} MB < ${service.minMaxMemoryRestartMB} MB)`);
    }
  }
  return result;
}

function findPm2Result(results) {
  return results.find((result) => (result.name === 'pm2-service-registry' || result.name === 'pm2-critical-services') && result.ok);
}

function findWordTycoonResult(results) {
  return results.find((result) => result.name === 'word-tycoon' && result.ok);
}

function readPreviousState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeCurrentState(results) {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    const pm2 = findPm2Result(results);
    const wordTycoon = findWordTycoonResult(results);
    const state = {
      savedAt: new Date().toISOString(),
      pm2Services: pm2?.details?.services || [],
      wordTycoon: wordTycoon
        ? {
            backupsGB: wordTycoon.details?.backupsGB ?? null,
            hostDisk: wordTycoon.details?.hostDisk ?? null
          }
        : null
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (_) {
    // Non-fatal.
  }
}

function applyCrossRunWarnings(results, previousState) {
  const pm2 = findPm2Result(results);
  if (pm2 && previousState?.pm2Services?.length) {
    const previousByName = new Map(previousState.pm2Services.map((service) => [service.name, service]));
    for (const service of pm2.details.services || []) {
      const prior = previousByName.get(service.name);
      if (!prior) continue;
      const delta = Number(service.restarts || 0) - Number(prior.restarts || 0);
      if (delta > WARN_THRESHOLDS.pm2RestartDelta) {
        addWarning(pm2, `PM2 restart count increased for ${service.name} (+${delta} since previous smoke run)`);
      }
    }
  }

  const wordTycoon = findWordTycoonResult(results);
  const growth = calculateBackupGrowth(
    wordTycoon?.details?.backupsGB,
    previousState?.wordTycoon
      ? { ...previousState.wordTycoon, savedAt: previousState.savedAt }
      : null
  );
  if (!wordTycoon || !growth) return;
  wordTycoon.details.backupGrowth = growth;
  if (growth.growthGBPerDay > WARN_THRESHOLDS.backupGrowthGBPerDay) {
    addWarning(
      wordTycoon,
      `Backup footprint growing quickly (${growth.growthGBPerDay} GB/day over ${growth.sampleHours} hours; threshold ${WARN_THRESHOLDS.backupGrowthGBPerDay} GB/day)`
    );
  }
}

function collectWarnings(results) {
  return results.flatMap((result) => (result.warnings || []).map((warning) => ({
    name: result.name,
    message: warning
  })));
}

function printHuman(results) {
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS ${result.name}`);
    } else {
      console.log(`FAIL ${result.name} :: ${result.error}`);
    }
    const detailEntries = Object.entries(result.details || {});
    for (const [key, value] of detailEntries) {
      console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
    for (const warning of result.warnings || []) {
      console.log(`  WARN: ${warning}`);
    }
  }
}

async function main() {
  const config = buildConfig(process.argv.slice(2));
  const previousState = readPreviousState();
  const checks = [
    ['public-pages', () => checkPublicPages(config)],
    ['chat-relay', () => checkChatRelay(config)],
    ['word-tycoon', () => checkWordTycoon(config)],
    ['word-tycoon-public-boundary', () => checkWordTycoonPublicBoundary(config)],
    ['word-tycoon-admin', () => checkWordTycoonAdmin(config)],
    ['searchle', () => checkSearchle(config)],
    ['searchle-public-apis', () => checkSearchlePublicApis(config)],
    ['pm2-service-registry', () => checkPm2(config)]
  ];

  const results = [];
  for (const [, runCheck] of checks) {
    try {
      results.push(await runCheck());
    } catch (error) {
      const name = results.length < checks.length ? checks[results.length][0] : 'unknown';
      results.push(failResult(name, error));
    }
  }

  applyCrossRunWarnings(results, previousState);
  const warnings = collectWarnings(results);
  const ok = results.every((result) => result.ok);
  writeCurrentState(results);
  if (config.json) {
    console.log(JSON.stringify({ ok, warningCount: warnings.length, warnings, results }, null, 2));
  } else {
    printHuman(results);
    if (warnings.length) {
      console.log(`WARNINGS ${warnings.length}`);
      for (const warning of warnings) {
        console.log(`  ${warning.name}: ${warning.message}`);
      }
    }
  }

  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
