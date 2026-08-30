const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CompetitionService,
  CompetitionValidationError,
  normalizeAgentIds,
} = require('../src/services/competition.service');

const baseCommit = 'a'.repeat(40);
const repo = 'C:\\Projects\\competition-repo';

function agent(id, score, available = true) {
  return {
    id,
    name: id,
    score,
    available,
    command: id,
    executionCommand: `C:\\tools\\${id}.cmd`,
    executionArgs: [],
  };
}

function analysisWith(ranking = [
  agent('aider', 98, false),
  agent('opencode', 92),
  agent('qwen-code', 90),
]) {
  return {
    task: 'Improve input validation',
    classification: { coding: 80, debugging: 40 },
    recommendedAgent: ranking[0] || null,
    selectedAgent: ranking.find((entry) => entry.available) || null,
    ranking,
  };
}

function successfulResult(selectedAgent, taskId, durationMs = 100) {
  return {
    status: 'completed',
    taskId,
    selectedAgent,
    workspace: {
      branch: `agent/${taskId}-${selectedAgent.id}`,
      worktree: `C:\\worktrees\\${taskId}-${selectedAgent.id}`,
      baseCommit,
    },
    execution: { durationMs },
    changes: {
      count: 1,
      files: [{ status: ' M', file: 'README.md' }],
      untrackedFiles: [],
      diffRedacted: false,
      autoCommitDetected: false,
    },
    evaluation: {
      score: 100,
      verdict: 'pass',
      diff: { trackedDiffBytes: 100, diffTooLarge: false },
    },
  };
}

function createHarness({
  enabled = true,
  analysis = analysisWith(),
  maxAgents = 3,
  execute,
} = {}) {
  const calls = {
    analyze: 0,
    validate: 0,
    execute: [],
  };
  const executor = {
    isExecutionEnabled: () => enabled,
    validateRepository: async () => {
      calls.validate += 1;
      return {
        requestedWorkspace: repo,
        repo,
        targetBranch: 'main',
        baseCommit,
      };
    },
    executeWithAgent: async (input) => {
      calls.execute.push(input);

      if (execute) {
        return execute(input, calls);
      }

      return successfulResult(input.agent, input.taskId);
    },
  };
  const service = new CompetitionService({
    router: {
      analyzeTask: async () => {
        calls.analyze += 1;
        return analysis;
      },
    },
    executor,
    maxAgents,
    executionMode: 'sequential',
    idFactory: () => 'competition123',
  });

  return { calls, executor, service };
}

test('competition analyzes once and captures the repository once', async () => {
  const { calls, service } = createHarness();

  await service.compete({ task: 'task', workspace: repo });

  assert.equal(calls.analyze, 1);
  assert.equal(calls.validate, 1);
});

test('every candidate receives the same base commit and competition ID', async () => {
  const { calls, service } = createHarness();

  await service.compete({ task: 'task', workspace: repo });

  assert.ok(calls.execute.every((call) => call.repository.baseCommit === baseCommit));
  assert.ok(calls.execute.every((call) => call.taskId === 'competition123'));
});

test('candidate worktrees and branches remain agent-specific', async () => {
  const { service } = createHarness();
  const result = await service.compete({ task: 'task', workspace: repo });

  assert.equal(new Set(result.candidates.map((item) => item.branch)).size, 2);
  assert.equal(new Set(result.candidates.map((item) => item.worktree)).size, 2);
  assert.ok(result.candidates.every((item) => item.baseCommit === baseCommit));
});

test('candidate execution is strictly sequential', async () => {
  const events = [];
  const { service } = createHarness({
    execute: async (input) => {
      events.push(`start:${input.agent.id}`);
      await Promise.resolve();
      events.push(`end:${input.agent.id}`);
      return successfulResult(input.agent, input.taskId);
    },
  });

  await service.compete({ task: 'task', workspace: repo });

  assert.deepEqual(events, [
    'start:opencode',
    'end:opencode',
    'start:qwen-code',
    'end:qwen-code',
  ]);
});

test('one agent failure does not abort remaining candidates', async () => {
  const { calls, service } = createHarness({
    execute: async (input) => {
      if (input.agent.id === 'opencode') {
        throw new Error('simulated failure');
      }

      return successfulResult(input.agent, input.taskId);
    },
  });

  const result = await service.compete({ task: 'task', workspace: repo });

  assert.equal(calls.execute.length, 2);
  assert.equal(result.candidates[0].status, 'failed');
  assert.equal(result.candidates[1].status, 'completed');
  assert.equal(result.winner.agentId, 'qwen-code');
});

test('explicit unavailable agent is rejected', async () => {
  const { service } = createHarness();

  await assert.rejects(
    () => service.compete({
      task: 'task',
      workspace: repo,
      agentIds: ['opencode', 'aider'],
    }),
    (error) => error instanceof CompetitionValidationError
      && error.code === 'AGENT_UNAVAILABLE',
  );
});

test('unknown agent is rejected', async () => {
  const { service } = createHarness();

  await assert.rejects(
    () => service.compete({
      task: 'task',
      workspace: repo,
      agentIds: ['opencode', 'unknown'],
    }),
    (error) => error.code === 'UNKNOWN_AGENT',
  );
});

test('duplicate normalized agent IDs are rejected', async () => {
  const { service } = createHarness();

  await assert.rejects(
    () => service.compete({
      task: 'task',
      workspace: repo,
      agentIds: ['opencode', ' OpenCode '],
    }),
    (error) => error.code === 'DUPLICATE_AGENT_ID',
  );
});

test('explicit lists larger than configured maximum are rejected', async () => {
  const ranking = [agent('one', 90), agent('two', 80), agent('three', 70)];
  const { service } = createHarness({
    analysis: analysisWith(ranking),
    maxAgents: 2,
  });

  await assert.rejects(
    () => service.compete({
      task: 'task',
      workspace: repo,
      agentIds: ['one', 'two', 'three'],
    }),
    (error) => error.code === 'TOO_MANY_AGENTS',
  );
});

test('fewer than two competitors returns without repository or execution work', async () => {
  const { calls, service } = createHarness({
    analysis: analysisWith([agent('opencode', 90)]),
  });

  const result = await service.compete({ task: 'task', workspace: repo });

  assert.equal(result.status, 'insufficient_competitors');
  assert.equal(calls.validate, 0);
  assert.equal(calls.execute.length, 0);
});

test('execution-disabled competition creates no analysis or worktrees', async () => {
  const { calls, service } = createHarness({ enabled: false });

  const result = await service.compete({ task: 'task', workspace: repo });

  assert.equal(result.status, 'execution_disabled');
  assert.equal(calls.analyze, 0);
  assert.equal(calls.validate, 0);
  assert.equal(calls.execute.length, 0);
});

test('execution-disabled competition still rejects malformed agent lists', async () => {
  const { calls, service } = createHarness({ enabled: false });

  await assert.rejects(
    () => service.compete({
      task: 'task',
      workspace: repo,
      agentIds: ['opencode', ' OpenCode '],
    }),
    (error) => error.code === 'DUPLICATE_AGENT_ID',
  );
  assert.equal(calls.analyze, 0);
  assert.equal(calls.validate, 0);
});

test('implicit candidates follow available router ranking up to max agents', async () => {
  const ranking = [
    agent('first', 99),
    agent('unavailable', 98, false),
    agent('second', 90),
    agent('third', 80),
  ];
  const { service } = createHarness({
    analysis: analysisWith(ranking),
    maxAgents: 2,
  });

  const result = await service.compete({ task: 'task', workspace: repo });

  assert.deepEqual(result.executionOrder, ['first', 'second']);
});

test('explicit candidate order is preserved', async () => {
  const { service } = createHarness();
  const result = await service.compete({
    task: 'task',
    workspace: repo,
    agentIds: ['qwen-code', 'opencode'],
  });

  assert.deepEqual(result.executionOrder, ['qwen-code', 'opencode']);
});

test('winner is selected only from eligible candidate statuses', async () => {
  const { service } = createHarness({
    execute: async (input) => {
      const result = successfulResult(input.agent, input.taskId);

      if (input.agent.id === 'opencode') {
        result.status = 'evaluation_failed';
        result.evaluation.score = 100;
      } else {
        result.evaluation.score = 75;
      }

      return result;
    },
  });

  const result = await service.compete({ task: 'task', workspace: repo });

  assert.equal(result.winner.agentId, 'qwen-code');
});

test('agent list normalization is defensive and deterministic', () => {
  assert.deepEqual(normalizeAgentIds([' QWEN-CODE ', 'opencode']), [
    'qwen-code',
    'opencode',
  ]);
  assert.throws(() => normalizeAgentIds('opencode'), /must be an array/);
  assert.throws(() => normalizeAgentIds(['']), /non-empty string/);
});
