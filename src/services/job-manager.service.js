const { jobService } = require('./job.service');
const { jobSchedulerService } = require('./job-scheduler.service');
const { runSessionService } = require('./run-session.service');

class JobManagerService {
  constructor({
    jobs = jobService,
    scheduler = jobSchedulerService,
    sessions = runSessionService,
  } = {}) {
    this.jobs = jobs;
    this.scheduler = scheduler;
    this.sessions = sessions;
  }

  start() {
    return this.scheduler.start();
  }

  async submit(input) {
    await this.scheduler.assertExecutionReady();
    const job = this.jobs.createJob(input);
    this.sessions.create(job.type, {
      id: job.runId,
      jobId: job.id,
      initialState: 'queued',
    });
    this.sessions.append(job.runId, {
      type: 'job_created',
      stage: 'queue',
      status: 'completed',
      messageKey: 'run.jobCreated',
      data: { jobId: job.id, priority: job.priority, attempt: job.attempt },
    });
    this.sessions.append(job.runId, {
      type: 'run_started',
      stage: 'initializing',
      status: 'running',
      messageKey: 'run.started',
      data: { runType: job.type, jobId: job.id },
    });
    this.sessions.append(job.runId, {
      type: 'job_queued',
      stage: 'queue',
      status: 'pending',
      messageKey: 'run.jobQueued',
      data: { jobId: job.id, priority: job.priority },
    });
    this.scheduler.emitQueuePositions();
    this.scheduler.wake();
    return this.getJob(job.id);
  }

  async startSingle({ task, workspace, priority }) {
    const submitted = await this.submit({
      type: 'single', task, workspace, priority,
    });
    return this.sessions.snapshot(submitted.job.runId);
  }

  async startCompetition({ task, workspace, agentIds, priority }) {
    const submitted = await this.submit({
      type: 'competition', task, workspace, agents: agentIds, priority,
    });
    return this.sessions.snapshot(submitted.job.runId);
  }

  getJob(id) {
    const job = this.jobs.requireJob(id);
    return {
      job,
      runId: job.runId,
      queuePosition: this.jobs.getQueuePosition(job.id),
    };
  }

  listJobs(options) {
    return this.jobs.listJobs(options).map((job) => ({
      ...job,
      queuePosition: this.jobs.getQueuePosition(job.id),
    }));
  }

  cancel(id) {
    const outcome = this.scheduler.cancel(id);
    return {
      ...outcome,
      queuePosition: this.jobs.getQueuePosition(id),
    };
  }

  async retry(id, options = {}) {
    await this.scheduler.assertExecutionReady();
    const job = this.jobs.createRetryJob(id, options);
    this.sessions.create(job.type, {
      id: job.runId,
      jobId: job.id,
      initialState: 'queued',
    });
    this.sessions.append(job.runId, {
      type: 'job_retry_created',
      stage: 'queue',
      status: 'completed',
      messageKey: 'run.jobRetryCreated',
      data: { jobId: job.id, parentJobId: job.parentJobId, attempt: job.attempt },
    });
    this.sessions.append(job.runId, {
      type: 'run_started',
      stage: 'initializing',
      status: 'running',
      messageKey: 'run.started',
      data: { runType: job.type, jobId: job.id },
    });
    this.sessions.append(job.runId, {
      type: 'job_queued',
      stage: 'queue',
      status: 'pending',
      messageKey: 'run.jobQueued',
      data: { jobId: job.id, priority: job.priority },
    });
    this.scheduler.emitQueuePositions();
    this.scheduler.wake();
    return this.getJob(job.id);
  }

  updatePriority(id, priority) {
    const job = this.jobs.updatePriority(id, priority);
    this.scheduler.emitQueuePositions();
    this.scheduler.wake();
    return {
      job,
      queuePosition: this.jobs.getQueuePosition(job.id),
    };
  }

  getStats() {
    return this.scheduler.getStatus();
  }

  shutdown(options) {
    return this.scheduler.shutdown(options);
  }
}

const jobManagerService = new JobManagerService();

module.exports = {
  JobManagerService,
  jobManagerService,
};
