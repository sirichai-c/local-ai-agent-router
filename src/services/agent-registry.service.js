const agentDefinitions = require('../config/agents');
const { findCommand } = require('../utils/command.util');
const {
  resolveExecutionCommand,
} = require('../utils/execution-command.util');

class AgentRegistryService {
  constructor({
    agents = agentDefinitions,
    commandDetector = findCommand,
    executionCommandResolver = resolveExecutionCommand,
  } = {}) {
    this.agents = agents;
    this.commandDetector = commandDetector;
    this.executionCommandResolver = executionCommandResolver;
  }

  async detectAgent(agent) {
    for (const command of agent.commands) {
      const detection = await this.commandDetector(command);

      if (detection.exists) {
        const execution = await this.executionCommandResolver(
          agent,
          detection,
        );
        const executionCommand = typeof execution === 'string'
          ? execution
          : execution?.command || null;
        const executionArgs = typeof execution === 'string'
          ? []
          : execution?.args || [];

        return this.toRegistryEntry(agent, {
          installed: true,
          command,
          executablePath: detection.path,
          executionCommand,
          executionArgs,
        });
      }
    }

    return this.toRegistryEntry(agent, {
      installed: false,
      command: null,
      executablePath: null,
      executionCommand: null,
      executionArgs: [],
    });
  }

  toRegistryEntry(agent, {
    installed,
    command,
    executablePath,
    executionCommand,
    executionArgs,
  }) {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: [...agent.capabilities],
      capabilityScores: { ...agent.capabilityScores },
      installed,
      available: installed && Boolean(executionCommand),
      command,
      executablePath,
      executionCommand,
      executionArgs: [...executionArgs],
    };
  }

  async getAgents() {
    return Promise.all(this.agents.map((agent) => this.detectAgent(agent)));
  }

  async getAgentById(id) {
    const agent = this.agents.find((candidate) => candidate.id === id);

    if (!agent) {
      return null;
    }

    return this.detectAgent(agent);
  }
}

const agentRegistryService = new AgentRegistryService();

module.exports = {
  AgentRegistryService,
  agentRegistryService,
};
