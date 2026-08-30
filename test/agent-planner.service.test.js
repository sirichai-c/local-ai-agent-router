const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const {
  AgentPlannerService,
  WorkspaceValidationError,
} = require('../src/services/agent-planner.service');

function createAnalysis({ selectedAgent = true } = {}) {
  return {
    task: 'refactor code and inspect git diff',
    classification: {
      coding: 30,
      git: 90,
      refactor: 90,
    },
    recommendedAgent: {
      id: 'aider',
      name: 'Aider',
      available: false,
      command: null,
      score: 96,
    },
    selectedAgent: selectedAgent
      ? {
        id: 'opencode',
        name: 'OpenCode',
        available: true,
        command: 'opencode',
        executionCommand: 'C:\\tools\\opencode.exe',
        executionArgs: [],
        score: 82,
      }
      : null,
    ranking: [],
  };
}

test('planner uses selectedAgent rather than recommendedAgent', async () => {
  let resolvedAdapterId;
  let invocationInput;
  const service = new AgentPlannerService({
    router: {
      analyzeTask: async () => createAnalysis(),
    },
    adapterResolver: (agentId) => {
      resolvedAdapterId = agentId;
      return {
        buildInvocation: (input) => {
          invocationInput = input;
          return {
            command: input.executionCommand,
            args: [input.task],
            cwd: input.workspace,
            env: {},
          };
        },
      };
    },
    model: 'qwen3.5:4b',
    ollamaBaseUrl: 'http://localhost:11434',
  });

  const result = await service.planTask({
    task: 'ignored by fake router',
    workspace: process.cwd(),
  });

  assert.equal(result.status, 'planned');
  assert.equal(resolvedAdapterId, 'opencode');
  assert.equal(result.selectedAgent.id, 'opencode');
  assert.equal(invocationInput.command, 'opencode');
  assert.equal(invocationInput.executionCommand, 'C:\\tools\\opencode.exe');
  assert.deepEqual(invocationInput.executionArgs, []);
  assert.equal(invocationInput.workspace, path.resolve(process.cwd()));
});

test('planner returns a normal no-available-agent result', async () => {
  const service = new AgentPlannerService({
    router: {
      analyzeTask: async () => createAnalysis({ selectedAgent: false }),
    },
  });

  const result = await service.planTask({
    task: 'refactor this code',
    workspace: process.cwd(),
  });

  assert.equal(result.status, 'no_available_agent');
  assert.equal(result.analysis.selectedAgent, null);
  assert.equal(result.invocation, null);
});

test('planner rejects a workspace that does not exist', async () => {
  const service = new AgentPlannerService();
  const missingWorkspace = path.join(
    process.cwd(),
    '__phase_5_workspace_does_not_exist__',
  );

  await assert.rejects(
    () => service.planTask({ task: 'fix bug', workspace: missingWorkspace }),
    (error) => {
      assert.ok(error instanceof WorkspaceValidationError);
      assert.equal(error.code, 'WORKSPACE_NOT_FOUND');
      return true;
    },
  );
});

test('planner rejects a file used as the workspace', async () => {
  const service = new AgentPlannerService();

  await assert.rejects(
    () => service.planTask({
      task: 'fix bug',
      workspace: path.join(process.cwd(), 'package.json'),
    }),
    (error) => {
      assert.ok(error instanceof WorkspaceValidationError);
      assert.equal(error.code, 'WORKSPACE_NOT_DIRECTORY');
      return true;
    },
  );
});

test('planner treats a missing adapter as an internal configuration error', async () => {
  const service = new AgentPlannerService({
    router: {
      analyzeTask: async () => createAnalysis(),
    },
    adapterResolver: () => null,
  });

  await assert.rejects(
    () => service.planTask({ task: 'fix bug', workspace: process.cwd() }),
    /No adapter available for opencode/,
  );
});
