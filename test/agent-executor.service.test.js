const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AgentExecutorService,
  RepositoryValidationError,
} = require('../src/services/agent-executor.service');
const { GitCommandError } = require('../src/services/git.service');
const {
  HistoryPersistenceError,
  HistoryService,
} = require('../src/services/history.service');
const {
  createTemporaryDatabase,
} = require('../test-support/database-test.helper');
const { ExecutionCancelledError } = require('../src/services/cancellation.service');

const repo = 'C:\\Projects\\disposable';
const worktreePath = 'C:\\Projects\\.agent-worktrees\\disposable\\task-opencode';
const baseCommit = 'a'.repeat(40);

function createAnalysis(selectedAgent = true) {
  return {
    task: 'Add a Local Development section to README.md only.',
    classification: { coding: 40, smallChange: 80 },
    recommendedAgent: { id: 'aider' },
    selectedAgent: selectedAgent
      ? {
        id: 'opencode',
        name: 'OpenCode',
        command: 'opencode',
        executionCommand: 'C:\\tools\\opencode.exe',
        executionArgs: [],
        available: true,
      }
      : null,
    ranking: [],
  };
}

function createService(overrides = {}) {
  const {
    git: gitOverrides = {},
    ...serviceOverrides
  } = overrides;
  const analysis = createAnalysis();
  const git = {
    getRepoRoot: async () => repo,
    getCurrentBranch: async () => 'main',
    getHeadCommit: async () => baseCommit,
    isClean: async () => true,
    getChangedFiles: async () => [{ status: ' M', file: 'README.md' }],
    getDiff: async () => 'diff --git a/README.md b/README.md',
    getUntrackedFiles: async () => [],
    ...gitOverrides,
  };

  return new AgentExecutorService({
    router: { analyzeTask: async () => analysis },
    adapterResolver: () => ({
      buildInvocation: (input) => ({
        command: input.executionCommand,
        args: [input.task],
        cwd: input.workspace,
        env: {},
      }),
    }),
    workspaceResolver: async () => repo,
    git,
    worktrees: {
      create: async (input) => ({
        taskId: input.taskId || 'task123',
        repo,
        worktreePath,
        branch: `agent/${input.taskId || 'task123'}-opencode`,
        baseCommit,
      }),
    },
    runner: {
      runProcess: async (invocation) => ({
        ...invocation,
        exitCode: 0,
        timedOut: false,
        outputTruncated: false,
        stdout: 'done',
        stderr: '',
        error: null,
      }),
    },
    evaluator: {
      evaluateAgentResult: async () => ({
        score: 100,
        verdict: 'pass',
        summary: { changedFileCount: 1 },
      }),
    },
    fingerprints: {
      capture: async () => ({
        fingerprint: `sha256:${'a'.repeat(64)}`,
      }),
    },
    history: {
      createTask: async () => {},
      recordExecutionResult: async () => 1,
      completeTask: async () => {},
    },
    executionEnabled: true,
    model: 'qwen3:8b',
    ollamaBaseUrl: 'http://localhost:11434',
    clock: (() => {
      const times = [
        new Date('2026-08-30T00:00:00.000Z'),
        new Date('2026-08-30T00:00:01.250Z'),
      ];
      return () => times.shift();
    })(),
    idFactory: () => 'task123',
    ...serviceOverrides,
  });
}

test('execution gate returns before repository or process access', async () => {
  let repositoryInspected = false;
  let processStarted = false;
  const service = createService({
    executionEnabled: false,
    workspaceResolver: async () => {
      repositoryInspected = true;
      return repo;
    },
    runner: {
      runProcess: async () => {
        processStarted = true;
      },
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'execution_disabled');
  assert.equal(repositoryInspected, false);
  assert.equal(processStarted, false);
});

test('no available agent returns without creating a worktree', async () => {
  let worktreeCreated = false;
  const service = createService({
    router: { analyzeTask: async () => createAnalysis(false) },
    worktrees: {
      create: async () => {
        worktreeCreated = true;
      },
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'no_available_agent');
  assert.equal(worktreeCreated, false);
});

test('dirty target repository is rejected without creating a worktree', async () => {
  let worktreeCreated = false;
  const service = createService({
    git: { isClean: async () => false },
    worktrees: {
      create: async () => {
        worktreeCreated = true;
      },
    },
  });

  await assert.rejects(
    () => service.executeTask({ task: 'safe task', workspace: repo }),
    (error) => {
      assert.ok(error instanceof RepositoryValidationError);
      assert.equal(error.code, 'REPOSITORY_NOT_CLEAN');
      return true;
    },
  );
  assert.equal(worktreeCreated, false);
});

test('repository without a valid HEAD is rejected before worktree creation', async () => {
  let worktreeCreated = false;
  const service = createService({
    git: {
      getHeadCommit: async () => {
        throw new GitCommandError('invalid HEAD', {});
      },
    },
    worktrees: {
      create: async () => {
        worktreeCreated = true;
      },
    },
  });

  await assert.rejects(
    () => service.executeTask({ task: 'safe task', workspace: repo }),
    (error) => {
      assert.ok(error instanceof RepositoryValidationError);
      assert.equal(error.code, 'INVALID_HEAD');
      return true;
    },
  );
  assert.equal(worktreeCreated, false);
});

test('detached HEAD is rejected before worktree creation', async () => {
  let worktreeCreated = false;
  const service = createService({
    git: { getCurrentBranch: async () => '' },
    worktrees: {
      create: async () => {
        worktreeCreated = true;
      },
    },
  });

  await assert.rejects(
    () => service.executeTask({ task: 'safe task', workspace: repo }),
    (error) => {
      assert.ok(error instanceof RepositoryValidationError);
      assert.equal(error.code, 'DETACHED_HEAD');
      return true;
    },
  );
  assert.equal(worktreeCreated, false);
});

test('agent invocation cwd is always the isolated worktree', async () => {
  const result = await createService().executeTask({
    task: 'safe task',
    workspace: repo,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.execution.cwd, worktreePath);
  assert.notEqual(result.execution.cwd, repo);
  assert.equal(result.execution.durationMs, 1_250);
  assert.equal(result.changes.files[0].file, 'README.md');
  assert.equal(result.evaluation.verdict, 'pass');
});

test('unexpected agent commit marks the result as failed', async () => {
  const service = createService({
    git: {
      getHeadCommit: async (cwd) => (
        cwd === worktreePath ? 'b'.repeat(40) : baseCommit
      ),
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'failed');
  assert.equal(result.changes.autoCommitDetected, true);
  assert.notEqual(result.workspace.headCommit, result.workspace.baseCommit);
});

test('warning verdict maps successful execution to completed_with_warnings', async () => {
  const service = createService({
    evaluator: {
      evaluateAgentResult: async () => ({
        score: 80,
        verdict: 'warning',
        summary: { changedFileCount: 1 },
      }),
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'completed_with_warnings');
});

test('fail verdict maps successful execution to evaluation_failed', async () => {
  const service = createService({
    evaluator: {
      evaluateAgentResult: async () => ({
        score: 50,
        verdict: 'fail',
        summary: { changedFileCount: 1 },
      }),
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'evaluation_failed');
});

test('agent process failure remains failed regardless of evaluator verdict', async () => {
  const service = createService({
    runner: {
      runProcess: async (invocation) => ({
        ...invocation,
        exitCode: 1,
        timedOut: false,
        outputTruncated: false,
        stdout: '',
        stderr: 'failed',
        error: null,
      }),
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'failed');
});

test('executor passes explicit untracked files to the evaluator', async () => {
  let evaluationInput;
  const service = createService({
    git: {
      getChangedFiles: async () => [{ status: '??', file: 'new-file.js' }],
      getUntrackedFiles: async () => ['new-file.js'],
      getDiff: async () => '',
    },
    evaluator: {
      evaluateAgentResult: async (input) => {
        evaluationInput = input;
        return {
          score: 100,
          verdict: 'pass',
          summary: { changedFileCount: 1 },
        };
      },
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.deepEqual(evaluationInput.untrackedFiles, ['new-file.js']);
  assert.equal(result.changes.untrackedFiles[0], 'new-file.js');
});

test('executor redacts tracked diff when evaluation detects a sensitive path', async () => {
  const service = createService({
    evaluator: {
      evaluateAgentResult: async () => ({
        score: 50,
        verdict: 'fail',
        summary: { changedFileCount: 1 },
        diff: {
          sensitiveFiles: [{ path: '.env', rule: 'dotenv-file' }],
        },
      }),
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'evaluation_failed');
  assert.equal(result.changes.diff, null);
  assert.equal(result.changes.diffRedacted, true);
  assert.equal(result.execution.stdout, null);
  assert.equal(result.execution.stderr, null);
  assert.equal(result.execution.outputRedacted, true);
});

test('forced-agent execution does not reroute and reuses caller task ID', async () => {
  let worktreeInput;
  const forcedAgent = {
    id: 'qwen-code',
    name: 'Qwen Code',
    command: 'qwen',
    executionCommand: 'C:\\tools\\qwen.cmd',
    executionArgs: [],
    available: true,
  };
  const service = createService({
    router: {
      analyzeTask: async () => {
        throw new Error('router must not run for a forced agent');
      },
    },
    worktrees: {
      create: async (input) => {
        worktreeInput = input;
        return {
          taskId: input.taskId,
          repo,
          worktreePath,
          branch: `agent/${input.taskId}-qwen-code`,
          baseCommit,
        };
      },
    },
  });

  const result = await service.executeWithAgent({
    task: 'safe task',
    agent: forcedAgent,
    repository: {
      requestedWorkspace: repo,
      repo,
      targetBranch: 'main',
      baseCommit,
    },
    taskId: 'competition123',
    classification: { coding: 80 },
  });

  assert.equal(worktreeInput.taskId, 'competition123');
  assert.equal(worktreeInput.agentId, 'qwen-code');
  assert.equal(result.selectedAgent.id, 'qwen-code');
  assert.equal(result.workspace.branch, 'agent/competition123-qwen-code');
});

test('single-agent execution persists one task and one run to SQLite', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const history = new HistoryService({ database });
  const service = createService({ history });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });
  const stored = history.getTaskById(result.taskId);

  assert.equal(result.history.persisted, true);
  assert.equal(stored.mode, 'single');
  assert.equal(stored.status, 'completed');
  assert.equal(stored.targetBranch, 'main');
  assert.equal(stored.baseCommit, baseCommit);
  assert.equal(stored.decision, 'pending');
  assert.equal(stored.winnerAgentId, 'opencode');
  assert.equal(stored.runs.length, 1);
  assert.equal(stored.runs[0].agentId, 'opencode');
  assert.equal(stored.runs[0].evaluationScore, 100);
  assert.equal(stored.runs[0].competitionScore, null);
  assert.equal(
    stored.runs[0].candidateFingerprint,
    `sha256:${'a'.repeat(64)}`,
  );
});

test('disabled single-agent execution does not create history', async () => {
  let createCalls = 0;
  const service = createService({
    executionEnabled: false,
    history: {
      createTask: async () => {
        createCalls += 1;
      },
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'execution_disabled');
  assert.equal(createCalls, 0);
});

test('user cancellation preserves partial worktree context without recording a failed Agent score', async (t) => {
  const { database } = await createTemporaryDatabase(t, 'agent-router-cancel-history-');
  const history = new HistoryService({ database });
  const controller = new AbortController();
  let processStarted;
  const started = new Promise((resolve) => { processStarted = resolve; });
  const service = createService({
    history,
    runner: {
      runProcess: ({ signal }) => new Promise((_resolve, reject) => {
        processStarted();
        signal.addEventListener('abort', () => reject(new ExecutionCancelledError()), { once: true });
      }),
    },
  });
  const execution = service.executeTask({
    task: 'safe task', workspace: repo, signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(execution, (error) => (
    error.code === 'JOB_CANCELLED'
      && error.candidateContext.worktreePath === worktreePath
  ));
  const stored = history.getTaskById('task123');
  assert.equal(stored.status, 'cancelled');
  assert.equal(stored.runs.length, 0);
});

test('post-execution history failure reports clearly and preserves candidate result', async () => {
  const service = createService({
    history: {
      createTask: async () => {},
      recordExecutionResult: async () => {
        throw new Error('simulated database failure');
      },
      completeTask: async () => {},
    },
  });

  const result = await service.executeTask({ task: 'safe task', workspace: repo });

  assert.equal(result.status, 'completed');
  assert.equal(result.workspace.worktree, worktreePath);
  assert.equal(result.history.persisted, false);
  assert.equal(result.history.error.code, 'HISTORY_PERSISTENCE_FAILED');
});

test('pre-execution history failure prevents worktree creation', async () => {
  let worktreeCreated = false;
  const service = createService({
    history: {
      createTask: async () => {
        throw new Error('simulated database failure');
      },
    },
    worktrees: {
      create: async () => {
        worktreeCreated = true;
      },
    },
  });

  await assert.rejects(
    () => service.executeTask({ task: 'safe task', workspace: repo }),
    (error) => error instanceof HistoryPersistenceError,
  );
  assert.equal(worktreeCreated, false);
});

test('optional realtime reporting follows the actual single-agent pipeline without raw output', async () => {
  const events = [];
  const service = createService({
    runner: {
      runProcess: async (invocation) => ({
        ...invocation,
        exitCode: 0,
        timedOut: false,
        outputTruncated: false,
        stdout: 'SECRET_TOKEN=abc123',
        stderr: '-----BEGIN PRIVATE KEY-----',
        error: null,
      }),
    },
    evaluator: {
      evaluateAgentResult: async ({ onEvent }) => {
        onEvent({
          type: 'static_check',
          stage: 'evaluation',
          status: 'completed',
          messageKey: 'run.staticCheck',
          data: { checkType: 'javascript-syntax', file: 'README.md', passed: true },
        });
        onEvent({
          type: 'sandbox_check_completed',
          stage: 'evaluation',
          status: 'completed',
          messageKey: 'run.sandboxCheckCompleted',
          data: { check: 'test', network: 'none', passed: true },
        });
        return {
          score: 100,
          verdict: 'pass',
          summary: { changedFileCount: 1 },
        };
      },
    },
  });
  const result = await service.executeTask({
    task: '<script>alert(1)</script>',
    workspace: repo,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(events.map((event) => event.type), [
    'router_analyzing',
    'router_completed',
    'repository_validating',
    'repository_validated',
    'worktree_creating',
    'worktree_created',
    'agent_starting',
    'agent_running',
    'agent_completed',
    'evaluation_starting',
    'static_check',
    'sandbox_check_completed',
    'evaluation_completed',
  ]);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('SECRET_TOKEN'), false);
  assert.equal(serialized.includes('PRIVATE KEY'), false);
  assert.equal(serialized.includes('<script>'), false);
});
