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
  },
  {
    id: 'missing-agent',
    name: 'Missing Agent',
    commands: ['missing'],
    description: 'Missing test agent',
    capabilities: ['review'],
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
  });

  const agents = await service.getAgents();

  assert.deepEqual(agents, [
    {
      id: 'first-agent',
      name: 'First Agent',
      description: 'First test agent',
      capabilities: ['coding'],
      installed: true,
      available: true,
      command: 'first-fallback',
      executablePath: '/tools/first-fallback',
    },
    {
      id: 'missing-agent',
      name: 'Missing Agent',
      description: 'Missing test agent',
      capabilities: ['review'],
      installed: false,
      available: false,
      command: null,
      executablePath: null,
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
  });

  const agent = await service.getAgentById('first-agent');

  assert.equal(agent.command, 'first');
  assert.deepEqual(inspectedCommands, ['first']);
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
