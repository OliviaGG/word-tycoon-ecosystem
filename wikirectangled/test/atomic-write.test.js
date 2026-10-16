'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomicSync } = require('../src/atomic-write');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wikirectangled-atomic-write-'));
}

describe('atomic database writes', () => {
  it('writes and replaces a file through a durable temporary file', () => {
    const dir = makeTempDir();
    const target = path.join(dir, 'game.db');
    const tmp = `${target}.tmp`;

    writeFileAtomicSync(target, Buffer.from('first'), { tmpPath: tmp });
    writeFileAtomicSync(target, Buffer.from('second'), { tmpPath: tmp });

    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'second');
    assert.strictEqual(fs.existsSync(tmp), false);
  });

  it('leaves the prior database in place when validation fails', () => {
    const dir = makeTempDir();
    const target = path.join(dir, 'game.db');
    const tmp = `${target}.tmp`;
    fs.writeFileSync(target, 'stable');

    assert.throws(() => writeFileAtomicSync(target, Buffer.from('bad'), {
      tmpPath: tmp,
      validateTmp() { throw new Error('invalid export'); },
    }), /invalid export/);

    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'stable');
    assert.strictEqual(fs.existsSync(tmp), false);
  });
});
