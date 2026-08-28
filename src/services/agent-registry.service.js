const agentDefinitions = require('../config/agents');
const { findCommand } = require('../utils/command.util');

class AgentRegistryService {
  constructor({
    agents = agentDefinitions,
    commandDetector = findCommand,
  } = {}) {
    this.agents = agents;
    this.commandDetector = commandDetector;
  }

  async detectAgent(agent) {
    for (const command of agent.commands) {
      const detection = await this.commandDetector(command);

      if (detection.exists) {
        return this.toRegistryEntry(agent, {
          installed: true,
          command,
          executablePath: detection.path,
        });
      }
    }

    return this.toRegistryEntry(agent, {
      installed: false,
      command: null,
      executablePath: null,
    });
  }

  toRegistryEntry(agent, { installed, command, executablePath }) {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: [...agent.capabilities],
      installed,
      available: installed,
      command,
      executablePath,
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
