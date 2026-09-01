const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

const {
  AgentExecutorService,
} = require('../src/services/agent-executor.service');
const {
  agentRegistryService,
} = require('../src/services/agent-registry.service');
const {
  CompetitionService,
} = require('../src/services/competition.service');
const { gitService } = require('../src/services/git.service');
const {
  RunCoordinatorService,
} = require('../src/services/run-coordinator.service');
const { RunSessionService } = require('../src/services/run-session.service');

const runLive = process.env.RUN_AGENT_SANDBOX_TESTS === 'true';

async function createRepository(prefix, { withReadme = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const repo = path.join(root, 'source');
  await fs.mkdir(repo);
  await fs.writeFile(
    path.join(repo, withReadme ? 'README.md' : 'BASE.txt'),
    withReadme ? '# Sandbox Fixture\n' : 'Disposable real-time fixture\n',
  );
  await gitService.runGit(['init', '-b', 'main'], repo);
  await gitService.runGit(['config', 'user.name', 'Phase 11 Test'], repo);
  await gitService.runGit(
    ['config', 'user.email', 'phase11@example.invalid'],
    repo,
  );
  await gitService.stageAll(repo);
  await gitService.commit(repo, 'initial sandbox fixture');

  return { root, repo };
}

async function cleanupCandidates(repo, candidates) {
  for (const candidate of candidates) {
    const worktree = candidate.workspace?.worktree || candidate.worktree;
    const branch = candidate.workspace?.branch || candidate.branch;

    if (worktree) {
      await gitService.removeWorktree(repo, worktree, { force: true });
    }

    if (branch && await gitService.branchExists(repo, branch)) {
      await gitService.deleteBranch(repo, branch, { force: true });
    }
  }

  await gitService.pruneWorktrees(repo);
}

async function assertNoSandboxContainers(taskId) {
  const result = await gitService.runner.runProcess({
    command: process.platform === 'win32' ? 'docker.exe' : 'docker',
    args: [
      'ps',
      '--all',
      '--filter',
      `name=lar-agent-${taskId}`,
      '--format',
      '{{.Names}}',
    ],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '');
}

async function waitForTerminalSession(sessions, runId, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = sessions.snapshot(runId);
    if (snapshot && ['completed', 'failed'].includes(snapshot.state)) return snapshot;
    await delay(500);
  }
  throw new Error('Timed out waiting for the real-time Agent session');
}

test('live real-time Agent creates an isolated README candidate and safe lifecycle', {
  skip: !runLive,
  timeout: 900_000,
}, async (t) => {
  assert.equal(process.env.AGENT_EXECUTION_BACKEND, 'docker');
  const fixture = await createRepository('lar-agent-realtime-live-', { withReadme: false });
  const selectedAgent = await agentRegistryService.getAgentById('qwen-code');
  const agent = { ...selectedAgent, score: 100, staticScore: 100 };
  const executor = new AgentExecutorService({
    executionEnabled: true,
    history: {
      createTask: async () => {},
      recordExecutionResult: async () => {},
      completeTask: async () => {},
    },
    router: {
      analyzeTask: async (task) => ({
        task,
        classification: { coding: 100, smallChange: 100 },
        selectedAgent: agent,
        recommendedAgent: agent,
        ranking: [agent],
      }),
    },
  });
  let result;
  const sessions = new RunSessionService({ startCleanupTimer: false });
  const coordinator = new RunCoordinatorService({
    sessions,
    executor: {
      isExecutionEnabled: () => executor.isExecutionEnabled(),
      assertExecutionBackendAvailable: (...args) => (
        executor.assertExecutionBackendAvailable(...args)
      ),
      executeTask: async (input) => {
        result = await executor.executeTask(input);
        return result;
      },
    },
  });

  t.after(async () => {
    sessions.close();
    if (result?.workspace?.worktree) await cleanupCandidates(fixture.repo, [result]);
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  const accepted = await coordinator.startSingle({
    task: "Add a section named Real-Time Validation to README.md only. Use the write_file tool exactly once to create /workspace/README.md containing '# Real-Time Validation' followed by one short validation sentence. Do not read or modify any other file, do not commit or merge, and stop immediately after the write succeeds.",
    workspace: fixture.repo,
  });
  const snapshot = await waitForTerminalSession(sessions, accepted.id);
  const events = sessions.eventsAfter(accepted.id);
  const types = events.map((event) => event.type);

  assert.equal(accepted.state, 'starting');
  assert.equal(snapshot.state, 'completed', JSON.stringify({
    error: snapshot.error,
    status: result?.status,
    timedOut: result?.execution?.timedOut,
  }));
  assert.ok(['completed', 'completed_with_warnings'].includes(result.status));
  assert.ok(result.changes.untrackedFiles.includes('README.md'));
  assert.match(
    await fs.readFile(path.join(result.workspace.worktree, 'README.md'), 'utf8'),
    /Real-Time Validation/u,
  );
  assert.equal(result.workspace.headCommit, result.workspace.baseCommit);
  assert.equal(result.changes.autoCommitDetected, false);
  assert.equal(await gitService.isClean(fixture.repo), true);
  await assert.rejects(() => fs.stat(path.join(fixture.repo, 'README.md')), { code: 'ENOENT' });
  for (const required of [
    'run_started', 'router_analyzing', 'router_completed',
    'repository_validating', 'repository_validated',
    'worktree_creating', 'worktree_created',
    'agent_starting', 'agent_running', 'agent_completed',
    'evaluation_starting', 'evaluation_completed',
    'candidate_ready', 'run_completed',
  ]) assert.ok(types.includes(required), `Missing real-time event: ${required}`);
  assert.deepEqual(events.map((event) => event.id), events.map((_, index) => index + 1));
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  const serialized = JSON.stringify({ events, snapshot });
  assert.equal(serialized.includes('stdout'), false);
  assert.equal(serialized.includes('stderr'), false);
  assert.equal(serialized.includes('candidateFingerprint'), false);
  assert.equal(serialized.includes('trackedDiff'), false);
  await assertNoSandboxContainers(result.taskId);
});

test('live Qwen Code runs inside Docker and preserves the candidate worktree', {
  skip: !runLive,
  timeout: 900_000,
}, async (t) => {
  assert.equal(process.env.AGENT_EXECUTION_BACKEND, 'docker');
  const fixture = await createRepository('lar-agent-sandbox-live-');
  const executor = new AgentExecutorService({ executionEnabled: true });
  const agent = await agentRegistryService.getAgentById('qwen-code');
  const repository = await executor.validateRepository(fixture.repo);
  let result;

  t.after(async () => {
    if (result) {
      await cleanupCandidates(fixture.repo, [result]);
    }
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  assert.equal(agent.available, true);
  assert.equal(agent.runtime, 'docker');
  result = await executor.executeWithAgent({
    task: "Use the write_file tool exactly once to create /workspace/README.sandbox.md containing '# Sandbox Validation' followed by one short sentence. Do not read any file, do not modify any other file, do not ask for clarification, and stop immediately after the write succeeds.",
    agent,
    repository,
    taskId: '11bqwen00001',
    classification: { smallChange: 100 },
  });

  assert.equal(result.execution.sandbox.backend, 'docker');
  assert.equal(result.execution.sandbox.ollamaVerified, true);
  assert.equal(result.execution.sandbox.worktreeMount, '/workspace');
  assert.equal(result.workspace.headCommit, repository.baseCommit);
  assert.equal(result.changes.autoCommitDetected, false);
  assert.ok(
    ['completed', 'completed_with_warnings'].includes(result.status),
    JSON.stringify({
      status: result.status,
      exitCode: result.execution.exitCode,
      timedOut: result.execution.timedOut,
      error: result.execution.error,
      stderr: result.execution.stderr,
      evaluation: result.evaluation,
    }),
  );
  assert.match(
    await fs.readFile(
      path.join(result.workspace.worktree, 'README.sandbox.md'),
      'utf8',
    ),
    /Sandbox Validation/u,
    JSON.stringify({
      status: result.status,
      stdout: result.execution.stdout,
      stderr: result.execution.stderr,
      changes: result.changes,
      evaluation: result.evaluation,
    }),
  );
  assert.equal(await gitService.isClean(fixture.repo), true);
  assert.equal(await fs.readFile(path.join(fixture.repo, 'README.md'), 'utf8'), '# Sandbox Fixture\n');
  await assert.rejects(
    () => fs.stat(path.join(fixture.repo, 'README.sandbox.md')),
    { code: 'ENOENT' },
  );
  await assertNoSandboxContainers(result.taskId);
});

test('live OpenCode and Qwen Code competition uses separate Docker sandboxes', {
  skip: !runLive,
  timeout: 1_800_000,
}, async (t) => {
  assert.equal(process.env.AGENT_EXECUTION_BACKEND, 'docker');
  const fixture = await createRepository('lar-agent-competition-live-');
  const executor = new AgentExecutorService({ executionEnabled: true });
  const competition = new CompetitionService({ executor });
  let result;

  t.after(async () => {
    if (result) {
      await cleanupCandidates(fixture.repo, result.candidates);
    }
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  result = await competition.compete({
    task: "Use one file-writing tool to create /workspace/README.competition.md containing '# Agent Competition Test' followed by one short sentence. Do not read or modify any other file and stop immediately after the write succeeds.",
    workspace: fixture.repo,
    agentIds: ['opencode', 'qwen-code'],
  });

  assert.deepEqual(result.executionOrder, ['opencode', 'qwen-code']);
  assert.equal(result.candidates.length, 2);
  assert.equal(new Set(result.candidates.map((candidate) => candidate.baseCommit)).size, 1);
  assert.equal(new Set(result.candidates.map((candidate) => candidate.worktree)).size, 2);
  assert.equal(new Set(result.candidates.map((candidate) => candidate.branch)).size, 2);
  assert.ok(result.candidates.every(
    (candidate) => candidate.execution?.sandbox?.backend === 'docker',
  ));
  assert.ok(result.candidates.every(
    (candidate) => candidate.execution?.sandbox?.ollamaVerified === true,
  ));
  assert.ok(result.candidates.every(
    (candidate) => candidate.changes.autoCommitDetected === false,
  ));
  assert.equal(await gitService.isClean(fixture.repo), true);
  assert.equal(await fs.readFile(path.join(fixture.repo, 'README.md'), 'utf8'), '# Sandbox Fixture\n');
  await assert.rejects(
    () => fs.stat(path.join(fixture.repo, 'README.competition.md')),
    { code: 'ENOENT' },
  );
  assert.ok(result.candidates.some((candidate) => candidate.changes.count > 0));
  assert.ok(result.winner);
  assert.ok([
    'completed',
    'completed_with_warnings',
  ].includes(result.winner.status));
  await assertNoSandboxContainers(result.competitionId);
});
