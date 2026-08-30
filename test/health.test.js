const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

const { createApp } = require('../src/app');

let baseUrl;
let server;

before(async () => {
  const app = createApp();

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test('GET /health returns the service status', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    status: 'ok',
    service: 'local-ai-agent-router',
  });
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('unknown routes return a structured JSON error', async () => {
  const response = await fetch(`${baseUrl}/does-not-exist`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
});

test('POST /api/chat rejects a missing message before calling Ollama', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    error: {
      code: 'INVALID_MESSAGE',
      message: 'message must be a non-empty string',
    },
  });
});

test('GET /api/agents/does-not-exist returns an agent-specific 404', async () => {
  const response = await fetch(`${baseUrl}/api/agents/does-not-exist`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: 'Agent not found',
  });
});

test('POST /api/router/analyze requires a non-empty string task', async () => {
  const invalidBodies = [
    {},
    { task: '' },
    { task: '   ' },
    { task: 42 },
  ];

  for (const body of invalidBodies) {
    const response = await fetch(`${baseUrl}/api/router/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'task is required',
    });
  }
});

test('POST /api/router/plan requires task and workspace strings', async () => {
  const invalidBodies = [
    {},
    { task: 'fix bug' },
    { workspace: process.cwd() },
    { task: 'fix bug', workspace: 42 },
  ];

  for (const body of invalidBodies) {
    const response = await fetch(`${baseUrl}/api/router/plan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'task and workspace are required',
    });
  }
});

test('POST /api/tasks/execute requires task and workspace strings', async () => {
  const response = await fetch(`${baseUrl}/api/tasks/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'task and workspace are required',
  });
});

test('POST /api/tasks/compete validates its body', async () => {
  const missingResponse = await fetch(`${baseUrl}/api/tasks/compete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missingResponse.status, 400);
  assert.deepEqual(await missingResponse.json(), {
    error: 'task and workspace are required',
  });

  const invalidAgentsResponse = await fetch(`${baseUrl}/api/tasks/compete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: 'safe task',
      workspace: process.cwd(),
      agents: 'opencode',
    }),
  });
  assert.equal(invalidAgentsResponse.status, 400);
  assert.equal((await invalidAgentsResponse.json()).code, 'INVALID_AGENT_LIST');

  const duplicateAgentsResponse = await fetch(`${baseUrl}/api/tasks/compete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: 'safe task',
      workspace: process.cwd(),
      agents: ['opencode', ' OpenCode '],
    }),
  });
  assert.equal(duplicateAgentsResponse.status, 400);
  assert.equal(
    (await duplicateAgentsResponse.json()).code,
    'DUPLICATE_AGENT_ID',
  );

  const nonStringAgentResponse = await fetch(`${baseUrl}/api/tasks/compete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: 'safe task',
      workspace: process.cwd(),
      agents: ['opencode', 42],
    }),
  });
  assert.equal(nonStringAgentResponse.status, 400);
  assert.equal(
    (await nonStringAgentResponse.json()).code,
    'INVALID_AGENT_LIST',
  );
});

test('POST /api/tasks/compete respects the default execution gate', async () => {
  const response = await fetch(`${baseUrl}/api/tasks/compete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task: 'safe task',
      workspace: process.cwd(),
      agents: ['opencode', 'qwen-code'],
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'execution_disabled');
  assert.equal(body.competitionId, null);
  assert.deepEqual(body.candidates, []);
});
