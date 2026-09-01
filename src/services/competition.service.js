const { config } = require('../config/env');
const {
  competitionEvaluator,
} = require('../evaluators/competition.evaluator');
const {
  agentExecutorService,
  reportExecutionEvent,
} = require('./agent-executor.service');
const {
  HistoryPersistenceError,
  historyService,
} = require('./history.service');
const { routerService } = require('./router.service');
const { createTaskId } = require('./worktree.service');

class CompetitionValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CompetitionValidationError';
    this.code = code;
  }
}

function normalizeAgentIds(agentIds) {
  if (agentIds === undefined) {
    return null;
  }

  if (!Array.isArray(agentIds)) {
    throw new CompetitionValidationError(
      'agents must be an array of agent IDs',
      'INVALID_AGENT_LIST',
    );
  }

  const normalized = agentIds.map((agentId) => {
    if (typeof agentId !== 'string' || agentId.trim() === '') {
      throw new CompetitionValidationError(
        'agents must contain only non-empty string IDs',
        'INVALID_AGENT_LIST',
      );
    }

    return agentId.trim().toLowerCase();
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new CompetitionValidationError(
      'agents must not contain duplicate IDs',
      'DUPLICATE_AGENT_ID',
    );
  }

  return normalized;
}

function toCandidateResult(result, agent) {
  const trackedDiff = result.evaluation?.diff || {};

  return {
    agent: {
      id: result.selectedAgent.id,
      name: result.selectedAgent.name,
    },
    routerScore: agent.score,
    staticScore: agent.staticScore ?? agent.score,
    adaptiveScore: agent.adaptive ? agent.score : null,
    adaptive: agent.adaptive ?? false,
    status: result.status,
    candidateFingerprint: result.candidateFingerprint || null,
    durationMs: result.execution?.durationMs ?? null,
    branch: result.workspace?.branch ?? null,
    worktree: result.workspace?.worktree ?? null,
    baseCommit: result.workspace?.baseCommit ?? null,
    execution: result.execution,
    evaluation: result.evaluation,
    changedFiles: result.changes?.files || [],
    untrackedFiles: result.changes?.untrackedFiles || [],
    trackedDiff: {
      bytes: trackedDiff.trackedDiffBytes ?? 0,
      tooLarge: trackedDiff.diffTooLarge ?? false,
      redacted: result.changes?.diffRedacted ?? false,
    },
    changes: {
      count: result.changes?.count ?? 0,
      autoCommitDetected: result.changes?.autoCommitDetected ?? false,
    },
  };
}

function toFailedCandidate(agent, repository, error) {
  const context = error?.candidateContext || {};

  return {
    agent: { id: agent.id, name: agent.name },
    routerScore: agent.score,
    staticScore: agent.staticScore ?? agent.score,
    adaptiveScore: agent.adaptive ? agent.score : null,
    adaptive: agent.adaptive ?? false,
    status: 'failed',
    candidateFingerprint: null,
    durationMs: null,
    branch: context.branch || null,
    worktree: context.worktreePath || null,
    baseCommit: context.baseCommit || repository.baseCommit,
    execution: null,
    evaluation: {
      score: 0,
      verdict: 'fail',
      reasons: [{
        code: 'CANDIDATE_EXECUTION_ERROR',
        impact: -100,
      }],
    },
    changedFiles: [],
    untrackedFiles: [],
    trackedDiff: { bytes: 0, tooLarge: false, redacted: false },
    changes: { count: 0, autoCommitDetected: false },
    error: {
      code: 'CANDIDATE_EXECUTION_ERROR',
      message: 'Candidate execution failed before a complete result was available.',
    },
  };
}

class CompetitionService {
  constructor({
    router = routerService,
    executor = agentExecutorService,
    evaluator = competitionEvaluator,
    history = historyService,
    maxAgents = config.competition.maxAgents,
    executionMode = config.competition.executionMode,
    idFactory = createTaskId,
  } = {}) {
    if (executionMode !== 'sequential') {
      throw new Error('Only sequential competition execution is supported');
    }

    if (!Number.isSafeInteger(maxAgents) || maxAgents < 1) {
      throw new Error('Competition maxAgents must be a positive integer');
    }

    this.router = router;
    this.executor = executor;
    this.evaluator = evaluator;
    this.history = history;
    this.maxAgents = maxAgents;
    this.executionMode = executionMode;
    this.idFactory = idFactory;
  }

  selectCandidates(analysis, normalizedAgentIds) {
    if (normalizedAgentIds) {
      const agentsById = new Map(
        analysis.ranking.map((agent) => [agent.id, agent]),
      );

      return normalizedAgentIds.map((agentId) => {
        const agent = agentsById.get(agentId);

        if (!agent) {
          throw new CompetitionValidationError(
            `Unknown agent: ${agentId}`,
            'UNKNOWN_AGENT',
          );
        }

        if (!agent.available) {
          throw new CompetitionValidationError(
            `Agent is unavailable: ${agentId}`,
            'AGENT_UNAVAILABLE',
          );
        }

        return agent;
      });
    }

    return analysis.ranking
      .filter((agent) => agent.available)
      .slice(0, this.maxAgents);
  }

  async createCompetitionHistoryTask({
    competitionId,
    analysis,
    repository,
  }) {
    try {
      await this.history.createTask({
        id: competitionId,
        task: analysis.task,
        workspace: repository.repo,
        mode: 'competition',
        classification: analysis.classification,
        targetBranch: repository.targetBranch,
        baseCommit: repository.baseCommit,
      });
    } catch (error) {
      throw new HistoryPersistenceError(
        'Unable to create the competition history record.',
        error,
      );
    }
  }

  async persistCompetitionResults({
    competitionId,
    selectedAgents,
    candidates,
    comparison,
  }) {
    const errors = [];
    const scoresByAgentId = new Map(
      comparison.ranking.map((entry) => [
        entry.agentId,
        entry.competitionScore,
      ]),
    );

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const agent = selectedAgents[index];

      try {
        await this.history.recordExecutionResult({
          taskId: competitionId,
          agent,
          result: candidate,
          competitionScore: scoresByAgentId.get(agent.id) ?? null,
        });
      } catch {
        errors.push(`agent_run:${agent.id}`);
      }
    }

    try {
      await this.history.completeTask(competitionId, comparison.status, {
        winnerAgentId: comparison.winner?.agentId || null,
      });
    } catch {
      errors.push('task_completion');
    }

    return errors.length === 0
      ? { persisted: true, taskId: competitionId }
      : {
        persisted: false,
        taskId: competitionId,
        error: {
          code: 'HISTORY_PERSISTENCE_FAILED',
          message: 'Competition candidates were preserved, but history persistence was incomplete.',
          failedOperations: errors,
        },
      };
  }

  async compete({ task, workspace, agentIds, onEvent }) {
    const normalizedAgentIds = normalizeAgentIds(agentIds);

    if (normalizedAgentIds && normalizedAgentIds.length > this.maxAgents) {
      throw new CompetitionValidationError(
        `A competition supports at most ${this.maxAgents} agents`,
        'TOO_MANY_AGENTS',
      );
    }

    if (!this.executor.isExecutionEnabled()) {
      return {
        status: 'execution_disabled',
        message: 'Set AGENT_EXECUTION_ENABLED=true to allow agent execution.',
        competitionId: null,
        executionMode: this.executionMode,
        candidates: [],
        ranking: [],
        winner: null,
      };
    }

    if (typeof this.executor.assertExecutionBackendAvailable === 'function') {
      await this.executor.assertExecutionBackendAvailable();
    }

    reportExecutionEvent(onEvent, {
      type: 'router_analyzing',
      stage: 'routing',
      status: 'running',
      messageKey: 'run.routerAnalyzing',
      data: {},
    });
    const analysis = await this.router.analyzeTask(task);
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
    const selectedAgents = this.selectCandidates(analysis, normalizedAgentIds);

    if (selectedAgents.length < 2) {
      return {
        status: 'insufficient_competitors',
        message: 'At least two available agents are required for competition.',
        competitionId: null,
        executionMode: this.executionMode,
        analysis,
        candidates: selectedAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          available: agent.available,
          routerScore: agent.score,
        })),
        ranking: [],
        winner: null,
      };
    }

    reportExecutionEvent(onEvent, {
      type: 'competition_started',
      stage: 'competition',
      status: 'running',
      messageKey: 'run.competitionStarted',
      data: { agentIds: selectedAgents.map((agent) => agent.id) },
    });
    reportExecutionEvent(onEvent, {
      type: 'repository_validating',
      stage: 'repository',
      status: 'running',
      messageKey: 'run.repositoryValidating',
      data: {},
    });
    const repository = await this.executor.validateRepository(workspace);
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
    const competitionId = this.idFactory();
    const candidates = [];

    await this.createCompetitionHistoryTask({
      competitionId,
      analysis,
      repository,
    });

    // Deliberately sequential: local agents share one Ollama/GPU runtime.
    for (const agent of selectedAgents) {
      reportExecutionEvent(onEvent, {
        type: 'competition_candidate_starting',
        stage: 'competition',
        status: 'running',
        messageKey: 'run.competitionCandidateStarting',
        data: { agentId: agent.id },
      });
      try {
        const result = await this.executor.executeWithAgent({
          task: analysis.task,
          agent,
          repository,
          taskId: competitionId,
          classification: analysis.classification,
          onEvent,
        });
        const candidate = toCandidateResult(result, agent);
        candidates.push(candidate);
        reportExecutionEvent(onEvent, {
          type: 'competition_candidate_completed',
          stage: 'competition',
          status: candidate.status === 'failed' ? 'failed' : 'completed',
          messageKey: 'run.competitionCandidateCompleted',
          data: {
            agentId: agent.id,
            status: candidate.status,
            score: candidate.evaluation?.score ?? null,
            verdict: candidate.evaluation?.verdict || null,
          },
        });
      } catch (error) {
        const candidate = toFailedCandidate(
          agent,
          repository,
          error,
        );
        candidates.push(candidate);
        reportExecutionEvent(onEvent, {
          type: 'competition_candidate_completed',
          stage: 'competition',
          status: 'failed',
          messageKey: 'run.competitionCandidateCompleted',
          data: { agentId: agent.id, status: candidate.status },
        });
      }
    }

    const comparison = this.evaluator.evaluate(candidates);
    reportExecutionEvent(onEvent, {
      type: 'competition_ranking',
      stage: 'competition',
      status: 'completed',
      messageKey: 'run.competitionRanking',
      data: {
        winnerAgentId: comparison.winner?.agentId || null,
        ranking: comparison.ranking,
      },
    });
    const history = await this.persistCompetitionResults({
      competitionId,
      selectedAgents,
      candidates,
      comparison,
    });

    return {
      status: comparison.status,
      competitionId,
      executionMode: this.executionMode,
      executionOrder: selectedAgents.map((agent) => agent.id),
      task: analysis.task,
      classification: analysis.classification,
      repository: {
        original: repository.repo,
        targetBranch: repository.targetBranch,
        baseCommit: repository.baseCommit,
      },
      weights: comparison.weights,
      candidates,
      ranking: comparison.ranking,
      winner: comparison.winner,
      history,
    };
  }
}

const competitionService = new CompetitionService();

module.exports = {
  CompetitionService,
  CompetitionValidationError,
  competitionService,
  normalizeAgentIds,
  toCandidateResult,
};
