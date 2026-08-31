const { config } = require('../config/env');
const { performanceService } = require('./performance.service');

function clampScore(score) {
  return Math.max(0, Math.min(100, score));
}

function roundScore(score) {
  return Math.round(score * 100) / 100;
}

class AdaptiveScorerService {
  constructor({
    performance = performanceService,
    enabled = config.adaptiveRouting.enabled,
    weights = config.adaptiveRouting.weights,
    minSamples = config.adaptiveRouting.minSamples,
    recentSampleSize = config.adaptiveRouting.recentSampleSize,
  } = {}) {
    this.performance = performance;
    this.enabled = enabled;
    this.weights = weights;
    this.minSamples = minSamples;
    this.recentSampleSize = recentSampleSize;
  }

  staticResult(staticScore, sampleSize = 0) {
    const normalizedStaticScore = roundScore(clampScore(staticScore));

    return {
      score: normalizedStaticScore,
      staticScore: normalizedStaticScore,
      historicalScore: null,
      recentScore: null,
      sampleSize,
      adaptive: false,
    };
  }

  async scoreAgentWithHistory({ agent, staticScore, classification }) {
    if (!this.enabled) {
      return this.staticResult(staticScore);
    }

    const activeCategories = Object.entries(classification)
      .filter(([, importance]) => Number.isFinite(importance) && importance > 0)
      .sort(([left], [right]) => left.localeCompare(right));
    const categoryStats = await Promise.all(
      activeCategories.map(async ([category, importance]) => ({
        category,
        importance,
        stats: await this.performance.getAgentCategoryStats(
          agent.id,
          category,
        ),
      })),
    );
    const recentStats = await this.performance.getAgentRecentStats(
      agent.id,
      this.recentSampleSize,
    );
    const observedSampleSize = Math.max(
      recentStats.sampleSize || 0,
      ...categoryStats.map((entry) => entry.stats.sampleSize || 0),
    );
    const eligibleCategories = categoryStats.filter((entry) => (
      entry.stats.sampleSize >= this.minSamples
      && Number.isFinite(entry.stats.weightedEvaluationScore)
    ));
    const totalHistoricalImportance = eligibleCategories.reduce(
      (total, entry) => total + entry.importance,
      0,
    );
    const historicalScore = totalHistoricalImportance > 0
      ? eligibleCategories.reduce((total, entry) => (
        total + entry.importance * entry.stats.weightedEvaluationScore
      ), 0) / totalHistoricalImportance
      : null;
    const recentScore = recentStats.sampleSize >= this.minSamples
      && Number.isFinite(recentStats.averageEvaluationScore)
      ? recentStats.averageEvaluationScore
      : null;

    if (historicalScore === null && recentScore === null) {
      return this.staticResult(staticScore, observedSampleSize);
    }

    let weightedScore = clampScore(staticScore) * this.weights.static;
    let availableWeight = this.weights.static;

    if (historicalScore !== null) {
      weightedScore += clampScore(historicalScore) * this.weights.history;
      availableWeight += this.weights.history;
    }

    if (recentScore !== null) {
      weightedScore += clampScore(recentScore) * this.weights.recent;
      availableWeight += this.weights.recent;
    }

    if (availableWeight <= 0) {
      return this.staticResult(staticScore, observedSampleSize);
    }

    return {
      score: roundScore(clampScore(weightedScore / availableWeight)),
      staticScore: roundScore(clampScore(staticScore)),
      historicalScore: historicalScore === null
        ? null
        : roundScore(clampScore(historicalScore)),
      recentScore: recentScore === null
        ? null
        : roundScore(clampScore(recentScore)),
      sampleSize: observedSampleSize,
      adaptive: true,
    };
  }
}

const adaptiveScorerService = new AdaptiveScorerService();

module.exports = {
  AdaptiveScorerService,
  adaptiveScorerService,
  clampScore,
  roundScore,
};
