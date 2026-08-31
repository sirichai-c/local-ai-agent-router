const fs = require('node:fs/promises');
const path = require('node:path');

const { getAdapter } = require('../agents');
const { config } = require('../config/env');
const { routerService } = require('./router.service');
const {
  agentExecutionBackendService,
} = require('./agent-execution-backend.service');

class WorkspaceValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WorkspaceValidationError';
    this.code = code;
  }
}

class AgentPlannerService {
  constructor({
    router = routerService,
    adapterResolver = getAdapter,
    model = config.ollama.model,
    ollamaBaseUrl = config.ollama.baseUrl,
    executionBackend = agentExecutionBackendService,
  } = {}) {
    this.router = router;
    this.adapterResolver = adapterResolver;
    this.model = model;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.executionBackend = executionBackend;
  }

  async resolveWorkspace(workspace) {
    if (typeof workspace !== 'string' || workspace.trim() === '') {
      throw new WorkspaceValidationError(
        'Workspace is required',
        'WORKSPACE_REQUIRED',
      );
    }

    let resolvedWorkspace;

    try {
      resolvedWorkspace = path.resolve(workspace.trim());
    } catch {
      throw new WorkspaceValidationError(
        'Workspace path is invalid',
        'WORKSPACE_INVALID',
      );
    }

    let workspaceStat;

    try {
      workspaceStat = await fs.stat(resolvedWorkspace);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new WorkspaceValidationError(
          'Workspace does not exist',
          'WORKSPACE_NOT_FOUND',
        );
      }

      throw new WorkspaceValidationError(
        'Workspace cannot be accessed',
        'WORKSPACE_INACCESSIBLE',
      );
    }

    if (!workspaceStat.isDirectory()) {
      throw new WorkspaceValidationError(
        'Workspace must be a directory',
        'WORKSPACE_NOT_DIRECTORY',
      );
    }

    return resolvedWorkspace;
  }

  async planTask({ task, workspace }) {
    if (typeof task !== 'string' || task.trim() === '') {
      throw new TypeError('task must be a non-empty string');
    }

    const resolvedWorkspace = await this.resolveWorkspace(workspace);
    const analysis = await this.router.analyzeTask(task);

    if (!analysis.selectedAgent) {
      return {
        status: 'no_available_agent',
        workspace: resolvedWorkspace,
        model: this.model,
        analysis,
        invocation: null,
      };
    }

    const adapter = this.adapterResolver(analysis.selectedAgent.id);

    if (!adapter) {
      throw new Error(`No adapter available for ${analysis.selectedAgent.id}`);
    }

    if (!analysis.selectedAgent.command) {
      throw new Error(`No detected command available for ${analysis.selectedAgent.id}`);
    }

    if (!analysis.selectedAgent.executionCommand) {
      throw new Error(`No executable command available for ${analysis.selectedAgent.id}`);
    }

    const runtimeInput = this.executionBackend.createAdapterInput(
      analysis.selectedAgent,
      resolvedWorkspace,
    );
    const invocation = adapter.buildInvocation({
      task: analysis.task,
      workspace: resolvedWorkspace,
      model: this.model,
      ...runtimeInput,
      ollamaBaseUrl: this.ollamaBaseUrl,
    });

    return {
      status: 'planned',
      selectedAgent: analysis.selectedAgent,
      classification: analysis.classification,
      model: this.model,
      invocation,
    };
  }
}

const agentPlannerService = new AgentPlannerService();

module.exports = {
  AgentPlannerService,
  WorkspaceValidationError,
  agentPlannerService,
};
