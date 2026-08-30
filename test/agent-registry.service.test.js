const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AgentRegistryService,
} = require('../src/services/agent-registry.service');

const testAgents = [
  {
    id: 'first-agent',
    name: 'First Agent',
    commands: ['first', 'first-fallback'],
    description: 'First test agent',
    capabilities: ['coding'],
    capabilityScores: { coding: 70 },
  },
  {
    id: 'missing-agent',
    name: 'Missing Agent',
    commands: ['missing'],
    description: 'Missing test agent',
    capabilities: ['review'],
    capabilityScores: { review: 80 },
  },
];

test('getAgents reports detected and missing commands without throwing', async () => {
  const service = new AgentRegistryService({
    agents: testAgents,
    commandDetector: async (command) => ({
      exists: command === 'first-fallback',
      path: command === 'first-fallback' ? '/tools/first-fallback' : null,
      paths: [],
    }),
    executionCommandResolver: async (agent, detection) => detection.path,
  });

  const agents = await service.getAgents();

  assert.deepEqual(agents, [
    {
      id: 'first-agent',
      name: 'First Agent',
      description: 'First test agent',
      capabilities: ['coding'],
      capabilityScores: { coding: 70 },
      installed: true,
      available: true,
      command: 'first-fallback',
      executablePath: '/tools/first-fallback',
      executionCommand: '/tools/first-fallback',
      executionArgs: [],
    },
    {
      id: 'missing-agent',
      name: 'Missing Agent',
      description: 'Missing test agent',
      capabilities: ['review'],
      capabilityScores: { review: 80 },
      installed: false,
      available: false,
      command: null,
      executablePath: null,
      executionCommand: null,
      executionArgs: [],
    },
  ]);
});

test('getAgentById stops after the first available command', async () => {
  const inspectedCommands = [];
  const service = new AgentRegistryService({
    agents: testAgents,
    commandDetector: async (command) => {
      inspectedCommands.push(command);
      return {
        exists: true,
        path: `/tools/${command}`,
        paths: [`/tools/${command}`],
      };
    },
    executionCommandResolver: async (agent, detection) => detection.path,
  });

  const agent = await service.getAgentById('first-agent');

  assert.equal(agent.command, 'first');
  assert.deepEqual(inspectedCommands, ['first']);
});

test('installed Windows shim is unavailable without a spawn-safe executable', async () => {
  const service = new AgentRegistryService({
    agents: testAgents,
    commandDetector: async () => ({
      exists: true,
      path: 'C:\\tools\\first.cmd',
      paths: ['C:\\tools\\first.cmd'],
    }),
    executionCommandResolver: async () => null,
  });

  const agent = await service.getAgentById('first-agent');

  assert.equal(agent.installed, true);
  assert.equal(agent.available, false);
  assert.equal(agent.executionCommand, null);
  assert.deepEqual(agent.executionArgs, []);
});

test('getAgentById returns null for an unknown id without inspecting PATH', async () => {
  let detectionCalled = false;
  const service = new AgentRegistryService({
    agents: testAgents,
    commandDetector: async () => {
      detectionCalled = true;
      return { exists: false, path: null, paths: [] };
    },
  });

  const agent = await service.getAgentById('unknown');

  assert.equal(agent, null);
  assert.equal(detectionCalled, false);
});
