const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');

const {
  selectCandidateRun,
} = require('../src/services/candidate-review.service');
const {
  createCandidateFixture,
} = require('../test-support/candidate-test.helper');

test('candidate review inspects current worktree evidence', async (t) => {
  const fixture = await createCandidateFixture(t);
  const review = await fixture.reviews.review(fixture.taskId);

  assert.equal(review.approvable, true, JSON.stringify(review));
  assert.equal(review.reason, null);
  assert.equal(review.candidate.agentId, fixture.agentId);
  assert.equal(review.candidate.fingerprint, fixture.fingerprint.fingerprint);
  assert.match(review.candidate.trackedDiff, /Reviewed candidate change/u);
});

test('candidate review reports changed worktree without updating stored hash', async (t) => {
  const fixture = await createCandidateFixture(t);
  await fs.appendFile(
    path.join(fixture.worktree.worktreePath, 'README.md'),
    'tampered after evaluation\n',
  );
  const review = await fixture.reviews.review(fixture.taskId);
  const stored = fixture.history.getTaskById(fixture.taskId);

  assert.equal(review.approvable, false);
  assert.equal(review.reason, 'candidate_changed');
  assert.equal(
    stored.runs[0].candidateFingerprint,
    fixture.fingerprint.fingerprint,
  );
});

test('old Phase 9 candidates without tracking metadata require re-execution', async (t) => {
  const fixture = await createCandidateFixture(t);
  fixture.database.getConnection().prepare(`
    UPDATE agent_runs SET candidate_fingerprint = NULL WHERE task_id = ?
  `).run(fixture.taskId);
  const review = await fixture.reviews.review(fixture.taskId);

  assert.equal(review.approvable, false);
  assert.equal(review.reason, 'candidate_not_approval_compatible');
});

test('competition candidate selection preserves Phase 8 eligibility and ties', () => {
  const task = {
    mode: 'competition',
    winnerAgentId: 'qwen-code',
    runs: [
      {
        id: 1,
        agentId: 'opencode',
        status: 'evaluation_failed',
        competitionScore: 99,
        evaluationScore: 100,
        routerScore: 100,
        durationMs: 1,
      },
      {
        id: 2,
        agentId: 'qwen-code',
        status: 'completed',
        competitionScore: 90,
        evaluationScore: 95,
        routerScore: 90,
        durationMs: 100,
      },
      {
        id: 3,
        agentId: 'aider',
        status: 'completed_with_warnings',
        competitionScore: 90,
        evaluationScore: 90,
        routerScore: 99,
        durationMs: 50,
      },
    ],
  };

  assert.equal(selectCandidateRun(task).agentId, 'qwen-code');
});
