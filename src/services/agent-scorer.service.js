const DEFAULT_MAX_REASONS = 3;

function roundScore(value) {
  return Math.round(value * 100) / 100;
}

class AgentScorerService {
  scoreAgent(agent, taskScores, { maxReasons = DEFAULT_MAX_REASONS } = {}) {
    if (!agent || typeof agent !== 'object') {
      throw new TypeError('agent is required');
    }

    if (!taskScores || typeof taskScores !== 'object') {
      throw new TypeError('taskScores is required');
    }

    const capabilityScores = agent.capabilityScores || {};
    const contributions = [];
    let weightedScore = 0;
    let totalTaskWeight = 0;

    for (const [category, taskImportance] of Object.entries(taskScores)) {
      if (!Number.isFinite(taskImportance) || taskImportance <= 0) {
        continue;
      }

      const rawCapability = capabilityScores[category];
      const agentCapability = Number.isFinite(rawCapability) ? rawCapability : 0;
      const contribution = taskImportance * (agentCapability / 100);

      weightedScore += contribution;
      totalTaskWeight += taskImportance;
      contributions.push({
        category,
        taskImportance,
        agentCapability,
        contribution,
      });
    }

    contributions.sort((left, right) => (
      right.contribution - left.contribution
      || right.taskImportance - left.taskImportance
      || left.category.localeCompare(right.category)
    ));

    const score = totalTaskWeight === 0
      ? 0
      : (weightedScore / totalTaskWeight) * 100;

    return {
      score: roundScore(score),
      reasons: contributions.slice(0, maxReasons).map((reason) => ({
        category: reason.category,
        taskImportance: reason.taskImportance,
        agentCapability: reason.agentCapability,
      })),
    };
  }
}

const agentScorerService = new AgentScorerService();

module.exports = {
  AgentScorerService,
  agentScorerService,
  roundScore,
};
