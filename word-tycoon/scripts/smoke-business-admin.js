#!/usr/bin/env node

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const BUSINESS_CHECKS = [
  {
    name: 'pizza',
    hasFlag: 'hasShop',
    entityKey: 'shop',
    summaryNameKey: 'shopName',
    summaryLevelKey: 'shopLevel',
    summaryPrestigeKey: 'prestigeLevel',
    requiredEntityNumbers: ['shopLevel', 'prestigeLevel', 'shopXp', 'pizzaCoins', 'totalPizzasServed', 'totalCoinsEarned', 'incomePerSecond']
  },
  {
    name: 'newspaper',
    hasFlag: 'hasRoute',
    entityKey: 'route',
    summaryNameKey: 'routeName',
    summaryLevelKey: 'routeLevel',
    summaryPrestigeKey: 'prestigeLevel',
    requiredTopLevelNumbers: ['playerCoins'],
    requiredEntityNumbers: ['routeLevel', 'prestigeLevel', 'routeXp', 'totalPapersDelivered', 'totalXpEarned', 'incomePerSecond']
  },
  {
    name: 'carwash',
    hasFlag: 'hasShop',
    entityKey: 'shop',
    summaryNameKey: 'shopName',
    summaryLevelKey: 'shopLevel',
    summaryPrestigeKey: 'prestigeLevel',
    requiredTopLevelNumbers: ['stockMogulCost'],
    requiredTopLevelBooleans: ['hasStockMogul'],
    requiredEntityNumbers: ['shopLevel', 'prestigeLevel', 'shopXp', 'cleanCash', 'cleanCashCap', 'totalCarsWashed', 'totalCleanEarned', 'incomePerSecond', 'cleanCashPerSec', 'totalBizIncome']
  },
  {
    name: 'stockmogul',
    hasFlag: 'hasPortfolio',
    entityKey: 'portfolio',
    summaryNameKey: 'portfolioName',
    summaryLevelKey: 'portfolioLevel',
    summaryPrestigeKey: 'prestigeLevel',
    requiredEntityNumbers: ['portfolioLevel', 'prestigeLevel', 'portfolioXp', 'portfolioCoins', 'portfolioCoinsCap', 'totalTrades', 'totalCoinsEarned', 'incomePerSecond', 'cleanCash']
  },
  {
    name: 'gym',
    hasFlag: 'hasGym',
    entityKey: 'gym',
    summaryNameKey: 'gymName',
    summaryLevelKey: 'gymLevel',
    summaryPrestigeKey: 'prestigeLevel',
    requiredTopLevelNumbers: ['playerCoins'],
    requiredEntityNumbers: ['gymLevel', 'prestigeLevel', 'gymXp', 'totalMembersTrained', 'totalXpEarned', 'incomePerSecond']
  },
  {
    name: 'cinema',
    hasFlag: 'hasCinema',
    entityKey: 'cinema',
    summaryNameKey: 'cinemaName',
    summaryLevelKey: 'cinemaLevel',
    summaryPrestigeKey: 'prestigeLevel',
    requiredTopLevelNumbers: ['playerCoins'],
    requiredEntityNumbers: ['cinemaLevel', 'prestigeLevel', 'cinemaXp', 'totalViewersServed', 'totalXpEarned', 'incomePerSecond']
  },
  {
    name: 'startup',
    hasFlag: 'hasStartup',
    entityKey: 'startup',
    summaryNameKey: 'startupName',
    summaryLevelKey: 'startupLevel',
    summaryPrestigeKey: 'prestigeLevel',
    requiredTopLevelNumbers: ['playerCoins'],
    requiredEntityNumbers: ['startupLevel', 'prestigeLevel', 'startupXp', 'totalUsersServed', 'totalXpEarned', 'incomePerSecond']
  },
  {
    name: 'bank',
    hasFlag: 'hasBank',
    entityKey: 'bank',
    summaryNameKey: 'bankName',
    summaryLevelKey: 'bankLevel',
    summaryPrestigeKey: 'prestigeLevel',
    requiredTopLevelNumbers: ['playerCoins'],
    requiredEntityNumbers: ['bankLevel', 'prestigeLevel', 'bankXp', 'totalClientsServed', 'totalXpEarned', 'incomePerSecond']
  }
];

function parseArgs(argv) {
  const args = { json: false, discordUserIds: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--ssh-target' && argv[i + 1]) {
      args.sshTarget = argv[++i];
    } else if (arg === '--base-url' && argv[i + 1]) {
      args.baseUrl = argv[++i];
    } else if (arg === '--api-key' && argv[i + 1]) {
      args.apiKey = argv[++i];
    } else if ((arg === '--discord-user-id' || arg === '--discord-id') && argv[i + 1]) {
      args.discordUserIds.push(argv[++i]);
    }
  }
  return args;
}

function parseDiscordIds(rawValues) {
  const values = [];
  for (const rawValue of rawValues) {
    if (!rawValue) continue;
    for (const value of String(rawValue).split(',')) {
      const trimmed = value.trim();
      if (trimmed) values.push(trimmed);
    }
  }
  return [...new Set(values)];
}

function buildConfig(argv) {
  const args = parseArgs(argv);
  return {
    json: args.json,
    sshTarget: args.sshTarget || process.env.BUSINESS_SMOKE_SSH_TARGET || '',
    baseUrl: args.baseUrl || process.env.BUSINESS_SMOKE_BASE_URL || 'http://127.0.0.1:3020',
    apiKey: args.apiKey || process.env.GAME_API_SECRET,
    discordUserIds: parseDiscordIds([
      ...args.discordUserIds,
      process.env.BUSINESS_SMOKE_DISCORD_IDS || ''
    ])
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
  result.warnings = result.warnings || [];
  result.warnings.push(message);
  return result;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function ensureNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function validateTopLevelNumbers(payload, keys, label) {
  for (const key of keys || []) {
    ensureNonNegativeNumber(payload[key], `${label}.${key}`);
  }
}

function validateBooleans(payload, keys, label) {
  for (const key of keys || []) {
    if (typeof payload[key] !== 'boolean') {
      throw new Error(`${label}.${key} must be boolean`);
    }
  }
}

function validateEntity(entity, keys, label) {
  if (!isObject(entity)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of keys || []) {
    ensureNonNegativeNumber(entity[key], `${label}.${key}`);
  }
}

function validateUpgrades(upgrades, label) {
  if (!isObject(upgrades)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [key, value] of Object.entries(upgrades)) {
    ensureNonNegativeNumber(value, `${label}.${key}`);
  }
}

function validatePending(pending, label) {
  if (!isObject(pending)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [key, value] of Object.entries(pending)) {
    if (typeof value === 'number') {
      ensureNonNegativeNumber(value, `${label}.${key}`);
    }
  }
}

function validateAvailableUpgrades(availableUpgrades, label) {
  if (!isObject(availableUpgrades)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [upgradeName, upgrade] of Object.entries(availableUpgrades)) {
    if (!isObject(upgrade)) {
      throw new Error(`${label}.${upgradeName} must be an object`);
    }
    for (const key of ['currentLevel', 'cost']) {
      if (upgrade[key] !== undefined) {
        ensureNonNegativeNumber(upgrade[key], `${label}.${upgradeName}.${key}`);
      }
    }
    if (upgrade.maxed !== undefined && typeof upgrade.maxed !== 'boolean') {
      throw new Error(`${label}.${upgradeName}.maxed must be boolean`);
    }
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${text ? ` :: ${text.slice(0, 200)}` : ''}`);
  }
  if (!isObject(payload)) {
    throw new Error(`Non-JSON response from ${url}`);
  }
  return payload;
}

async function sshJson(target, url, { headers = {} } = {}) {
  const headerFlags = Object.entries(headers).flatMap(([key, value]) => ['-H', `${key}:${value}`]);
  const remoteCommand = ['curl', '-sS', ...headerFlags, url];
  const { stdout } = await execFileAsync('ssh', [target, ...remoteCommand], { maxBuffer: 1024 * 1024 * 10 });
  return JSON.parse(stdout);
}

async function loadPayload(config, businessName, discordUserId) {
  const path = `/api/admin/${businessName}/${encodeURIComponent(discordUserId)}`;
  if (config.sshTarget) {
    return sshJson(config.sshTarget, `${config.baseUrl}${path}`, {
      headers: { 'x-api-key': config.apiKey }
    });
  }
  return fetchJson(`${config.baseUrl}${path}`, {
    headers: { 'x-api-key': config.apiKey }
  });
}

function summarizeOwnedPayload(payload, check) {
  const entity = payload[check.entityKey];
  return {
    owned: true,
    name: entity[check.summaryNameKey] || null,
    level: entity[check.summaryLevelKey] ?? null,
    prestigeLevel: entity[check.summaryPrestigeKey] ?? null,
    upgradeCount: Object.keys(payload.upgrades || {}).length,
    pendingKeys: Object.keys(payload.pending || {}).length
  };
}

function validateBusinessPayload(payload, check, discordUserId) {
  if (!isObject(payload)) {
    throw new Error(`Response for ${check.name}/${discordUserId} must be an object`);
  }
  if (payload.ok !== true) {
    throw new Error(payload.message || `${check.name} returned ok=false`);
  }
  if (payload[check.hasFlag] === false) {
    const result = okResult(`${check.name}:${discordUserId}`, {
      discordUserId,
      business: check.name,
      owned: false
    });
    addWarning(result, `${discordUserId} does not currently have ${check.name} initialized`);
    return result;
  }
  if (payload[check.hasFlag] !== true) {
    throw new Error(`${check.name}/${discordUserId} missing ${check.hasFlag}=true`);
  }

  validateTopLevelNumbers(payload, check.requiredTopLevelNumbers, check.name);
  validateBooleans(payload, check.requiredTopLevelBooleans, check.name);
  validateEntity(payload[check.entityKey], check.requiredEntityNumbers, `${check.name}.${check.entityKey}`);
  validateUpgrades(payload.upgrades, `${check.name}.upgrades`);
  validatePending(payload.pending, `${check.name}.pending`);
  validateAvailableUpgrades(payload.availableUpgrades, `${check.name}.availableUpgrades`);

  if (!Array.isArray(payload.availableCustomizations) && !isObject(payload.availableCustomizations)) {
    throw new Error(`${check.name}.availableCustomizations must be an array or object`);
  }
  if (!isObject(payload.customizations)) {
    throw new Error(`${check.name}.customizations must be an object`);
  }

  return okResult(`${check.name}:${discordUserId}`, {
    discordUserId,
    business: check.name,
    ...summarizeOwnedPayload(payload, check)
  });
}

async function checkBusiness(config, check, discordUserId) {
  const payload = await loadPayload(config, check.name, discordUserId);
  return validateBusinessPayload(payload, check, discordUserId);
}

function printHuman(results) {
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS ${result.name}`);
    } else {
      console.log(`FAIL ${result.name} :: ${result.error}`);
    }
    for (const [key, value] of Object.entries(result.details || {})) {
      console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
    for (const warning of result.warnings || []) {
      console.log(`  WARN: ${warning}`);
    }
  }
}

function buildSummary(results) {
  return {
    totalChecks: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    warningCount: results.reduce((sum, result) => sum + (result.warnings || []).length, 0)
  };
}

async function main() {
  const config = buildConfig(process.argv.slice(2));
  if (!config.discordUserIds.length) {
    const result = okResult('business-admin-smoke', {
      skipped: true,
      reason: 'No Discord user ids supplied. Use --discord-user-id or BUSINESS_SMOKE_DISCORD_IDS.'
    });
    if (config.json) {
      console.log(JSON.stringify({ ok: true, summary: buildSummary([result]), results: [result] }, null, 2));
    } else {
      printHuman([result]);
    }
    return;
  }

  const results = [];
  for (const discordUserId of config.discordUserIds) {
    for (const check of BUSINESS_CHECKS) {
      try {
        results.push(await checkBusiness(config, check, discordUserId));
      } catch (error) {
        results.push(failResult(`${check.name}:${discordUserId}`, error, {
          discordUserId,
          business: check.name
        }));
      }
    }
  }

  const summary = buildSummary(results);
  const ok = summary.failed === 0;

  if (config.json) {
    console.log(JSON.stringify({ ok, summary, results }, null, 2));
  } else {
    printHuman(results);
    console.log(`SUMMARY total=${summary.totalChecks} passed=${summary.passed} failed=${summary.failed} warnings=${summary.warningCount}`);
  }

  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
