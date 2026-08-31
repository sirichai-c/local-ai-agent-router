const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  SandboxProjectEvaluator,
} = require('../src/evaluators/sandbox-project.evaluator');
const {
  SandboxSnapshotService,
} = require('../src/services/sandbox-snapshot.service');
const { SandboxService } = require('../src/services/sandbox.service');

const runLive = process.env.RUN_DOCKER_SANDBOX_TESTS === 'true';

test('live Docker evaluation isolates scripts from host and candidate', {
  skip: !runLive,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lar-live-sandbox-'));
  const workspace = path.join(root, 'candidate');
  const runRoot = path.join(root, 'runs');
  await fs.mkdir(workspace);
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const packageJson = {
    name: 'phase11-live-proof',
    version: '1.0.0',
    scripts: {
      test: 'node test.js',
      lint: 'node lint.js',
      build: 'node build.js',
    },
  };
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  );
  await fs.writeFile(path.join(workspace, 'README.md'), 'candidate\n');
  await fs.writeFile(path.join(workspace, 'lint.js'), "console.log('lint-pass');\n");
  await fs.writeFile(
    path.join(workspace, 'build.js'),
    "require('fs').writeFileSync('build-output.txt', 'sandbox-only');\n",
  );
  await fs.writeFile(path.join(workspace, 'test.js'), `
const fs = require('node:fs');
const assert = require('node:assert/strict');

assert.equal(process.env.ROUTER_PHASE11_SECRET, undefined);
assert.equal(fs.existsSync('/var/run/docker.sock'), false);
assert.equal(fs.existsSync('/host-phase11-sentinel'), false);

(async () => {
  let networkBlocked = false;
  try {
    await fetch('http://host.docker.internal:11434/api/tags', {
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    networkBlocked = true;
  }
  assert.equal(networkBlocked, true);
  fs.writeFileSync('test-output.txt', 'sandbox-only');
  console.log('test-pass-network-none');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
`);

  const snapshots = new SandboxSnapshotService({ runRoot });
  const sandbox = new SandboxService({ runRoot });
  const evaluator = new SandboxProjectEvaluator({ snapshots, sandbox });
  const before = await fs.readFile(path.join(workspace, 'README.md'), 'utf8');
  const previousSecret = process.env.ROUTER_PHASE11_SECRET;
  process.env.ROUTER_PHASE11_SECRET = 'must-not-enter-container';

  let result;
  try {
    result = await evaluator.evaluate({
      workspace,
      scripts: packageJson.scripts,
    });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.ROUTER_PHASE11_SECRET;
    } else {
      process.env.ROUTER_PHASE11_SECRET = previousSecret;
    }
  }

  assert.equal(result.dependencyInstall.passed, true);
  assert.equal(result.scripts.test.passed, true);
  assert.equal(result.scripts.lint.passed, true);
  assert.equal(result.scripts.build.passed, true);
  assert.equal(result.scripts.test.network, 'none');
  assert.equal(await fs.readFile(path.join(workspace, 'README.md'), 'utf8'), before);
  for (const generated of ['package-lock.json', 'node_modules', 'test-output.txt', 'build-output.txt']) {
    await assert.rejects(() => fs.stat(path.join(workspace, generated)), { code: 'ENOENT' });
  }
  assert.deepEqual(await fs.readdir(runRoot), []);
});
