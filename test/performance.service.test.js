const assert = require('node:assert/strict');
const { test } = require('node:test');

const { HistoryService } = require('../src/services/history.service');
const {
  PerformanceService,
} = require('../src/services/performance.service');
const {
  createTemporaryDatabase,
} = require('../test-support/database-test.helper');

function increasingClock() {
  let tick = 0;

  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

function seedRun(history, {
  id,
  agentId = 'qwen-code',
  status = 'completed',
  evaluationScore = 100,
  verdict = 'pass',
  durationMs = 100,
  classification = { coding: 80 },
}) {
  history.createTask({
    id,
    task: `task ${id}`,
    mode: 'single',
    classification,
  });
  history.recordAgentRun({
    taskId: id,
    agentId,
    status,
    evaluationScore,
    verdict,
    durationMs,
  });
  history.completeTask(id, status);
}

test('global and recent statistics include failed runs as zero quality', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const history = new HistoryService({ database, clock: increasingClock() });
  const performance = new PerformanceService({ database, recentSampleSize: 2 });

  seedRun(history, { id: 'one', evaluationScore: 100, durationMs: 100 });
  seedRun(history, {
    id: 'two',
    status: 'completed_with_warnings',
    evaluationScore: 80,
    verdict: 'warning',
    durationMs: 200,
  });
  seedRun(history, {
    id: 'three',
    status: 'evaluation_failed',
    evaluationScore: 40,
    verdict: 'fail',
    durationMs: 300,
  });
  seedRun(history, {
    id: 'four',
    status: 'failed',
    evaluationScore: null,
    verdict: 'fail',
    durationMs: null,
  });

  assert.deepEqual(performance.getAgentGlobalStats('qwen-code'), {
    sampleSize: 4,
    averageEvaluationScore: 55,
    successRate: 0.5,
    passRate: 0.25,
    warningRate: 0.25,
    failureRate: 0.5,
    averageDurationMs: 200,
  });
  assert.deepEqual(performance.getAgentRecentStats('qwen-code'), {
    sampleSize: 2,
    averageEvaluationScore: 20,
    successRate: 0,
    passRate: 0,
    warningRate: 0,
    failureRate: 1,
    averageDurationMs: 300,
  });
});

test('category evaluation score is weighted by classification relevance', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const history = new HistoryService({ database, clock: increasingClock() });
  const performance = new PerformanceService({ database });

  seedRun(history, {
    id: 'strong-debug',
    evaluationScore: 100,
    classification: { debugging: 80 },
  });
  seedRun(history, {
    id: 'weak-debug',
    status: 'evaluation_failed',
    evaluationScore: 0,
    verdict: 'fail',
    classification: { debugging: 20 },
  });

  assert.deepEqual(
    performance.getAgentCategoryStats('qwen-code', 'debugging'),
    {
      sampleSize: 2,
      weightedEvaluationScore: 80,
      passRate: 0.5,
      averageDurationMs: 100,
    },
  );
});

test('multi-category joins count one run once per requested category', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const history = new HistoryService({ database, clock: increasingClock() });
  const performance = new PerformanceService({ database });

  seedRun(history, {
    id: 'multi-category',
    evaluationScore: 90,
    classification: { coding: 80, debugging: 70, git: 20 },
  });

  assert.equal(performance.getAgentGlobalStats('qwen-code').sampleSize, 1);
  assert.equal(
    performance.getAgentCategoryStats('qwen-code', 'coding').sampleSize,
    1,
  );
  assert.equal(
    performance.getAgentCategoryStats('qwen-code', 'debugging').sampleSize,
    1,
  );
});

test('performance services return explicit empty statistics for cold start', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const performance = new PerformanceService({ database });

  assert.deepEqual(performance.getAgentGlobalStats('opencode'), {
    sampleSize: 0,
    averageEvaluationScore: null,
    successRate: null,
    passRate: null,
    warningRate: null,
    failureRate: null,
    averageDurationMs: null,
  });
  assert.deepEqual(
    performance.getAgentCategoryStats('opencode', 'architecture'),
    {
      sampleSize: 0,
      weightedEvaluationScore: null,
      passRate: null,
      averageDurationMs: null,
    },
  );
});
