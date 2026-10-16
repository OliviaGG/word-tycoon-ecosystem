'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

function removeIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

function writeFileDurableSync(filePath, buffer) {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < buffer.length) {
      offset += fs.writeSync(fd, buffer, offset, buffer.length - offset, offset);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDirBestEffort(dirPath, strict = false) {
  let fd = null;
  try {
    fd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(fd);
  } catch (err) {
    if (strict && process.platform !== 'win32') throw err;
    const tolerated = new Set(['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM']);
    if (!tolerated.has(err?.code)) {
      console.warn(`[AtomicWrite] Directory fsync skipped for ${dirPath}: ${err.message}`);
    }
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function writeFileAtomicSync(targetPath, buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer');

  const tmpPath = (options.tmpPath || `${targetPath}.tmp`) + '.' + crypto.randomUUID();
  const dirPath = path.dirname(targetPath);
  let renamed = false;

  try {
    writeFileDurableSync(tmpPath, buffer);
    const stat = fs.statSync(tmpPath);
    if (typeof options.validateTmp === 'function') options.validateTmp(tmpPath, stat);
    fs.renameSync(tmpPath, targetPath);
    renamed = true;
    fsyncDirBestEffort(dirPath, options.strictDirectorySync);
  } catch (err) {
    if (!renamed) removeIfExists(tmpPath);
    throw err;
  }
}

module.exports = { writeFileAtomicSync };
