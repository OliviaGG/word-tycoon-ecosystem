'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, decode } = require('../scripts/solo-content-wire.cjs');
test('transport round trip preserves exact JSON bytes including integer-like keys', () => {
  const entries = [['music', 1], ['2', 2], ['song', 3], ['1', 4]];
  const payload = { targetWord: 'music', rankings: Object.fromEntries(entries), totalRankedWords: 4 };
  const vocabulary = Object.keys(payload.rankings).sort();
  const restored = decode(encode(payload, vocabulary), vocabulary, 'music');
  assert.equal(restored.toString(), JSON.stringify(payload));
});
test('missing words, duplicate ranks and truncated transport cannot silently change a puzzle', () => {
  const payload = { targetWord: 'music', rankings: { music: 1, song: 2 }, totalRankedWords: 2 };
  assert.throws(() => encode(payload, ['music', 'missing']), /Invalid/);
  assert.throws(() => encode({ ...payload, rankings: { music: 1, song: 1 } }, ['music', 'song']), /Invalid/);
  assert.throws(() => decode(Buffer.alloc(4), ['music', 'song'], 'music'), /length/);
  const bytes = Buffer.alloc(8); bytes.writeUInt32LE(1, 0); bytes.writeUInt32LE(1, 4);
  assert.throws(() => decode(bytes, ['music', 'song'], 'music'), /duplicate/);
});
