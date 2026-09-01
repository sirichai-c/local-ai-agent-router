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
const {
  HistoryPersistenceError,
  historyService,
} = require('./history.service');
const { processRunnerService } = require('./process-runner.service');
const { routerService } = require('./router.service');
const { createTaskId, worktreeService } = require('./worktree.service');
const { evaluatorService } = require('./evaluator.service');
const {
  candidateFingerprintService,
} = require('./candidate-fingerprint.service');
const {
  AgentExecutionBackendService,
} = require('./agent-execution-backend.service');
const {
  isCancellationError,
  throwIfAborted,
} = require('./cancellation.service');

const APPROVAL_ELIGIBLE_STATUSES = new Set([
  'completed',
  'completed_with_warnings',
]);

function mapExecutionStatus({ processResult, autoCommitDetected, verdict }) {
  const processSucceeded = processResult.exitCode === 0
    && !processResult.timedOut
    && !autoCommitDetected;

  if (!processSucceeded) {
    return 'failed';
  }

  if (verdict === 'pass') {
    return 'completed';
  }

  if (verdict === 'warning') {
    return 'completed_with_warnings';
  }

  return 'evaluation_failed';
}

function reportExecutionEvent(onEvent, event) {
  if (typeof onEvent !== 'function') return;

  try {
    onEvent(event);
  } catch {
    // Optional observability cannot alter the execution pipeline.
  }
}

class AgentExecutorService {
  constructor({
    router = routerService,
    adapterResolver = getAdapter,
    workspaceResolver = (workspace) => agentPlannerService.resolveWorkspace(workspace),
    git = gitService,
    worktrees = worktreeService,
    runner = processRunnerService,
    executionBackend,
    evaluator = evaluatorService,
    fingerprints = candidateFingerprintService,
    history = historyService,
    executionEnabled = config.agentExecution.enabled,
    model = config.ollama.model,
    ollamaBaseUrl = config.ollama.baseUrl,
    clock = () => new Date(),
    idFactory = createTaskId,
  } = {}) {
    this.router = router;
    this.adapterResolver = adapterResolver;
    this.workspaceResolver = workspaceResolver;
    this.git = git;
    this.worktrees = worktrees;
    this.runner = runner;
    this.executionBackend = executionBackend || new AgentExecutionBackendService({
      backend: config.agentExecution.backend,
      hostRunner: runner,
    });
    this.evaluator = evaluator;
    this.fingerprints = fingerprints;
    this.history = history;
    this.executionEnabled = executionEnabled;
    this.model = model;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.clock = clock;
    this.idFactory = idFactory;
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

  isExecutionEnabled() {
    return this.executionEnabled === true;
  }

  async assertExecutionBackendAvailable(agentId) {
    return agentId
      ? this.executionBackend.assertAvailable(agentId)
      : this.executionBackend.assertConfiguredAvailable();
  }

  async createSingleHistoryTask({ taskId, task, repository, classification }) {
    try {
      await this.history.createTask({
        id: taskId,
        task,
        workspace: repository.repo,
        mode: 'single',
        classification,
        targetBranch: repository.targetBranch,
        baseCommit: repository.baseCommit,
      });
    } catch (error) {
      throw new HistoryPersistenceError(
        'Unable to create the single-agent history record.',
        error,
      );
    }
  }

  async persistSingleResult({ taskId, agent, result }) {
    const errors = [];

    try {
      await this.history.recordExecutionResult({ taskId, agent, result });
    } catch {
      errors.push('agent_run');
    }

    try {
      await this.history.completeTask(taskId, result.status, {
        winnerAgentId: APPROVAL_ELIGIBLE_STATUSES.has(result.status)
          ? agent.id
          : null,
      });
    } catch {
      errors.push('task_completion');
    }

    return errors.length === 0
      ? { persisted: true, taskId }
      : {
        persisted: false,
        taskId,
        error: {
          code: 'HISTORY_PERSISTENCE_FAILED',
          message: 'Agent changes were preserved, but history persistence was incomplete.',
          failedOperations: errors,
        },
      };
  }

  async persistSingleFailure({ taskId, agent, error }) {
    const context = error?.candidateContext || {};
    const failedResult = {
      status: 'failed',
      selectedAgent: agent,
      execution: null,
      evaluation: { score: null, verdict: 'fail' },
      changes: { count: 0 },
      workspace: {
        branch: context.branch || null,
        worktree: context.worktreePath || null,
      },
    };

    return this.persistSingleResult({ taskId, agent, result: failedResult });
  }

  async executeTask({ task, workspace, onEvent, signal }) {
    throwIfAborted(signal);
    if (this.isExecutionEnabled()) {
      await this.assertExecutionBackendAvailable();
    }

    reportExecutionEvent(onEvent, {
      type: 'router_analyzing',
      stage: 'routing',
      status: 'running',
      messageKey: 'run.routerAnalyzing',
      data: {},
    });
    const analysis = await this.router.analyzeTask(task);
    throwIfAborted(signal);
    reportExecutionEvent(onEvent, {
      type: 'router_completed',
      stage: 'routing',
      status: 'completed',
      messageKey: 'run.routerCompleted',
      data: {
        selectedAgentId: analysis.selectedAgent?.id || null,
        classification: analysis.classification,
        ranking: (analysis.ranking || []).map((agent) => ({
          agentId: agent.id,
          score: agent.score,
          available: agent.available,
        })),
      },
    });

    if (!analysis.selectedAgent) {
      return {
        status: 'no_available_agent',
        analysis,
      };
    }

    if (!this.isExecutionEnabled()) {
      return {
        status: 'execution_disabled',
        message: 'Set AGENT_EXECUTION_ENABLED=true to allow agent execution.',
        selectedAgent: analysis.selectedAgent,
        classification: analysis.classification,
      };
    }

    reportExecutionEvent(onEvent, {
      type: 'repository_validating',
      stage: 'repository',
      status: 'running',
      messageKey: 'run.repositoryValidating',
      data: {},
    });
    const repository = await this.validateRepository(workspace);
    throwIfAborted(signal);
    reportExecutionEvent(onEvent, {
      type: 'repository_validated',
      stage: 'repository',
      status: 'completed',
      messageKey: 'run.repositoryValidated',
      data: {
        targetBranch: repository.targetBranch,
        baseCommit: repository.baseCommit,
      },
    });
    const taskId = this.idFactory();

    await this.createSingleHistoryTask({
      taskId,
      task: analysis.task,
      repository,
      classification: analysis.classification,
    });

    try {
      const result = await this.executeWithAgent({
        task: analysis.task,
        agent: analysis.selectedAgent,
        repository,
        taskId,
        classification: analysis.classification,
        onEvent,
        signal,
      });
      const history = await this.persistSingleResult({
        taskId,
        agent: analysis.selectedAgent,
        result,
      });

      return { ...result, history };
    } catch (error) {
      if (isCancellationError(error, signal)) {
        try {
          error.history = await this.history.completeTask(taskId, 'cancelled');
        } catch {
          error.history = null;
        }
        throw error;
      }
      error.history = await this.persistSingleFailure({
        taskId,
        agent: analysis.selectedAgent,
        error,
      });
      throw error;
    }
  }

  async executeWithAgent({
    task,
    agent,
    repository,
    taskId,
    classification = {},
    onEvent,
    signal,
  }) {
    throwIfAborted(signal);
    if (!this.isExecutionEnabled()) {
      return {
        status: 'execution_disabled',
        message: 'Set AGENT_EXECUTION_ENABLED=true to allow agent execution.',
        selectedAgent: agent,
        classification,
      };
    }

    if (!agent?.id || !agent.available) {
      throw new Error('Forced agent must be a known, available registry agent');
    }

    if (!repository?.repo || !repository.baseCommit) {
      throw new Error('A validated repository snapshot is required');
    }

    const adapter = this.adapterResolver(agent.id);

    if (!adapter) {
      throw new Error(`No adapter available for ${agent.id}`);
    }

    await this.assertExecutionBackendAvailable(agent.id);
    throwIfAborted(signal);

    reportExecutionEvent(onEvent, {
      type: 'worktree_creating',
      stage: 'worktree',
      status: 'running',
      messageKey: 'run.worktreeCreating',
      data: { agentId: agent.id },
    });
    const worktree = await this.worktrees.create({
      repo: repository.repo,
      agentId: agent.id,
      baseCommit: repository.baseCommit,
      taskId,
    });
    throwIfAborted(signal);
    reportExecutionEvent(onEvent, {
      type: 'worktree_created',
      stage: 'worktree',
      status: 'completed',
      messageKey: 'run.worktreeCreated',
      data: { agentId: agent.id, branch: worktree.branch },
    });
    let agentTerminalEventEmitted = false;

    try {
      const runtimeInput = this.executionBackend.createAdapterInput(
        agent,
        worktree.worktreePath,
      );
      const invocationPlan = adapter.buildInvocation({
        task,
        workspace: worktree.worktreePath,
        model: this.model,
        ...runtimeInput,
        ollamaBaseUrl: this.ollamaBaseUrl,
      });
      const invocation = typeof adapter.prepareExecution === 'function'
        ? await adapter.prepareExecution(invocationPlan)
        : invocationPlan;
      throwIfAborted(signal);
      reportExecutionEvent(onEvent, {
        type: 'agent_starting',
        stage: 'agent',
        status: 'running',
        messageKey: 'run.agentStarting',
        data: { agentId: agent.id },
      });
      const startedAt = this.clock();
      reportExecutionEvent(onEvent, {
        type: 'agent_running',
        stage: 'agent',
        status: 'running',
        messageKey: 'run.agentRunning',
        data: { agentId: agent.id },
      });
      const processResult = await this.executionBackend.run({
        invocation,
        agent,
        worktree,
        ollamaBaseUrl: this.ollamaBaseUrl,
        signal,
      });
      throwIfAborted(signal);
      const finishedAt = this.clock();
      const processSucceeded = processResult.exitCode === 0
        && !processResult.timedOut;
      reportExecutionEvent(onEvent, {
        type: processSucceeded ? 'agent_completed' : 'agent_failed',
        stage: 'agent',
        status: processSucceeded ? 'completed' : 'failed',
        messageKey: processSucceeded ? 'run.agentCompleted' : 'run.agentFailed',
        data: {
          agentId: agent.id,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          exitCode: processResult.exitCode,
          timedOut: processResult.timedOut,
        },
      });
      agentTerminalEventEmitted = true;
      const [worktreeHead, changedFiles, diff, untrackedFiles] = await Promise.all([
        this.git.getHeadCommit(worktree.worktreePath),
        this.git.getChangedFiles(worktree.worktreePath),
        this.git.getDiff(worktree.worktreePath),
        this.git.getUntrackedFiles(worktree.worktreePath),
      ]);
      const autoCommitDetected = worktreeHead !== repository.baseCommit;
      reportExecutionEvent(onEvent, {
        type: 'evaluation_starting',
        stage: 'evaluation',
        status: 'running',
        messageKey: 'run.evaluationStarting',
        data: { agentId: agent.id },
      });
      const evaluation = await this.evaluator.evaluateAgentResult({
        workspace: worktree.worktreePath,
        execution: processResult,
        baseCommit: repository.baseCommit,
        changedFiles,
        trackedDiff: diff,
        untrackedFiles,
        unexpectedCommit: autoCommitDetected,
        onEvent,
        signal,
      });
      throwIfAborted(signal);
      reportExecutionEvent(onEvent, {
        type: 'evaluation_completed',
        stage: 'evaluation',
        status: evaluation.verdict === 'fail' ? 'failed' : 'completed',
        messageKey: 'run.evaluationCompleted',
        data: {
          agentId: agent.id,
          score: evaluation.score,
          verdict: evaluation.verdict,
        },
      });
      let status = mapExecutionStatus({
        processResult,
        autoCommitDetected,
        verdict: evaluation.verdict,
      });
      let candidateFingerprint = null;
      let candidateTracking = {
        tracked: false,
        reason: 'candidate_not_eligible',
      };

      if (APPROVAL_ELIGIBLE_STATUSES.has(status)) {
        try {
          const fingerprint = await this.fingerprints.capture({
            workspace: worktree.worktreePath,
            baseCommit: repository.baseCommit,
          });
          candidateFingerprint = fingerprint.fingerprint;
          candidateTracking = { tracked: true, reason: null };
        } catch (error) {
          status = 'evaluation_failed';
          candidateTracking = {
            tracked: false,
            reason: error.code || 'candidate_fingerprint_failed',
          };
        }
      }
      const sensitiveDiffRedacted = (
        evaluation.diff?.sensitiveFiles?.length || 0
      ) > 0;

      return {
        status,
        taskId: worktree.taskId,
        selectedAgent: agent,
        candidateFingerprint,
        candidateTracking,
        classification,
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
          stdout: sensitiveDiffRedacted ? null : processResult.stdout,
          stderr: sensitiveDiffRedacted ? null : processResult.stderr,
          outputRedacted: sensitiveDiffRedacted,
          error: processResult.error,
          sandbox: processResult.sandbox || {
            backend: 'host',
          },
        },
        changes: {
          count: evaluation.summary.changedFileCount,
          files: changedFiles,
          untrackedFiles,
          diff: sensitiveDiffRedacted ? null : diff,
          diffRedacted: sensitiveDiffRedacted,
          autoCommitDetected,
        },
        evaluation,
      };
    } catch (error) {
      if (!agentTerminalEventEmitted && !isCancellationError(error, signal)) {
        reportExecutionEvent(onEvent, {
          type: 'agent_failed',
          stage: 'agent',
          status: 'failed',
          messageKey: 'run.agentFailed',
          data: { agentId: agent.id },
        });
      }
      error.candidateContext = {
        taskId: worktree.taskId,
        worktreePath: worktree.worktreePath,
        branch: worktree.branch,
        baseCommit: worktree.baseCommit,
      };
      throw error;
    }
  }
}

const agentExecutorService = new AgentExecutorService();

module.exports = {
  APPROVAL_ELIGIBLE_STATUSES,
  AgentExecutorService,
  RepositoryValidationError,
  WorkspaceValidationError,
  agentExecutorService,
  mapExecutionStatus,
  reportExecutionEvent,
};
