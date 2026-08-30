const { config } = require('../config/env');

const ELIGIBLE_STATUSES = new Set([
  'completed',
  'completed_with_warnings',
]);

const SCORE_CAPS = Object.freeze({
  failed: 40,
  evaluation_failed: 60,
});

function clampScore(score) {
  return Math.max(0, Math.min(100, score));
}

function roundScore(score) {
  return Math.round(score * 100) / 100;
}

function getPositiveDuration(candidate) {
  const duration = Number(
    candidate.durationMs ?? candidate.execution?.durationMs,
  );

  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function compareRankedCandidates(left, right) {
  const scoreComparison = right.competitionScore - left.competitionScore
    || right.evaluationScore - left.evaluationScore
    || right.routerScore - left.routerScore
    || (left.durationMs ?? Number.POSITIVE_INFINITY)
      - (right.durationMs ?? Number.POSITIVE_INFINITY);

  if (scoreComparison !== 0) {
    return scoreComparison;
  }

  if (left.agentId === right.agentId) {
    return 0;
  }

  return left.agentId < right.agentId ? -1 : 1;
}

class CompetitionEvaluator {
  constructor({ weights = config.competition.weights } = {}) {
    this.weights = weights;
  }

  evaluate(candidates = []) {
    const positiveDurations = candidates
      .map(getPositiveDuration)
      .filter((duration) => duration !== null);
    const fastestDurationMs = positiveDurations.length > 0
      ? Math.min(...positiveDurations)
      : null;

    const ranking = candidates.map((candidate, candidateIndex) => {
      const agentId = candidate.agent?.id || candidate.agentId || '';
      const durationMs = getPositiveDuration(candidate);
      const evaluationScore = clampScore(
        Number(candidate.evaluation?.score ?? candidate.evaluationScore) || 0,
      );
      const routerScore = clampScore(Number(candidate.routerScore) || 0);
      const speedScore = durationMs && fastestDurationMs
        ? clampScore((fastestDurationMs / durationMs) * 100)
        : 0;
      const rawScore = (
        evaluationScore * this.weights.quality
        + routerScore * this.weights.router
        + speedScore * this.weights.speed
      );
      const scoreCap = SCORE_CAPS[candidate.status] ?? 100;
      const competitionScore = roundScore(
        Math.min(clampScore(rawScore), scoreCap),
      );

      return {
        rank: 0,
        candidateIndex,
        agentId,
        status: candidate.status,
        eligible: ELIGIBLE_STATUSES.has(candidate.status),
        competitionScore,
        evaluationScore: roundScore(evaluationScore),
        routerScore: roundScore(routerScore),
        speedScore: roundScore(speedScore),
        durationMs,
        branch: candidate.branch ?? candidate.workspace?.branch ?? null,
        worktree: candidate.worktree ?? candidate.workspace?.worktree ?? null,
        baseCommit: candidate.baseCommit
          ?? candidate.workspace?.baseCommit
          ?? null,
      };
    });

    ranking.sort(compareRankedCandidates);
    ranking.forEach((candidate, index) => {
      candidate.rank = index + 1;
    });

    const winner = ranking.find((candidate) => candidate.eligible) || null;

    return {
      status: winner ? 'completed' : 'no_valid_candidate',
      fastestDurationMs,
      weights: { ...this.weights },
      winner: winner
        ? {
          agentId: winner.agentId,
          competitionScore: winner.competitionScore,
          evaluationScore: winner.evaluationScore,
          routerScore: winner.routerScore,
          speedScore: winner.speedScore,
          status: winner.status,
          branch: winner.branch,
          worktree: winner.worktree,
          baseCommit: winner.baseCommit,
        }
        : null,
      ranking,
    };
  }
}

const competitionEvaluator = new CompetitionEvaluator();

module.exports = {
  CompetitionEvaluator,
  ELIGIBLE_STATUSES,
  SCORE_CAPS,
  compareRankedCandidates,
  competitionEvaluator,
};
