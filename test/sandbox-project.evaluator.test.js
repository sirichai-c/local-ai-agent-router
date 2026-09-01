const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  SandboxProjectEvaluator,
} = require('../src/evaluators/sandbox-project.evaluator');
const { ExecutionCancelledError } = require('../src/services/cancellation.service');

function createHarness({ installResult, scriptResults = {} } = {}) {
  const calls = [];
  let cleaned = false;
  const snapshots = {
    create: async () => ({
      sandboxId: 'a'.repeat(16),
      runPath: '/runs/id',
      snapshotPath: '/runs/id/workspace',
    }),
    cleanup: async () => {
      cleaned = true;
    },
  };
  const sandbox = {
    inspectAvailability: async () => ({ available: true, image: 'safe:1' }),
    run: async (input) => {
      calls.push(input);
      if (input.purpose === 'dependency-install') {
        return installResult || {
          exitCode: 0,
          timedOut: false,
          outputTruncated: false,
          stdout: '',
          stderr: '',
          network: input.network,
        };
      }
      return scriptResults[input.purpose] || {
        exitCode: 0,
        timedOut: false,
        outputTruncated: false,
        stdout: '',
        stderr: '',
        network: input.network,
      };
    },
  };
  const evaluator = new SandboxProjectEvaluator({
    snapshots,
    sandbox,
    access: async () => {},
  });
  return { evaluator, calls, wasCleaned: () => cleaned };
}

test('sandbox project evaluator runs test, lint, and build deterministically', async () => {
  const harness = createHarness();
  const events = [];
  const result = await harness.evaluator.evaluate({
    workspace: '/candidate',
    scripts: { test: 'x', lint: 'x', build: 'x' },
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.dependencyInstall.passed, true);
  assert.deepEqual(
    harness.calls.map((call) => call.purpose),
    ['dependency-install', 'test', 'lint', 'build'],
  );
  assert.equal(harness.calls[0].network, 'bridge');
  assert.ok(harness.calls.slice(1).every((call) => call.network === 'none'));
  assert.ok(Object.values(result.scripts).every((check) => check.passed));
  assert.equal(harness.wasCleaned(), true);
  assert.deepEqual(events.map((event) => `${event.type}:${event.data.check}`), [
    'sandbox_check_started:dependency-install',
    'sandbox_check_completed:dependency-install',
    'sandbox_check_started:test',
    'sandbox_check_completed:test',
    'sandbox_check_started:lint',
    'sandbox_check_completed:lint',
    'sandbox_check_started:build',
    'sandbox_check_completed:build',
  ]);
  assert.ok(events.filter((event) => event.type === 'sandbox_check_started')
    .slice(1)
    .every((event) => event.data.network === 'none'));
  assert.equal(JSON.stringify(events).includes('stdout'), false);
  assert.equal(JSON.stringify(events).includes('stderr'), false);
});

test('failed and timed-out project scripts retain separate evidence', async () => {
  const harness = createHarness({
    scriptResults: {
      test: {
        exitCode: 1,
        timedOut: false,
        outputTruncated: false,
        stdout: '',
        stderr: 'failed',
        network: 'none',
      },
      build: {
        exitCode: null,
        timedOut: true,
        outputTruncated: false,
        stdout: '',
        stderr: '',
        network: 'none',
      },
    },
  });
  const result = await harness.evaluator.evaluate({
    workspace: '/candidate',
    scripts: { test: 'x', build: 'x' },
  });

  assert.equal(result.scripts.test.passed, false);
  assert.equal(result.scripts.test.reason, 'project_check_failed');
  assert.equal(result.scripts.build.passed, false);
  assert.equal(result.scripts.build.reason, 'sandbox_timeout');
  assert.equal(result.scripts.lint.available, false);
});

test('dependency install failure skips scripts without claiming failure', async () => {
  const harness = createHarness({
    installResult: {
      exitCode: 1,
      timedOut: false,
      outputTruncated: false,
      stdout: '',
      stderr: 'registry unavailable',
      network: 'bridge',
    },
  });
  const result = await harness.evaluator.evaluate({
    workspace: '/candidate',
    scripts: { test: 'x', lint: 'x' },
  });

  assert.equal(result.dependencyInstall.passed, false);
  assert.equal(result.scripts.test.executed, false);
  assert.equal(result.scripts.test.passed, null);
  assert.equal(result.scripts.test.reason, 'dependency_install_failed');
  assert.deepEqual(
    harness.calls.map((call) => call.purpose),
    ['dependency-install'],
  );
});

test('missing scripts do not create a snapshot or become failures', async () => {
  let snapshotCreated = false;
  const evaluator = new SandboxProjectEvaluator({
    snapshots: {
      create: async () => {
        snapshotCreated = true;
      },
    },
  });
  const result = await evaluator.evaluate({ workspace: '/candidate', scripts: {} });

  assert.equal(snapshotCreated, false);
  assert.equal(result.scripts.test.available, false);
  assert.equal(result.scripts.test.passed, null);
});

test('unavailable sandbox fails closed without host script execution', async () => {
  let snapshotCreated = false;
  const evaluator = new SandboxProjectEvaluator({
    snapshots: { create: async () => { snapshotCreated = true; } },
    sandbox: {
      inspectAvailability: async () => ({
        available: false,
        image: 'missing:1',
        reason: 'sandbox_image_unavailable',
      }),
    },
  });
  const result = await evaluator.evaluate({
    workspace: '/candidate',
    scripts: { test: 'must-not-run' },
  });

  assert.equal(snapshotCreated, false);
  assert.equal(result.scripts.test.executed, false);
  assert.equal(result.scripts.test.reason, 'sandbox_image_unavailable');
});

test('evaluation cancellation stops later scripts and still cleans its disposable snapshot', async () => {
  const controller = new AbortController();
  const calls = [];
  let cleaned = false;
  let installStarted;
  const started = new Promise((resolve) => { installStarted = resolve; });
  const evaluator = new SandboxProjectEvaluator({
    access: async () => {},
    snapshots: {
      create: async () => ({ sandboxId: 'a'.repeat(16), snapshotPath: '/runs/id/workspace' }),
      cleanup: async () => { cleaned = true; },
    },
    sandbox: {
      inspectAvailability: async () => ({ available: true, image: 'safe:1' }),
      run: (input) => new Promise((_resolve, reject) => {
        calls.push(input.purpose);
        installStarted();
        input.signal.addEventListener('abort', () => reject(new ExecutionCancelledError()), { once: true });
      }),
    },
  });
  const evaluation = evaluator.evaluate({
    workspace: '/candidate', scripts: { test: 'x', lint: 'x' }, signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(evaluation, (error) => error.code === 'JOB_CANCELLED');
  assert.deepEqual(calls, ['dependency-install']);
  assert.equal(cleaned, true);
});
