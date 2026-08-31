const path = require('node:path');

const { gitService } = require('./git.service');
const {
  expectedCandidateLocation,
} = require('./candidate-review.service');
const { historyService } = require('./history.service');
const {
  isPathInside,
  pathsEqual,
  pathsReferToSameLocation,
  worktreeService,
} = require('./worktree.service');

class WorktreeCleanupError extends Error {
  constructor(message, code = 'UNSAFE_WORKTREE_CLEANUP') {
    super(message);
    this.name = 'WorktreeCleanupError';
    this.code = code;
  }
}

class WorktreeCleanupService {
  constructor({
    git = gitService,
    history = historyService,
    worktrees = worktreeService,
  } = {}) {
    this.git = git;
    this.history = history;
    this.worktrees = worktrees;
  }

  async validateTarget(task, run) {
    if (!task.workspace || !run.worktree || !run.branch) {
      throw new WorktreeCleanupError(
        'Candidate cleanup metadata is incomplete.',
        'CLEANUP_METADATA_INCOMPLETE',
      );
    }

    const repo = path.resolve(task.workspace);
    const resolvedRepo = await this.git.getRepoRoot(repo);
    const worktree = path.resolve(run.worktree);
    const root = path.resolve(this.worktrees.getWorktreeRoot(resolvedRepo));
    const expected = expectedCandidateLocation(task, run, this.worktrees);

    if (!await pathsReferToSameLocation(resolvedRepo, repo)) {
      throw new WorktreeCleanupError(
        'Stored repository path is not the repository root.',
      );
    }

    if (pathsEqual(worktree, repo)
      || pathsEqual(worktree, root)
      || !isPathInside(root, worktree)
      || !pathsEqual(worktree, expected.worktree)
      || run.branch !== expected.branch) {
      throw new WorktreeCleanupError(
        'Candidate worktree or branch does not match the task cleanup policy.',
      );
    }

    let registered = null;

    for (const entry of await this.git.getWorktrees(repo)) {
      if (await pathsReferToSameLocation(entry.path, worktree)) {
        registered = entry;
        break;
      }
    }

    if (!registered || registered.branch !== expected.branch) {
      throw new WorktreeCleanupError(
        'Candidate path is not a registered worktree for the expected branch.',
        'WORKTREE_NOT_REGISTERED',
      );
    }

    return {
      repo,
      worktree,
      branch: expected.branch,
    };
  }

  async cleanupRun(task, run, { forceBranch }) {
    const target = await this.validateTarget(task, run);

    await this.git.removeWorktree(target.repo, target.worktree, { force: true });
    await this.git.deleteBranch(target.repo, target.branch, {
      force: forceBranch,
    });

    return { agentId: run.agentId, removed: true };
  }

  async cleanupTask(taskId, {
    decision,
    winnerAgentId = null,
  }) {
    const task = await this.history.getTaskById(taskId);

    if (!task) {
      throw new WorktreeCleanupError('Task not found.', 'TASK_NOT_FOUND');
    }

    const warnings = [];
    const cleaned = [];
    const seen = new Set();

    for (const run of task.runs) {
      if (!run.worktree || !run.branch) {
        continue;
      }

      const key = `${path.resolve(run.worktree)}\0${run.branch}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      try {
        cleaned.push(await this.cleanupRun(task, run, {
          forceBranch: decision === 'rejected' || run.agentId !== winnerAgentId,
        }));
      } catch (error) {
        warnings.push({
          agentId: run.agentId,
          code: error.code || 'CLEANUP_FAILED',
          message: error.message,
        });
      }
    }

    try {
      if (!task.workspace) {
        throw new WorktreeCleanupError(
          'Task does not contain a repository path for worktree pruning.',
          'CLEANUP_METADATA_INCOMPLETE',
        );
      }

      await this.git.pruneWorktrees(path.resolve(task.workspace));
    } catch (error) {
      warnings.push({
        agentId: null,
        code: 'WORKTREE_PRUNE_FAILED',
        message: error.message,
      });
    }

    return { cleaned, cleanupWarnings: warnings };
  }
}

const worktreeCleanupService = new WorktreeCleanupService();

module.exports = {
  WorktreeCleanupError,
  WorktreeCleanupService,
  worktreeCleanupService,
};
