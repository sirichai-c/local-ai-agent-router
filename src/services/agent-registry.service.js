const agentDefinitions = require('../config/agents');
const { findCommand } = require('../utils/command.util');
const {
  resolveExecutionCommand,
} = require('../utils/execution-command.util');
const { config } = require('../config/env');
const {
  sandboxAgentRunnerService,
} = require('./sandbox-agent-runner.service');

class AgentRegistryService {
  constructor({
    agents = agentDefinitions,
    commandDetector = findCommand,
    executionCommandResolver = resolveExecutionCommand,
    executionBackend = config.agentExecution.backend,
    sandboxCapabilityProvider = (agentId) => (
      sandboxAgentRunnerService.getCapability(agentId)
    ),
  } = {}) {
    this.agents = agents;
    this.commandDetector = commandDetector;
    this.executionCommandResolver = executionCommandResolver;
    this.executionBackend = executionBackend;
    this.sandboxCapabilityProvider = sandboxCapabilityProvider;
  }

  async detectHost(agent) {
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

        return {
          installed: true,
          command,
          executablePath: detection.path,
          executionCommand,
          executionArgs,
        };
      }
    }

    return {
      installed: false,
      command: null,
      executablePath: null,
      executionCommand: null,
      executionArgs: [],
    };
  }

  async detectAgent(agent) {
    const host = await this.detectHost(agent);
    let sandbox = {
      available: false,
      backend: this.executionBackend,
      image: null,
      command: null,
      reason: this.executionBackend === 'host'
        ? 'sandbox_backend_not_selected'
        : 'sandbox_backend_unavailable',
    };

    if (this.executionBackend === 'docker') {
      sandbox = await this.sandboxCapabilityProvider(agent.id);
    } else if (this.executionBackend === 'sbx') {
      sandbox.reason = 'sbx_not_installed';
    }

    const sandboxSelected = this.executionBackend !== 'host';
    const available = sandboxSelected
      ? sandbox.available === true
      : host.installed && Boolean(host.executionCommand);
    const effectiveCommand = sandboxSelected
      ? sandbox.command
      : host.command;
    const effectiveExecutionCommand = sandboxSelected
      ? sandbox.command
      : host.executionCommand;

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: [...agent.capabilities],
      capabilityScores: { ...agent.capabilityScores },
      installed: host.installed,
      available,
      command: effectiveCommand,
      executablePath: host.executablePath,
      executionCommand: effectiveExecutionCommand,
      executionArgs: sandboxSelected ? [] : [...host.executionArgs],
      runtime: this.executionBackend,
      host: {
        installed: host.installed,
        available: host.installed && Boolean(host.executionCommand),
        command: host.command,
        executablePath: host.executablePath,
        executionCommand: host.executionCommand,
        executionArgs: [...host.executionArgs],
      },
      sandbox: {
        available: sandbox.available === true,
        backend: sandbox.backend || this.executionBackend,
        image: sandbox.image || null,
        command: sandbox.command || null,
        reason: sandbox.reason || null,
      },
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
