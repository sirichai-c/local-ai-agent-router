const { config } = require('../config/env');
const { databaseService } = require('./database.service');

function roundMetric(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function normalizeStats(row) {
  return {
    sampleSize: Number(row.sampleSize || 0),
    averageEvaluationScore: roundMetric(row.averageEvaluationScore),
    successRate: roundMetric(row.successRate, 4),
    passRate: roundMetric(row.passRate, 4),
    warningRate: roundMetric(row.warningRate, 4),
    failureRate: roundMetric(row.failureRate, 4),
    averageDurationMs: roundMetric(row.averageDurationMs),
  };
}

class PerformanceService {
  constructor({
    database = databaseService,
    recentSampleSize = config.adaptiveRouting.recentSampleSize,
  } = {}) {
    this.database = database;
    this.recentSampleSize = recentSampleSize;
  }

  getAgentGlobalStats(agentId) {
    const row = this.database.getConnection().prepare(`
      SELECT
        COUNT(*) AS sampleSize,
        AVG(COALESCE(evaluation_score, 0)) AS averageEvaluationScore,
        AVG(CASE
          WHEN status IN ('completed', 'completed_with_warnings') THEN 1.0
          ELSE 0.0
        END) AS successRate,
        AVG(CASE WHEN verdict = 'pass' THEN 1.0 ELSE 0.0 END) AS passRate,
        AVG(CASE WHEN verdict = 'warning' THEN 1.0 ELSE 0.0 END) AS warningRate,
        AVG(CASE
          WHEN status IN ('completed', 'completed_with_warnings') THEN 0.0
          ELSE 1.0
        END) AS failureRate,
        AVG(duration_ms) AS averageDurationMs
      FROM agent_runs
      WHERE agent_id = ?
    `).get(agentId);

    return normalizeStats(row);
  }

  getAgentCategoryStats(agentId, category) {
    const row = this.database.getConnection().prepare(`
      SELECT
        COUNT(DISTINCT agent_runs.id) AS sampleSize,
        SUM(COALESCE(agent_runs.evaluation_score, 0) * task_categories.score)
          / NULLIF(SUM(task_categories.score), 0) AS weightedEvaluationScore,
        AVG(CASE
          WHEN agent_runs.verdict = 'pass' THEN 1.0
          ELSE 0.0
        END) AS passRate,
        AVG(agent_runs.duration_ms) AS averageDurationMs
      FROM agent_runs
      INNER JOIN tasks ON tasks.id = agent_runs.task_id
      INNER JOIN task_categories
        ON task_categories.task_id = tasks.id
        AND task_categories.category = @category
      WHERE agent_runs.agent_id = @agentId
    `).get({ agentId, category });

    return {
      sampleSize: Number(row.sampleSize || 0),
      weightedEvaluationScore: roundMetric(row.weightedEvaluationScore),
      passRate: roundMetric(row.passRate, 4),
      averageDurationMs: roundMetric(row.averageDurationMs),
    };
  }

  getAgentRecentStats(agentId, limit = this.recentSampleSize) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('recent performance limit must be a positive integer');
    }

    const row = this.database.getConnection().prepare(`
      SELECT
        COUNT(*) AS sampleSize,
        AVG(COALESCE(evaluation_score, 0)) AS averageEvaluationScore,
        AVG(CASE
          WHEN status IN ('completed', 'completed_with_warnings') THEN 1.0
          ELSE 0.0
        END) AS successRate,
        AVG(CASE WHEN verdict = 'pass' THEN 1.0 ELSE 0.0 END) AS passRate,
        AVG(CASE WHEN verdict = 'warning' THEN 1.0 ELSE 0.0 END) AS warningRate,
        AVG(CASE
          WHEN status IN ('completed', 'completed_with_warnings') THEN 0.0
          ELSE 1.0
        END) AS failureRate,
        AVG(duration_ms) AS averageDurationMs
      FROM (
        SELECT
          status,
          evaluation_score,
          verdict,
          duration_ms
        FROM agent_runs
        WHERE agent_id = @agentId
        ORDER BY created_at DESC, id DESC
        LIMIT @limit
      ) AS recent_runs
    `).get({ agentId, limit });

    return normalizeStats(row);
  }
}

const performanceService = new PerformanceService();

module.exports = {
  PerformanceService,
  normalizeStats,
  performanceService,
  roundMetric,
};
