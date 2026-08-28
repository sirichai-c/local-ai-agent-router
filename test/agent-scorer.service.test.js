const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AgentScorerService,
} = require('../src/services/agent-scorer.service');

const scorer = new AgentScorerService();

test('scoreAgent calculates normalized weighted compatibility', () => {
  const result = scorer.scoreAgent(
    {
      capabilityScores: {
        git: 100,
        refactor: 50,
      },
    },
    {
      git: 90,
      refactor: 30,
      coding: 0,
    },
  );

  assert.equal(result.score, 87.5);
  assert.deepEqual(result.reasons, [
    {
      category: 'git',
      taskImportance: 90,
      agentCapability: 100,
    },
    {
      category: 'refactor',
      taskImportance: 30,
      agentCapability: 50,
    },
  ]);
});

test('scoreAgent treats missing capabilities as zero and limits reasons', () => {
  const result = scorer.scoreAgent(
    {
      capabilityScores: {
        coding: 80,
      },
    },
    {
      coding: 50,
      debugging: 40,
      git: 30,
      review: 20,
    },
  );

  assert.equal(result.score, 28.57);
  assert.equal(result.reasons.length, 3);
  assert.equal(result.reasons[0].category, 'coding');
});

test('scoreAgent returns zero when every task category is inactive', () => {
  const result = scorer.scoreAgent(
    { capabilityScores: { coding: 95 } },
    { coding: 0 },
  );

  assert.deepEqual(result, {
    score: 0,
    reasons: [],
  });
});
