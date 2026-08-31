const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const {
  WorktreeCleanupError,
} = require('../src/services/worktree-cleanup.service');
const {
  createCandidateFixture,
} = require('../test-support/candidate-test.helper');

test('cleanup refuses the original repository path', async (t) => {
  const fixture = await createCandidateFixture(t);
  const task = fixture.history.getTaskById(fixture.taskId);
  const run = { ...task.runs[0], worktree: fixture.repo };

  await assert.rejects(
    () => fixture.cleanup.validateTarget(task, run),
    (error) => error instanceof WorktreeCleanupError,
  );
});

test('cleanup refuses paths outside the configured worktree root', async (t) => {
  const fixture = await createCandidateFixture(t);
  const task = fixture.history.getTaskById(fixture.taskId);
  const run = {
    ...task.runs[0],
    worktree: path.join(fixture.temporaryRoot, 'outside-worktree'),
  };

  await assert.rejects(
    () => fixture.cleanup.validateTarget(task, run),
    (error) => error.code === 'UNSAFE_WORKTREE_CLEANUP',
  );
});

test('cleanup refuses an unregistered expected worktree path', async (t) => {
  const fixture = await createCandidateFixture(t);
  const task = fixture.history.getTaskById(fixture.taskId);
  const run = { ...task.runs[0] };
  await fixture.git.runGit(
    ['worktree', 'remove', '--force', fixture.worktree.worktreePath],
    fixture.repo,
  );

  await assert.rejects(
    () => fixture.cleanup.validateTarget(task, run),
    (error) => error.code === 'WORKTREE_NOT_REGISTERED',
  );
});

test('cleanup refuses an arbitrary branch name from database metadata', async (t) => {
  const fixture = await createCandidateFixture(t);
  const task = fixture.history.getTaskById(fixture.taskId);
  const run = { ...task.runs[0], branch: 'main' };

  await assert.rejects(
    () => fixture.cleanup.validateTarget(task, run),
    (error) => error.code === 'UNSAFE_WORKTREE_CLEANUP',
  );
});
