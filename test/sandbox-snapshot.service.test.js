const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  SandboxSnapshotError,
  SandboxSnapshotService,
} = require('../src/services/sandbox-snapshot.service');

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lar-snapshot-test-'));
  const workspace = path.join(root, 'candidate');
  const runRoot = path.join(root, 'runs');
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'README.md'), 'safe\n');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, workspace, runRoot };
}

function createService(runRoot, id = 'a'.repeat(16)) {
  return new SandboxSnapshotService({ runRoot, idFactory: () => id });
}

test('snapshot copies regular project files and cleanup removes only its run', async (t) => {
  const fixture = await createFixture(t);
  const service = createService(fixture.runRoot);
  const snapshot = await service.create(fixture.workspace);

  assert.equal(
    await fs.readFile(path.join(snapshot.snapshotPath, 'README.md'), 'utf8'),
    'safe\n',
  );
  assert.equal(await fs.readFile(path.join(fixture.workspace, 'README.md'), 'utf8'), 'safe\n');
  assert.deepEqual(await service.cleanup(snapshot), { removed: true, kept: false });
  await assert.rejects(() => fs.stat(snapshot.runPath), { code: 'ENOENT' });
});

test('snapshot excludes Git metadata, dependencies, and runtime roots', async (t) => {
  const fixture = await createFixture(t);
  for (const name of ['.git', 'node_modules', '.agent-worktrees', '.sandbox-runs']) {
    await fs.mkdir(path.join(fixture.workspace, name));
    await fs.writeFile(path.join(fixture.workspace, name, 'sentinel'), 'hidden');
  }
  const snapshot = await createService(fixture.runRoot).create(fixture.workspace);

  for (const name of ['.git', 'node_modules', '.agent-worktrees', '.sandbox-runs']) {
    await assert.rejects(
      () => fs.stat(path.join(snapshot.snapshotPath, name)),
      { code: 'ENOENT' },
    );
  }
});

test('snapshot rejects symbolic links instead of following external paths', async (t) => {
  const fixture = await createFixture(t);
  const outside = path.join(fixture.root, 'outside');
  const link = path.join(fixture.workspace, 'escape');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'sentinel.txt'), 'host-only');

  try {
    await fs.symlink(outside, link, 'dir');
  } catch (symlinkError) {
    if (!['EPERM', 'EACCES'].includes(symlinkError.code)) {
      throw symlinkError;
    }

    await fs.symlink(outside, link, 'junction');
  }

  await assert.rejects(
    () => createService(fixture.runRoot).create(fixture.workspace),
    (error) => error instanceof SandboxSnapshotError
      && error.code === 'SNAPSHOT_SYMLINK_REJECTED',
  );
});

test('cleanup refuses arbitrary external and run-root paths', async (t) => {
  const fixture = await createFixture(t);
  const service = createService(fixture.runRoot);
  const snapshot = await service.create(fixture.workspace);

  await assert.rejects(
    () => service.cleanup({ ...snapshot, runPath: fixture.workspace }),
    (error) => error.code === 'UNSAFE_SANDBOX_CLEANUP',
  );
  await assert.rejects(
    () => service.cleanup({ ...snapshot, runPath: fixture.runRoot }),
    (error) => error.code === 'UNSAFE_SANDBOX_CLEANUP',
  );
  assert.equal(await fs.readFile(path.join(fixture.workspace, 'README.md'), 'utf8'), 'safe\n');
});
