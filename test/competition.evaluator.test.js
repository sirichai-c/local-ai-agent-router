const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CompetitionEvaluator,
} = require('../src/evaluators/competition.evaluator');

const evaluator = new CompetitionEvaluator({
  weights: { quality: 0.7, router: 0.2, speed: 0.1 },
});

function candidate({
  id,
  status = 'completed',
  quality = 100,
  router = 80,
  duration = 100,
} = {}) {
  return {
    agent: { id, name: id },
    status,
    routerScore: router,
    durationMs: duration,
    evaluation: { score: quality },
    branch: `agent/task-${id}`,
    worktree: `C:\\worktrees\\task-${id}`,
    baseCommit: 'a'.repeat(40),
  };
}

test('competition score combines quality, router suitability, and speed', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'opencode', quality: 100, router: 80, duration: 100 }),
  ]);

  assert.equal(result.ranking[0].competitionScore, 96);
  assert.equal(result.ranking[0].speedScore, 100);
});

test('quality dominates a higher router score', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'quality', quality: 100, router: 50, duration: 100 }),
    candidate({ id: 'router', quality: 70, router: 100, duration: 100 }),
  ]);

  assert.equal(result.winner.agentId, 'quality');
});

test('a fast failed candidate is capped and cannot win', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'failed', status: 'failed', duration: 10 }),
    candidate({ id: 'valid', quality: 80, duration: 100 }),
  ]);
  const failed = result.ranking.find((entry) => entry.agentId === 'failed');

  assert.equal(failed.competitionScore, 40);
  assert.equal(failed.eligible, false);
  assert.equal(result.winner.agentId, 'valid');
});

test('evaluation_failed candidate is capped and ineligible', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'unsafe', status: 'evaluation_failed', quality: 100 }),
    candidate({ id: 'safe', quality: 70 }),
  ]);
  const unsafe = result.ranking.find((entry) => entry.agentId === 'unsafe');

  assert.equal(unsafe.competitionScore, 60);
  assert.equal(unsafe.eligible, false);
  assert.equal(result.winner.agentId, 'safe');
});

test('completed_with_warnings candidate remains eligible', () => {
  const result = evaluator.evaluate([
    candidate({
      id: 'warning',
      status: 'completed_with_warnings',
      quality: 89,
    }),
    candidate({ id: 'failed', status: 'failed', quality: 100 }),
  ]);

  assert.equal(result.winner.agentId, 'warning');
});

test('missing or invalid duration receives a zero speed score', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'known', duration: 100 }),
    candidate({ id: 'missing', duration: null }),
  ]);
  const missing = result.ranking.find((entry) => entry.agentId === 'missing');

  assert.equal(missing.speedScore, 0);
  assert.equal(missing.durationMs, null);
});

test('relative speed gives an agent twice as slow a score of 50', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'fast', duration: 100 }),
    candidate({ id: 'slow', duration: 200 }),
  ]);
  const slow = result.ranking.find((entry) => entry.agentId === 'slow');

  assert.equal(slow.speedScore, 50);
});

test('ties use agent ID as the final deterministic tiebreaker', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'qwen-code' }),
    candidate({ id: 'opencode' }),
  ]);

  assert.deepEqual(
    result.ranking.map((entry) => entry.agentId),
    ['opencode', 'qwen-code'],
  );
});

test('all failed candidates produce no winner', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'a', status: 'failed' }),
    candidate({ id: 'b', status: 'evaluation_failed' }),
  ]);

  assert.equal(result.status, 'no_valid_candidate');
  assert.equal(result.winner, null);
});

test('input dimensions and final score are clamped to 0-100', () => {
  const result = evaluator.evaluate([
    candidate({ id: 'high', quality: 500, router: 500 }),
    candidate({ id: 'low', quality: -50, router: -50 }),
  ]);

  assert.equal(result.ranking[0].competitionScore, 100);
  assert.ok(result.ranking.every((entry) => (
    entry.competitionScore >= 0 && entry.competitionScore <= 100
  )));
});
