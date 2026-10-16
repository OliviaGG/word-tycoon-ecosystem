'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function createPrivateStore(directory, { fsImpl = fs, maxBytes = 16 * 1024 * 1024 } = {}) {
  let blocked = false;
  if (!fsImpl.existsSync(directory)) fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'state.json');
  function regular(file, isDirectory = false) {
    const stat = fsImpl.lstatSync(file);
    if (stat.isSymbolicLink() || !(isDirectory ? stat.isDirectory() : stat.isFile())
        || (!isDirectory && stat.size > maxBytes) || (process.platform !== 'win32' && (stat.mode & 0o077))) throw Error('Unsafe solo store');
  }
  regular(directory, true);
  function read() {
    if (blocked) throw Error('Solo storage requires recovery');
    if (!fsImpl.existsSync(filename)) return null;
    regular(filename); return JSON.parse(fsImpl.readFileSync(filename, 'utf8'));
  }
  function write(value) {
    if (blocked) throw Error('Solo storage requires recovery');
    regular(directory, true);
    if (fsImpl.existsSync(filename)) regular(filename);
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > maxBytes) throw Error('Solo storage capacity reached');
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    let fd, renamed = false;
    try {
      fd = fsImpl.openSync(temporary, 'wx', 0o600); fsImpl.writeFileSync(fd, bytes); fsImpl.fsyncSync(fd);
      fsImpl.closeSync(fd); fd = undefined; fsImpl.renameSync(temporary, filename); renamed = true;
      if (process.platform !== 'win32') {
        const dirFd = fsImpl.openSync(directory, 'r');
        try { fsImpl.fsyncSync(dirFd); } finally { fsImpl.closeSync(dirFd); }
      }
    } catch (error) { if (renamed) blocked = true; throw error; }
    finally { if (fd !== undefined) fsImpl.closeSync(fd); if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary); }
  }
  return { read, write };
}
module.exports = { createPrivateStore };
