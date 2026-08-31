const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AdaptiveScorerService,
} = require('../src/services/adaptive-scorer.service');

const weights = { static: 0.5, history: 0.3, recent: 0.2 };
const agent = { id: 'qwen-code' };

function createPerformance({ categories = {}, recent } = {}) {
  return {
    categoryCalls: 0,
    recentCalls: 0,
    getAgentCategoryStats(agentId, category) {
      this.categoryCalls += 1;
      return categories[category] || {
        sampleSize: 0,
        weightedEvaluationScore: null,
      };
    },
    getAgentRecentStats() {
      this.recentCalls += 1;
      return recent || {
        sampleSize: 0,
        averageEvaluationScore: null,
      };
    },
  };
}

function createScorer(performance, overrides = {}) {
  return new AdaptiveScorerService({
    performance,
    enabled: true,
    weights,
    minSamples: 3,
    recentSampleSize: 10,
    ...overrides,
  });
}

test('adaptive routing disabled returns static score without history queries', async () => {
  const performance = createPerformance();
  const scorer = createScorer(performance, { enabled: false });
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80 },
  });

  assert.deepEqual(result, {
    score: 80,
    staticScore: 80,
    historicalScore: null,
    recentScore: null,
    sampleSize: 0,
    adaptive: false,
  });
  assert.equal(performance.categoryCalls, 0);
  assert.equal(performance.recentCalls, 0);
});

test('no history keeps cold-start routing static', async () => {
  const scorer = createScorer(createPerformance());
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80 },
  });

  assert.equal(result.score, 80);
  assert.equal(result.adaptive, false);
  assert.equal(result.sampleSize, 0);
});

test('samples below minimum do not activate adaptive scoring', async () => {
  const scorer = createScorer(createPerformance({
    categories: {
      debugging: { sampleSize: 2, weightedEvaluationScore: 100 },
    },
    recent: { sampleSize: 2, averageEvaluationScore: 100 },
  }));
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80 },
  });

  assert.equal(result.score, 80);
  assert.equal(result.adaptive, false);
  assert.equal(result.sampleSize, 2);
});

test('sufficient category and recent evidence use all configured weights', async () => {
  const scorer = createScorer(createPerformance({
    categories: {
      debugging: { sampleSize: 5, weightedEvaluationScore: 90 },
    },
    recent: { sampleSize: 5, averageEvaluationScore: 100 },
  }));
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80 },
  });

  assert.equal(result.score, 87);
  assert.equal(result.historicalScore, 90);
  assert.equal(result.recentScore, 100);
  assert.equal(result.adaptive, true);
});

test('missing recent evidence renormalizes static and historical weights', async () => {
  const scorer = createScorer(createPerformance({
    categories: {
      debugging: { sampleSize: 3, weightedEvaluationScore: 100 },
    },
  }));
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80 },
  });

  assert.equal(result.score, 87.5);
  assert.equal(result.recentScore, null);
});

test('missing category evidence renormalizes static and recent weights', async () => {
  const scorer = createScorer(createPerformance({
    recent: { sampleSize: 3, averageEvaluationScore: 100 },
  }));
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80 },
  });

  assert.equal(result.score, 85.71);
  assert.equal(result.historicalScore, null);
});

test('consistently strong history raises the static score', async () => {
  const scorer = createScorer(createPerformance({
    categories: {
      debugging: { sampleSize: 10, weightedEvaluationScore: 98 },
    },
    recent: { sampleSize: 10, averageEvaluationScore: 96 },
  }));
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80 },
  });

  assert.ok(result.score > result.staticScore);
});

test('consistently poor history lowers the static score', async () => {
  const scorer = createScorer(createPerformance({
    categories: {
      debugging: { sampleSize: 10, weightedEvaluationScore: 20 },
    },
    recent: { sampleSize: 10, averageEvaluationScore: 30 },
  }));
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80 },
  });

  assert.ok(result.score < result.staticScore);
});

test('missing category history is excluded instead of treated as zero', async () => {
  const scorer = createScorer(createPerformance({
    categories: {
      debugging: { sampleSize: 3, weightedEvaluationScore: 90 },
      git: { sampleSize: 0, weightedEvaluationScore: null },
    },
  }));
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 80,
    classification: { debugging: 80, git: 20 },
  });

  assert.equal(result.historicalScore, 90);
  assert.equal(result.score, 83.75);
});

test('adaptive scores are clamped to the 0-100 safety range', async () => {
  const scorer = createScorer(createPerformance({
    categories: {
      debugging: { sampleSize: 3, weightedEvaluationScore: 200 },
    },
    recent: { sampleSize: 3, averageEvaluationScore: 200 },
  }));
  const result = await scorer.scoreAgentWithHistory({
    agent,
    staticScore: 200,
    classification: { debugging: 80 },
  });

  assert.equal(result.score, 100);
  assert.equal(result.staticScore, 100);
});

test('identical history inputs produce identical adaptive output', async () => {
  const performance = createPerformance({
    categories: {
      debugging: { sampleSize: 4, weightedEvaluationScore: 88 },
    },
    recent: { sampleSize: 4, averageEvaluationScore: 92 },
  });
  const scorer = createScorer(performance);
  const input = {
    agent,
    staticScore: 85,
    classification: { debugging: 80 },
  };

  assert.deepEqual(
    await scorer.scoreAgentWithHistory(input),
    await scorer.scoreAgentWithHistory(input),
  );
});
