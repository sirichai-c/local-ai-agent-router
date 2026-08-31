const assert = require('node:assert/strict');
const { test } = require('node:test');

const agentDefinitions = require('../src/config/agents');
const {
  AdaptiveScorerService,
} = require('../src/services/adaptive-scorer.service');
const { HistoryService } = require('../src/services/history.service');
const { PerformanceService } = require('../src/services/performance.service');
const { RouterService } = require('../src/services/router.service');
const {
  createTemporaryDatabase,
} = require('../test-support/database-test.helper');

function registryAgents() {
  return agentDefinitions
    .filter((agent) => ['opencode', 'qwen-code'].includes(agent.id))
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      capabilityScores: { ...agent.capabilityScores },
      installed: true,
      available: true,
      command: agent.commands[0],
      executablePath: `/tools/${agent.commands[0]}`,
      executionCommand: `/tools/${agent.commands[0]}`,
      executionArgs: [],
    }));
}

function seedArchitectureHistory(history, agentId, evaluationScore) {
  for (let index = 1; index <= 3; index += 1) {
    const taskId = `${agentId}-${index}`;
    const passed = evaluationScore >= 90;

    history.createTask({
      id: taskId,
      task: 'design backend architecture',
      mode: 'single',
      classification: { architecture: 90 },
    });
    history.recordAgentRun({
      taskId,
      agentId,
      status: passed ? 'completed' : 'evaluation_failed',
      evaluationScore,
      verdict: passed ? 'pass' : 'fail',
      durationMs: 1_000,
    });
    history.completeTask(taskId, passed ? 'completed' : 'evaluation_failed');
  }
}

test('real historical evidence can adapt ranking while disabled mode stays static', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const history = new HistoryService({ database });
  const performance = new PerformanceService({
    database,
    recentSampleSize: 10,
  });
  const registry = { getAgents: async () => registryAgents() };

  seedArchitectureHistory(history, 'opencode', 0);
  seedArchitectureHistory(history, 'qwen-code', 100);

  const adaptiveRouter = new RouterService({
    registry,
    adaptiveScorer: new AdaptiveScorerService({
      performance,
      enabled: true,
      weights: { static: 0.5, history: 0.3, recent: 0.2 },
      minSamples: 3,
      recentSampleSize: 10,
    }),
  });
  const staticRouter = new RouterService({
    registry,
    adaptiveScorer: new AdaptiveScorerService({
      performance,
      enabled: false,
    }),
  });
  const task = 'Design the architecture of this backend';
  const adaptiveResult = await adaptiveRouter.analyzeTask(task);
  const staticResult = await staticRouter.analyzeTask(task);

  assert.equal(staticResult.recommendedAgent.id, 'opencode');
  assert.equal(staticResult.ranking[0].score, 95);
  assert.equal(staticResult.ranking[0].adaptive, false);
  assert.equal(adaptiveResult.recommendedAgent.id, 'qwen-code');
  assert.equal(adaptiveResult.ranking[0].staticScore, 89.75);
  assert.equal(adaptiveResult.ranking[0].historicalScore, 100);
  assert.equal(adaptiveResult.ranking[0].recentScore, 100);
  assert.equal(adaptiveResult.ranking[0].score, 94.88);
  assert.equal(adaptiveResult.ranking[0].adaptive, true);
});
