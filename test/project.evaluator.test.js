const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  ProjectEvaluator,
  SCRIPT_DISABLED_REASON,
  SCRIPT_UNSUPPORTED_REASON,
} = require('../src/evaluators/project.evaluator');

async function createWorkspace(t, packageContents) {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-router-project-test-'),
  );
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));

  if (packageContents !== undefined) {
    await fs.writeFile(path.join(workspace, 'package.json'), packageContents);
  }

  return workspace;
}

test('project evaluator detects scripts but keeps them disabled', async (t) => {
  const workspace = await createWorkspace(t, JSON.stringify({
    scripts: {
      test: 'node test.js',
      lint: 'eslint .',
      build: 'node build.js',
    },
  }));
  const result = await new ProjectEvaluator({
    runProjectScripts: false,
  }).evaluate({ workspace });

  assert.equal(result.projectType, 'node');
  assert.equal(result.packageJson.valid, true);

  for (const script of ['test', 'lint', 'build']) {
    assert.deepEqual(result.scripts[script], {
      available: true,
      executed: false,
      passed: null,
      reason: SCRIPT_DISABLED_REASON,
    });
  }
});

test('project evaluator reports a project without package.json', async (t) => {
  const workspace = await createWorkspace(t);
  const result = await new ProjectEvaluator().evaluate({ workspace });

  assert.equal(result.projectType, 'unknown');
  assert.deepEqual(result.packageJson, { exists: false, valid: null });
  assert.equal(result.scripts.test.available, false);
});

test('invalid package.json is reported without exposing contents', async (t) => {
  const workspace = await createWorkspace(t, '{"password":"secret",}');
  const result = await new ProjectEvaluator().evaluate({ workspace });

  assert.equal(result.packageJson.valid, false);
  assert.equal(result.packageJson.error, 'package.json is not valid JSON.');
  assert.doesNotMatch(result.packageJson.error, /secret/u);
});

test('malicious scripts are never executed on the host', async (t) => {
  const marker = path.join(os.tmpdir(), `phase7-malicious-${Date.now()}.txt`);
  const workspace = await createWorkspace(t, JSON.stringify({
    scripts: {
      test: `node -e "require('fs').writeFileSync('${marker}', 'bad')"`,
    },
  }));
  const result = await new ProjectEvaluator({
    runProjectScripts: true,
    sandboxEnabled: false,
  }).evaluate({ workspace });

  assert.equal(result.scriptExecutionPolicy.requested, true);
  assert.equal(result.scriptExecutionPolicy.supported, false);
  assert.equal(result.scripts.test.executed, false);
  assert.equal(result.scripts.test.reason, SCRIPT_UNSUPPORTED_REASON);
  await assert.rejects(() => fs.stat(marker), { code: 'ENOENT' });
});

test('enabled project scripts delegate only to the sandbox evaluator', async (t) => {
  const workspace = await createWorkspace(t, JSON.stringify({
    scripts: { test: 'node test.js' },
  }));
  let sandboxInput;
  const result = await new ProjectEvaluator({
    runProjectScripts: true,
    sandboxEnabled: true,
    sandbox: {
      evaluate: async (input) => {
        sandboxInput = input;
        return {
          sandbox: { requested: true, executed: true, image: 'safe:1' },
          dependencyInstall: { executed: true, passed: true },
          scripts: {
            test: {
              available: true,
              executed: true,
              sandbox: true,
              network: 'none',
              passed: true,
            },
            lint: { available: false, executed: false, passed: null },
            build: { available: false, executed: false, passed: null },
          },
        };
      },
    },
  }).evaluate({ workspace });

  assert.equal(sandboxInput.workspace, workspace);
  assert.equal(result.scriptExecutionPolicy.hostExecution, false);
  assert.equal(result.scriptExecutionPolicy.sandbox, true);
  assert.equal(result.scripts.test.executed, true);
  assert.equal(result.scripts.test.passed, true);
});
