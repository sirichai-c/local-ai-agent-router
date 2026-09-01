const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  JobStateService,
} = require('../src/services/job-state.service');

function job(status) {
  return {
    id: 'job-1',
    status,
    startedAt: null,
    completedAt: null,
    cancelRequestedAt: null,
    cancelledAt: null,
    errorCode: null,
    errorMessage: null,
    resultStatus: null,
    taskId: null,
    competitionId: null,
  };
}

test('Job state machine permits only explicit scheduling transitions', () => {
  const state = new JobStateService();
  const starting = state.transition(job('queued'), 'starting', {
    now: '2026-09-01T00:00:00.000Z',
  });
  const running = state.transition(starting, 'running', {
    now: '2026-09-01T00:00:01.000Z',
  });
  const evaluating = state.transition(running, 'evaluating', {
    now: '2026-09-01T00:00:02.000Z',
  });
  const completed = state.transition(evaluating, 'completed', {
    now: '2026-09-01T00:00:03.000Z',
    resultStatus: 'completed',
    taskId: 'task-1',
  });

  assert.equal(starting.startedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(completed.completedAt, '2026-09-01T00:00:03.000Z');
  assert.equal(completed.taskId, 'task-1');
  assert.throws(() => state.transition(completed, 'queued'), /cannot transition/);
  assert.throws(() => state.transition(job('queued'), 'completed'), /cannot transition/);
});

test('cancellation and interruption timestamps are applied consistently', () => {
  const state = new JobStateService();
  const requested = state.transition(job('running'), 'cancel_requested', {
    now: '2026-09-01T01:00:00.000Z',
  });
  const cancelled = state.transition(requested, 'cancelled', {
    now: '2026-09-01T01:00:01.000Z',
  });
  const interrupted = state.transition(job('evaluating'), 'interrupted', {
    now: '2026-09-01T02:00:00.000Z',
    errorCode: 'server_restart',
    errorMessage: 'Router restarted.',
  });

  assert.equal(requested.cancelRequestedAt, '2026-09-01T01:00:00.000Z');
  assert.equal(cancelled.cancelledAt, '2026-09-01T01:00:01.000Z');
  assert.equal(cancelled.completedAt, cancelled.cancelledAt);
  assert.equal(interrupted.errorCode, 'server_restart');
});
