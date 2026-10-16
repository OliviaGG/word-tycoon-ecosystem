// Anonymous User Registry
// Assigns persistent unique "Anon #N" display names to users who don't have a custom name.
// The mapping is keyed by platformUserId (which is canonical — survives socket reconnects).

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const REGISTRY_PATH = path.join(DATA_DIR, 'anon-registry.json');

// In-memory cache: platformUserId -> anonNumber
let registry = {};
let nextNumber = 1;
let loaded = false;

// Names the client might send when the user hasn't set a display name
const GENERIC_NAMES = new Set([
  '', 'anonymous', 'anon', 'guest', 'undefined', 'null'
]);

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
      registry = data.registry || {};
      nextNumber = data.nextNumber || 1;
      console.log(`[AnonRegistry] Loaded ${Object.keys(registry).length} entries, next=${nextNumber}`);
    }
  } catch (err) {
    console.warn('[AnonRegistry] Load failed, starting fresh:', err.message);
    registry = {};
    nextNumber = 1;
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = REGISTRY_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ registry, nextNumber }));
      fs.renameSync(tmp, REGISTRY_PATH);
    } catch (err) {
      console.warn('[AnonRegistry] Save failed:', err.message);
    }
  }, 1500);
}

function saveImmediate() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = REGISTRY_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ registry, nextNumber }));
    fs.renameSync(tmp, REGISTRY_PATH);
  } catch (err) {
    console.warn('[AnonRegistry] Save failed:', err.message);
  }
}

/**
 * Check if a display name looks "generic" — meaning the user hasn't set one.
 */
function isGenericName(name) {
  if (!name) return true;
  const clean = String(name).trim().toLowerCase();
  if (GENERIC_NAMES.has(clean)) return true;
  // Also treat names that look like IDs (long random strings) as generic
  if (/^[a-f0-9-]{20,}$/i.test(clean)) return true;
  if (/^guest_/i.test(clean)) return true;
  if (/^web_/i.test(clean)) return true;
  return false;
}

/**
 * Get or assign an Anon #N name for this user.
 * @param {string} platformUserId — canonical user ID (stable across sessions)
 * @returns {string} e.g. "Anon #42"
 */
function getAnonName(platformUserId) {
  load();
  if (!platformUserId) platformUserId = 'unknown_' + Math.random().toString(36).slice(2, 10);

  let num = registry[platformUserId];
  if (!num) {
    num = nextNumber++;
    registry[platformUserId] = num;
    save();
  }
  return `Anon #${num}`;
}

/**
 * Resolve a user's display name — if it's generic/missing, substitute Anon #N.
 * @param {object} user — object with displayName, username, id, platformUserId
 * @returns {string} the resolved display name
 */
function resolveDisplayName(user) {
  if (!user) return 'Anon #?';
  const raw = user.customNick || user.displayName || user.username || '';
  if (!isGenericName(raw)) return raw;
  return getAnonName(user.platformUserId || user.id);
}

module.exports = {
  getAnonName,
  resolveDisplayName,
  isGenericName,
  saveImmediate
};
