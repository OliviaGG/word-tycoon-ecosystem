'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

function removeIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

function writeFileDurableSync(filePath, buffer) {
  const fd = fs.openSync(filePath, 'w');
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

function fsyncDirBestEffort(dirPath) {
  let fd = null;
  try {
    fd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(fd);
  } catch (err) {
    // Windows and some filesystems do not support fsync on directories.
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
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('buffer must be a Buffer');
  }

  const tmpPath = options.tmpPath || `${targetPath}.tmp`;
  const dirPath = path.dirname(targetPath);
  let renamed = false;

  try {
    writeFileDurableSync(tmpPath, buffer);
    const stat = fs.statSync(tmpPath);
    if (typeof options.validateTmp === 'function') {
      options.validateTmp(tmpPath, stat);
    }
    fs.renameSync(tmpPath, targetPath);
    renamed = true;
    fsyncDirBestEffort(dirPath);
  } catch (err) {
    if (!renamed) removeIfExists(tmpPath);
    throw err;
  }
}

async function writeFileDurable(filePath, buffer) {
  const fd = await fsp.open(filePath, 'w');
  try {
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await fd.write(buffer, offset, buffer.length - offset, offset);
      offset += bytesWritten;
    }
    await fd.sync();
  } finally {
    await fd.close();
  }
}

async function fsyncDirBestEffortAsync(dirPath) {
  let fd = null;
  try {
    fd = await fsp.open(dirPath, 'r');
    await fd.sync();
  } catch (err) {
    const tolerated = new Set(['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM']);
    if (!tolerated.has(err?.code)) {
      console.warn(`[AtomicWrite] Directory fsync skipped for ${dirPath}: ${err.message}`);
    }
  } finally {
    if (fd != null) {
      try { await fd.close(); } catch (_) {}
    }
  }
}

async function writeFileAtomic(targetPath, buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('buffer must be a Buffer');
  }

  const tmpPath = options.tmpPath || `${targetPath}.tmp`;
  const dirPath = path.dirname(targetPath);
  let renamed = false;

  try {
    await writeFileDurable(tmpPath, buffer);
    const stat = await fsp.stat(tmpPath);
    if (typeof options.validateTmp === 'function') {
      options.validateTmp(tmpPath, stat);
    }
    await fsp.rename(tmpPath, targetPath);
    renamed = true;
    await fsyncDirBestEffortAsync(dirPath);
  } catch (err) {
    if (!renamed) {
      try { await fsp.unlink(tmpPath); } catch (_) {}
    }
    throw err;
  }
}

module.exports = {
  writeFileAtomicSync,
  writeFileDurableSync,
  fsyncDirBestEffort,
  removeIfExists,
  writeFileAtomic,
  writeFileDurable,
  fsyncDirBestEffortAsync
};
