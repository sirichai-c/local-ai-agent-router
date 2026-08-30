const { getAdapter } = require('../agents');
const { config } = require('../config/env');
const {
  WorkspaceValidationError,
  agentPlannerService,
} = require('./agent-planner.service');
const {
  GitCommandError,
  RepositoryValidationError,
  gitService,
} = require('./git.service');
const { processRunnerService } = require('./process-runner.service');
const { routerService } = require('./router.service');
const { worktreeService } = require('./worktree.service');

class AgentExecutorService {
  constructor({
    router = routerService,
    adapterResolver = getAdapter,
    workspaceResolver = (workspace) => agentPlannerService.resolveWorkspace(workspace),
    git = gitService,
    worktrees = worktreeService,
    runner = processRunnerService,
    executionEnabled = config.agentExecution.enabled,
    model = config.ollama.model,
    ollamaBaseUrl = config.ollama.baseUrl,
    clock = () => new Date(),
  } = {}) {
    this.router = router;
    this.adapterResolver = adapterResolver;
    this.workspaceResolver = workspaceResolver;
    this.git = git;
    this.worktrees = worktrees;
    this.runner = runner;
    this.executionEnabled = executionEnabled;
    this.model = model;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.clock = clock;
  }

  async validateRepository(workspace) {
    const resolvedWorkspace = await this.workspaceResolver(workspace);
    const repo = await this.git.getRepoRoot(resolvedWorkspace);
    let baseCommit;

    try {
      baseCommit = await this.git.getHeadCommit(repo);
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw new RepositoryValidationError(
          'Repository does not have a valid HEAD commit.',
          'INVALID_HEAD',
        );
      }

      throw error;
    }

    const [targetBranch, clean] = await Promise.all([
      this.git.getCurrentBranch(repo),
      this.git.isClean(repo),
    ]);

    if (!targetBranch) {
      throw new RepositoryValidationError(
        'Detached HEAD repositories are not supported for agent execution.',
        'DETACHED_HEAD',
      );
    }

    if (!clean) {
      throw new RepositoryValidationError(
        'Repository has uncommitted changes. Commit or stash them before agent execution.',
        'REPOSITORY_NOT_CLEAN',
      );
    }

    return {
      requestedWorkspace: resolvedWorkspace,
      repo,
      targetBranch,
      baseCommit,
    };
  }

  async executeTask({ task, workspace }) {
    const analysis = await this.router.analyzeTask(task);

    if (!analysis.selectedAgent) {
      return {
        status: 'no_available_agent',
        analysis,
      };
    }

    if (!this.executionEnabled) {
      return {
        status: 'execution_disabled',
        message: 'Set AGENT_EXECUTION_ENABLED=true to allow agent execution.',
        selectedAgent: analysis.selectedAgent,
        classification: analysis.classification,
      };
    }

    const adapter = this.adapterResolver(analysis.selectedAgent.id);

    if (!adapter) {
      throw new Error(`No adapter available for ${analysis.selectedAgent.id}`);
    }

    if (!analysis.selectedAgent.executionCommand) {
      throw new Error(
        `No spawn-safe executable available for ${analysis.selectedAgent.id}`,
      );
    }

    const repository = await this.validateRepository(workspace);
    const worktree = await this.worktrees.create({
      repo: repository.repo,
      agentId: analysis.selectedAgent.id,
      baseCommit: repository.baseCommit,
    });
    const invocationPlan = adapter.buildInvocation({
      task: analysis.task,
      workspace: worktree.worktreePath,
      model: this.model,
      command: analysis.selectedAgent.command,
      executionCommand: analysis.selectedAgent.executionCommand,
      executionArgs: analysis.selectedAgent.executionArgs,
      ollamaBaseUrl: this.ollamaBaseUrl,
    });
    const invocation = typeof adapter.prepareExecution === 'function'
      ? await adapter.prepareExecution(invocationPlan)
      : invocationPlan;
    const startedAt = this.clock();
    const processResult = await this.runner.runProcess(invocation);
    const finishedAt = this.clock();
    const [worktreeHead, changedFiles, diff] = await Promise.all([
      this.git.getHeadCommit(worktree.worktreePath),
      this.git.getChangedFiles(worktree.worktreePath),
      this.git.getDiff(worktree.worktreePath),
    ]);
    const autoCommitDetected = worktreeHead !== repository.baseCommit;
    const executionSucceeded = processResult.exitCode === 0
      && !processResult.timedOut
      && !autoCommitDetected;

    return {
      status: executionSucceeded ? 'completed' : 'failed',
      taskId: worktree.taskId,
      selectedAgent: analysis.selectedAgent,
      classification: analysis.classification,
      workspace: {
        requested: repository.requestedWorkspace,
        original: repository.repo,
        worktree: worktree.worktreePath,
        targetBranch: repository.targetBranch,
        branch: worktree.branch,
        baseCommit: repository.baseCommit,
        headCommit: worktreeHead,
      },
      execution: {
        command: processResult.command,
        args: processResult.args,
        cwd: processResult.cwd,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        exitCode: processResult.exitCode,
        timedOut: processResult.timedOut,
        outputTruncated: processResult.outputTruncated,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        error: processResult.error,
      },
      changes: {
        count: changedFiles.length,
        files: changedFiles,
        diff,
        autoCommitDetected,
      },
    };
  }
}

const agentExecutorService = new AgentExecutorService();

module.exports = {
  AgentExecutorService,
  RepositoryValidationError,
  WorkspaceValidationError,
  agentExecutorService,
};
