const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { test } = require('node:test');

const {
  DatabaseService,
  SCHEMA_VERSION,
} = require('../src/services/database.service');
const {
  createTemporaryDatabase,
} = require('../test-support/database-test.helper');

test('database service creates the SQLite file, schema, indexes, and pragmas', async (t) => {
  const { database, databasePath } = await createTemporaryDatabase(t);
  const connection = database.getConnection();
  const tables = connection.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  const indexes = connection.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name LIKE 'idx_%'
    ORDER BY name
  `).all().map((row) => row.name);

  assert.deepEqual(tables, ['agent_runs', 'task_categories', 'tasks']);
  assert.deepEqual(indexes, [
    'idx_agent_runs_agent_created',
    'idx_agent_runs_agent_id',
    'idx_agent_runs_task_id',
    'idx_task_categories_category',
    'idx_task_categories_task_id',
  ]);
  assert.equal(connection.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(connection.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(connection.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal((await fs.stat(databasePath)).isFile(), true);
});

test('schema initialization is idempotent and preserves existing records', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const connection = database.getConnection();

  connection.prepare(`
    INSERT INTO tasks (
      id, task_text, workspace, mode, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run('task-1', 'persist me', null, 'single', 'completed', '2026-01-01T00:00:00.000Z');
  database.initializeSchema(connection);

  assert.equal(
    connection.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,
    1,
  );
});

test('history persists after closing and reopening the same database file', async (t) => {
  const { database, databasePath } = await createTemporaryDatabase(t);
  const connection = database.getConnection();

  connection.prepare(`
    INSERT INTO tasks (
      id, task_text, workspace, mode, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run('task-persist', 'persistent task', null, 'single', 'completed', '2026-01-01T00:00:00.000Z');
  database.close();

  const reopened = new DatabaseService({ databasePath });
  try {
    assert.deepEqual(
      reopened.getConnection().prepare(`
        SELECT id, task_text AS task FROM tasks WHERE id = ?
      `).get('task-persist'),
      { id: 'task-persist', task: 'persistent task' },
    );
  } finally {
    reopened.close();
  }
});

test('in-memory databases remain supported for isolated tests', () => {
  const database = new DatabaseService({ databasePath: ':memory:' });
  const connection = database.getConnection();

  assert.equal(connection.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(
    connection.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,
    0,
  );
  database.close();
});
