function defineAgent(agent) {
  const capabilityScores = Object.freeze({ ...agent.capabilityScores });

  return Object.freeze({
    ...agent,
    commands: Object.freeze([...agent.commands]),
    capabilities: Object.freeze(Object.keys(capabilityScores)),
    capabilityScores,
  });
}

const agentDefinitions = [
  {
    id: 'opencode',
    name: 'OpenCode',
    commands: ['opencode'],
    description: 'Terminal coding agent for implementing and exploring software projects.',
    capabilityScores: {
      coding: 95,
      debugging: 90,
      refactor: 85,
      git: 75,
      review: 85,
      architecture: 95,
      multiFile: 95,
      terminal: 95,
      autonomous: 90,
      smallChange: 75,
    },
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    commands: ['qwen', 'qwen-code'],
    description: 'Terminal coding agent designed for Qwen models and autonomous code tasks.',
    capabilityScores: {
      coding: 95,
      debugging: 92,
      refactor: 85,
      git: 75,
      review: 92,
      architecture: 88,
      multiFile: 90,
      terminal: 88,
      autonomous: 95,
      smallChange: 80,
    },
  },
  {
    id: 'aider',
    name: 'Aider',
    commands: ['aider'],
    description: 'AI pair-programming agent focused on repository-aware code changes.',
    capabilityScores: {
      coding: 82,
      debugging: 75,
      refactor: 98,
      git: 100,
      review: 92,
      architecture: 65,
      multiFile: 78,
      terminal: 65,
      autonomous: 60,
      smallChange: 100,
    },
  },
].map(defineAgent);

module.exports = Object.freeze(agentDefinitions);
