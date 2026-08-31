const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');

const {
  CandidateFingerprintService,
  hashRegularFile,
} = require('../src/services/candidate-fingerprint.service');
const {
  createCandidateFixture,
} = require('../test-support/candidate-test.helper');

test('same candidate state produces the same fingerprint', async (t) => {
  const fixture = await createCandidateFixture(t);
  const second = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });

  assert.equal(second.fingerprint, fixture.fingerprint.fingerprint);
  assert.equal(
    second.snapshotFingerprint,
    fixture.fingerprint.snapshotFingerprint,
  );
});

test('tracked file changes alter the fingerprint', async (t) => {
  const fixture = await createCandidateFixture(t);
  await fs.appendFile(
    path.join(fixture.worktree.worktreePath, 'README.md'),
    'another change\n',
  );
  const changed = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });

  assert.notEqual(changed.fingerprint, fixture.fingerprint.fingerprint);
});

test('untracked file contents alter the fingerprint', async (t) => {
  const fixture = await createCandidateFixture(t);
  const candidatePath = path.join(fixture.worktree.worktreePath, 'new.js');
  await fs.writeFile(candidatePath, 'module.exports = 1;\n');
  const first = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });
  await fs.writeFile(candidatePath, 'module.exports = 2;\n');
  const second = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });

  assert.notEqual(second.fingerprint, first.fingerprint);
});

test('untracked filename changes alter the fingerprint', async (t) => {
  const fixture = await createCandidateFixture(t);
  const firstPath = path.join(fixture.worktree.worktreePath, 'first.txt');
  const secondPath = path.join(fixture.worktree.worktreePath, 'second.txt');
  await fs.writeFile(firstPath, 'same contents\n');
  const first = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });
  await fs.rename(firstPath, secondPath);
  const second = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });

  assert.notEqual(second.fingerprint, first.fingerprint);
});

test('base commit changes alter the fingerprint', async (t) => {
  const fixture = await createCandidateFixture(t);
  const changed = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: 'b'.repeat(40),
  });

  assert.notEqual(changed.fingerprint, fixture.fingerprint.fingerprint);
});

test('worktree HEAD changes alter the fingerprint', async (t) => {
  const fixture = await createCandidateFixture(t);
  await fixture.git.runGit(['add', '-A'], fixture.worktree.worktreePath);
  await fixture.git.runGit(
    ['commit', '-m', 'unexpected candidate commit'],
    fixture.worktree.worktreePath,
  );
  const changed = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });

  assert.notEqual(changed.fingerprint, fixture.fingerprint.fingerprint);
});

test('path traversal from Git output is rejected', async (t) => {
  const fixture = await createCandidateFixture(t);
  const service = new CandidateFingerprintService({
    git: {
      getHeadCommit: async () => fixture.baseCommit,
      getStatus: async () => '?? ../../outside.txt',
      getChangedFiles: async () => [{
        status: '??',
        file: '../../outside.txt',
      }],
      getDiffResult: async () => ({ stdout: '', outputTruncated: false }),
      getUntrackedFiles: async () => ['../../outside.txt'],
    },
  });

  await assert.rejects(
    () => service.capture({
      workspace: fixture.worktree.worktreePath,
      baseCommit: fixture.baseCommit,
    }),
    (error) => error.code === 'UNSAFE_WORKSPACE_PATH',
  );
});

test('symlink and real-path escapes are rejected', async (t) => {
  const fixture = await createCandidateFixture(t);
  const outside = path.join(fixture.temporaryRoot, 'outside.txt');
  const link = path.join(fixture.worktree.worktreePath, 'escape.txt');
  await fs.writeFile(outside, 'outside\n');

  try {
    await fs.symlink(outside, link, 'file');
  } catch (error) {
    if (error.code !== 'EPERM') {
      throw error;
    }

    const outsideDirectory = path.join(fixture.temporaryRoot, 'outside-dir');
    const junction = path.join(fixture.worktree.worktreePath, 'escape-dir');
    await fs.mkdir(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, 'outside.txt'), 'outside\n');
    await fs.symlink(outsideDirectory, junction, 'junction');

    await assert.rejects(
      () => hashRegularFile(
        fixture.worktree.worktreePath,
        'escape-dir/outside.txt',
      ),
      (failure) => failure.code === 'UNSAFE_CANDIDATE_PATH',
    );
    return;
  }

  await assert.rejects(
    () => hashRegularFile(fixture.worktree.worktreePath, 'escape.txt'),
    (error) => error.code === 'UNSAFE_CANDIDATE_PATH',
  );
});

test('changed and untracked ordering does not affect fingerprints', async (t) => {
  const fixture = await createCandidateFixture(t);
  await fs.writeFile(
    path.join(fixture.worktree.worktreePath, 'a.txt'),
    'a\n',
  );
  await fs.writeFile(
    path.join(fixture.worktree.worktreePath, 'z.txt'),
    'z\n',
  );
  const normal = await fixture.fingerprints.capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });
  const reversedGit = {
    getHeadCommit: (...args) => fixture.git.getHeadCommit(...args),
    getStatus: (...args) => fixture.git.getStatus(...args),
    getDiffResult: (...args) => fixture.git.getDiffResult(...args),
    getChangedFiles: async (...args) => (
      await fixture.git.getChangedFiles(...args)
    ).reverse(),
    getUntrackedFiles: async (...args) => (
      await fixture.git.getUntrackedFiles(...args)
    ).reverse(),
  };
  const reversed = await new CandidateFingerprintService({
    git: reversedGit,
  }).capture({
    workspace: fixture.worktree.worktreePath,
    baseCommit: fixture.baseCommit,
  });

  assert.equal(reversed.fingerprint, normal.fingerprint);
  assert.equal(reversed.snapshotFingerprint, normal.snapshotFingerprint);
});
