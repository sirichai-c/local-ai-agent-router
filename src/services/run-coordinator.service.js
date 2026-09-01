const {
  APPROVAL_ELIGIBLE_STATUSES,
  agentExecutorService,
} = require('./agent-executor.service');
const { competitionService } = require('./competition.service');
const { runSessionService } = require('./run-session.service');

class RunStartError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = 'RunStartError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sanitizeStaticCheck(check) {
  return {
    type: check.type || null,
    file: check.file || null,
    applicable: check.applicable === true,
    passed: check.passed ?? null,
    skipped: check.skipped === true,
    reason: check.reason || null,
  };
}

function sanitizeProject(project) {
  if (!project) return null;

  return {
    projectType: project.projectType || null,
    packageJson: project.packageJson
      ? {
        exists: project.packageJson.exists,
        valid: project.packageJson.valid,
      }
      : null,
    sandbox: project.sandbox
      ? {
        executed: project.sandbox.executed === true,
        image: project.sandbox.image || null,
        reason: project.sandbox.reason || null,
        sourceMutated: project.sandbox.sourceMutated,
      }
      : null,
    scripts: Object.fromEntries(Object.entries(project.scripts || {}).map(
      ([name, check]) => [name, {
        type: check.type || `npm-${name}`,
        available: check.available === true,
        executed: check.executed === true,
        sandbox: check.sandbox === true,
        network: check.network || null,
        passed: check.passed ?? null,
        exitCode: check.exitCode ?? null,
        timedOut: check.timedOut === true,
        reason: check.reason || null,
      }],
    )),
  };
}

function sanitizeEvaluation(evaluation) {
  if (!evaluation) return null;

  return {
    score: evaluation.score ?? null,
    verdict: evaluation.verdict || null,
    hardFail: evaluation.hardFail === true,
    hardFailCodes: [...(evaluation.hardFailCodes || [])],
    summary: evaluation.summary || null,
    staticChecks: (evaluation.staticChecks || []).map(sanitizeStaticCheck),
    project: sanitizeProject(evaluation.project),
    reasons: (evaluation.reasons || []).map((reason) => ({
      code: reason.code || null,
      impact: reason.impact ?? null,
      file: reason.file || null,
    })),
  };
}

function sanitizeAgent(agent) {
  if (!agent) return null;
  return { id: agent.id, name: agent.name };
}

function summarizeSingleResult(result) {
  return {
    status: result.status,
    taskId: result.taskId || result.history?.taskId || null,
    selectedAgent: sanitizeAgent(result.selectedAgent),
    candidateAvailable: APPROVAL_ELIGIBLE_STATUSES.has(result.status)
      && Boolean(result.candidateFingerprint),
    evaluation: sanitizeEvaluation(result.evaluation),
    execution: result.execution
      ? {
        startedAt: result.execution.startedAt || null,
        finishedAt: result.execution.finishedAt || null,
        durationMs: result.execution.durationMs ?? null,
        exitCode: result.execution.exitCode ?? null,
        timedOut: result.execution.timedOut === true,
        outputTruncated: result.execution.outputTruncated === true,
        outputRedacted: result.execution.outputRedacted === true,
        sandbox: result.execution.sandbox
          ? {
            backend: result.execution.sandbox.backend || null,
            image: result.execution.sandbox.image || null,
            network: result.execution.sandbox.network || null,
            ollamaVerified: result.execution.sandbox.ollamaVerified === true,
          }
          : null,
      }
      : null,
    changes: result.changes
      ? {
        count: result.changes.count ?? 0,
        files: result.changes.files || [],
        untrackedFiles: result.changes.untrackedFiles || [],
        diffRedacted: result.changes.diffRedacted === true,
        autoCommitDetected: result.changes.autoCommitDetected === true,
      }
      : null,
    workspace: result.workspace
      ? {
        targetBranch: result.workspace.targetBranch || null,
        branch: result.workspace.branch || null,
        baseCommit: result.workspace.baseCommit || null,
      }
      : null,
  };
}

function summarizeCompetitionResult(result) {
  return {
    status: result.status,
    competitionId: result.competitionId || result.history?.taskId || null,
    executionMode: result.executionMode,
    executionOrder: result.executionOrder || [],
    candidateAvailable: Boolean(result.winner),
    winner: result.winner || null,
    ranking: result.ranking || [],
    candidates: (result.candidates || []).map((candidate) => ({
      agent: sanitizeAgent(candidate.agent),
      status: candidate.status,
      routerScore: candidate.routerScore,
      durationMs: candidate.durationMs,
      evaluation: sanitizeEvaluation(candidate.evaluation),
      changes: candidate.changes,
    })),
    repository: result.repository
      ? {
        targetBranch: result.repository.targetBranch || null,
        baseCommit: result.repository.baseCommit || null,
      }
      : null,
  };
}

function toSafeRunError(error) {
  const code = typeof error?.code === 'string'
    && /^[A-Za-z0-9_-]{1,80}$/u.test(error.code)
    ? error.code
    : 'RUN_EXECUTION_FAILED';

  return {
    code,
    message: 'The accepted real-time run failed. Persistent history may contain its final metadata.',
  };
}

class RunCoordinatorService {
  constructor({
    sessions = runSessionService,
    executor = agentExecutorService,
    competition = competitionService,
    schedule = (callback) => setImmediate(callback),
  } = {}) {
    this.sessions = sessions;
    this.executor = executor;
    this.competition = competition;
    this.schedule = schedule;
  }

  async assertCanStart() {
    if (!this.executor.isExecutionEnabled()) {
      throw new RunStartError(
        'Agent execution is disabled by server configuration.',
        'EXECUTION_DISABLED',
        409,
      );
    }

    if (typeof this.executor.assertExecutionBackendAvailable === 'function') {
      await this.executor.assertExecutionBackendAvailable();
    }
  }

  report(runId, event) {
    try {
      this.sessions.append(runId, event);
    } catch {
      // Observability must not change execution semantics.
    }
  }

  failRun(runId, error, eventData = {}) {
    const failureStage = this.sessions.snapshot(runId)?.currentStage || 'failed';
    this.sessions.fail(runId, error, {
      ...eventData,
      stage: failureStage,
    });
  }

  startBackground(callback) {
    this.schedule(() => Promise.resolve(callback()).catch(() => {
        // The run method records a safe terminal failure itself.
      }));
  }

  async startSingle({ task, workspace }) {
    await this.assertCanStart();
    const session = this.sessions.create('single');
    this.report(session.id, {
      type: 'run_started',
      stage: 'initializing',
      status: 'running',
      messageKey: 'run.started',
      data: { runType: 'single' },
    });
    this.startBackground(() => this.runSingle(session.id, { task, workspace }));
    return this.sessions.snapshot(session.id);
  }

  async startCompetition({ task, workspace, agentIds }) {
    await this.assertCanStart();
    const session = this.sessions.create('competition');
    this.report(session.id, {
      type: 'run_started',
      stage: 'initializing',
      status: 'running',
      messageKey: 'run.started',
      data: { runType: 'competition' },
    });
    this.startBackground(() => this.runCompetition(session.id, {
      task,
      workspace,
      agentIds,
    }));
    return this.sessions.snapshot(session.id);
  }

  async runSingle(runId, input) {
    try {
      const result = await this.executor.executeTask({
        ...input,
        onEvent: (event) => this.report(runId, event),
      });
      const summary = summarizeSingleResult(result);
      this.sessions.updateIdentity(runId, { taskId: summary.taskId });

      if (summary.candidateAvailable) {
        this.report(runId, {
          type: 'candidate_ready',
          stage: 'candidate',
          status: 'completed',
          messageKey: 'run.candidateReady',
          data: { taskId: summary.taskId },
        });
      }

      if (result.status === 'failed'
        || result.status === 'no_available_agent'
        || result.status === 'execution_disabled') {
        const error = {
          code: `RUN_${String(result.status).toUpperCase()}`,
          message: 'The Agent run did not produce an approvable result.',
        };
        this.failRun(runId, error, {
          code: error.code,
          resultStatus: result.status,
          taskId: summary.taskId,
        });
        return;
      }

      this.sessions.complete(runId, summary, {
        taskId: summary.taskId,
        resultStatus: summary.status,
        verdict: summary.evaluation?.verdict || null,
        candidateAvailable: summary.candidateAvailable,
      });
    } catch (error) {
      const safeError = toSafeRunError(error);
      this.failRun(runId, safeError, { code: safeError.code });
    }
  }

  async runCompetition(runId, input) {
    try {
      const result = await this.competition.compete({
        ...input,
        onEvent: (event) => this.report(runId, event),
      });
      const summary = summarizeCompetitionResult(result);
      this.sessions.updateIdentity(runId, {
        competitionId: summary.competitionId,
      });

      if (summary.candidateAvailable) {
        this.report(runId, {
          type: 'candidate_ready',
          stage: 'candidate',
          status: 'completed',
          messageKey: 'run.candidateReady',
          data: {
            taskId: summary.competitionId,
            agentId: summary.winner?.agentId || null,
          },
        });
      }

      if (['execution_disabled', 'insufficient_competitors'].includes(result.status)) {
        const error = {
          code: `RUN_${String(result.status).toUpperCase()}`,
          message: 'The competition could not produce a ranking.',
        };
        this.failRun(runId, error, {
          code: error.code,
          resultStatus: result.status,
        });
        return;
      }

      this.sessions.complete(runId, summary, {
        competitionId: summary.competitionId,
        resultStatus: summary.status,
        winnerAgentId: summary.winner?.agentId || null,
        candidateAvailable: summary.candidateAvailable,
      });
    } catch (error) {
      const safeError = toSafeRunError(error);
      this.failRun(runId, safeError, { code: safeError.code });
    }
  }
}

const runCoordinatorService = new RunCoordinatorService();

module.exports = {
  RunCoordinatorService,
  RunStartError,
  runCoordinatorService,
  sanitizeEvaluation,
  summarizeCompetitionResult,
  summarizeSingleResult,
  toSafeRunError,
};
