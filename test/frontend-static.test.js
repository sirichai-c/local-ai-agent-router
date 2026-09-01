const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../src/app');

async function withServer(app, operation) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await operation(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('serves built Dashboard routes without swallowing API or health routes', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'router-web-dist-'));
  const html = '<!doctype html><html><body><div id="root">Dashboard</div></body></html>';
  await fs.writeFile(path.join(temporaryRoot, 'index.html'), html);
  await fs.writeFile(path.join(temporaryRoot, 'asset.txt'), 'asset');

  try {
    await withServer(createApp({ frontendDistPath: temporaryRoot }), async (baseUrl) => {
      const root = await fetch(`${baseUrl}/`, { headers: { accept: 'text/html' } });
      assert.equal(root.status, 200);
      assert.match(await root.text(), /Dashboard/u);

      const history = await fetch(`${baseUrl}/history`, { headers: { accept: 'text/html' } });
      assert.equal(history.status, 200);
      assert.match(await history.text(), /Dashboard/u);

      const queue = await fetch(`${baseUrl}/queue`, { headers: { accept: 'text/html' } });
      assert.equal(queue.status, 200);
      assert.match(await queue.text(), /Dashboard/u);

      const asset = await fetch(`${baseUrl}/asset.txt`);
      assert.equal(await asset.text(), 'asset');

      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.headers.get('content-type').includes('application/json'), true);
      assert.equal((await health.json()).status, 'ok');

      const missingApi = await fetch(`${baseUrl}/api/not-real`);
      assert.equal(missingApi.status, 404);
      assert.equal(missingApi.headers.get('content-type').includes('application/json'), true);
      assert.equal((await missingApi.json()).error.code, 'NOT_FOUND');
    });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('backend starts when Dashboard build is absent', async () => {
  await withServer(createApp({ frontendDistPath: path.join(os.tmpdir(), 'missing-router-dashboard') }), async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    const root = await fetch(`${baseUrl}/`);
    assert.equal(root.status, 404);
    assert.equal((await root.json()).error.code, 'NOT_FOUND');
  });
});
