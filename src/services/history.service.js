const { databaseService } = require('./database.service');

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

class HistoryNotFoundError extends Error {
  constructor(taskId) {
    super(`History task not found: ${taskId}`);
    this.name = 'HistoryNotFoundError';
    this.code = 'HISTORY_TASK_NOT_FOUND';
  }
}

class HistoryPersistenceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'HistoryPersistenceError';
    this.code = 'HISTORY_PERSISTENCE_FAILED';
    this.cause = cause;
  }
}

function normalizeLimit(value, {
  defaultLimit = DEFAULT_HISTORY_LIMIT,
  maxLimit = MAX_HISTORY_LIMIT,
} = {}) {
  if (value === undefined || value === null || value === '') {
    return defaultLimit;
  }

  const limit = Number(value);

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new RangeError(`limit must be an integer between 1 and ${maxLimit}`);
  }

  return limit;
}

function optionalNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function createAgentRunRecord({
  taskId,
  agent,
  result,
  competitionScore = null,
}) {
  const runAgent = agent || result.selectedAgent || result.agent;
  const durationMs = result.execution?.durationMs ?? result.durationMs;
  const changedFiles = result.changes?.count
    ?? result.changedFiles?.length
    ?? null;
  const branch = result.workspace?.branch ?? result.branch ?? null;
  const worktree = result.workspace?.worktree ?? result.worktree ?? null;

  return {
    taskId,
    agentId: runAgent.id,
    status: result.status,
    routerScore: optionalNumber(runAgent.score ?? result.routerScore),
    staticScore: optionalNumber(
      runAgent.staticScore ?? runAgent.score ?? result.staticScore,
    ),
    adaptiveScore: runAgent.adaptive
      ? optionalNumber(runAgent.score)
      : optionalNumber(result.adaptiveScore),
    evaluationScore: optionalNumber(result.evaluation?.score),
    verdict: result.evaluation?.verdict || null,
    competitionScore: optionalNumber(competitionScore),
    durationMs: Number.isSafeInteger(durationMs) && durationMs >= 0
      ? durationMs
      : null,
    changedFiles: Number.isSafeInteger(changedFiles) && changedFiles >= 0
      ? changedFiles
      : null,
    branch,
    worktree,
    candidateFingerprint: result.candidateFingerprint || null,
  };
}

class HistoryService {
  constructor({
    database = databaseService,
    clock = () => new Date(),
  } = {}) {
    this.database = database;
    this.clock = clock;
  }

  now() {
    return this.clock().toISOString();
  }

  createTask({
    id,
    task,
    workspace = null,
    mode,
    classification = {},
    status = 'running',
    targetBranch = null,
    baseCommit = null,
    decision = 'pending',
  }) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('task history id is required');
    }

    if (typeof task !== 'string' || task.trim() === '') {
      throw new TypeError('task history text is required');
    }

    if (!['single', 'competition'].includes(mode)) {
      throw new TypeError('task history mode must be single or competition');
    }

    const categories = Object.entries(classification)
      .filter(([, score]) => Number.isFinite(score) && score > 0)
      .sort(([left], [right]) => left.localeCompare(right));
    const connection = this.database.getConnection();
    const insertTask = connection.prepare(`
      INSERT INTO tasks (
        id,
        task_text,
        workspace,
        mode,
        status,
        created_at,
        completed_at,
        target_branch,
        base_commit,
        decision
      ) VALUES (
        @id,
        @task,
        @workspace,
        @mode,
        @status,
        @createdAt,
        NULL,
        @targetBranch,
        @baseCommit,
        @decision
      )
    `);
    const insertCategory = connection.prepare(`
      INSERT INTO task_categories (task_id, category, score)
      VALUES (@taskId, @category, @score)
    `);
    const transaction = connection.transaction(() => {
      insertTask.run({
        id,
        task: task.trim(),
        workspace,
        mode,
        status,
        createdAt: this.now(),
        targetBranch,
        baseCommit,
        decision,
      });

      for (const [category, score] of categories) {
        insertCategory.run({ taskId: id, category, score });
      }
    });

    transaction();
    return this.getTaskById(id);
  }

  recordAgentRun({
    taskId,
    agentId,
    status,
    routerScore = null,
    staticScore = null,
    adaptiveScore = null,
    evaluationScore = null,
    verdict = null,
    competitionScore = null,
    durationMs = null,
    changedFiles = null,
    branch = null,
    worktree = null,
    candidateFingerprint = null,
  }) {
    const connection = this.database.getConnection();
    const result = connection.prepare(`
      INSERT INTO agent_runs (
        task_id,
        agent_id,
        status,
        router_score,
        static_score,
        adaptive_score,
        evaluation_score,
        verdict,
        competition_score,
        duration_ms,
        changed_files,
        branch,
        worktree,
        candidate_fingerprint,
        created_at
      ) VALUES (
        @taskId,
        @agentId,
        @status,
        @routerScore,
        @staticScore,
        @adaptiveScore,
        @evaluationScore,
        @verdict,
        @competitionScore,
        @durationMs,
        @changedFiles,
        @branch,
        @worktree,
        @candidateFingerprint,
        @createdAt
      )
    `).run({
      taskId,
      agentId,
      status,
      routerScore,
      staticScore,
      adaptiveScore,
      evaluationScore,
      verdict,
      competitionScore,
      durationMs,
      changedFiles,
      branch,
      worktree,
      candidateFingerprint,
      createdAt: this.now(),
    });

    return Number(result.lastInsertRowid);
  }

  recordExecutionResult(input) {
    return this.recordAgentRun(createAgentRunRecord(input));
  }

  completeTask(taskId, status, { winnerAgentId = null } = {}) {
    const result = this.database.getConnection().prepare(`
      UPDATE tasks
      SET
        status = @status,
        completed_at = @completedAt,
        winner_agent_id = COALESCE(@winnerAgentId, winner_agent_id)
      WHERE id = @taskId
    `).run({
      taskId,
      status,
      completedAt: this.now(),
      winnerAgentId,
    });

    if (result.changes === 0) {
      throw new HistoryNotFoundError(taskId);
    }

    return this.getTaskById(taskId);
  }

  getRecentTasks(limit = DEFAULT_HISTORY_LIMIT) {
    const safeLimit = normalizeLimit(limit);

    return this.database.getConnection().prepare(`
      SELECT
        tasks.id,
        tasks.task_text AS task,
        tasks.workspace,
        tasks.mode,
        tasks.status,
        tasks.created_at AS createdAt,
        tasks.completed_at AS completedAt,
        tasks.decision,
        tasks.decision_at AS decisionAt,
        tasks.winner_agent_id AS winnerAgentId,
        COUNT(agent_runs.id) AS runCount
      FROM tasks
      LEFT JOIN agent_runs ON agent_runs.task_id = tasks.id
      GROUP BY tasks.id
      ORDER BY tasks.created_at DESC, tasks.id DESC
      LIMIT ?
    `).all(safeLimit);
  }

  getTaskById(taskId) {
    const connection = this.database.getConnection();
    const task = connection.prepare(`
      SELECT
        id,
        task_text AS task,
        workspace,
        mode,
        status,
        created_at AS createdAt,
        completed_at AS completedAt,
        target_branch AS targetBranch,
        base_commit AS baseCommit,
        decision,
        decision_at AS decisionAt,
        candidate_commit AS candidateCommit,
        merge_commit AS mergeCommit,
        winner_agent_id AS winnerAgentId
      FROM tasks
      WHERE id = ?
    `).get(taskId);

    if (!task) {
      return null;
    }

    const categoryRows = connection.prepare(`
      SELECT category, score
      FROM task_categories
      WHERE task_id = ?
      ORDER BY category ASC
    `).all(taskId);
    const runs = connection.prepare(`
      SELECT
        id,
        agent_id AS agentId,
        status,
        router_score AS routerScore,
        static_score AS staticScore,
        adaptive_score AS adaptiveScore,
        evaluation_score AS evaluationScore,
        verdict,
        competition_score AS competitionScore,
        duration_ms AS durationMs,
        changed_files AS changedFiles,
        branch,
        worktree,
        candidate_fingerprint AS candidateFingerprint,
        created_at AS createdAt
      FROM agent_runs
      WHERE task_id = ?
      ORDER BY id ASC
    `).all(taskId);

    return {
      ...task,
      classification: Object.fromEntries(
        categoryRows.map((row) => [row.category, row.score]),
      ),
      runs,
    };
  }

  setCandidateFingerprint(runId, fingerprint) {
    const result = this.database.getConnection().prepare(`
      UPDATE agent_runs
      SET candidate_fingerprint = @fingerprint
      WHERE id = @runId
    `).run({ runId, fingerprint });

    if (result.changes === 0) {
      throw new Error('Agent run not found while storing candidate fingerprint');
    }
  }

  setCandidateCommit(taskId, candidateCommit) {
    const result = this.database.getConnection().prepare(`
      UPDATE tasks
      SET candidate_commit = @candidateCommit
      WHERE id = @taskId AND decision = 'pending'
    `).run({ taskId, candidateCommit });

    if (result.changes === 0) {
      throw new Error('Task is not pending while storing candidate commit');
    }

    return this.getTaskById(taskId);
  }

  recordApproval({
    taskId,
    candidateCommit,
    mergeCommit,
    winnerAgentId,
  }) {
    const result = this.database.getConnection().prepare(`
      UPDATE tasks
      SET
        decision = 'approved',
        decision_at = @decisionAt,
        status = 'merged',
        candidate_commit = @candidateCommit,
        merge_commit = @mergeCommit,
        winner_agent_id = @winnerAgentId
      WHERE id = @taskId AND decision = 'pending'
    `).run({
      taskId,
      decisionAt: this.now(),
      candidateCommit,
      mergeCommit,
      winnerAgentId,
    });

    if (result.changes === 0) {
      throw new Error('Task decision changed before approval could be recorded');
    }

    return this.getTaskById(taskId);
  }

  recordRejection(taskId) {
    const result = this.database.getConnection().prepare(`
      UPDATE tasks
      SET
        decision = 'rejected',
        decision_at = @decisionAt,
        status = 'rejected'
      WHERE id = @taskId AND decision = 'pending'
    `).run({ taskId, decisionAt: this.now() });

    if (result.changes === 0) {
      throw new Error('Task decision changed before rejection could be recorded');
    }

    return this.getTaskById(taskId);
  }
}

const historyService = new HistoryService();

module.exports = {
  DEFAULT_HISTORY_LIMIT,
  HistoryNotFoundError,
  HistoryPersistenceError,
  HistoryService,
  MAX_HISTORY_LIMIT,
  createAgentRunRecord,
  historyService,
  normalizeLimit,
};
