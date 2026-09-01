const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  RunSessionService,
} = require('../src/services/run-session.service');

function event(type = 'router_analyzing', stage = 'routing') {
  return {
    type,
    stage,
    status: 'running',
    messageKey: 'run.test',
    data: {},
  };
}

test('run sessions use unique IDs and expose immutable snapshots', () => {
  const ids = ['run-a', 'run-b'];
  const sessions = new RunSessionService({
    idFactory: () => ids.shift(),
    startCleanupTimer: false,
  });
  const first = sessions.create('single');
  const second = sessions.create('competition');

  assert.equal(first.id, 'run-a');
  assert.equal(second.id, 'run-b');
  assert.equal(first.state, 'starting');
  first.state = 'tampered';
  assert.equal(sessions.snapshot('run-a').state, 'starting');
  assert.equal(sessions.snapshot('unknown'), null);
});

test('events are sequential, bounded, and replayable after an event ID', () => {
  const sessions = new RunSessionService({
    idFactory: () => 'bounded-run',
    eventLimit: 3,
    startCleanupTimer: false,
  });
  sessions.create('single');

  for (let index = 0; index < 5; index += 1) {
    sessions.append('bounded-run', event());
  }

  assert.deepEqual(
    sessions.eventsAfter('bounded-run').map((item) => item.id),
    [3, 4, 5],
  );
  assert.deepEqual(
    sessions.eventsAfter('bounded-run', 3).map((item) => item.id),
    [4, 5],
  );
  assert.equal(sessions.oldestEventId('bounded-run'), 3);
});

test('subscribers receive events once and unsubscribe without stopping the run', () => {
  const sessions = new RunSessionService({
    idFactory: () => 'subscriber-run',
    startCleanupTimer: false,
  });
  sessions.create('single');
  const received = [];
  const unsubscribe = sessions.subscribe('subscriber-run', (item) => received.push(item));
  sessions.append('subscriber-run', event());
  unsubscribe();
  sessions.append('subscriber-run', event('repository_validating', 'repository'));

  assert.equal(received.length, 1);
  assert.equal(sessions.listenerCount('subscriber-run'), 0);
  assert.equal(sessions.snapshot('subscriber-run').state, 'running');
});

test('complete and fail create terminal events and reject later mutation', () => {
  const sessions = new RunSessionService({
    idFactory: (() => { const ids = ['complete-run', 'failed-run']; return () => ids.shift(); })(),
    startCleanupTimer: false,
  });
  sessions.create('single');
  sessions.complete('complete-run', { status: 'completed' }, { taskId: 'task-1' });
  assert.equal(sessions.snapshot('complete-run').state, 'completed');
  assert.equal(sessions.eventsAfter('complete-run').at(-1).type, 'run_completed');
  assert.throws(() => sessions.append('complete-run', event()), /already finished/);

  sessions.create('single');
  sessions.fail('failed-run', { code: 'SAFE', message: 'Safe failure.' }, { code: 'SAFE' });
  assert.equal(sessions.snapshot('failed-run').state, 'failed');
  const failedEvent = sessions.eventsAfter('failed-run').at(-1);
  assert.equal(failedEvent.type, 'run_failed');
  assert.deepEqual(failedEvent.data, {
    code: 'SAFE',
    message: 'Safe failure.',
    stage: 'failed',
  });
});

test('finished sessions expire after TTL while active sessions remain', () => {
  let now = new Date('2026-09-01T00:00:00.000Z');
  const ids = ['finished', 'active'];
  const sessions = new RunSessionService({
    idFactory: () => ids.shift(),
    clock: () => now,
    sessionTtlMs: 1_000,
    startCleanupTimer: false,
  });
  sessions.create('single');
  sessions.complete('finished', { status: 'completed' });
  sessions.create('single');
  now = new Date('2026-09-01T00:00:01.001Z');

  assert.equal(sessions.cleanupExpired(), 1);
  assert.equal(sessions.snapshot('finished'), null);
  assert.notEqual(sessions.snapshot('active'), null);
});

test('event validation rejects arbitrary types and oversized data', () => {
  const sessions = new RunSessionService({
    idFactory: () => 'safe-run',
    startCleanupTimer: false,
  });
  sessions.create('single');
  assert.throws(() => sessions.append('safe-run', {
    ...event(),
    type: 'browser_claimed_candidate_ready',
  }), /type is not allowed/);
  assert.throws(() => sessions.append('safe-run', {
    ...event(),
    data: { value: 'x'.repeat(9_000) },
  }), /safety limit/);
});
