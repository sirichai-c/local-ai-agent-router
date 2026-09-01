const { config } = require('../config/env');
const { processRunnerService } = require('./process-runner.service');
const {
  AgentSandboxError,
  sandboxAgentRunnerService,
} = require('./sandbox-agent-runner.service');

class AgentExecutionBackendError extends Error {
  constructor(message, code = 'AGENT_EXECUTION_BACKEND_UNAVAILABLE') {
    super(message);
    this.name = 'AgentExecutionBackendError';
    this.code = code;
    this.statusCode = 503;
  }
}

class AgentExecutionBackendService {
  constructor({
    backend = config.agentExecution.backend,
    hostRunner = processRunnerService,
    sandboxRunner = sandboxAgentRunnerService,
  } = {}) {
    this.backend = backend;
    this.hostRunner = hostRunner;
    this.sandboxRunner = sandboxRunner;
  }

  isSandboxed() {
    return this.backend !== 'host';
  }

  async assertAvailable(agentId) {
    if (this.backend === 'host') {
      return { available: true, backend: 'host' };
    }

    if (this.backend === 'sbx') {
      throw new AgentExecutionBackendError(
        'AGENT_EXECUTION_BACKEND=sbx is unavailable because sbx is not installed.',
        'SBX_BACKEND_UNAVAILABLE',
      );
    }

    try {
      return await this.sandboxRunner.assertAvailable(agentId);
    } catch (error) {
      if (error instanceof AgentSandboxError) {
        throw new AgentExecutionBackendError(error.message, error.code);
      }

      throw error;
    }
  }

  async assertConfiguredAvailable() {
    if (this.backend === 'host') {
      return { available: true, backend: 'host' };
    }

    if (this.backend === 'sbx') {
      throw new AgentExecutionBackendError(
        'AGENT_EXECUTION_BACKEND=sbx is unavailable because sbx is not installed.',
        'SBX_BACKEND_UNAVAILABLE',
      );
    }

    const capability = await this.sandboxRunner.inspectImage();

    if (!capability.available) {
      throw new AgentExecutionBackendError(
        'Docker Agent sandbox image is unavailable; host fallback is forbidden.',
        'AGENT_SANDBOX_UNAVAILABLE',
      );
    }

    return capability;
  }

  createAdapterInput(agent, workspace) {
    if (this.backend === 'host') {
      return {
        command: agent.command,
        executionCommand: agent.executionCommand,
        executionArgs: agent.executionArgs,
        runtime: { backend: 'host', workspace },
      };
    }

    if (this.backend === 'sbx') {
      throw new AgentExecutionBackendError(
        'SBX backend is configured but unavailable; host fallback is forbidden.',
        'SBX_BACKEND_UNAVAILABLE',
      );
    }

    if (!agent.sandbox?.command) {
      throw new AgentExecutionBackendError(
        `Agent ${agent.id} is not available in the Docker sandbox image.`,
        'AGENT_SANDBOX_UNAVAILABLE',
      );
    }

    return {
      command: agent.sandbox.command,
      executionCommand: agent.sandbox.command,
      executionArgs: [],
      runtime: { backend: 'docker', workspace: '/workspace' },
    };
  }

  async run({ invocation, agent, worktree, ollamaBaseUrl, signal }) {
    await this.assertAvailable(agent.id);

    if (this.backend === 'host') {
      return this.hostRunner.runProcess(signal === undefined
        ? invocation
        : { ...invocation, signal });
    }

    return this.sandboxRunner.run({
      invocation,
      agent,
      worktree,
      ollamaBaseUrl,
      signal,
    });
  }
}

const agentExecutionBackendService = new AgentExecutionBackendService();

module.exports = {
  AgentExecutionBackendError,
  AgentExecutionBackendService,
  agentExecutionBackendService,
};
