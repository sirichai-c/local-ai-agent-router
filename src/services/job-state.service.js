const JOB_STATUSES = Object.freeze(new Set([
  'queued',
  'starting',
  'running',
  'evaluating',
  'completed',
  'failed',
  'cancel_requested',
  'cancelled',
  'interrupted',
]));

const TERMINAL_JOB_STATUSES = Object.freeze(new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]));

const ACTIVE_JOB_STATUSES = Object.freeze(new Set([
  'starting',
  'running',
  'evaluating',
  'cancel_requested',
]));

const RETRYABLE_JOB_STATUSES = Object.freeze(new Set([
  'failed',
  'cancelled',
  'interrupted',
]));

const JOB_TRANSITIONS = Object.freeze({
  queued: new Set(['starting', 'cancelled']),
  starting: new Set(['running', 'failed', 'cancel_requested', 'interrupted']),
  running: new Set(['evaluating', 'completed', 'failed', 'cancel_requested', 'interrupted']),
  evaluating: new Set(['completed', 'failed', 'cancel_requested', 'interrupted']),
  cancel_requested: new Set(['cancelled', 'failed', 'interrupted']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  interrupted: new Set(),
});

class JobStateError extends Error {
  constructor(message, code = 'JOB_STATE_INVALID', statusCode = 409) {
    super(message);
    this.name = 'JobStateError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class JobStateService {
  canTransition(from, to) {
    return JOB_STATUSES.has(from)
      && JOB_STATUSES.has(to)
      && JOB_TRANSITIONS[from].has(to);
  }

  transition(job, to, {
    now,
    errorCode = null,
    errorMessage = null,
    resultStatus = job.resultStatus || null,
    taskId = job.taskId || null,
    competitionId = job.competitionId || null,
  } = {}) {
    if (!job || typeof job !== 'object') throw new TypeError('job is required');
    if (!this.canTransition(job.status, to)) {
      throw new JobStateError(
        `Job cannot transition from ${job.status} to ${to}.`,
        'JOB_TRANSITION_INVALID',
      );
    }

    const timestamp = typeof now === 'string' ? now : new Date().toISOString();
    const next = {
      ...job,
      status: to,
      taskId,
      competitionId,
      resultStatus,
    };

    if (to === 'starting') next.startedAt = job.startedAt || timestamp;
    if (to === 'cancel_requested') next.cancelRequestedAt = timestamp;
    if (to === 'cancelled') {
      next.cancelledAt = timestamp;
      next.completedAt = timestamp;
    }
    if (TERMINAL_JOB_STATUSES.has(to) && to !== 'cancelled') {
      next.completedAt = timestamp;
    }
    if (to === 'failed' || to === 'interrupted') {
      next.errorCode = errorCode;
      next.errorMessage = errorMessage;
    }

    return next;
  }
}

const jobStateService = new JobStateService();

module.exports = {
  ACTIVE_JOB_STATUSES,
  JOB_STATUSES,
  JOB_TRANSITIONS,
  JobStateError,
  JobStateService,
  RETRYABLE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  jobStateService,
};
