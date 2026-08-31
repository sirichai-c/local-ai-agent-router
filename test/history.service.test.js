const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  HistoryNotFoundError,
  HistoryService,
  createAgentRunRecord,
  normalizeLimit,
} = require('../src/services/history.service');
const {
  createTemporaryDatabase,
} = require('../test-support/database-test.helper');

function fixedClock() {
  let tick = 0;

  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

test('history service stores a task, meaningful categories, and agent metadata', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const history = new HistoryService({ database, clock: fixedClock() });

  history.createTask({
    id: 'task-1',
    task: 'debug API',
    workspace: 'C:\\Projects\\example',
    mode: 'single',
    classification: { coding: 30, debugging: 80, git: 0 },
    targetBranch: 'main',
    baseCommit: 'a'.repeat(40),
  });
  history.recordAgentRun({
    taskId: 'task-1',
    agentId: 'qwen-code',
    status: 'completed',
    routerScore: 92,
    staticScore: 90,
    adaptiveScore: 92,
    evaluationScore: 95,
    verdict: 'pass',
    durationMs: 1_200,
    changedFiles: 2,
    branch: 'agent/task-1-qwen-code',
    worktree: 'C:\\worktrees\\task-1-qwen-code',
    candidateFingerprint: `sha256:${'b'.repeat(64)}`,
  });
  history.completeTask('task-1', 'completed', {
    winnerAgentId: 'qwen-code',
  });

  const detail = history.getTaskById('task-1');
  const list = history.getRecentTasks(10);

  assert.deepEqual(detail.classification, { coding: 30, debugging: 80 });
  assert.equal(detail.status, 'completed');
  assert.equal(detail.runs.length, 1);
  assert.equal(detail.runs[0].staticScore, 90);
  assert.equal(detail.runs[0].evaluationScore, 95);
  assert.equal(detail.runs[0].competitionScore, null);
  assert.equal(detail.targetBranch, 'main');
  assert.equal(detail.baseCommit, 'a'.repeat(40));
  assert.equal(detail.decision, 'pending');
  assert.equal(detail.winnerAgentId, 'qwen-code');
  assert.equal(
    detail.runs[0].candidateFingerprint,
    `sha256:${'b'.repeat(64)}`,
  );
  assert.equal(list[0].runCount, 1);
  assert.equal('stdout' in detail.runs[0], false);
  assert.equal('stderr' in detail.runs[0], false);
  assert.equal('diff' in detail.runs[0], false);
});

test('task and category insert rolls back as one transaction on failure', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const connection = database.getConnection();
  const history = new HistoryService({ database });

  connection.exec(`
    CREATE TRIGGER reject_debugging_category
    BEFORE INSERT ON task_categories
    WHEN NEW.category = 'debugging'
    BEGIN
      SELECT RAISE(ABORT, 'intentional category failure');
    END;
  `);

  assert.throws(
    () => history.createTask({
      id: 'rollback-task',
      task: 'debug API',
      mode: 'single',
      classification: { coding: 30, debugging: 80 },
    }),
    /intentional category failure/,
  );
  assert.equal(
    connection.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,
    0,
  );
  assert.equal(
    connection.prepare('SELECT COUNT(*) AS count FROM task_categories').get().count,
    0,
  );
});

test('foreign keys reject orphan agent runs', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const history = new HistoryService({ database });

  assert.throws(
    () => history.recordAgentRun({
      taskId: 'missing-task',
      agentId: 'opencode',
      status: 'failed',
    }),
    /FOREIGN KEY constraint failed/,
  );
});

test('history validation bounds list sizes and missing completion targets', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const history = new HistoryService({ database });

  assert.equal(normalizeLimit(undefined), 20);
  assert.equal(normalizeLimit('100'), 100);
  assert.throws(() => normalizeLimit('101'), /between 1 and 100/);
  assert.throws(
    () => history.completeTask('missing', 'failed'),
    (error) => error instanceof HistoryNotFoundError,
  );
});

test('execution result mapping stores only bounded metadata fields', () => {
  const record = createAgentRunRecord({
    taskId: 'task-1',
    agent: {
      id: 'opencode',
      score: 91,
      staticScore: 88,
      adaptive: true,
    },
    result: {
      status: 'completed',
      execution: { durationMs: 500, stdout: 'must not persist' },
      evaluation: { score: 97, verdict: 'pass' },
      changes: { count: 1, diff: 'must not persist' },
      workspace: { branch: 'agent/task-opencode', worktree: 'worktree' },
      candidateFingerprint: `sha256:${'c'.repeat(64)}`,
    },
  });

  assert.equal(record.routerScore, 91);
  assert.equal(record.staticScore, 88);
  assert.equal(record.adaptiveScore, 91);
  assert.equal(record.changedFiles, 1);
  assert.equal(record.candidateFingerprint, `sha256:${'c'.repeat(64)}`);
  assert.equal('stdout' in record, false);
  assert.equal('diff' in record, false);
});
