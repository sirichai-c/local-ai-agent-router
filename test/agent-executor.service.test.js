const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AgentExecutorService,
  RepositoryValidationError,
} = require('../src/services/agent-executor.service');
const { GitCommandError } = require('../src/services/git.service');

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
      create: async () => ({
        taskId: 'task123',
        repo,
        worktreePath,
        branch: 'agent/task123-opencode',
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
