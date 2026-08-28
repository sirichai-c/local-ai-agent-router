const agentDefinitions = [
  {
    id: 'opencode',
    name: 'OpenCode',
    commands: ['opencode'],
    description: 'Terminal coding agent for implementing and exploring software projects.',
    capabilities: ['coding', 'architecture', 'multi-file', 'debugging'],
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    commands: ['qwen', 'qwen-code'],
    description: 'Terminal coding agent designed for Qwen models and autonomous code tasks.',
    capabilities: ['coding', 'debugging', 'review', 'autonomous'],
  },
  {
    id: 'aider',
    name: 'Aider',
    commands: ['aider'],
    description: 'AI pair-programming agent focused on repository-aware code changes.',
    capabilities: ['coding', 'refactor', 'git', 'review', 'small-change'],
  },
].map((agent) => Object.freeze({
  ...agent,
  commands: Object.freeze([...agent.commands]),
  capabilities: Object.freeze([...agent.capabilities]),
}));

module.exports = Object.freeze(agentDefinitions);
