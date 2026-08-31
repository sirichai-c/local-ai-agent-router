const fs = require('node:fs');
const path = require('node:path');

const BetterSqlite3 = require('better-sqlite3');

const { config } = require('../config/env');

const SCHEMA_VERSION = 2;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    task_text TEXT NOT NULL,
    workspace TEXT,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    target_branch TEXT,
    base_commit TEXT,
    decision TEXT,
    decision_at TEXT,
    candidate_commit TEXT,
    merge_commit TEXT,
    winner_agent_id TEXT
  );

  CREATE TABLE IF NOT EXISTS task_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    category TEXT NOT NULL,
    score REAL NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE(task_id, category)
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
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
    candidate_fingerprint TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id
    ON agent_runs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id
    ON agent_runs(task_id);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created
    ON agent_runs(agent_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_categories_task_id
    ON task_categories(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_categories_category
    ON task_categories(category);

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

const PHASE_10_TASK_COLUMNS = Object.freeze({
  target_branch: 'TEXT',
  base_commit: 'TEXT',
  decision: 'TEXT',
  decision_at: 'TEXT',
  candidate_commit: 'TEXT',
  merge_commit: 'TEXT',
  winner_agent_id: 'TEXT',
});

function getColumnNames(connection, tableName) {
  return new Set(
    connection.pragma(`table_info(${tableName})`).map((column) => column.name),
  );
}

function addMissingColumns(connection, tableName, columns) {
  const existingColumns = getColumnNames(connection, tableName);

  for (const [columnName, definition] of Object.entries(columns)) {
    if (!existingColumns.has(columnName)) {
      // Identifiers and definitions are application constants, never runtime input.
      connection.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
      );
    }
  }
}

function applyPhase10Migration(connection, appliedAt = new Date().toISOString()) {
  const migrate = connection.transaction(() => {
    addMissingColumns(connection, 'tasks', PHASE_10_TASK_COLUMNS);
    addMissingColumns(connection, 'agent_runs', {
      candidate_fingerprint: 'TEXT',
    });
    connection.prepare(`
      INSERT OR IGNORE INTO schema_migrations (version, applied_at)
      VALUES (?, ?)
    `).run(2, appliedAt);
    connection.pragma('user_version = 2');
  });

  migrate();
}

function resolveDatabasePath(databasePath, cwd = process.cwd()) {
  if (databasePath === ':memory:') {
    return databasePath;
  }

  return path.resolve(cwd, databasePath);
}

class DatabaseService {
  constructor({
    databasePath = config.database.path,
    cwd = process.cwd(),
    Database = BetterSqlite3,
    busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS,
  } = {}) {
    if (typeof databasePath !== 'string' || databasePath.trim() === '') {
      throw new TypeError('databasePath must be a non-empty string');
    }

    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new TypeError('busyTimeoutMs must be a non-negative integer');
    }

    this.databasePath = resolveDatabasePath(databasePath.trim(), cwd);
    this.Database = Database;
    this.busyTimeoutMs = busyTimeoutMs;
    this.connection = null;
  }

  ensureParentDirectory() {
    if (this.databasePath === ':memory:') {
      return;
    }

    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
  }

  configure(connection) {
    if (this.databasePath !== ':memory:') {
      connection.pragma('journal_mode = WAL');
    }

    connection.pragma('foreign_keys = ON');
    connection.pragma(`busy_timeout = ${this.busyTimeoutMs}`);
  }

  initializeSchema(connection) {
    const currentVersion = connection.pragma('user_version', { simple: true });

    if (currentVersion > SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than supported version ${SCHEMA_VERSION}`,
      );
    }

    connection.exec(SCHEMA_SQL);

    if (currentVersion < 2) {
      applyPhase10Migration(connection);
    }
  }

  getConnection() {
    if (this.connection?.open) {
      return this.connection;
    }

    this.ensureParentDirectory();
    const connection = new this.Database(this.databasePath);

    try {
      this.configure(connection);
      this.initializeSchema(connection);
      this.connection = connection;
      return connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  close() {
    if (this.connection?.open) {
      this.connection.close();
    }

    this.connection = null;
  }
}

const databaseService = new DatabaseService();

module.exports = {
  DatabaseService,
  PHASE_10_TASK_COLUMNS,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  addMissingColumns,
  applyPhase10Migration,
  databaseService,
  resolveDatabasePath,
};
