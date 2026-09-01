const { config } = require('../config/env');
const { isCancellationError } = require('./cancellation.service');
const { agentExecutorService } = require('./agent-executor.service');
const { competitionService } = require('./competition.service');
const { jobService } = require('./job.service');
const {
  summarizeCompetitionResult,
  summarizeSingleResult,
  toSafeRunError,
} = require('./run-coordinator.service');
const { runSessionService } = require('./run-session.service');

class JobSchedulerError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = 'JobSchedulerError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class JobSchedulerService {
  constructor({
    jobs = jobService,
    sessions = runSessionService,
    executor = agentExecutorService,
    competition = competitionService,
    maxConcurrent = config.jobs.maxConcurrent,
    schedule = (callback) => setImmediate(callback),
  } = {}) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new TypeError('maxConcurrent must be a positive integer');
    }
    this.jobs = jobs;
    this.sessions = sessions;
    this.executor = executor;
    this.competition = competition;
    this.maxConcurrent = maxConcurrent;
    this.schedule = schedule;
    this.active = new Map();
    this.started = false;
    this.shuttingDown = false;
    this.dispatching = false;
    this.dispatchScheduled = false;
  }

  async assertExecutionReady() {
    if (!this.executor.isExecutionEnabled()) {
      throw new JobSchedulerError(
        'Agent execution is disabled by server configuration.',
        'EXECUTION_DISABLED',
        409,
      );
    }
    if (typeof this.executor.assertExecutionBackendAvailable === 'function') {
      await this.executor.assertExecutionBackendAvailable();
    }
  }

  ensureSession(job) {
    let session = this.sessions.snapshot(job.runId);
    if (!session) {
      session = this.sessions.create(job.type, {
        id: job.runId,
        jobId: job.id,
        initialState: job.status,
      });
    }
    this.sessions.updateIdentity(job.runId, { jobId: job.id });
    return session;
  }

  report(job, event) {
    try {
      this.ensureSession(job);
      this.sessions.append(job.runId, event);
    } catch {
      // Scheduling and execution remain authoritative if observability fails.
    }
  }

  emitQueuePositions() {
    const queued = this.jobs.listQueuedOrdered();
    queued.forEach((job, index) => {
      this.report(job, {
        type: 'queue_position',
        stage: 'queue',
        status: 'pending',
        messageKey: 'run.queuePosition',
        data: {
          jobId: job.id,
          position: index + 1,
          priority: job.priority,
        },
      });
    });
    return queued.length;
  }

  start() {
    if (this.started) return { interrupted: [], ...this.getStatus() };
    this.started = true;
    this.shuttingDown = false;
    const interrupted = this.jobs.markInterruptedJobs();
    for (const job of this.jobs.listQueuedOrdered()) {
      if (!this.sessions.snapshot(job.runId)) {
        this.sessions.create(job.type, {
          id: job.runId,
          jobId: job.id,
          initialState: 'queued',
        });
        this.report(job, {
          type: 'job_queued',
          stage: 'queue',
          status: 'pending',
          messageKey: 'run.jobQueued',
          data: { jobId: job.id, priority: job.priority, recovered: true },
        });
      }
    }
    this.emitQueuePositions();
    this.wake();
    return { interrupted, ...this.getStatus() };
  }

  wake() {
    if (!this.started
      || this.shuttingDown
      || this.dispatchScheduled
      || !this.executor.isExecutionEnabled()) return;
    this.dispatchScheduled = true;
    this.schedule(() => {
      this.dispatchScheduled = false;
      void this.dispatch();
    });
  }

  async dispatch() {
    if (this.dispatching || !this.started || this.shuttingDown) return;
    this.dispatching = true;
    try {
      while (!this.shuttingDown && this.active.size < this.maxConcurrent) {
        const job = this.jobs.claimNextQueuedJob();
        if (!job) break;
        this.launch(job);
      }
      this.emitQueuePositions();
    } finally {
      this.dispatching = false;
    }
  }

  launch(job) {
    const controller = new AbortController();
    this.ensureSession(job);
    this.report(job, {
      type: 'job_starting',
      stage: 'queue',
      status: 'running',
      messageKey: 'run.jobStarting',
      data: { jobId: job.id, attempt: job.attempt },
    });
    const promise = this.execute(job, controller.signal)
      .catch(() => { /* execute records a safe terminal state */ })
      .finally(() => {
        this.active.delete(job.id);
        this.emitQueuePositions();
        this.wake();
      });
    this.active.set(job.id, { controller, promise, runId: job.runId });
  }

  onExecutionEvent(job, event) {
    if (event.type === 'evaluation_starting') {
      const current = this.jobs.getJob(job.id);
      if (current?.status === 'running') {
        try { this.jobs.transition(job.id, 'evaluating'); } catch { /* state won race */ }
      }
    }
    this.report(job, event);
  }

  async execute(job, signal) {
    try {
      const current = this.jobs.requireJob(job.id);
      if (current.status === 'cancel_requested' || signal.aborted) {
        await this.finishCancelled(current);
        return;
      }
      this.jobs.transition(job.id, 'running');
      this.report(job, {
        type: 'job_running',
        stage: 'queue',
        status: 'running',
        messageKey: 'run.jobRunning',
        data: { jobId: job.id, attempt: job.attempt },
      });
      const input = {
        task: job.task,
        workspace: job.workspace,
        signal,
        onEvent: (event) => this.onExecutionEvent(job, event),
      };
      const result = job.type === 'competition'
        ? await this.competition.compete({
          ...input,
          agentIds: job.requestedAgents,
        })
        : await this.executor.executeTask(input);

      if (signal.aborted || this.jobs.getJob(job.id)?.status === 'cancel_requested') {
        await this.finishCancelled(job);
        return;
      }

      const summary = job.type === 'competition'
        ? summarizeCompetitionResult(result)
        : summarizeSingleResult(result);
      const taskId = job.type === 'single' ? summary.taskId : null;
      const competitionId = job.type === 'competition' ? summary.competitionId : null;
      this.sessions.updateIdentity(job.runId, {
        jobId: job.id,
        taskId,
        competitionId,
      });
      const successful = job.type === 'competition'
        ? Boolean(summary.candidateAvailable)
        : !['failed', 'evaluation_failed', 'no_available_agent', 'execution_disabled']
          .includes(result.status);

      if (!successful) {
        this.finishFailed(job, {
          code: `JOB_${String(result.status || 'FAILED').toUpperCase()}`,
          message: 'The Job did not produce a valid completed result.',
        }, { resultStatus: result.status, taskId, competitionId });
        return;
      }

      if (summary.candidateAvailable) {
        this.report(job, {
          type: 'candidate_ready',
          stage: 'candidate',
          status: 'completed',
          messageKey: 'run.candidateReady',
          data: {
            taskId: taskId || competitionId,
            agentId: summary.winner?.agentId || null,
          },
        });
      }
      this.jobs.transition(job.id, 'completed', {
        resultStatus: result.status,
        taskId,
        competitionId,
      });
      this.report(job, {
        type: 'job_completed',
        stage: 'complete',
        status: 'completed',
        messageKey: 'run.jobCompleted',
        data: { jobId: job.id, resultStatus: result.status },
      });
      this.sessions.complete(job.runId, summary, {
        jobId: job.id,
        taskId,
        competitionId,
        resultStatus: result.status,
        candidateAvailable: summary.candidateAvailable,
      });
    } catch (error) {
      if (isCancellationError(error, signal)
        || this.jobs.getJob(job.id)?.status === 'cancel_requested') {
        await this.finishCancelled(job);
        return;
      }
      this.finishFailed(job, toSafeRunError(error));
    }
  }

  async finishCancelled(job) {
    const current = this.jobs.requireJob(job.id);
    let cancelled = current;
    if (current.status !== 'cancelled') {
      if (['starting', 'running', 'evaluating'].includes(current.status)) {
        cancelled = this.jobs.transition(job.id, 'cancel_requested');
      }
      if (cancelled.status === 'cancel_requested') {
        cancelled = this.jobs.transition(job.id, 'cancelled', {
          resultStatus: 'cancelled',
        });
      }
    }
    try {
      this.sessions.cancel(cancelled.runId, { jobId: cancelled.id });
    } catch { /* session may already be terminal */ }
    return cancelled;
  }

  finishFailed(job, error, metadata = {}) {
    const current = this.jobs.getJob(job.id);
    if (!current || ['completed', 'failed', 'cancelled', 'interrupted'].includes(current.status)) {
      return current;
    }
    const failed = this.jobs.transition(job.id, 'failed', {
      errorCode: error.code || 'JOB_EXECUTION_FAILED',
      errorMessage: error.message || 'Job execution failed.',
      ...metadata,
    });
    this.report(failed, {
      type: 'job_failed',
      stage: 'failed',
      status: 'failed',
      messageKey: 'run.jobFailed',
      data: { jobId: failed.id, code: failed.errorCode },
    });
    try {
      this.sessions.fail(failed.runId, {
        code: failed.errorCode,
        message: failed.errorMessage,
      }, { jobId: failed.id, stage: 'failed' });
    } catch { /* best effort observability */ }
    return failed;
  }

  cancel(jobId) {
    const outcome = this.jobs.requestCancellation(jobId);
    const job = outcome.job;
    this.ensureSession(job);
    if (outcome.outcome === 'cancelled') {
      try { this.sessions.cancel(job.runId, { jobId: job.id }); } catch { /* terminal */ }
    } else if (outcome.outcome === 'cancel_requested') {
      this.report(job, {
        type: 'job_cancel_requested',
        stage: 'queue',
        status: 'warning',
        messageKey: 'run.jobCancelRequested',
        data: { jobId: job.id },
      });
      this.active.get(job.id)?.controller.abort();
    }
    this.emitQueuePositions();
    this.wake();
    return outcome;
  }

  getStatus() {
    const stats = this.jobs.getStats();
    return {
      status: this.shuttingDown ? 'stopping' : this.started ? 'running' : 'stopped',
      active: this.active.size,
      maxConcurrent: this.maxConcurrent,
      queued: stats.queued,
    };
  }

  async shutdown({ timeoutMs = 10_000 } = {}) {
    this.shuttingDown = true;
    this.started = false;
    for (const [jobId, active] of this.active) {
      try { this.jobs.requestCancellation(jobId); } catch { /* terminal race */ }
      active.controller.abort();
    }
    const activePromises = [...this.active.values()].map((entry) => entry.promise);
    if (activePromises.length) {
      await Promise.race([
        Promise.allSettled(activePromises),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          timer.unref?.();
        }),
      ]);
    }
    for (const [jobId, active] of this.active) {
      const current = this.jobs.getJob(jobId);
      if (current && !['completed', 'failed', 'cancelled', 'interrupted'].includes(current.status)) {
        const interrupted = this.jobs.transition(jobId, 'interrupted', {
          errorCode: 'server_shutdown',
          errorMessage: 'The Router stopped before cancellation completed.',
        });
        try { this.sessions.interrupt(active.runId, { jobId: interrupted.id }); } catch { /* terminal */ }
      }
    }
    return this.getStatus();
  }
}

const jobSchedulerService = new JobSchedulerService();

module.exports = {
  JobSchedulerError,
  JobSchedulerService,
  jobSchedulerService,
};
