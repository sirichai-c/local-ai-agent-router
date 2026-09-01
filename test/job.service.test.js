const assert = require('node:assert/strict');
const { test } = require('node:test');

const { JobService } = require('../src/services/job.service');
const { createTemporaryDatabase } = require('../test-support/database-test.helper');

function incrementingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++));
}

async function fixture(t) {
  const { database } = await createTemporaryDatabase(t, 'agent-router-job-service-');
  let nextId = 0;
  const ids = ['job-a', 'run-a', 'job-b', 'run-b', 'job-c', 'run-c', 'job-d', 'run-d'];
  return new JobService({
    database,
    clock: incrementingClock(),
    idFactory: () => ids[nextId++],
  });
}

test('persistent queue orders priority first and FIFO within one priority', async (t) => {
  const jobs = await fixture(t);
  const a = jobs.createJob({ type: 'single', task: 'A', workspace: 'C:\\repo-a', priority: 50 });
  const b = jobs.createJob({ type: 'single', task: 'B', workspace: 'C:\\repo-b', priority: 75 });
  const c = jobs.createJob({ type: 'single', task: 'C', workspace: 'C:\\repo-c', priority: 50 });

  assert.deepEqual(jobs.listQueuedOrdered().map((job) => job.id), [b.id, a.id, c.id]);
  assert.deepEqual(
    jobs.listJobs({ status: 'queued', limit: 20 }).map((job) => job.id),
    [b.id, a.id, c.id],
  );
  assert.equal(jobs.getQueuePosition(b.id), 1);
  assert.equal(jobs.getQueuePosition(c.id), 3);
  assert.equal(jobs.claimNextQueuedJob().id, b.id);
  assert.equal(jobs.claimNextQueuedJob().id, a.id);
  assert.equal(jobs.claimNextQueuedJob().id, c.id);
  assert.equal(jobs.claimNextQueuedJob(), null);
});

test('atomic claim changes a queued Job exactly once', async (t) => {
  const jobs = await fixture(t);
  const created = jobs.createJob({ type: 'single', task: 'Only once', workspace: 'C:\\repo', priority: 50 });
  assert.equal(jobs.claimNextQueuedJob().id, created.id);
  assert.equal(jobs.claimNextQueuedJob(), null);
  assert.equal(jobs.getJob(created.id).status, 'starting');
});

test('queued cancellation is idempotent and completed cancellation conflicts', async (t) => {
  const jobs = await fixture(t);
  const queued = jobs.createJob({ type: 'single', task: 'Cancel me', workspace: 'C:\\repo', priority: 50 });
  assert.equal(jobs.requestCancellation(queued.id).outcome, 'cancelled');
  assert.equal(jobs.requestCancellation(queued.id).outcome, 'already_cancelled');

  const completed = jobs.createJob({ type: 'single', task: 'Done', workspace: 'C:\\repo', priority: 50 });
  jobs.transition(completed.id, 'starting');
  jobs.transition(completed.id, 'running');
  jobs.transition(completed.id, 'completed');
  assert.throws(() => jobs.requestCancellation(completed.id), (error) => (
    error.code === 'JOB_ALREADY_COMPLETED' && error.statusCode === 409
  ));
});

test('retry creates a new queued attempt without mutating its failed parent', async (t) => {
  const jobs = await fixture(t);
  const original = jobs.createJob({
    type: 'competition',
    task: 'Try agents',
    workspace: 'C:\\repo',
    agents: ['qwen-code', 'opencode'],
    priority: 75,
  });
  jobs.transition(original.id, 'starting');
  jobs.transition(original.id, 'failed', {
    errorCode: 'AGENT_CRASH',
    errorMessage: 'Agent crashed.',
  });
  const retried = jobs.createRetryJob(original.id, { priority: 100 });

  assert.notEqual(retried.id, original.id);
  assert.equal(retried.parentJobId, original.id);
  assert.equal(retried.attempt, 2);
  assert.equal(retried.priority, 100);
  assert.deepEqual(retried.requestedAgents, ['qwen-code', 'opencode']);
  assert.equal(jobs.getJob(original.id).status, 'failed');
  assert.throws(() => jobs.createRetryJob(retried.id), (error) => error.code === 'JOB_NOT_RETRYABLE');
});

test('cancelled and interrupted Jobs require explicit child retries', async (t) => {
  const jobs = await fixture(t);
  const cancelled = jobs.createJob({ type: 'single', task: 'cancelled', workspace: 'C:\\repo', priority: 50 });
  jobs.requestCancellation(cancelled.id);
  const cancelledRetry = jobs.createRetryJob(cancelled.id);
  assert.equal(cancelledRetry.parentJobId, cancelled.id);
  assert.equal(cancelledRetry.attempt, 2);
  assert.equal(jobs.getJob(cancelled.id).status, 'cancelled');

  const interrupted = jobs.createJob({ type: 'single', task: 'interrupted', workspace: 'C:\\repo', priority: 50 });
  jobs.transition(interrupted.id, 'starting');
  jobs.transition(interrupted.id, 'interrupted', {
    errorCode: 'server_restart', errorMessage: 'Router restarted.',
  });
  const interruptedRetry = jobs.createRetryJob(interrupted.id);
  assert.equal(interruptedRetry.parentJobId, interrupted.id);
  assert.equal(interruptedRetry.attempt, 2);
  assert.equal(jobs.getJob(interrupted.id).status, 'interrupted');
});

test('priority changes only while queued and immediately changes queue order', async (t) => {
  const jobs = await fixture(t);
  const first = jobs.createJob({ type: 'single', task: 'First', workspace: 'C:\\repo', priority: 50 });
  const second = jobs.createJob({ type: 'single', task: 'Second', workspace: 'C:\\repo', priority: 25 });
  jobs.updatePriority(second.id, 100);
  assert.deepEqual(jobs.listQueuedOrdered().map((job) => job.id), [second.id, first.id]);
  jobs.claimNextQueuedJob();
  assert.throws(() => jobs.updatePriority(second.id, 25), (error) => error.code === 'JOB_PRIORITY_LOCKED');
});

test('startup recovery preserves queued/completed Jobs and interrupts only active states', async (t) => {
  const jobs = await fixture(t);
  const queued = jobs.createJob({ type: 'single', task: 'Queued', workspace: 'C:\\repo', priority: 50 });
  const running = jobs.createJob({ type: 'single', task: 'Running', workspace: 'C:\\repo', priority: 50 });
  const evaluating = jobs.createJob({ type: 'single', task: 'Evaluating', workspace: 'C:\\repo', priority: 50 });
  const completed = jobs.createJob({ type: 'single', task: 'Completed', workspace: 'C:\\repo', priority: 50 });
  jobs.transition(running.id, 'starting'); jobs.transition(running.id, 'running');
  jobs.transition(evaluating.id, 'starting'); jobs.transition(evaluating.id, 'running'); jobs.transition(evaluating.id, 'evaluating');
  jobs.transition(completed.id, 'starting'); jobs.transition(completed.id, 'running'); jobs.transition(completed.id, 'completed');

  const interrupted = jobs.markInterruptedJobs();
  assert.deepEqual(new Set(interrupted.map((job) => job.id)), new Set([running.id, evaluating.id]));
  assert.equal(jobs.getJob(queued.id).status, 'queued');
  assert.equal(jobs.getJob(running.id).status, 'interrupted');
  assert.equal(jobs.getJob(evaluating.id).errorCode, 'server_restart');
  assert.equal(jobs.getJob(completed.id).status, 'completed');
});

test('Job validation rejects arbitrary Agent payloads and unsafe priorities', async (t) => {
  const jobs = await fixture(t);
  assert.throws(() => jobs.createJob({ type: 'single', task: 'x', workspace: 'C:\\repo', priority: 101 }), /between 0 and 100/);
  assert.throws(() => jobs.createJob({ type: 'competition', task: 'x', workspace: 'C:\\repo', agents: ['qwen-code'], priority: 50 }), /require 2/);
  assert.throws(() => jobs.createJob({ type: 'competition', task: 'x', workspace: 'C:\\repo', agents: ['qwen-code', '../bad'], priority: 50 }), /invalid Agent ID/);
});
