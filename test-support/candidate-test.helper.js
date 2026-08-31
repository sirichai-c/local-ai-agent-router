const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  ApprovalService,
} = require('../src/services/approval.service');
const {
  CandidateFingerprintService,
} = require('../src/services/candidate-fingerprint.service');
const {
  CandidateReviewService,
} = require('../src/services/candidate-review.service');
const { DatabaseService } = require('../src/services/database.service');
const { GitService } = require('../src/services/git.service');
const { HistoryService } = require('../src/services/history.service');
const {
  WorktreeCleanupService,
} = require('../src/services/worktree-cleanup.service');
const { WorktreeService } = require('../src/services/worktree.service');

async function createCandidateFixture(testContext, {
  taskId = 'phase10task',
  agentId = 'qwen-code',
  mode = 'single',
  task = 'Add reviewed documentation',
} = {}) {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-router-phase10-'),
  );
  const repo = path.join(temporaryRoot, 'repository');
  const worktreeRoot = path.join(temporaryRoot, 'worktrees');
  const database = new DatabaseService({
    databasePath: path.join(temporaryRoot, 'history.db'),
  });
  const history = new HistoryService({ database });
  const git = new GitService();
  const worktrees = new WorktreeService({ git, worktreeRoot });
  const fingerprints = new CandidateFingerprintService({ git });

  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, 'README.md'), '# Test Repository\n');
  await git.runGit(['init', '--initial-branch=main'], repo);
  await git.runGit(['config', 'user.email', 'phase10@example.invalid'], repo);
  await git.runGit(['config', 'user.name', 'Phase 10 Test'], repo);
  await git.runGit(['add', 'README.md'], repo);
  await git.runGit(['commit', '-m', 'initial test repository'], repo);

  const baseCommit = await git.getHeadCommit(repo);
  const worktree = await worktrees.create({
    repo,
    agentId,
    taskId,
    baseCommit,
  });
  await fs.appendFile(
    path.join(worktree.worktreePath, 'README.md'),
    '\nReviewed candidate change.\n',
  );
  const fingerprint = await fingerprints.capture({
    workspace: worktree.worktreePath,
    baseCommit,
  });

  history.createTask({
    id: taskId,
    task,
    workspace: repo,
    mode,
    classification: { coding: 80 },
    targetBranch: 'main',
    baseCommit,
  });
  history.recordAgentRun({
    taskId,
    agentId,
    status: 'completed',
    routerScore: 90,
    evaluationScore: 100,
    verdict: 'pass',
    competitionScore: mode === 'competition' ? 95 : null,
    durationMs: 100,
    changedFiles: 1,
    branch: worktree.branch,
    worktree: worktree.worktreePath,
    candidateFingerprint: fingerprint.fingerprint,
  });
  history.completeTask(taskId, 'completed', { winnerAgentId: agentId });

  const reviews = new CandidateReviewService({
    history,
    git,
    fingerprints,
    worktrees,
  });
  const cleanup = new WorktreeCleanupService({ git, history, worktrees });
  const approval = new ApprovalService({ history, reviews, git, cleanup });

  testContext.after(async () => {
    await git.runGit(
      ['worktree', 'remove', '--force', worktree.worktreePath],
      repo,
      { allowFailure: true },
    );
    await git.runGit(
      ['branch', '-D', worktree.branch],
      repo,
      { allowFailure: true },
    );
    database.close();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  return {
    agentId,
    approval,
    baseCommit,
    cleanup,
    database,
    fingerprint,
    fingerprints,
    git,
    history,
    repo,
    reviews,
    taskId,
    temporaryRoot,
    worktree,
    worktreeRoot,
    worktrees,
  };
}

module.exports = { createCandidateFixture };
