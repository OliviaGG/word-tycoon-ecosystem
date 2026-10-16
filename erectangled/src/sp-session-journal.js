'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const MODES = new Set(['daily', 'weekly', 'random', 'archive']);
function createSpSessionJournal({ directory, now = Date.now, ttl = 4 * 60 * 60 * 1000, max = 500,
  maxBytes = 512 * 1024, filesystem = fs } = {}) {
  const records = new Map(); let corrupt = 0;
  filesystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!filesystem.lstatSync(directory).isDirectory() || filesystem.lstatSync(directory).isSymbolicLink()) throw Error('Invalid session journal directory');
  function key(sid, mode) {
    if (typeof sid !== 'string' || !sid || sid.length > 256 || !MODES.has(mode)) return null;
    return crypto.createHash('sha256').update(mode + ':' + sid).digest('hex');
  }
  function syncDirectory() {
    let fd; try { fd = filesystem.openSync(directory, 'r'); filesystem.fsyncSync(fd); }
    catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'EBADF'].includes(error.code)) throw error; }
    finally { if (fd !== undefined) filesystem.closeSync(fd); }
  }
  function remove(id) { filesystem.unlinkSync(path.join(directory, id + '.json')); records.delete(id); }
  function prune() {
    for (const [id, record] of records) if (now() - record.lastAccess >= ttl) remove(id);
    while (records.size > max) remove(records.keys().next().value);
  }
  const names = filesystem.readdirSync(directory);
  if (names.length > 1500) throw Error('Session journal inventory requires review');
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    try {
      const file = path.join(directory, name), stat = filesystem.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw Error('Invalid session record');
      const record = JSON.parse(filesystem.readFileSync(file, 'utf8'));
      if (record.version !== 1 || record.key + '.json' !== name || !MODES.has(record.mode) ||
          !Number.isFinite(record.lastAccess) || record.lastAccess > now() + 60000 || !record.state || typeof record.state !== 'object') throw Error('Invalid session record');
      records.set(record.key, record);
    } catch { corrupt++; }
  }
  const ordered = [...records].sort((a, b) => a[1].lastAccess - b[1].lastAccess); records.clear();
  for (const [id, record] of ordered) records.set(id, record);
  prune();
  function write(record) {
    const buffer = Buffer.from(JSON.stringify(record)); if (buffer.length > maxBytes) throw Error('Session snapshot too large');
    const target = path.join(directory, record.key + '.json'), temp = target + '.tmp-' + crypto.randomBytes(8).toString('hex');
    let fd;
    try { fd = filesystem.openSync(temp, 'wx', 0o600); filesystem.writeFileSync(fd, buffer); filesystem.fsyncSync(fd); filesystem.closeSync(fd); fd = undefined;
      filesystem.renameSync(temp, target); syncDirectory();
    } finally { if (fd !== undefined) filesystem.closeSync(fd); try { filesystem.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    records.delete(record.key); records.set(record.key, record); prune();
  }
  function save(sid, mode, state, context = null) {
    const id = key(sid, mode); if (!id) throw Error('Invalid session identity');
    write({ version: 1, key: id, mode, lastAccess: now(), context, state: JSON.parse(JSON.stringify(state)) });
  }
  function get(sid, mode, context = null) {
    const id = key(sid, mode); if (!id) return null;
    const record = records.get(id); if (!record) return null;
    if (now() - record.lastAccess >= ttl) { remove(id); return null; }
    if (JSON.stringify(record.context) !== JSON.stringify(context)) return null;
    // Reads preserve LRU/idle lifetime in memory; the next accepted transition persists it.
    records.delete(id); records.set(id, { ...record, lastAccess: now() });
    return JSON.parse(JSON.stringify(record.state));
  }
  function touch(sid, mode) {
    const id = key(sid, mode), record = records.get(id); if (!record) return;
    if (now() - record.lastAccess >= ttl) { remove(id); return; }
    records.delete(id); records.set(id, { ...record, lastAccess: now() });
  }
  return { save, get, key, touch, prune, summary: () => ({ sessions: records.size, corrupt, max, ttl }) };
}
module.exports = { createSpSessionJournal };
