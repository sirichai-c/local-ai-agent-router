const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

const { createApp } = require('../src/app');
const { createRunController } = require('../src/controllers/run.controller');
const { createRunRouter } = require('../src/routes/run.routes');
const { RunStartError } = require('../src/services/run-coordinator.service');
const { RunSessionService } = require('../src/services/run-session.service');

function lifecycleEvent(type, stage = 'routing', status = 'running') {
  return {
    type,
    stage,
    status,
    messageKey: 'run.test',
    data: {},
  };
}

async function createServer({ sessions, coordinator, heartbeatMs = 20 }) {
  const controller = createRunController({ sessions, coordinator, heartbeatMs });
  const app = createApp({
    frontendDistPath: 'C:\\definitely-not-built',
    runRoutes: createRunRouter({ controller }),
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(
      (error) => error ? reject(error) : resolve(),
    )),
  };
}

function parseEvent(block) {
  const lines = block.split('\n');
  if (lines.some((line) => line.startsWith(':'))) return { heartbeat: true };
  const data = lines.find((line) => line.startsWith('data: '));
  return data ? JSON.parse(data.slice(6)) : null;
}

async function readUntil(reader, predicate, timeoutMs = 2_000) {
  const decoder = new TextDecoder();
  let buffer = '';
  const timeout = Date.now() + timeoutMs;

  while (Date.now() < timeout) {
    const read = await Promise.race([
      reader.read(),
      delay(Math.max(1, timeout - Date.now())).then(() => ({ timeout: true })),
    ]);
    if (read.timeout) break;
    if (read.done) break;
    buffer += decoder.decode(read.value, { stream: true }).replaceAll('\r\n', '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop();
    for (const block of blocks) {
      const parsed = parseEvent(block);
      if (parsed && predicate(parsed)) return parsed;
    }
  }

  throw new Error('Timed out waiting for SSE event');
}

test('SSE replays initial events, streams ordered new events, and cleans listeners', async () => {
  const sessions = new RunSessionService({ idFactory: () => 'sse-run', startCleanupTimer: false });
  sessions.create('single');
  sessions.append('sse-run', lifecycleEvent('run_started', 'initializing'));
  const server = await createServer({ sessions, coordinator: {} });
  const abort = new AbortController();

  try {
    const response = await fetch(`${server.baseUrl}/api/runs/sse-run/events`, { signal: abort.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/event-stream/u);
    const reader = response.body.getReader();
    const initial = await readUntil(reader, (event) => event.type === 'run_started');
    assert.equal(initial.id, 1);
    assert.equal(sessions.listenerCount('sse-run'), 1);
    sessions.append('sse-run', lifecycleEvent('router_analyzing'));
    sessions.append('sse-run', lifecycleEvent('router_completed', 'routing', 'completed'));
    const completed = await readUntil(reader, (event) => event.type === 'router_completed');
    assert.equal(completed.id, 3);
    abort.abort();
    await delay(30);
    assert.equal(sessions.listenerCount('sse-run'), 0);
    assert.equal(sessions.snapshot('sse-run').state, 'running');
  } finally {
    abort.abort();
    await server.close();
    sessions.close();
  }
});

test('Last-Event-ID replays only missed events without duplication', async () => {
  const sessions = new RunSessionService({ idFactory: () => 'replay-run', startCleanupTimer: false });
  sessions.create('single');
  sessions.append('replay-run', lifecycleEvent('run_started', 'initializing'));
  sessions.append('replay-run', lifecycleEvent('router_analyzing'));
  sessions.append('replay-run', lifecycleEvent('router_completed', 'routing', 'completed'));
  const server = await createServer({ sessions, coordinator: {} });
  const abort = new AbortController();

  try {
    const response = await fetch(`${server.baseUrl}/api/runs/replay-run/events`, {
      headers: { 'Last-Event-ID': '2' },
      signal: abort.signal,
    });
    const event = await readUntil(response.body.getReader(), (item) => item.type === 'router_completed');
    assert.equal(event.id, 3);
  } finally {
    abort.abort();
    await server.close();
    sessions.close();
  }
});

test('an expired replay window sends a current snapshot event', async () => {
  const sessions = new RunSessionService({
    idFactory: () => 'snapshot-run',
    eventLimit: 2,
    startCleanupTimer: false,
  });
  sessions.create('single');
  sessions.append('snapshot-run', lifecycleEvent('run_started', 'initializing'));
  sessions.append('snapshot-run', lifecycleEvent('router_analyzing'));
  sessions.append('snapshot-run', lifecycleEvent('router_completed', 'routing', 'completed'));
  const server = await createServer({ sessions, coordinator: {} });
  const abort = new AbortController();

  try {
    const response = await fetch(`${server.baseUrl}/api/runs/snapshot-run/events`, {
      headers: { 'Last-Event-ID': '0' },
      signal: abort.signal,
    });
    const event = await readUntil(response.body.getReader(), (item) => item.type === 'session_snapshot');
    assert.equal(event.data.snapshot.lastEventId, 3);
    assert.equal(event.data.snapshot.result, null);
  } finally {
    abort.abort();
    await server.close();
    sessions.close();
  }
});

test('heartbeat comments preserve the protocol and snapshot endpoint returns terminal state', async () => {
  const sessions = new RunSessionService({ idFactory: () => 'complete-run', startCleanupTimer: false });
  sessions.create('single');
  sessions.complete('complete-run', { status: 'completed', taskId: 'task-1' }, { taskId: 'task-1' });
  const server = await createServer({ sessions, coordinator: {}, heartbeatMs: 10 });
  const abort = new AbortController();

  try {
    const snapshotResponse = await fetch(`${server.baseUrl}/api/runs/complete-run`);
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.state, 'completed');
    assert.equal(snapshot.result.taskId, 'task-1');
    const response = await fetch(`${server.baseUrl}/api/runs/complete-run/events`, { signal: abort.signal });
    const heartbeat = await readUntil(response.body.getReader(), (item) => item.heartbeat === true);
    assert.equal(heartbeat.heartbeat, true);
  } finally {
    abort.abort();
    await server.close();
    sessions.close();
  }
});

test('unknown runs return 404 and disabled execution creates no session', async () => {
  const sessions = new RunSessionService({ startCleanupTimer: false });
  const coordinator = {
    startSingle: async () => {
      throw new RunStartError('Agent execution is disabled.', 'EXECUTION_DISABLED', 409);
    },
  };
  const server = await createServer({ sessions, coordinator });

  try {
    const missing = await fetch(`${server.baseUrl}/api/runs/not-present`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'RUN_NOT_FOUND');
    const stream = await fetch(`${server.baseUrl}/api/runs/not-present/events`);
    assert.equal(stream.status, 404);
    const start = await fetch(`${server.baseUrl}/api/runs/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'safe', workspace: 'C:\\repo' }),
    });
    assert.equal(start.status, 409);
    assert.equal((await start.json()).code, 'EXECUTION_DISABLED');
    assert.equal(sessions.sessions.size, 0);
  } finally {
    await server.close();
    sessions.close();
  }
});

test('single and competition start endpoints return accepted runtime IDs immediately', async () => {
  const sessions = new RunSessionService({ startCleanupTimer: false });
  const calls = [];
  const coordinator = {
    startSingle: async (input) => {
      calls.push({ type: 'single', input });
      return { id: 'accepted-single', type: 'single', state: 'starting' };
    },
    startCompetition: async (input) => {
      calls.push({ type: 'competition', input });
      return { id: 'accepted-competition', type: 'competition', state: 'starting' };
    },
  };
  const server = await createServer({ sessions, coordinator });

  try {
    const single = await fetch(`${server.baseUrl}/api/runs/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'update README', workspace: 'C:\\repo' }),
    });
    assert.equal(single.status, 202);
    assert.deepEqual(await single.json(), {
      runId: 'accepted-single',
      type: 'single',
      state: 'starting',
    });

    const competition = await fetch(`${server.baseUrl}/api/runs/compete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task: 'update README',
        workspace: 'C:\\repo',
        agents: ['qwen-code', 'opencode'],
      }),
    });
    assert.equal(competition.status, 202);
    assert.deepEqual(await competition.json(), {
      runId: 'accepted-competition',
      type: 'competition',
      state: 'starting',
    });
    assert.deepEqual(calls, [
      {
        type: 'single',
        input: { task: 'update README', workspace: 'C:\\repo' },
      },
      {
        type: 'competition',
        input: {
          task: 'update README',
          workspace: 'C:\\repo',
          agentIds: ['qwen-code', 'opencode'],
        },
      },
    ]);
  } finally {
    await server.close();
    sessions.close();
  }
});

test('invalid Last-Event-ID is rejected before opening an SSE connection', async () => {
  const sessions = new RunSessionService({ idFactory: () => 'invalid-last-id', startCleanupTimer: false });
  sessions.create('single');
  const server = await createServer({ sessions, coordinator: {} });

  try {
    const response = await fetch(`${server.baseUrl}/api/runs/invalid-last-id/events`, {
      headers: { 'Last-Event-ID': 'not-a-number' },
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_LAST_EVENT_ID');
    assert.equal(sessions.listenerCount('invalid-last-id'), 0);
  } finally {
    await server.close();
    sessions.close();
  }
});

test('multiple subscribers observe one session without triggering another execution', async () => {
  const sessions = new RunSessionService({ idFactory: () => 'shared-run', startCleanupTimer: false });
  sessions.create('single');
  sessions.append('shared-run', lifecycleEvent('run_started', 'initializing'));
  const server = await createServer({ sessions, coordinator: {} });
  const firstAbort = new AbortController();
  const secondAbort = new AbortController();

  try {
    const [first, second] = await Promise.all([
      fetch(`${server.baseUrl}/api/runs/shared-run/events`, { signal: firstAbort.signal }),
      fetch(`${server.baseUrl}/api/runs/shared-run/events`, { signal: secondAbort.signal }),
    ]);
    assert.equal(sessions.listenerCount('shared-run'), 2);
    sessions.append('shared-run', lifecycleEvent('router_completed', 'routing', 'completed'));
    const [left, right] = await Promise.all([
      readUntil(first.body.getReader(), (event) => event.type === 'router_completed'),
      readUntil(second.body.getReader(), (event) => event.type === 'router_completed'),
    ]);
    assert.equal(left.id, right.id);
    assert.equal(sessions.snapshot('shared-run').lastEventId, 2);
  } finally {
    firstAbort.abort();
    secondAbort.abort();
    await server.close();
    sessions.close();
  }
});
