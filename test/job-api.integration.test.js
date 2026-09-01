const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createApp } = require('../src/app');
const { createJobController } = require('../src/controllers/job.controller');
const { createRunController } = require('../src/controllers/run.controller');
const { createJobRouter } = require('../src/routes/job.routes');
const { createRunRouter } = require('../src/routes/run.routes');
const { JobManagerService } = require('../src/services/job-manager.service');
const { JobSchedulerService } = require('../src/services/job-scheduler.service');
const { JobService } = require('../src/services/job.service');
const { RunSessionService } = require('../src/services/run-session.service');
const { createTemporaryDatabase } = require('../test-support/database-test.helper');

async function fixture(t) {
  const { database } = await createTemporaryDatabase(t, 'agent-router-job-api-');
  const jobs = new JobService({ database });
  const sessions = new RunSessionService({ startCleanupTimer: false });
  const executor = {
    isExecutionEnabled: () => true,
    assertExecutionBackendAvailable: async () => {},
    executeTask: async () => ({ status: 'completed', taskId: 'task-1' }),
  };
  const scheduler = new JobSchedulerService({ jobs, sessions, executor });
  const manager = new JobManagerService({ jobs, sessions, scheduler });
  const controller = createJobController({ manager });
  const app = createApp({
    frontendDistPath: 'C:\\not-built',
    jobRoutes: createJobRouter({ controller }),
    runRoutes: createRunRouter({
      controller: createRunController({ coordinator: manager, sessions }),
    }),
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(async () => {
    sessions.close();
    await new Promise((resolve, reject) => server.close(
      (error) => error ? reject(error) : resolve(),
    ));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    jobs,
    sessions,
  };
}

async function jsonRequest(url, options) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  return { response, body: await response.json() };
}

test('Job API submits, lists, reads, reprioritizes, cancels, and retries safely', async (t) => {
  const { baseUrl, jobs } = await fixture(t);
  const submitted = await jsonRequest(`${baseUrl}/api/jobs`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'single', task: 'Update README', workspace: 'C:\\repo', priority: 25,
    }),
  });
  assert.equal(submitted.response.status, 202);
  assert.equal(submitted.body.job.status, 'queued');
  assert.equal(submitted.body.queuePosition, 1);
  assert.equal(typeof submitted.body.runId, 'string');

  const changed = await jsonRequest(`${baseUrl}/api/jobs/${submitted.body.job.id}/priority`, {
    method: 'PATCH', body: JSON.stringify({ priority: 100 }),
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.body.job.priority, 100);

  const listed = await jsonRequest(`${baseUrl}/api/jobs?status=queued&limit=20`);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.jobs.length, 1);
  assert.equal(listed.body.scheduler.maxConcurrent, 1);
  const stats = await jsonRequest(`${baseUrl}/api/jobs/stats`);
  assert.equal(stats.response.status, 200);
  assert.equal(stats.body.status, 'stopped');

  const detail = await jsonRequest(`${baseUrl}/api/jobs/${submitted.body.job.id}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.job.task, 'Update README');

  const cancelled = await jsonRequest(`${baseUrl}/api/jobs/${submitted.body.job.id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ pid: 4, containerId: 'untrusted', command: 'taskkill' }),
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.job.status, 'cancelled');
  assert.equal(jobs.getJob(submitted.body.job.id).status, 'cancelled');

  const cancelledAgain = await jsonRequest(`${baseUrl}/api/jobs/${submitted.body.job.id}/cancel`, {
    method: 'POST', body: '{}',
  });
  assert.equal(cancelledAgain.response.status, 200);
  assert.equal(cancelledAgain.body.outcome, 'already_cancelled');

  const retry = await jsonRequest(`${baseUrl}/api/jobs/${submitted.body.job.id}/retry`, {
    method: 'POST', body: JSON.stringify({ priority: 75 }),
  });
  assert.equal(retry.response.status, 202);
  assert.notEqual(retry.body.job.id, submitted.body.job.id);
  assert.equal(retry.body.job.parentJobId, submitted.body.job.id);
  assert.equal(retry.body.job.attempt, 2);
  assert.equal(retry.body.job.priority, 75);
});

test('Phase 13 start routes submit exactly one persistent Job without direct execution', async (t) => {
  const { baseUrl, jobs } = await fixture(t);
  const single = await jsonRequest(`${baseUrl}/api/runs/execute`, {
    method: 'POST',
    body: JSON.stringify({ task: 'single compatibility', workspace: 'C:\\repo', priority: 75 }),
  });
  assert.equal(single.response.status, 202);
  assert.equal(single.body.state, 'queued');
  assert.equal(jobs.listJobs({ limit: 10 }).length, 1);
  assert.equal(jobs.listJobs({ limit: 10 })[0].priority, 75);

  const competition = await jsonRequest(`${baseUrl}/api/runs/compete`, {
    method: 'POST',
    body: JSON.stringify({
      task: 'competition compatibility', workspace: 'C:\\repo',
      agents: ['qwen-code', 'opencode'],
    }),
  });
  assert.equal(competition.response.status, 202);
  assert.equal(competition.body.state, 'queued');
  assert.equal(jobs.listJobs({ limit: 10 }).length, 2);
});

test('Job API returns bounded controlled validation and state conflicts', async (t) => {
  const { baseUrl, jobs } = await fixture(t);
  const invalid = await jsonRequest(`${baseUrl}/api/jobs`, {
    method: 'POST', body: JSON.stringify({ type: 'single', task: '', workspace: 'C:\\repo', priority: 101 }),
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.code, 'JOB_TASK_INVALID');

  const invalidLimit = await jsonRequest(`${baseUrl}/api/jobs?limit=1000`);
  assert.equal(invalidLimit.response.status, 400);
  assert.equal(invalidLimit.body.code, 'JOB_LIMIT_INVALID');

  const missing = await jsonRequest(`${baseUrl}/api/jobs/not-present`);
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.code, 'JOB_NOT_FOUND');

  const completed = jobs.createJob({ type: 'single', task: 'done', workspace: 'C:\\repo', priority: 50 });
  jobs.transition(completed.id, 'starting'); jobs.transition(completed.id, 'running'); jobs.transition(completed.id, 'completed');
  const cancelCompleted = await jsonRequest(`${baseUrl}/api/jobs/${completed.id}/cancel`, {
    method: 'POST', body: '{}',
  });
  assert.equal(cancelCompleted.response.status, 409);
  assert.equal(cancelCompleted.body.code, 'JOB_ALREADY_COMPLETED');
  const retryCompleted = await jsonRequest(`${baseUrl}/api/jobs/${completed.id}/retry`, {
    method: 'POST', body: '{}',
  });
  assert.equal(retryCompleted.response.status, 409);
  assert.equal(retryCompleted.body.code, 'JOB_NOT_RETRYABLE');
});
