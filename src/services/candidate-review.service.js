const fs = require('node:fs/promises');
const path = require('node:path');

const { diffEvaluator } = require('../evaluators/diff.evaluator');
const {
  candidateFingerprintService,
} = require('./candidate-fingerprint.service');
const { gitService } = require('./git.service');
const { historyService } = require('./history.service');
const {
  isPathInside,
  pathsEqual,
  pathsReferToSameLocation,
  sanitizeAgentId,
  validateTaskId,
  worktreeService,
} = require('./worktree.service');

const CANDIDATE_ELIGIBLE_STATUSES = new Set([
  'completed',
  'completed_with_warnings',
]);

class CandidateReviewError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = 'CandidateReviewError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function compareCandidateRuns(left, right) {
  return (right.competitionScore ?? 0) - (left.competitionScore ?? 0)
    || (right.evaluationScore ?? 0) - (left.evaluationScore ?? 0)
    || (right.routerScore ?? 0) - (left.routerScore ?? 0)
    || (left.durationMs ?? Number.POSITIVE_INFINITY)
      - (right.durationMs ?? Number.POSITIVE_INFINITY)
    || left.agentId.localeCompare(right.agentId);
}

function selectCandidateRun(task) {
  const eligibleRuns = task.runs
    .filter((run) => CANDIDATE_ELIGIBLE_STATUSES.has(run.status))
    .sort(compareCandidateRuns);

  if (task.mode === 'single') {
    return task.runs.length === 1 && eligibleRuns.length === 1
      ? eligibleRuns[0]
      : null;
  }

  if (task.mode !== 'competition' || eligibleRuns.length === 0) {
    return null;
  }

  const derivedWinner = eligibleRuns[0];

  if (!task.winnerAgentId) {
    return derivedWinner;
  }

  const storedWinner = eligibleRuns.find(
    (run) => run.agentId === task.winnerAgentId,
  );

  if (!storedWinner || storedWinner.id !== derivedWinner.id) {
    throw new CandidateReviewError(
      'Stored competition winner does not match deterministic ranking.',
      'CANDIDATE_HISTORY_INCONSISTENT',
    );
  }

  return storedWinner;
}

function expectedCandidateLocation(task, run, worktrees) {
  const taskId = validateTaskId(task.id);
  const agentId = sanitizeAgentId(run.agentId);
  const directoryName = `${taskId}-${agentId}`;

  return {
    branch: `agent/${directoryName}`,
    worktree: path.resolve(worktrees.getWorktreeRoot(task.workspace), directoryName),
  };
}

class CandidateReviewService {
  constructor({
    history = historyService,
    git = gitService,
    fingerprints = candidateFingerprintService,
    worktrees = worktreeService,
    diff = diffEvaluator,
  } = {}) {
    this.history = history;
    this.git = git;
    this.fingerprints = fingerprints;
    this.worktrees = worktrees;
    this.diff = diff;
  }

  async getStoredCandidate(taskId) {
    const task = await this.history.getTaskById(taskId);

    if (!task) {
      throw new CandidateReviewError('Task not found.', 'TASK_NOT_FOUND', 404);
    }

    const run = selectCandidateRun(task);

    if (!run) {
      throw new CandidateReviewError(
        'Task does not have an eligible candidate.',
        'NO_VALID_CANDIDATE',
      );
    }

    return { task, run };
  }

  compatibilityReason(task, run) {
    if (!task.targetBranch || !task.baseCommit || !run.candidateFingerprint) {
      return 'candidate_not_approval_compatible';
    }

    if (!run.branch || !run.worktree || !task.workspace) {
      return 'candidate_metadata_incomplete';
    }

    return null;
  }

  async inspect(taskId) {
    const { task, run } = await this.getStoredCandidate(taskId);
    const incompatibleReason = this.compatibilityReason(task, run);

    if (incompatibleReason) {
      return {
        task,
        run,
        evidence: null,
        approvable: false,
        reason: incompatibleReason,
      };
    }

    if (task.decision !== 'pending') {
      return {
        task,
        run,
        evidence: null,
        approvable: false,
        reason: `candidate_${task.decision}`,
      };
    }

    const repo = path.resolve(task.workspace);
    const worktree = path.resolve(run.worktree);
    const expected = expectedCandidateLocation(task, run, this.worktrees);
    const worktreeRoot = path.resolve(this.worktrees.getWorktreeRoot(repo));

    if (pathsEqual(worktree, repo)
      || !isPathInside(worktreeRoot, worktree)
      || !pathsEqual(worktree, expected.worktree)
      || run.branch !== expected.branch) {
      return {
        task,
        run,
        evidence: null,
        approvable: false,
        reason: 'candidate_location_invalid',
      };
    }

    try {
      const worktreeStat = await fs.stat(worktree);

      if (!worktreeStat.isDirectory()) {
        throw new Error('not a directory');
      }
    } catch {
      return {
        task,
        run,
        evidence: null,
        approvable: false,
        reason: 'candidate_worktree_missing',
      };
    }

    let registered = null;

    for (const entry of await this.git.getWorktrees(repo)) {
      if (await pathsReferToSameLocation(entry.path, worktree)) {
        registered = entry;
        break;
      }
    }

    if (!registered || registered.branch !== expected.branch) {
      return {
        task,
        run,
        evidence: null,
        approvable: false,
        reason: 'candidate_worktree_unregistered',
      };
    }

    const [worktreeHead, branchHead] = await Promise.all([
      this.git.getHeadCommit(worktree),
      this.git.getBranchCommit(repo, expected.branch),
    ]);

    if (worktreeHead !== task.baseCommit || branchHead !== task.baseCommit) {
      return {
        task,
        run,
        evidence: null,
        approvable: false,
        reason: 'candidate_changed',
      };
    }

    let evidence;

    try {
      evidence = await this.fingerprints.capture({
        workspace: worktree,
        baseCommit: task.baseCommit,
      });
    } catch (error) {
      return {
        task,
        run,
        evidence: null,
        approvable: false,
        reason: error.code || 'candidate_fingerprint_failed',
      };
    }

    const diffEvidence = this.diff.evaluate({
      workspace: worktree,
      changedFiles: evidence.changedFiles,
      trackedDiff: evidence.trackedDiff,
      untrackedFiles: evidence.untrackedFiles,
    });
    const sensitive = diffEvidence.sensitiveFiles.length > 0
      || diffEvidence.unsafePaths.length > 0;
    const fingerprintMatches = (
      evidence.fingerprint === run.candidateFingerprint
    );

    return {
      task,
      run,
      evidence,
      sensitive,
      approvable: fingerprintMatches && evidence.hasChanges && !sensitive,
      reason: !fingerprintMatches
        ? 'candidate_changed'
        : (!evidence.hasChanges
          ? 'candidate_has_no_changes'
          : (sensitive ? 'candidate_unsafe' : null)),
    };
  }

  toPublicReview(review) {
    const { task, run, evidence } = review;

    return {
      task: {
        id: task.id,
        task: task.task,
        mode: task.mode,
        status: task.status,
        targetBranch: task.targetBranch,
        baseCommit: task.baseCommit,
        decision: task.decision,
        decisionAt: task.decisionAt,
        candidateCommit: task.candidateCommit,
        mergeCommit: task.mergeCommit,
      },
      candidate: {
        agentId: run.agentId,
        status: run.status,
        evaluationScore: run.evaluationScore,
        verdict: run.verdict,
        competitionScore: run.competitionScore,
        branch: run.branch,
        worktree: run.worktree,
        changedFiles: evidence?.changedFiles || [],
        untrackedFiles: evidence?.untrackedFiles || [],
        trackedDiff: review.sensitive ? null : (evidence?.trackedDiff ?? null),
        diffRedacted: review.sensitive === true,
        fingerprint: run.candidateFingerprint,
      },
      approvable: review.approvable,
      reason: review.reason,
    };
  }

  async review(taskId) {
    return this.toPublicReview(await this.inspect(taskId));
  }
}

const candidateReviewService = new CandidateReviewService();

module.exports = {
  CANDIDATE_ELIGIBLE_STATUSES,
  CandidateReviewError,
  CandidateReviewService,
  candidateReviewService,
  compareCandidateRuns,
  expectedCandidateLocation,
  selectCandidateRun,
};
