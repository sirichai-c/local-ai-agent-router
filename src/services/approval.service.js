const path = require('node:path');

const {
  CandidateReviewError,
  candidateReviewService,
} = require('./candidate-review.service');
const { GitCommandError, gitService } = require('./git.service');
const { historyService } = require('./history.service');
const { worktreeCleanupService } = require('./worktree-cleanup.service');
const { pathsReferToSameLocation } = require('./worktree.service');

class ApprovalError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sanitizeTaskSummary(task, maxLength = 72) {
  const normalized = String(task)
    .replace(/\s+/gu, ' ')
    .trim();
  const summary = normalized || 'apply reviewed agent candidate';

  return summary.slice(0, maxLength).trimEnd();
}

function validateExpectedFingerprint(fingerprint) {
  if (typeof fingerprint !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(fingerprint)) {
    throw new ApprovalError(
      'expectedFingerprint must be a SHA-256 candidate fingerprint.',
      'invalid_expected_fingerprint',
      400,
    );
  }

  return fingerprint;
}

function isGitIdentityError(error) {
  if (!(error instanceof GitCommandError)) {
    return false;
  }

  const output = `${error.result?.stdout || ''}\n${error.result?.stderr || ''}`
    .toLowerCase();

  return output.includes('author identity unknown')
    || output.includes('please tell me who you are')
    || output.includes('unable to auto-detect email address');
}

class ApprovalService {
  constructor({
    history = historyService,
    reviews = candidateReviewService,
    git = gitService,
    cleanup = worktreeCleanupService,
  } = {}) {
    this.history = history;
    this.reviews = reviews;
    this.git = git;
    this.cleanup = cleanup;
    this.taskLocks = new Map();
  }

  async withTaskLock(taskId, operation) {
    const previous = this.taskLocks.get(taskId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this.taskLocks.set(taskId, current);

    await previous;

    try {
      return await operation();
    } finally {
      release();

      if (this.taskLocks.get(taskId) === current) {
        this.taskLocks.delete(taskId);
      }
    }
  }

  async getTaskOrThrow(taskId) {
    const task = await this.history.getTaskById(taskId);

    if (!task) {
      throw new ApprovalError('Task not found.', 'task_not_found', 404);
    }

    return task;
  }

  async validateTarget(task) {
    const repo = path.resolve(task.workspace);
    const actualRoot = await this.git.getRepoRoot(repo);

    if (!await pathsReferToSameLocation(actualRoot, repo)) {
      throw new ApprovalError(
        'Stored target is not the repository root.',
        'invalid_target_repository',
      );
    }

    const operationState = await this.git.getOperationState(repo);

    if (operationState.merge || operationState.rebase) {
      throw new ApprovalError(
        'Target repository already has a merge or rebase in progress.',
        'git_operation_in_progress',
      );
    }

    if (!await this.git.isClean(repo)) {
      throw new ApprovalError(
        'Target repository has uncommitted changes.',
        'repository_not_clean',
      );
    }

    const currentBranch = await this.git.getCurrentBranch(repo);

    if (currentBranch !== task.targetBranch) {
      throw new ApprovalError(
        'Target repository is not on the branch used for evaluation.',
        'wrong_target_branch',
      );
    }

    const currentHead = await this.git.getHeadCommit(repo);

    if (currentHead !== task.baseCommit) {
      throw new ApprovalError(
        'Target branch changed after the candidate was evaluated.',
        'stale_base',
      );
    }

    return repo;
  }

  async approve(taskId, expectedFingerprint) {
    const expected = validateExpectedFingerprint(expectedFingerprint);

    return this.withTaskLock(taskId, async () => {
      const initialTask = await this.getTaskOrThrow(taskId);

      if (initialTask.decision === 'approved') {
        return {
          status: 'already_approved',
          taskId,
          candidateCommit: initialTask.candidateCommit,
          mergeCommit: initialTask.mergeCommit,
        };
      }

      if (initialTask.decision === 'rejected') {
        throw new ApprovalError(
          'Rejected tasks cannot be approved.',
          'task_already_rejected',
        );
      }

      let review;

      try {
        review = await this.reviews.inspect(taskId);
      } catch (error) {
        if (error instanceof CandidateReviewError) {
          throw new ApprovalError(error.message, error.code, error.statusCode);
        }

        throw error;
      }

      if (expected !== review.run.candidateFingerprint) {
        throw new ApprovalError(
          'Expected fingerprint does not match the evaluated candidate.',
          'fingerprint_mismatch',
        );
      }

      if (!review.approvable) {
        throw new ApprovalError(
          'Candidate is no longer approvable.',
          review.reason || 'candidate_not_approvable',
        );
      }

      const repo = await this.validateTarget(review.task);
      const worktree = path.resolve(review.run.worktree);

      await this.git.stageAll(worktree);

      if (!await this.git.hasStagedChanges(worktree)) {
        await this.git.unstageAll(worktree);
        throw new ApprovalError(
          'Candidate does not contain changes to commit.',
          'candidate_has_no_changes',
        );
      }

      const stagedState = await this.reviews.fingerprints.capture({
        workspace: worktree,
        baseCommit: review.task.baseCommit,
      });

      if (stagedState.snapshotFingerprint
        !== review.evidence.snapshotFingerprint
        || await this.git.hasUnstagedOrUntrackedChanges(worktree)) {
        await this.git.unstageAll(worktree);
        throw new ApprovalError(
          'Candidate changed while approval was being prepared.',
          'candidate_changed',
        );
      }

      const stagedDiff = await this.git.getStagedDiff(worktree);
      const message = `agent: ${sanitizeTaskSummary(review.task.task)}`;
      let candidateCommit;

      try {
        candidateCommit = await this.git.commit(worktree, message);
      } catch (error) {
        if (isGitIdentityError(error)) {
          await this.git.unstageAll(worktree);
          throw new ApprovalError(
            'Git user.name and user.email must be configured before approval.',
            'git_identity_required',
          );
        }

        throw error;
      }

      if (!await this.git.isAncestor(
        repo,
        review.task.baseCommit,
        candidateCommit,
      )) {
        throw new ApprovalError(
          'Candidate commit does not descend from the evaluated base.',
          'candidate_ancestry_invalid',
        );
      }

      const committedDiff = await this.git.getCommitDiff(
        repo,
        review.task.baseCommit,
        candidateCommit,
      );

      if (committedDiff !== stagedDiff) {
        throw new ApprovalError(
          'Candidate commit does not match the approved staged snapshot.',
          'candidate_changed',
        );
      }

      await this.history.setCandidateCommit(taskId, candidateCommit);

      // Candidate commit creation takes time; recheck target state before merge.
      await this.validateTarget(review.task);

      let mergeCommit;

      try {
        // Merge the immutable reviewed commit, not a mutable branch reference.
        mergeCommit = await this.git.mergeNoFastForward(repo, candidateCommit);
      } catch (error) {
        const abortResult = await this.git.abortMerge(repo);
        const state = await this.git.getOperationState(repo);

        throw new ApprovalError(
          state.merge || state.rebase || abortResult.timedOut
            ? 'Merge failed and Git could not confirm a clean abort.'
            : 'Merge failed and was aborted; candidate was preserved.',
          state.merge || state.rebase
            ? 'merge_abort_failed'
            : 'merge_failed',
        );
      }

      let recordedTask;

      try {
        recordedTask = await this.history.recordApproval({
          taskId,
          candidateCommit,
          mergeCommit,
          winnerAgentId: review.run.agentId,
        });
      } catch (error) {
        return {
          status: 'merged',
          taskId,
          agentId: review.run.agentId,
          candidateCommit,
          mergeCommit,
          cleanupWarnings: [],
          persistenceWarning: {
            code: 'approval_persistence_failed',
            message: 'Local merge succeeded, but approval metadata was not fully persisted.',
          },
        };
      }

      const cleanup = await this.cleanup.cleanupTask(taskId, {
        decision: 'approved',
        winnerAgentId: review.run.agentId,
      });

      return {
        status: 'merged',
        taskId,
        agentId: review.run.agentId,
        candidateCommit: recordedTask.candidateCommit,
        mergeCommit: recordedTask.mergeCommit,
        cleanupWarnings: cleanup.cleanupWarnings,
      };
    });
  }

  async reject(taskId) {
    return this.withTaskLock(taskId, async () => {
      const task = await this.getTaskOrThrow(taskId);

      if (task.decision === 'rejected') {
        return { status: 'already_rejected', taskId, cleanupWarnings: [] };
      }

      if (task.decision === 'approved') {
        throw new ApprovalError(
          'Approved tasks cannot be rejected.',
          'task_already_approved',
        );
      }

      await this.history.recordRejection(taskId);
      const cleanup = await this.cleanup.cleanupTask(taskId, {
        decision: 'rejected',
      });

      return {
        status: 'rejected',
        taskId,
        cleanupWarnings: cleanup.cleanupWarnings,
      };
    });
  }
}

const approvalService = new ApprovalService();

module.exports = {
  ApprovalError,
  ApprovalService,
  approvalService,
  isGitIdentityError,
  sanitizeTaskSummary,
  validateExpectedFingerprint,
};
