const { config } = require('../config/env');
const {
  competitionEvaluator,
} = require('../evaluators/competition.evaluator');
const { agentExecutorService } = require('./agent-executor.service');
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

function toCandidateResult(result, routerScore) {
  const trackedDiff = result.evaluation?.diff || {};

  return {
    agent: {
      id: result.selectedAgent.id,
      name: result.selectedAgent.name,
    },
    routerScore,
    status: result.status,
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

function toFailedCandidate(agent, routerScore, repository, error) {
  const context = error?.candidateContext || {};

  return {
    agent: { id: agent.id, name: agent.name },
    routerScore,
    status: 'failed',
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

  async compete({ task, workspace, agentIds }) {
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

    const analysis = await this.router.analyzeTask(task);
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

    const repository = await this.executor.validateRepository(workspace);
    const competitionId = this.idFactory();
    const candidates = [];

    // Deliberately sequential: local agents share one Ollama/GPU runtime.
    for (const agent of selectedAgents) {
      try {
        const result = await this.executor.executeWithAgent({
          task: analysis.task,
          agent,
          repository,
          taskId: competitionId,
          classification: analysis.classification,
        });
        candidates.push(toCandidateResult(result, agent.score));
      } catch (error) {
        candidates.push(toFailedCandidate(
          agent,
          agent.score,
          repository,
          error,
        ));
      }
    }

    const comparison = this.evaluator.evaluate(candidates);

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
