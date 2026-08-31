const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');

const {
  ApprovalError,
  ApprovalService,
  sanitizeTaskSummary,
} = require('../src/services/approval.service');
const {
  CandidateReviewService,
} = require('../src/services/candidate-review.service');
const { GitCommandError } = require('../src/services/git.service');
const {
  WorktreeCleanupService,
} = require('../src/services/worktree-cleanup.service');
const {
  createCandidateFixture,
} = require('../test-support/candidate-test.helper');

test('human approval commits candidate, creates local merge, and cleans candidates', async (t) => {
  const fixture = await createCandidateFixture(t);
  const result = await fixture.approval.approve(
    fixture.taskId,
    fixture.fingerprint.fingerprint,
  );
  const stored = fixture.history.getTaskById(fixture.taskId);
  const mergeParents = (await fixture.git.runGit(
    ['show', '-s', '--format=%P', result.mergeCommit],
    fixture.repo,
  )).stdout.trim().split(' ');

  assert.equal(result.status, 'merged');
  assert.equal(stored.decision, 'approved');
  assert.equal(stored.status, 'merged');
  assert.equal(stored.candidateCommit, result.candidateCommit);
  assert.equal(stored.mergeCommit, result.mergeCommit);
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), result.mergeCommit);
  assert.equal(mergeParents.length, 2);
  assert.equal(mergeParents[0], fixture.baseCommit);
  assert.equal(mergeParents[1], result.candidateCommit);
  assert.match(
    await fs.readFile(path.join(fixture.repo, 'README.md'), 'utf8'),
    /Reviewed candidate change/u,
  );
  assert.equal(await fixture.git.branchExists(
    fixture.repo,
    fixture.worktree.branch,
  ), false);
  await assert.rejects(() => fs.stat(fixture.worktree.worktreePath), /ENOENT/u);
  assert.equal((await fixture.git.runGit(
    ['remote'],
    fixture.repo,
  )).stdout.trim(), '');
});

test('approving an already approved task is idempotent', async (t) => {
  const fixture = await createCandidateFixture(t);
  const first = await fixture.approval.approve(
    fixture.taskId,
    fixture.fingerprint.fingerprint,
  );
  const headAfterFirst = await fixture.git.getHeadCommit(fixture.repo);
  const second = await fixture.approval.approve(
    fixture.taskId,
    fixture.fingerprint.fingerprint,
  );

  assert.equal(second.status, 'already_approved');
  assert.equal(second.mergeCommit, first.mergeCommit);
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), headAfterFirst);
});

test('TOCTOU candidate modification is rejected without commit or merge', async (t) => {
  const fixture = await createCandidateFixture(t);
  const reviewed = await fixture.reviews.review(fixture.taskId);
  await fs.appendFile(
    path.join(fixture.worktree.worktreePath, 'README.md'),
    'changed after human review\n',
  );

  await assert.rejects(
    () => fixture.approval.approve(
      fixture.taskId,
      reviewed.candidate.fingerprint,
    ),
    (error) => error instanceof ApprovalError
      && error.code === 'candidate_changed',
  );
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), fixture.baseCommit);
  assert.equal(
    await fixture.git.getHeadCommit(fixture.worktree.worktreePath),
    fixture.baseCommit,
  );
});

test('approval requires the exact stored fingerprint', async (t) => {
  const fixture = await createCandidateFixture(t);

  await assert.rejects(
    () => fixture.approval.approve(
      fixture.taskId,
      `sha256:${'f'.repeat(64)}`,
    ),
    (error) => error.code === 'fingerprint_mismatch',
  );
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), fixture.baseCommit);
  assert.equal(
    await fixture.git.getHeadCommit(fixture.worktree.worktreePath),
    fixture.baseCommit,
  );
});

test('stale target HEAD is rejected without automatic rebase', async (t) => {
  const fixture = await createCandidateFixture(t);
  await fs.writeFile(path.join(fixture.repo, 'target.txt'), 'new target work\n');
  await fixture.git.runGit(['add', 'target.txt'], fixture.repo);
  await fixture.git.runGit(['commit', '-m', 'target moved'], fixture.repo);
  const movedHead = await fixture.git.getHeadCommit(fixture.repo);

  await assert.rejects(
    () => fixture.approval.approve(
      fixture.taskId,
      fixture.fingerprint.fingerprint,
    ),
    (error) => error.code === 'stale_base',
  );
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), movedHead);
  assert.equal(fixture.history.getTaskById(fixture.taskId).decision, 'pending');
});

test('dirty target is rejected without altering user changes', async (t) => {
  const fixture = await createCandidateFixture(t);
  const userFile = path.join(fixture.repo, 'user-work.txt');
  await fs.writeFile(userFile, 'keep this change\n');

  await assert.rejects(
    () => fixture.approval.approve(
      fixture.taskId,
      fixture.fingerprint.fingerprint,
    ),
    (error) => error.code === 'repository_not_clean',
  );
  assert.equal(await fs.readFile(userFile, 'utf8'), 'keep this change\n');
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), fixture.baseCommit);
});

test('wrong target branch is rejected without automatic checkout', async (t) => {
  const fixture = await createCandidateFixture(t);
  await fixture.git.runGit(['switch', '-c', 'other'], fixture.repo);

  await assert.rejects(
    () => fixture.approval.approve(
      fixture.taskId,
      fixture.fingerprint.fingerprint,
    ),
    (error) => error.code === 'wrong_target_branch',
  );
  assert.equal(await fixture.git.getCurrentBranch(fixture.repo), 'other');
});

test('reject marks history, cleans candidate, and never changes target HEAD', async (t) => {
  const fixture = await createCandidateFixture(t);
  const result = await fixture.approval.reject(fixture.taskId);
  const stored = fixture.history.getTaskById(fixture.taskId);

  assert.equal(result.status, 'rejected');
  assert.equal(stored.decision, 'rejected');
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), fixture.baseCommit);
  assert.equal(await fixture.git.branchExists(
    fixture.repo,
    fixture.worktree.branch,
  ), false);
  await assert.rejects(() => fs.stat(fixture.worktree.worktreePath), /ENOENT/u);

  const repeated = await fixture.approval.reject(fixture.taskId);
  assert.equal(repeated.status, 'already_rejected');
});

test('approved-to-rejected and rejected-to-approved transitions are forbidden', async (t) => {
  const approved = await createCandidateFixture(t, { taskId: 'approvedtask' });
  await approved.approval.approve(
    approved.taskId,
    approved.fingerprint.fingerprint,
  );
  await assert.rejects(
    () => approved.approval.reject(approved.taskId),
    (error) => error.code === 'task_already_approved',
  );

  const rejected = await createCandidateFixture(t, { taskId: 'rejectedtask' });
  await rejected.approval.reject(rejected.taskId);
  await assert.rejects(
    () => rejected.approval.approve(
      rejected.taskId,
      rejected.fingerprint.fingerprint,
    ),
    (error) => error.code === 'task_already_rejected',
  );
});

test('merge failure attempts abort and preserves candidate without approval', async (t) => {
  const fixture = await createCandidateFixture(t);
  let abortCalls = 0;
  const failingGit = Object.create(fixture.git);
  failingGit.mergeNoFastForward = async () => {
    throw new GitCommandError('simulated merge failure', {
      stdout: '',
      stderr: 'conflict',
      exitCode: 1,
    });
  };
  failingGit.abortMerge = async () => {
    abortCalls += 1;
    return { exitCode: 0, timedOut: false };
  };
  const reviews = new CandidateReviewService({
    history: fixture.history,
    git: failingGit,
    fingerprints: fixture.fingerprints,
    worktrees: fixture.worktrees,
  });
  const cleanup = new WorktreeCleanupService({
    history: fixture.history,
    git: failingGit,
    worktrees: fixture.worktrees,
  });
  const approval = new ApprovalService({
    history: fixture.history,
    reviews,
    git: failingGit,
    cleanup,
  });

  await assert.rejects(
    () => approval.approve(fixture.taskId, fixture.fingerprint.fingerprint),
    (error) => error.code === 'merge_failed',
  );
  assert.equal(abortCalls, 1);
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), fixture.baseCommit);
  assert.equal(fixture.history.getTaskById(fixture.taskId).decision, 'pending');
  assert.equal(await fs.stat(fixture.worktree.worktreePath).then(
    (stat) => stat.isDirectory(),
  ), true);
});

test('partial cleanup failure does not roll back a successful merge', async (t) => {
  const fixture = await createCandidateFixture(t);
  const approval = new ApprovalService({
    history: fixture.history,
    reviews: fixture.reviews,
    git: fixture.git,
    cleanup: {
      cleanupTask: async () => ({
        cleaned: [],
        cleanupWarnings: [{
          agentId: fixture.agentId,
          code: 'CLEANUP_FAILED',
          message: 'simulated cleanup failure',
        }],
      }),
    },
  });
  const result = await approval.approve(
    fixture.taskId,
    fixture.fingerprint.fingerprint,
  );

  assert.equal(result.status, 'merged');
  assert.equal(result.cleanupWarnings.length, 1);
  assert.equal(fixture.history.getTaskById(fixture.taskId).decision, 'approved');
  assert.equal(await fixture.git.getHeadCommit(fixture.repo), result.mergeCommit);
});

test('commit summaries are single-line, trimmed, and bounded', () => {
  const summary = sanitizeTaskSummary(`  add validation\n${'x'.repeat(100)}  `);

  assert.equal(summary.includes('\n'), false);
  assert.equal(summary.length <= 72, true);
});
