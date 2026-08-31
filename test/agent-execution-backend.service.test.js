const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AgentExecutionBackendError,
  AgentExecutionBackendService,
} = require('../src/services/agent-execution-backend.service');

const agent = {
  id: 'opencode',
  command: 'opencode',
  executionCommand: 'C:\\tools\\opencode.exe',
  executionArgs: [],
  sandbox: { command: 'opencode', available: true },
};

test('host backend preserves the existing safe process runner', async () => {
  let invocation;
  const backend = new AgentExecutionBackendService({
    backend: 'host',
    hostRunner: { runProcess: async (input) => { invocation = input; return input; } },
  });
  const input = { command: 'opencode', args: [], cwd: 'repo', env: {} };
  await backend.run({ invocation: input, agent });

  assert.equal(invocation, input);
  assert.equal(backend.createAdapterInput(agent, 'repo').runtime.backend, 'host');
});

test('Docker backend delegates to sandbox without using host runner', async () => {
  let hostCalled = false;
  let sandboxInput;
  const backend = new AgentExecutionBackendService({
    backend: 'docker',
    hostRunner: { runProcess: async () => { hostCalled = true; } },
    sandboxRunner: {
      assertAvailable: async () => ({ available: true }),
      run: async (input) => { sandboxInput = input; return { exitCode: 0 }; },
    },
  });
  const runtime = backend.createAdapterInput(agent, 'host-worktree');
  await backend.run({
    invocation: { command: 'opencode', args: [], cwd: 'host-worktree', env: {} },
    agent,
    worktree: { worktreePath: 'host-worktree' },
    ollamaBaseUrl: 'http://localhost:11434',
  });

  assert.equal(hostCalled, false);
  assert.equal(runtime.executionCommand, 'opencode');
  assert.equal(runtime.runtime.workspace, '/workspace');
  assert.equal(sandboxInput.agent, agent);
});

test('configured SBX backend fails closed without host fallback', async () => {
  let hostCalled = false;
  const backend = new AgentExecutionBackendService({
    backend: 'sbx',
    hostRunner: { runProcess: async () => { hostCalled = true; } },
  });

  await assert.rejects(
    () => backend.assertConfiguredAvailable(),
    (error) => error instanceof AgentExecutionBackendError
      && error.code === 'SBX_BACKEND_UNAVAILABLE',
  );
  assert.throws(
    () => backend.createAdapterInput(agent, 'repo'),
    /host fallback is forbidden/u,
  );
  assert.equal(hostCalled, false);
});

test('unavailable Docker image fails before host execution', async () => {
  let hostCalled = false;
  const backend = new AgentExecutionBackendService({
    backend: 'docker',
    hostRunner: { runProcess: async () => { hostCalled = true; } },
    sandboxRunner: {
      inspectImage: async () => ({ available: false }),
    },
  });

  await assert.rejects(
    () => backend.assertConfiguredAvailable(),
    /host fallback is forbidden/u,
  );
  assert.equal(hostCalled, false);
});
