const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  config,
  parseCompetitionExecutionMode,
  parseBoolean,
  parseDatabasePath,
  parseNonNegativeNumber,
  parsePositiveNumber,
  parseDockerMemory,
  parseSandboxImage,
  parseOptionalPath,
  parsePositiveInteger,
  validateAdaptiveWeights,
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

test('adaptive routing configuration uses deterministic validated defaults', () => {
  assert.equal(config.database.path, ':memory:');
  assert.equal(config.adaptiveRouting.enabled, true);
  assert.deepEqual(config.adaptiveRouting.weights, {
    static: 0.5,
    history: 0.3,
    recent: 0.2,
  });
  assert.equal(config.adaptiveRouting.minSamples, 3);
  assert.equal(config.adaptiveRouting.recentSampleSize, 10);
  assert.equal(parseDatabasePath(undefined), './data/agent-router.db');
  assert.throws(() => parseDatabasePath('   '), /non-empty string/);
  assert.throws(
    () => validateAdaptiveWeights({ static: 0.5, history: 0.5, recent: 0.5 }),
    /sum to 1.0/,
  );
});

test('sandbox configuration uses bounded validated defaults', () => {
  assert.equal(config.sandbox.enabled, true);
  assert.equal(config.sandbox.image, 'local-agent-router/node-sandbox:1');
  assert.equal(config.sandbox.memory, '2g');
  assert.equal(config.sandbox.cpus, 2);
  assert.equal(config.sandbox.pidsLimit, 256);
  assert.equal(config.sandbox.timeoutMs, 300_000);
  assert.equal(config.sandbox.installTimeoutMs, 300_000);
  assert.equal(config.sandbox.installDependencies, true);
  assert.equal(config.sandbox.keepRuns, false);
  assert.equal(config.sandbox.runRoot, './.sandbox-runs');
  assert.equal(parsePositiveNumber('1.5', 1, 'CPU'), 1.5);
  assert.throws(() => parsePositiveNumber('0', 1, 'CPU'), /positive number/);
  assert.equal(parseDockerMemory('512m'), '512m');
  assert.throws(() => parseDockerMemory('--privileged'), /memory value/);
  assert.equal(parseSandboxImage('safe/image:1'), 'safe/image:1');
  assert.throws(() => parseSandboxImage('--privileged'), /image reference/);
});
