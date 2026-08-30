const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ScoreEvaluator } = require('../src/evaluators/score.evaluator');

function createEvidence(overrides = {}) {
  return {
    execution: {
      exitCode: 0,
      timedOut: false,
      outputTruncated: false,
      ...(overrides.execution || {}),
    },
    diff: {
      changedFileCount: 1,
      sensitiveFiles: [],
      unsafePaths: [],
      tooManyFiles: false,
      diffTooLarge: false,
      ...(overrides.diff || {}),
    },
    staticChecks: overrides.staticChecks || [],
    project: overrides.project || {
      packageJson: { exists: false, valid: null },
      scripts: {},
    },
    unexpectedCommit: overrides.unexpectedCommit || false,
  };
}

test('perfect evidence receives a passing score', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence());

  assert.equal(result.score, 100);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.hardFail, false);
});

test('no changes produces a deterministic warning', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    diff: { changedFileCount: 0 },
  }));

  assert.equal(result.score, 80);
  assert.equal(result.verdict, 'warning');
});

test('a failed changed-file static check forces a fail verdict', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    staticChecks: [{
      file: 'src/broken.js',
      type: 'javascript-syntax',
      passed: false,
      code: 'INVALID_JAVASCRIPT_SYNTAX',
    }],
  }));

  assert.equal(result.score, 80);
  assert.equal(result.verdict, 'fail');
});

test('a sensitive file modification is a hard fail', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    diff: {
      changedFileCount: 1,
      sensitiveFiles: [{ path: '.env', rule: 'dotenv-file' }],
    },
  }));

  assert.equal(result.score, 50);
  assert.equal(result.verdict, 'fail');
  assert.equal(result.hardFail, true);
});

test('timeout is a hard fail', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    execution: { exitCode: null, timedOut: true },
  }));

  assert.equal(result.verdict, 'fail');
  assert.equal(result.hardFailCodes.includes('AGENT_TIMEOUT'), true);
});

test('unexpected agent commit is a hard fail even at threshold score', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    unexpectedCommit: true,
  }));

  assert.equal(result.score, 70);
  assert.equal(result.verdict, 'fail');
  assert.equal(result.hardFail, true);
});

test('output truncation receives only the documented small deduction', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    execution: { outputTruncated: true },
  }));

  assert.equal(result.score, 95);
  assert.equal(result.verdict, 'pass');
});

test('skipped project scripts do not reduce score', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    project: {
      packageJson: { exists: true, valid: true },
      scripts: {
        test: {
          available: true,
          executed: false,
          passed: null,
          reason: 'disabled',
        },
      },
    },
  }));

  assert.equal(result.score, 100);
  assert.equal(
    result.reasons.some((reason) => reason.code === 'PROJECT_CHECK_SKIPPED'),
    true,
  );
});

test('an executed failing project check reduces score', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    project: {
      packageJson: { exists: true, valid: true },
      scripts: {
        test: {
          available: true,
          executed: true,
          passed: false,
        },
      },
    },
  }));

  assert.equal(result.score, 80);
  assert.equal(result.verdict, 'warning');
});

test('invalid package.json receives the documented deduction', () => {
  const result = new ScoreEvaluator().evaluate(createEvidence({
    project: {
      packageJson: { exists: true, valid: false },
      scripts: {},
    },
  }));

  assert.equal(result.score, 70);
  assert.equal(result.verdict, 'warning');
});

test('score is clamped between zero and one hundred', () => {
  const sensitiveFiles = Array.from({ length: 5 }, (_, index) => ({
    path: `.env.${index}`,
    rule: 'dotenv-file',
  }));
  const result = new ScoreEvaluator().evaluate(createEvidence({
    diff: { changedFileCount: 5, sensitiveFiles },
  }));

  assert.equal(result.score, 0);
});
