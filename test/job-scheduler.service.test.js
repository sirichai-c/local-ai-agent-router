const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ExecutionCancelledError } = require('../src/services/cancellation.service');
const { JobManagerService } = require('../src/services/job-manager.service');
const { JobSchedulerService } = require('../src/services/job-scheduler.service');
const { JobService } = require('../src/services/job.service');
const { RunSessionService } = require('../src/services/run-session.service');
const { createTemporaryDatabase } = require('../test-support/database-test.helper');

async function waitFor(predicate, message = 'condition', timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function successfulResult(taskId) {
  return {
    status: 'completed',
    taskId,
    selectedAgent: { id: 'qwen-code', name: 'Qwen Code' },
    candidateFingerprint: null,
  };
}

async function createFixture(t, {
  maxConcurrent = 1,
  executor,
  competition,
} = {}) {
  const { database } = await createTemporaryDatabase(t, 'agent-router-job-scheduler-');
  const jobs = new JobService({ database });
  const sessions = new RunSessionService({ startCleanupTimer: false });
  t.after(() => sessions.close());
  const defaultExecutor = {
    isExecutionEnabled: () => true,
    assertExecutionBackendAvailable: async () => {},
    executeTask: async () => successfulResult('task-default'),
  };
  const scheduler = new JobSchedulerService({
    jobs,
    sessions,
    executor: executor || defaultExecutor,
    competition: competition || { compete: async () => ({ status: 'completed', competitionId: 'competition-default', winner: { agentId: 'qwen-code' }, ranking: [], candidates: [] }) },
    maxConcurrent,
  });
  const manager = new JobManagerService({ jobs, sessions, scheduler });
  t.after(async () => scheduler.shutdown({ timeoutMs: 100 }));
  return { jobs, manager, scheduler, sessions };
}

function controlledExecutor() {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const order = [];
  const releases = [];
  return {
    get active() { return active; },
    get maxActive() { return maxActive; },
    get calls() { return calls; },
    order,
    releases,
    isExecutionEnabled: () => true,
    assertExecutionBackendAvailable: async () => {},
    executeTask: ({ task, signal, onEvent }) => new Promise((resolve, reject) => {
      calls += 1;
      order.push(task);
      active += 1;
      maxActive = Math.max(maxActive, active);
      onEvent?.({ type: 'evaluation_starting', stage: 'evaluation', status: 'running', messageKey: 'run.evaluationStarting', data: {} });
      const finish = (callback) => {
        if (active > 0) active -= 1;
        callback();
      };
      const release = () => {
        signal?.removeEventListener('abort', abort);
        finish(() => resolve(successfulResult(`task-${calls}`)));
      };
      const abort = () => {
        const index = releases.indexOf(release);
        if (index >= 0) releases.splice(index, 1);
        finish(() => reject(new ExecutionCancelledError()));
      };
      signal?.addEventListener('abort', abort, { once: true });
      releases.push(release);
    }),
  };
}

test('scheduler enforces default concurrency one and advances queued Jobs', async (t) => {
  const executor = controlledExecutor();
  const { jobs, manager, sessions } = await createFixture(t, { executor, maxConcurrent: 1 });
  manager.start();
  const submitted = await Promise.all(['A', 'B', 'C'].map((task) => manager.submit({
    type: 'single', task, workspace: 'C:\\repo', priority: 50,
  })));

  await waitFor(() => executor.active === 1 && jobs.listJobs({ limit: 10, status: 'queued' }).length === 2, 'one active Job');
  assert.equal(executor.maxActive, 1);
  executor.releases.shift()();
  await waitFor(() => executor.calls === 2 && executor.active === 1, 'second Job');
  executor.releases.shift()();
  await waitFor(() => executor.calls === 3 && executor.active === 1, 'third Job');
  executor.releases.shift()();
  await waitFor(() => submitted.every(({ job }) => jobs.getJob(job.id).status === 'completed'), 'all Jobs completed');
  assert.equal(executor.maxActive, 1);
  const eventTypes = sessions.eventsAfter(submitted[0].runId).map((event) => event.type);
  for (const expected of ['job_created', 'job_queued', 'queue_position', 'job_starting', 'job_running', 'job_completed', 'run_completed']) {
    assert.equal(eventTypes.includes(expected), true, `missing ${expected}`);
  }
});

test('configured concurrency two never exceeds two active executions', async (t) => {
  const executor = controlledExecutor();
  const { jobs, manager } = await createFixture(t, { executor, maxConcurrent: 2 });
  manager.start();
  const submitted = await Promise.all(['A', 'B', 'C'].map((task) => manager.submit({
    type: 'single', task, workspace: 'C:\\repo', priority: 50,
  })));
  await waitFor(() => executor.active === 2 && executor.calls === 2, 'two active Jobs');
  assert.equal(executor.maxActive, 2);
  executor.releases.shift()();
  await waitFor(() => executor.calls === 3 && executor.active === 2, 'third Job admitted');
  while (executor.releases.length) executor.releases.shift()();
  await waitFor(() => submitted.every(({ job }) => jobs.getJob(job.id).status === 'completed'), 'all concurrent Jobs completed');
  assert.equal(executor.maxActive, 2);
});

test('urgent queued work starts before older normal work after a worker slot frees', async (t) => {
  const executor = controlledExecutor();
  const { jobs, manager } = await createFixture(t, { executor, maxConcurrent: 1 });
  manager.start();
  const blocker = await manager.submit({ type: 'single', task: 'blocker', workspace: 'C:\\repo', priority: 50 });
  await waitFor(() => executor.active === 1, 'blocker');
  const normal = await manager.submit({ type: 'single', task: 'normal', workspace: 'C:\\repo', priority: 50 });
  const urgent = await manager.submit({ type: 'single', task: 'urgent', workspace: 'C:\\repo', priority: 100 });
  executor.releases.shift()();
  await waitFor(() => executor.order.length === 2, 'next priority Job');
  assert.deepEqual(executor.order, ['blocker', 'urgent']);
  executor.releases.shift()();
  await waitFor(() => executor.order.length === 3, 'normal Job');
  assert.equal(executor.order[2], 'normal');
  executor.releases.shift()();
  await waitFor(() => [blocker, normal, urgent].every(({ job }) => jobs.getJob(job.id).status === 'completed'), 'priority Jobs completed');
});

test('rapid scheduler wakes and dispatch calls cannot execute one Job twice', async (t) => {
  const executor = controlledExecutor();
  const { jobs, manager, scheduler } = await createFixture(t, { executor });
  manager.start();
  const { job } = await manager.submit({ type: 'single', task: 'once', workspace: 'C:\\repo', priority: 50 });
  for (let index = 0; index < 20; index += 1) scheduler.wake();
  await Promise.all(Array.from({ length: 10 }, () => scheduler.dispatch()));
  await waitFor(() => executor.calls === 1, 'single execution');
  executor.releases.shift()();
  await waitFor(() => jobs.getJob(job.id).status === 'completed', 'completion');
  assert.equal(executor.calls, 1);
});

test('queued cancellation never invokes the Agent executor', async (t) => {
  const executor = controlledExecutor();
  const { jobs, manager } = await createFixture(t, { executor });
  const { job } = await manager.submit({ type: 'single', task: 'cancel queued', workspace: 'C:\\repo', priority: 50 });
  const cancelled = manager.cancel(job.id);
  assert.equal(cancelled.outcome, 'cancelled');
  assert.equal(jobs.getJob(job.id).status, 'cancelled');
  assert.equal(executor.calls, 0);
  manager.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(executor.calls, 0);
});

test('disabled execution is rejected before a persistent Job or run session is created', async (t) => {
  const executor = {
    isExecutionEnabled: () => false,
    assertExecutionBackendAvailable: async () => {
      throw new Error('must not inspect backend while disabled');
    },
    executeTask: async () => {
      throw new Error('must not execute');
    },
  };
  const { jobs, manager, sessions } = await createFixture(t, { executor });
  await assert.rejects(
    () => manager.submit({ type: 'single', task: 'disabled', workspace: 'C:\\repo', priority: 50 }),
    (error) => error.code === 'EXECUTION_DISABLED',
  );
  assert.equal(jobs.listJobs({ limit: 10 }).length, 0);
  assert.equal(sessions.sessions.size, 0);
});

test('running cancellation aborts only its active execution and frees the slot', async (t) => {
  const executor = controlledExecutor();
  const { jobs, manager, sessions } = await createFixture(t, { executor });
  manager.start();
  const first = await manager.submit({ type: 'single', task: 'first', workspace: 'C:\\repo', priority: 50 });
  const second = await manager.submit({ type: 'single', task: 'second', workspace: 'C:\\repo', priority: 50 });
  await waitFor(() => jobs.getJob(first.job.id).status === 'evaluating', 'first running');
  assert.equal(manager.cancel(first.job.id).outcome, 'cancel_requested');
  await waitFor(() => jobs.getJob(first.job.id).status === 'cancelled', 'first cancelled');
  await waitFor(() => executor.calls === 2, 'second started');
  assert.equal(jobs.getJob(second.job.id).status, 'evaluating');
  const eventTypes = sessions.eventsAfter(first.runId).map((event) => event.type);
  assert.equal(eventTypes.includes('job_cancel_requested'), true);
  assert.equal(eventTypes.includes('job_cancelled'), true);
  executor.releases.shift()();
  await waitFor(() => jobs.getJob(second.job.id).status === 'completed', 'second completed');
});

test('competition cancellation stops the current competitor path and produces no Winner', async (t) => {
  let secondAgentStarted = false;
  const competition = {
    compete: ({ signal, onEvent }) => new Promise((resolve, reject) => {
      onEvent({ type: 'competition_started', stage: 'competition', status: 'running', messageKey: 'run.competitionStarted', data: { agentIds: ['qwen-code', 'opencode'] } });
      onEvent({ type: 'competition_candidate_starting', stage: 'competition', status: 'running', messageKey: 'run.competitionCandidateStarting', data: { agentId: 'qwen-code' } });
      const timer = setTimeout(() => { secondAgentStarted = true; resolve({ winner: { agentId: 'opencode' } }); }, 10_000);
      timer.unref?.();
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new ExecutionCancelledError());
      }, { once: true });
    }),
  };
  const { jobs, manager, sessions } = await createFixture(t, { competition });
  manager.start();
  const submitted = await manager.submit({
    type: 'competition', task: 'compare', workspace: 'C:\\repo',
    agents: ['qwen-code', 'opencode'], priority: 50,
  });
  await waitFor(() => jobs.getJob(submitted.job.id).status === 'running', 'competition running');
  manager.cancel(submitted.job.id);
  await waitFor(() => jobs.getJob(submitted.job.id).status === 'cancelled', 'competition cancelled');
  assert.equal(secondAgentStarted, false);
  assert.equal(sessions.snapshot(submitted.runId).result, null);
  assert.equal(sessions.eventsAfter(submitted.runId).some((event) => event.type === 'competition_ranking'), false);
});

test('retry creates a separate run session and leaves the original stream terminal', async (t) => {
  const { jobs, manager, sessions } = await createFixture(t);
  const original = jobs.createJob({ type: 'single', task: 'retry', workspace: 'C:\\repo', priority: 50 });
  jobs.transition(original.id, 'starting');
  jobs.transition(original.id, 'failed', { errorCode: 'AGENT_CRASH', errorMessage: 'crashed' });
  sessions.create('single', { id: original.runId, jobId: original.id, initialState: 'starting' });
  sessions.fail(original.runId, { code: 'AGENT_CRASH', message: 'failed' });

  const retried = await manager.retry(original.id);
  assert.notEqual(retried.runId, original.runId);
  assert.equal(retried.job.parentJobId, original.id);
  assert.equal(sessions.snapshot(original.runId).state, 'failed');
  assert.equal(sessions.snapshot(retried.runId).state, 'queued');
});

test('startup marks old active Jobs interrupted, recreates queued sessions, and does not retry interrupted Jobs', async (t) => {
  const executor = controlledExecutor();
  const { jobs, scheduler, sessions } = await createFixture(t, { executor });
  const queued = jobs.createJob({ type: 'single', task: 'queued', workspace: 'C:\\repo', priority: 50 });
  const oldActive = jobs.createJob({ type: 'single', task: 'old active', workspace: 'C:\\repo', priority: 50 });
  jobs.transition(oldActive.id, 'starting'); jobs.transition(oldActive.id, 'running');
  scheduler.start();
  assert.equal(jobs.getJob(oldActive.id).status, 'interrupted');
  assert.equal(sessions.snapshot(queued.runId).jobId, queued.id);
  await waitFor(() => executor.calls === 1, 'queued recovery');
  assert.equal(jobs.getJob(oldActive.id).status, 'interrupted');
  executor.releases.shift()();
  await waitFor(() => jobs.getJob(queued.id).status === 'completed', 'recovered Job completion');
});

test('scheduler shutdown starts no new work and preserves queued Jobs', async (t) => {
  const executor = controlledExecutor();
  const { jobs, manager, scheduler } = await createFixture(t, { executor });
  manager.start();
  const active = await manager.submit({ type: 'single', task: 'active', workspace: 'C:\\repo', priority: 50 });
  const queued = await manager.submit({ type: 'single', task: 'queued', workspace: 'C:\\repo', priority: 50 });
  await waitFor(() => executor.active === 1, 'active before shutdown');
  await scheduler.shutdown({ timeoutMs: 500 });
  await waitFor(() => jobs.getJob(active.job.id).status === 'cancelled', 'active cancellation');
  assert.equal(jobs.getJob(queued.job.id).status, 'queued');
  assert.equal(executor.calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(executor.calls, 1);
});
