const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const {
  createCandidateFixture,
} = require('../test-support/candidate-test.helper');

async function startWorkflowServer(fixtures) {
  const app = express();
  app.use(express.json());
  app.get('/api/tasks/:id/candidate', async (request, response) => {
    const fixture = fixtures.get(request.params.id);
    response.json(await fixture.reviews.review(request.params.id));
  });
  app.post('/api/tasks/:id/approve', async (request, response) => {
    const fixture = fixtures.get(request.params.id);
    response.json(await fixture.approval.approve(
      request.params.id,
      request.body.expectedFingerprint,
    ));
  });
  app.post('/api/tasks/:id/reject', async (request, response) => {
    const fixture = fixtures.get(request.params.id);
    response.json(await fixture.approval.reject(request.params.id));
  });
  app.use((error, request, response, next) => {
    void request;
    void next;
    response.status(error.statusCode || 500).json({
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Unexpected error',
      },
    });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('Dashboard API client completes disposable approve, reject, and TOCTOU flows', async (t) => {
  const approved = await createCandidateFixture(t, { taskId: 'dashboardapprove' });
  const rejected = await createCandidateFixture(t, { taskId: 'dashboardreject' });
  const changed = await createCandidateFixture(t, { taskId: 'dashboardchanged' });
  const server = await startWorkflowServer(new Map([
    [approved.taskId, approved],
    [rejected.taskId, rejected],
    [changed.taskId, changed],
  ]));
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => nativeFetch(`${server.baseUrl}${url}`, options);

  try {
    const { apiClient } = await import('../web/src/api/client.js');

    const approvalReview = await apiClient.getCandidate(approved.taskId);
    const approval = await apiClient.approveCandidate(
      approved.taskId,
      approvalReview.candidate.fingerprint,
    );
    assert.equal(approval.status, 'merged');
    assert.match(
      await fs.readFile(path.join(approved.repo, 'README.md'), 'utf8'),
      /Reviewed candidate change/u,
    );

    const targetBeforeReject = await rejected.git.getHeadCommit(rejected.repo);
    const rejection = await apiClient.rejectCandidate(rejected.taskId);
    assert.equal(rejection.status, 'rejected');
    assert.equal(await rejected.git.getHeadCommit(rejected.repo), targetBeforeReject);

    const changedReview = await apiClient.getCandidate(changed.taskId);
    await fs.appendFile(
      path.join(changed.worktree.worktreePath, 'README.md'),
      'changed after Dashboard review\n',
    );
    await assert.rejects(
      () => apiClient.approveCandidate(
        changed.taskId,
        changedReview.candidate.fingerprint,
      ),
      (error) => error.status === 409 && error.code === 'candidate_changed',
    );
    assert.equal(await changed.git.getHeadCommit(changed.repo), changed.baseCommit);
  } finally {
    globalThis.fetch = nativeFetch;
    await server.close();
  }
});
