const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeUsername, validateUsername } = require('../src/username-moderation');

test('sanitizeUsername strips unsupported characters and trims whitespace', () => {
  assert.equal(sanitizeUsername('  <Bad>Name!!  ', 20), 'BadName');
});

test('validateUsername accepts normal usernames', () => {
  const result = validateUsername('Maggie Rose', { maxLength: 20 });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized, 'Maggie Rose');
});

test('validateUsername blocks exact blocked words as standalone tokens', () => {
  const result = validateUsername('hell rider', { maxLength: 20 });
  assert.equal(result.valid, false);
  assert.equal(result.code, 'blocked');
});

test('validateUsername does not block innocent substrings', () => {
  const result = validateUsername('ClassicPlayer', { maxLength: 20 });
  assert.equal(result.valid, true);
});

test('validateUsername blocks obfuscated profanity fragments', () => {
  const result = validateUsername('sh1tlord', { maxLength: 20 });
  assert.equal(result.valid, false);
  assert.equal(result.code, 'blocked');
});

test('validateUsername blocks stretched profanity patterns', () => {
  const result = validateUsername('fuuuckyeah', { maxLength: 20 });
  assert.equal(result.valid, false);
  assert.equal(result.code, 'blocked');
});
