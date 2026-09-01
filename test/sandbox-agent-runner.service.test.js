const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  AgentSandboxError,
  SandboxAgentRunnerService,
  toContainerOllamaUrl,
  validateAgentEnvironment,
} = require('../src/services/sandbox-agent-runner.service');
const { getSandboxAgent } = require('../src/config/sandbox-agents');

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lar-agent-sandbox-'));
  const repo = path.join(root, 'repo');
  const worktreeRoot = path.join(root, 'worktrees');
  const worktreePath = path.join(worktreeRoot, 'abc123-opencode');
  await fs.mkdir(repo);
  await fs.mkdir(worktreePath, { recursive: true });
  await fs.writeFile(path.join(worktreePath, 'README.md'), 'candidate');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    repo,
    worktreeRoot,
    worktree: {
      repo,
      taskId: 'abc123',
      branch: 'agent/abc123-opencode',
      worktreePath,
    },
  };
}

function createRunner({ healthExitCode = 0, agentTimedOut = false } = {}) {
  const calls = [];
  return {
    calls,
    runProcess: async (input) => {
      calls.push(input);
      if (input.args[0] === 'image') {
        return { ...input, exitCode: 0, timedOut: false, stdout: '[]', stderr: '', outputTruncated: false };
      }
      if (input.args[0] === 'rm') {
        return { ...input, exitCode: 0, timedOut: false, stdout: '', stderr: '', outputTruncated: false };
      }
      const isHealth = input.args.includes('lar-agent-abc123-ollama');
      return {
        ...input,
        exitCode: isHealth ? healthExitCode : (agentTimedOut ? null : 0),
        timedOut: isHealth ? false : agentTimedOut,
        stdout: isHealth ? 'ollama-ok' : 'agent-output',
        stderr: '',
        outputTruncated: false,
        error: null,
      };
    },
  };
}

function createService(fixture, runner) {
  return new SandboxAgentRunnerService({
    runner,
    worktrees: { getWorktreeRoot: () => fixture.worktreeRoot },
    dockerCommand: 'docker',
    availabilityTtlMs: 30_000,
    clock: () => 1,
  });
}

test('sandbox Agent runner applies isolation and returns ProcessResult-compatible evidence', async (t) => {
  const fixture = await createFixture(t);
  const runner = createRunner();
  const service = createService(fixture, runner);
  const result = await service.run({
    agent: { id: 'opencode' },
    worktree: fixture.worktree,
    ollamaBaseUrl: 'http://localhost:11434',
    invocation: {
      command: 'opencode',
      args: ['run', 'safe task'],
      cwd: fixture.worktree.worktreePath,
      env: { OPENCODE_CONFIG_CONTENT: '{}' },
    },
  });
  const runCalls = runner.calls.filter((call) => call.args[0] === 'run');
  const agentArgs = runCalls[1].args.join(' ');

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'agent-output');
  assert.equal(result.sandbox.backend, 'docker');
  assert.equal(result.sandbox.ollamaVerified, true);
  for (const expected of [
    '--cap-drop ALL',
    '--security-opt no-new-privileges:true',
    '--read-only',
    '--user 1000:1000',
    '--network bridge',
    'target=/workspace',
  ]) {
    assert.match(agentArgs, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  }
  assert.doesNotMatch(agentArgs, /--privileged|docker\.sock|\.env/u);
  assert.match(runCalls[0].args.join(' '), /\/api\/tags/u);
  assert.equal(runner.calls.filter((call) => call.args[0] === 'rm').length, 2);
});

test('sandbox Agent runner rejects host environment keys and arbitrary commands', async (t) => {
  const fixture = await createFixture(t);
  const service = createService(fixture, createRunner());
  assert.throws(
    () => validateAgentEnvironment(getSandboxAgent('opencode'), {
      ROUTER_SECRET: 'must-not-pass',
    }),
    /not allowed/u,
  );
  await assert.rejects(
    () => service.run({
      agent: { id: 'opencode' },
      worktree: fixture.worktree,
      ollamaBaseUrl: 'http://localhost:11434',
      invocation: { command: 'powershell', args: [], env: {}, cwd: fixture.worktree.worktreePath },
    }),
    (error) => error instanceof AgentSandboxError
      && error.code === 'AGENT_SANDBOX_COMMAND_INVALID',
  );
});

test('sandbox Agent runner rejects a worktree outside generated policy', async (t) => {
  const fixture = await createFixture(t);
  const service = createService(fixture, createRunner());
  await assert.rejects(
    () => service.validateWorktree(
      { id: 'opencode' },
      { ...fixture.worktree, worktreePath: fixture.repo },
    ),
    (error) => error.code === 'AGENT_SANDBOX_WORKTREE_INVALID',
  );
});

test('Ollama connectivity failure prevents Agent execution and host fallback', async (t) => {
  const fixture = await createFixture(t);
  const runner = createRunner({ healthExitCode: 2 });
  const service = createService(fixture, runner);
  await assert.rejects(
    () => service.run({
      agent: { id: 'opencode' },
      worktree: fixture.worktree,
      ollamaBaseUrl: 'http://localhost:11434',
      invocation: { command: 'opencode', args: ['run'], env: {}, cwd: fixture.worktree.worktreePath },
    }),
    (error) => error.code === 'AGENT_SANDBOX_OLLAMA_UNAVAILABLE',
  );
  assert.equal(runner.calls.filter((call) => call.args[0] === 'run').length, 1);
});

test('Agent timeout remains compatible and container cleanup is attempted', async (t) => {
  const fixture = await createFixture(t);
  const runner = createRunner({ agentTimedOut: true });
  const service = createService(fixture, runner);
  const result = await service.run({
    agent: { id: 'opencode' },
    worktree: fixture.worktree,
    ollamaBaseUrl: 'http://localhost:11434',
    invocation: { command: 'opencode', args: ['run'], env: {}, cwd: fixture.worktree.worktreePath },
  });

  assert.equal(result.timedOut, true);
  assert.equal(runner.calls.filter((call) => call.args[0] === 'rm').length, 2);
  assert.equal(await fs.readFile(path.join(fixture.worktree.worktreePath, 'README.md'), 'utf8'), 'candidate');
});

test('loopback Ollama URL is mapped only inside Docker', () => {
  assert.equal(
    toContainerOllamaUrl('http://localhost:11434'),
    'http://host.docker.internal:11434',
  );
});

test('Agent sandbox forwards cancellation to health and Agent processes but not cleanup', async (t) => {
  const fixture = await createFixture(t);
  const runner = createRunner();
  const service = createService(fixture, runner);
  const controller = new AbortController();
  await service.run({
    agent: { id: 'opencode' },
    worktree: fixture.worktree,
    ollamaBaseUrl: 'http://localhost:11434',
    signal: controller.signal,
    invocation: { command: 'opencode', args: ['run'], env: {}, cwd: fixture.worktree.worktreePath },
  });
  const runCalls = runner.calls.filter((call) => call.args[0] === 'run');
  const cleanupCalls = runner.calls.filter((call) => call.args[0] === 'rm');
  assert.ok(runCalls.every((call) => call.signal === controller.signal));
  assert.ok(cleanupCalls.every((call) => call.signal === undefined));
});
