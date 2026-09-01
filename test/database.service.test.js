const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const BetterSqlite3 = require('better-sqlite3');

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

  assert.deepEqual(tables, [
    'agent_runs',
    'jobs',
    'schema_migrations',
    'task_categories',
    'tasks',
  ]);
  assert.deepEqual(indexes, [
    'idx_agent_runs_agent_created',
    'idx_agent_runs_agent_id',
    'idx_agent_runs_task_id',
    'idx_jobs_created',
    'idx_jobs_parent',
    'idx_jobs_queue',
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

test('Phase 9 database migrates non-destructively through Phase 14', async (t) => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-router-phase9-migration-'),
  );
  const databasePath = path.join(temporaryRoot, 'phase9.db');
  const oldDatabase = new BetterSqlite3(databasePath);
  oldDatabase.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      task_text TEXT NOT NULL,
      workspace TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE task_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      category TEXT NOT NULL,
      score REAL NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(task_id, category)
    );
    CREATE TABLE agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      router_score REAL,
      static_score REAL,
      adaptive_score REAL,
      evaluation_score REAL,
      verdict TEXT,
      competition_score REAL,
      duration_ms INTEGER,
      changed_files INTEGER,
      branch TEXT,
      worktree TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    PRAGMA user_version = 1;
  `);
  oldDatabase.prepare(`
    INSERT INTO tasks (
      id, task_text, mode, status, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    'old-task',
    'preserve Phase 9 history',
    'single',
    'completed',
    '2026-01-01T00:00:00.000Z',
  );
  oldDatabase.close();

  const database = new DatabaseService({ databasePath });
  t.after(async () => {
    database.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const connection = database.getConnection();
  const taskColumns = new Set(
    connection.pragma('table_info(tasks)').map((column) => column.name),
  );
  const runColumns = new Set(
    connection.pragma('table_info(agent_runs)').map((column) => column.name),
  );

  assert.equal(connection.pragma('user_version', { simple: true }), 3);
  assert.equal(taskColumns.has('target_branch'), true);
  assert.equal(taskColumns.has('base_commit'), true);
  assert.equal(taskColumns.has('decision'), true);
  assert.equal(taskColumns.has('candidate_commit'), true);
  assert.equal(taskColumns.has('merge_commit'), true);
  assert.equal(runColumns.has('candidate_fingerprint'), true);
  assert.equal(
    connection.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get().count,
    1,
  );
  assert.equal(
    connection.prepare('SELECT task_text FROM tasks WHERE id = ?')
      .get('old-task').task_text,
    'preserve Phase 9 history',
  );
});

test('Phase 14 migration can initialize repeatedly without record loss', async (t) => {
  const { database } = await createTemporaryDatabase(t);
  const connection = database.getConnection();
  connection.prepare(`
    INSERT INTO tasks (
      id, task_text, mode, status, created_at, decision
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'migration-repeat',
    'keep me',
    'single',
    'completed',
    '2026-01-01T00:00:00.000Z',
    'pending',
  );

  database.initializeSchema(connection);
  database.initializeSchema(connection);

  assert.equal(
    connection.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,
    1,
  );
  assert.equal(
    connection.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 2
    `).get().count,
    1,
  );
  assert.equal(
    connection.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 3
    `).get().count,
    1,
  );
});

test('Phase 13-style version 2 database migrates to Jobs without losing history', async (t) => {
  const { database, databasePath } = await createTemporaryDatabase(t, 'agent-router-phase13-migration-');
  const connection = database.getConnection();
  connection.prepare(`
    INSERT INTO tasks (id, task_text, mode, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('phase13-task', 'preserve live-era history', 'single', 'completed', '2026-08-31T00:00:00.000Z');
  connection.exec(`
    DROP TABLE jobs;
    DELETE FROM schema_migrations WHERE version = 3;
    PRAGMA user_version = 2;
  `);
  database.close();

  const upgraded = new DatabaseService({ databasePath });
  try {
    const upgradedConnection = upgraded.getConnection();
    upgraded.initializeSchema(upgradedConnection);
    upgraded.initializeSchema(upgradedConnection);
    assert.equal(upgradedConnection.pragma('user_version', { simple: true }), 3);
    assert.equal(
      upgradedConnection.prepare('SELECT task_text FROM tasks WHERE id = ?')
        .get('phase13-task').task_text,
      'preserve live-era history',
    );
    assert.equal(
      upgradedConnection.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get().count,
      1,
    );
    assert.equal(
      upgradedConnection.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 3').get().count,
      1,
    );
  } finally {
    upgraded.close();
  }
});
