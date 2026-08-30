const assert = require('node:assert/strict');
const { test } = require('node:test');

const agentDefinitions = require('../src/config/agents');
const { RouterService } = require('../src/services/router.service');

function createRouter(availableAgentIds = ['opencode']) {
  const availableIds = new Set(availableAgentIds);
  const agents = agentDefinitions.map((agent) => ({
    id: agent.id,
    name: agent.name,
    capabilityScores: { ...agent.capabilityScores },
    installed: availableIds.has(agent.id),
    available: availableIds.has(agent.id),
    command: availableIds.has(agent.id) ? agent.commands[0] : null,
    executablePath: availableIds.has(agent.id) ? `/tools/${agent.commands[0]}` : null,
    executionCommand: availableIds.has(agent.id)
      ? `/tools/${agent.commands[0]}`
      : null,
    executionArgs: [],
  }));

  return new RouterService({
    registry: {
      getAgents: async () => agents,
    },
  });
}

const routingCases = [
  {
    name: 'refactor and Git favors Aider',
    task: 'ช่วย refactor authentication service และตรวจ git diff ให้ด้วย',
    expectedAgent: 'aider',
  },
  {
    name: 'architecture across a project favors OpenCode',
    task: 'ช่วยออกแบบ architecture ของ Express backend ทั้ง project',
    expectedAgent: 'opencode',
  },
  {
    name: 'review, debugging, and autonomous work favors Qwen Code',
    task: 'ช่วย review code หาบั๊ก และจัดการแก้ให้เสร็จทั้งหมด',
    expectedAgent: 'qwen-code',
  },
  {
    name: 'a small single-file edit favors Aider',
    task: 'แก้ข้อความในไฟล์เดียว เป็นการแก้เล็กน้อย',
    expectedAgent: 'aider',
  },
  {
    name: 'an unknown task uses the deterministic coding fallback',
    task: 'please improve this',
    expectedAgent: 'opencode',
  },
];

for (const routingCase of routingCases) {
  test(routingCase.name, async () => {
    const router = createRouter(['opencode']);
    const result = await router.analyzeTask(routingCase.task);

    assert.equal(result.recommendedAgent.id, routingCase.expectedAgent);
    assert.equal(result.selectedAgent.id, 'opencode');
    assert.equal(result.ranking.length, 3);
    assert.ok(result.ranking[0].score >= result.ranking[1].score);
    assert.ok(result.ranking.every((agent) => agent.reasons.length <= 3));
  });
}

test('selectedAgent is null when no registered agent is available', async () => {
  const router = createRouter([]);
  const result = await router.analyzeTask('refactor this code and inspect git diff');

  assert.equal(result.recommendedAgent.id, 'aider');
  assert.equal(result.selectedAgent, null);
});

test('analyzing the same task twice produces identical output', async () => {
  const router = createRouter(['opencode']);
  const task = 'ช่วย review code หาบั๊ก และจัดการแก้ให้เสร็จทั้งหมด';

  const first = await router.analyzeTask(task);
  const second = await router.analyzeTask(task);

  assert.deepEqual(first, second);
});
