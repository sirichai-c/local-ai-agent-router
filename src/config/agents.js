function defineAgent(agent) {
  const capabilityScores = Object.freeze({ ...agent.capabilityScores });
  const execution = agent.execution
    ? Object.freeze({
      ...agent.execution,
      windows: agent.execution.windows
        ? Object.freeze({ ...agent.execution.windows })
        : undefined,
    })
    : undefined;

  return Object.freeze({
    ...agent,
    execution,
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
    execution: {
      windows: {
        nativeExecutableRelativePath: 'node_modules/opencode-ai/bin/opencode.exe',
      },
    },
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
    execution: {
      windows: {
        nodeEntryRelativePath: 'node_modules/@qwen-code/qwen-code/cli-entry.js',
      },
    },
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
