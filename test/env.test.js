const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  config,
  parseCompetitionExecutionMode,
  parseBoolean,
  parseNonNegativeNumber,
  parseOptionalPath,
  parsePositiveInteger,
  validateCompetitionWeights,
} = require('../src/config/env');

test('evaluator defaults keep project scripts disabled and limits bounded', () => {
  assert.equal(config.evaluator.runProjectScripts, false);
  assert.equal(config.evaluator.maxChangedFiles, 50);
  assert.equal(config.evaluator.maxDiffBytes, 524_288);
});

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

test('competition configuration uses validated sequential defaults', () => {
  assert.equal(config.competition.maxAgents, 3);
  assert.equal(config.competition.executionMode, 'sequential');
  assert.deepEqual(config.competition.weights, {
    quality: 0.7,
    router: 0.2,
    speed: 0.1,
  });
});

test('competition configuration rejects unsafe modes and invalid weights', () => {
  assert.equal(parseCompetitionExecutionMode(undefined), 'sequential');
  assert.throws(
    () => parseCompetitionExecutionMode('parallel'),
    /must be sequential/,
  );
  assert.equal(parseNonNegativeNumber('0.25', 0, 'WEIGHT'), 0.25);
  assert.throws(
    () => parseNonNegativeNumber('-1', 0, 'WEIGHT'),
    /non-negative number/,
  );
  assert.throws(
    () => validateCompetitionWeights({ quality: 0.5, router: 0.5, speed: 0.5 }),
    /sum to 1.0/,
  );
});
