const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { DiffEvaluator } = require('../src/evaluators/diff.evaluator');

const workspace = path.resolve('C:\\Projects\\evaluator-worktree');

function evaluate(overrides = {}, options = {}) {
  return new DiffEvaluator(options).evaluate({
    workspace,
    changedFiles: [{ status: ' M', file: 'README.md' }],
    trackedDiff: 'small diff',
    untrackedFiles: [],
    ...overrides,
  });
}

test('diff evaluator counts one small changed file', () => {
  const result = evaluate();

  assert.equal(result.changedFileCount, 1);
  assert.equal(result.trackedDiffBytes, Buffer.byteLength('small diff', 'utf8'));
  assert.equal(result.tooManyFiles, false);
  assert.equal(result.diffTooLarge, false);
});

test('diff evaluator flags too many files', () => {
  const result = evaluate({
    changedFiles: [
      { status: ' M', file: 'one.js' },
      { status: ' M', file: 'two.js' },
    ],
  }, { maxChangedFiles: 1 });

  assert.equal(result.changedFileCount, 2);
  assert.equal(result.tooManyFiles, true);
});

test('diff evaluator measures UTF-8 bytes and flags oversized diff', () => {
  const trackedDiff = 'ก'.repeat(4);
  const result = evaluate({ trackedDiff }, { maxDiffBytes: 10 });

  assert.equal(result.trackedDiffBytes, 12);
  assert.equal(result.diffTooLarge, true);
});

test('sensitive dotenv and private key paths are critical', () => {
  const result = evaluate({
    changedFiles: [
      { status: ' M', file: '.env' },
      { status: '??', file: 'certs/private.pem' },
    ],
    untrackedFiles: ['certs/private.pem'],
  });

  assert.deepEqual(
    result.sensitiveFiles.map((file) => file.path),
    ['.env', 'certs/private.pem'],
  );
  assert.equal(result.sensitiveFiles.every((file) => file.severity === 'critical'), true);
});

test('.env.example is allowed by the sensitive filename policy', () => {
  const result = evaluate({
    changedFiles: [{ status: ' M', file: '.env.example' }],
  });

  assert.deepEqual(result.sensitiveFiles, []);
});

test('untracked sensitive files are counted and detected', () => {
  const result = evaluate({
    changedFiles: [{ status: '??', file: 'credentials.json' }],
    trackedDiff: '',
    untrackedFiles: ['credentials.json'],
  });

  assert.equal(result.changedFileCount, 1);
  assert.deepEqual(result.untrackedFiles, ['credentials.json']);
  assert.equal(result.sensitiveFiles[0].rule, 'credential-json');
});

test('path traversal is reported as a critical unsafe path', () => {
  const result = evaluate({
    changedFiles: [{ status: '??', file: '../../outside.js' }],
    trackedDiff: '',
    untrackedFiles: ['../../outside.js'],
  });

  assert.equal(result.unsafePaths.length, 1);
  assert.equal(result.unsafePaths[0].rule, 'UNSAFE_WORKSPACE_PATH');
});
