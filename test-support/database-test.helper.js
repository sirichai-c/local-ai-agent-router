const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DatabaseService,
} = require('../src/services/database.service');

async function createTemporaryDatabase(testContext, prefix = 'agent-router-db-') {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(temporaryRoot, 'history.db');
  const database = new DatabaseService({ databasePath });

  testContext.after(async () => {
    database.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  return { database, databasePath, temporaryRoot };
}

module.exports = { createTemporaryDatabase };
