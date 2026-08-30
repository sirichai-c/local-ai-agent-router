const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  parseBoolean,
  parseOptionalPath,
  parsePositiveInteger,
} = require('../src/config/env');

test('execution gate enables only for the exact true value', () => {
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('false'), false);
  assert.equal(parseBoolean('TRUE'), false);
  assert.equal(parseBoolean(undefined), false);
});

test('positive execution limits reject invalid configuration', () => {
  assert.equal(parsePositiveInteger(undefined, 100, 'LIMIT'), 100);
  assert.equal(parsePositiveInteger('250', 100, 'LIMIT'), 250);
  assert.throws(
    () => parsePositiveInteger('0', 100, 'LIMIT'),
    /LIMIT must be a positive integer/,
  );
});

test('optional worktree root keeps an empty value disabled', () => {
  assert.equal(parseOptionalPath(undefined), null);
  assert.equal(parseOptionalPath('  '), null);
  assert.equal(parseOptionalPath(' C:\\worktrees '), 'C:\\worktrees');
});
