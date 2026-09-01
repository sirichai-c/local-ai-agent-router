const crypto = require('node:crypto');

const { config } = require('../config/env');
const { databaseService } = require('./database.service');
const {
  ACTIVE_JOB_STATUSES,
  JOB_STATUSES,
  JobStateError,
  RETRYABLE_JOB_STATUSES,
  jobStateService,
} = require('./job-state.service');

const DEFAULT_JOB_PRIORITY = 50;
const MAX_JOB_LIST_LIMIT = 100;
const JOB_TYPES = Object.freeze(new Set(['single', 'competition']));
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

class JobServiceError extends Error {
  constructor(message, code = 'JOB_ERROR', statusCode = 400) {
    super(message);
    this.name = 'JobServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizePriority(value = DEFAULT_JOB_PRIORITY) {
  const priority = Number(value);
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 100) {
    throw new JobServiceError(
      'priority must be an integer between 0 and 100',
      'JOB_PRIORITY_INVALID',
    );
  }
  return priority;
}

function normalizeRequestedAgents(value, type) {
  if (value === undefined || value === null) return null;
  if (type !== 'competition' || !Array.isArray(value)) {
    throw new JobServiceError(
      'agents are supported only as an array for competition Jobs',
      'JOB_AGENTS_INVALID',
    );
  }
  const agents = value.map((agentId) => {
    if (typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId.trim().toLowerCase())) {
      throw new JobServiceError('agents contain an invalid Agent ID', 'JOB_AGENTS_INVALID');
    }
    return agentId.trim().toLowerCase();
  });
  if (new Set(agents).size !== agents.length) {
    throw new JobServiceError('agents must not contain duplicates', 'JOB_AGENTS_INVALID');
  }
  if (agents.length < 2 || agents.length > config.competition.maxAgents) {
    throw new JobServiceError(
      `competition Jobs require 2 to ${config.competition.maxAgents} Agents`,
      'JOB_AGENTS_INVALID',
    );
  }
  return agents;
}

function parseRequestedAgents(value) {
  if (value === null || value === undefined) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)
      || parsed.length < 2
      || parsed.length > config.competition.maxAgents
      || new Set(parsed).size !== parsed.length
      || parsed.some((item) => typeof item !== 'string' || !AGENT_ID_PATTERN.test(item))) {
      throw new Error('invalid persisted Agent list');
    }
    return parsed;
  } catch {
    throw new JobServiceError(
      'Persisted requested Agents are invalid.',
      'JOB_PERSISTED_AGENTS_INVALID',
      500,
    );
  }
}

function mapJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    task: row.task_text,
    workspace: row.workspace,
    status: row.status,
    priority: row.priority,
    requestedAgents: parseRequestedAgents(row.requested_agents),
    attempt: row.attempt,
    parentJobId: row.parent_job_id,
    runId: row.run_id,
    taskId: row.task_id,
    competitionId: row.competition_id,
    createdAt: row.created_at,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelRequestedAt: row.cancel_requested_at,
    cancelledAt: row.cancelled_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    resultStatus: row.result_status,
  };
}

function validateCreateInput({ type, task, workspace, agents, priority }) {
  if (!JOB_TYPES.has(type)) {
    throw new JobServiceError('type must be single or competition', 'JOB_TYPE_INVALID');
  }
  if (typeof task !== 'string' || task.trim() === '') {
    throw new JobServiceError('task is required', 'JOB_TASK_INVALID');
  }
  if (typeof workspace !== 'string' || workspace.trim() === '') {
    throw new JobServiceError('workspace is required', 'JOB_WORKSPACE_INVALID');
  }
  return {
    type,
    task: task.trim(),
    workspace: workspace.trim(),
    requestedAgents: normalizeRequestedAgents(agents, type),
    priority: normalizePriority(priority),
  };
}

class JobService {
  constructor({
    database = databaseService,
    state = jobStateService,
    idFactory = () => crypto.randomUUID(),
    clock = () => new Date(),
  } = {}) {
    this.database = database;
    this.state = state;
    this.idFactory = idFactory;
    this.clock = clock;
  }

  now() {
    return this.clock().toISOString();
  }

  createJob(input, {
    id = this.idFactory(),
    runId = this.idFactory(),
    attempt = 1,
    parentJobId = null,
  } = {}) {
    const normalized = validateCreateInput(input);
    if (!Number.isSafeInteger(attempt) || attempt < 1) {
      throw new JobServiceError('attempt must be a positive integer', 'JOB_ATTEMPT_INVALID');
    }
    const now = this.now();
    this.database.getConnection().prepare(`
      INSERT INTO jobs (
        id, type, task_text, workspace, status, priority, requested_agents,
        attempt, parent_job_id, run_id, created_at, queued_at
      ) VALUES (
        @id, @type, @task, @workspace, 'queued', @priority, @requestedAgents,
        @attempt, @parentJobId, @runId, @createdAt, @queuedAt
      )
    `).run({
      id,
      runId,
      attempt,
      parentJobId,
      type: normalized.type,
      task: normalized.task,
      workspace: normalized.workspace,
      priority: normalized.priority,
      requestedAgents: normalized.requestedAgents
        ? JSON.stringify(normalized.requestedAgents)
        : null,
      createdAt: now,
      queuedAt: now,
    });
    return this.getJob(id);
  }

  getJob(id) {
    if (typeof id !== 'string' || id.trim() === '') return null;
    return mapJobRow(this.database.getConnection().prepare(
      'SELECT * FROM jobs WHERE id = ?',
    ).get(id));
  }

  requireJob(id) {
    const job = this.getJob(id);
    if (!job) throw new JobServiceError('Job not found.', 'JOB_NOT_FOUND', 404);
    return job;
  }

  listJobs({ limit = 20, status } = {}) {
    const safeLimit = Number(limit);
    if (!Number.isSafeInteger(safeLimit) || safeLimit < 1 || safeLimit > MAX_JOB_LIST_LIMIT) {
      throw new JobServiceError(
        `limit must be an integer between 1 and ${MAX_JOB_LIST_LIMIT}`,
        'JOB_LIMIT_INVALID',
      );
    }
    if (status !== undefined && !JOB_STATUSES.has(status)) {
      throw new JobServiceError('status filter is invalid', 'JOB_STATUS_INVALID');
    }
    let rows;
    if (status === 'queued') {
      rows = this.database.getConnection().prepare(`
        SELECT * FROM jobs WHERE status = 'queued'
        ORDER BY priority DESC, created_at ASC, id ASC LIMIT ?
      `).all(safeLimit);
    } else if (status) {
      rows = this.database.getConnection().prepare(`
        SELECT * FROM jobs WHERE status = ?
        ORDER BY created_at DESC, id DESC LIMIT ?
      `).all(status, safeLimit);
    } else {
      rows = this.database.getConnection().prepare(`
        SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?
      `).all(safeLimit);
    }
    return rows.map(mapJobRow);
  }

  listQueuedOrdered(limit = MAX_JOB_LIST_LIMIT) {
    return this.database.getConnection().prepare(`
      SELECT * FROM jobs WHERE status = 'queued'
      ORDER BY priority DESC, created_at ASC, id ASC LIMIT ?
    `).all(limit).map(mapJobRow);
  }

  getQueuePosition(id) {
    const job = this.getJob(id);
    if (!job || job.status !== 'queued') return null;
    const row = this.database.getConnection().prepare(`
      SELECT COUNT(*) + 1 AS position
      FROM jobs
      WHERE status = 'queued' AND (
        priority > @priority OR
        (priority = @priority AND created_at < @createdAt) OR
        (priority = @priority AND created_at = @createdAt AND id < @id)
      )
    `).get({ priority: job.priority, createdAt: job.createdAt, id: job.id });
    return row.position;
  }

  persistTransition(connection, job) {
    connection.prepare(`
      UPDATE jobs SET
        status = @status,
        started_at = @startedAt,
        completed_at = @completedAt,
        cancel_requested_at = @cancelRequestedAt,
        cancelled_at = @cancelledAt,
        error_code = @errorCode,
        error_message = @errorMessage,
        result_status = @resultStatus,
        task_id = @taskId,
        competition_id = @competitionId
      WHERE id = @id
    `).run(job);
  }

  transition(id, to, metadata = {}) {
    const connection = this.database.getConnection();
    const transaction = connection.transaction(() => {
      const current = mapJobRow(connection.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
      if (!current) throw new JobServiceError('Job not found.', 'JOB_NOT_FOUND', 404);
      const next = this.state.transition(current, to, { now: this.now(), ...metadata });
      this.persistTransition(connection, next);
      return next;
    });
    return transaction.immediate();
  }

  claimNextQueuedJob() {
    const connection = this.database.getConnection();
    const transaction = connection.transaction(() => {
      const row = connection.prepare(`
        SELECT * FROM jobs WHERE status = 'queued'
        ORDER BY priority DESC, created_at ASC, id ASC LIMIT 1
      `).get();
      if (!row) return null;
      const current = mapJobRow(row);
      const next = this.state.transition(current, 'starting', { now: this.now() });
      const claim = connection.prepare(`
        UPDATE jobs SET status = 'starting', started_at = @startedAt
        WHERE id = @id AND status = 'queued'
      `).run({ id: next.id, startedAt: next.startedAt });
      return claim.changes === 1 ? next : null;
    });
    return transaction.immediate();
  }

  requestCancellation(id) {
    const job = this.requireJob(id);
    if (job.status === 'cancelled') return { job, outcome: 'already_cancelled' };
    if (job.status === 'completed') {
      throw new JobServiceError(
        'Completed Job cannot be cancelled.',
        'JOB_ALREADY_COMPLETED',
        409,
      );
    }
    if (job.status === 'queued') {
      return { job: this.transition(id, 'cancelled'), outcome: 'cancelled' };
    }
    if (['starting', 'running', 'evaluating'].includes(job.status)) {
      return {
        job: this.transition(id, 'cancel_requested'),
        outcome: 'cancel_requested',
      };
    }
    if (job.status === 'cancel_requested') {
      return { job, outcome: 'cancel_requested' };
    }
    throw new JobServiceError(
      `Job in ${job.status} state cannot be cancelled.`,
      'JOB_NOT_CANCELLABLE',
      409,
    );
  }

  createRetryJob(id, { priority } = {}) {
    const original = this.requireJob(id);
    if (!RETRYABLE_JOB_STATUSES.has(original.status)) {
      throw new JobServiceError(
        `Job in ${original.status} state cannot be retried.`,
        'JOB_NOT_RETRYABLE',
        409,
      );
    }
    return this.createJob({
      type: original.type,
      task: original.task,
      workspace: original.workspace,
      agents: original.requestedAgents,
      priority: priority === undefined ? original.priority : priority,
    }, {
      attempt: original.attempt + 1,
      parentJobId: original.id,
    });
  }

  updatePriority(id, priority) {
    const normalized = normalizePriority(priority);
    const result = this.database.getConnection().prepare(`
      UPDATE jobs SET priority = ? WHERE id = ? AND status = 'queued'
    `).run(normalized, id);
    if (result.changes === 0) {
      const job = this.requireJob(id);
      throw new JobServiceError(
        `Priority cannot change while Job is ${job.status}.`,
        'JOB_PRIORITY_LOCKED',
        409,
      );
    }
    return this.getJob(id);
  }

  markInterruptedJobs() {
    const connection = this.database.getConnection();
    const transaction = connection.transaction(() => {
      const rows = connection.prepare(`
        SELECT * FROM jobs
        WHERE status IN ('starting', 'running', 'evaluating', 'cancel_requested')
      `).all();
      const interrupted = [];
      for (const row of rows) {
        const current = mapJobRow(row);
        const next = this.state.transition(current, 'interrupted', {
          now: this.now(),
          errorCode: 'server_restart',
          errorMessage: 'The Router restarted while this Job was active.',
        });
        this.persistTransition(connection, next);
        interrupted.push(next);
      }
      return interrupted;
    });
    return transaction.immediate();
  }

  getStats() {
    const rows = this.database.getConnection().prepare(`
      SELECT status, COUNT(*) AS count FROM jobs GROUP BY status
    `).all();
    const counts = Object.fromEntries(rows.map((row) => [row.status, row.count]));
    return {
      active: ['starting', 'running', 'evaluating', 'cancel_requested']
        .reduce((sum, status) => sum + (counts[status] || 0), 0),
      queued: counts.queued || 0,
      counts,
    };
  }
}

const jobService = new JobService();

module.exports = {
  DEFAULT_JOB_PRIORITY,
  JOB_TYPES,
  JobService,
  JobServiceError,
  MAX_JOB_LIST_LIMIT,
  jobService,
  mapJobRow,
  normalizePriority,
  normalizeRequestedAgents,
  parseRequestedAgents,
  validateCreateInput,
};
