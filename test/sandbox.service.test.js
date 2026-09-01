const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  CONTAINER_ENVIRONMENT,
  SandboxService,
} = require('../src/services/sandbox.service');

async function createFixture(t) {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lar-sandbox-test-'));
  const snapshotPath = path.join(runRoot, 'a'.repeat(16), 'workspace');
  await fs.mkdir(snapshotPath, { recursive: true });
  t.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  return { runRoot, snapshotPath };
}

function createRunner(results = []) {
  const calls = [];
  return {
    calls,
    runProcess: async (input) => {
      calls.push(input);
      return results.shift() || {
        ...input,
        exitCode: 0,
        timedOut: false,
        stdout: '',
        stderr: '',
        outputTruncated: false,
      };
    },
  };
}

test('Docker command generation applies the fixed security boundary', async (t) => {
  const fixture = await createFixture(t);
  const runner = createRunner();
  const sandbox = new SandboxService({
    runner,
    runRoot: fixture.runRoot,
    dockerCommand: 'docker',
  });
  await sandbox.run({
    sandboxId: 'a'.repeat(16),
    snapshotPath: fixture.snapshotPath,
    command: 'npm',
    args: ['test'],
    network: 'none',
    purpose: 'test',
  });
  const args = runner.calls[0].args;
  const serialized = args.join(' ');

  for (const required of [
    '--memory 2g',
    '--cpus 2',
    '--pids-limit 256',
    '--cap-drop ALL',
    '--security-opt no-new-privileges:true',
    '--read-only',
    '--network none',
    '--user 1000:1000',
  ]) {
    assert.match(serialized, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  }
  assert.doesNotMatch(serialized, /--privileged|docker\.sock|\/var\/run|C:\\\\/u);
  assert.deepEqual(CONTAINER_ENVIRONMENT, {
    CI: 'true',
    HOME: '/tmp/home',
    npm_config_cache: '/tmp/npm-cache',
  });
  assert.equal(runner.calls[0].env.PASSWORD, undefined);
});

test('sandbox allows network only when the caller selects the install stage', async (t) => {
  const fixture = await createFixture(t);
  const runner = createRunner();
  const sandbox = new SandboxService({ runner, runRoot: fixture.runRoot });
  await sandbox.run({
    sandboxId: 'a'.repeat(16),
    snapshotPath: fixture.snapshotPath,
    command: 'npm',
    args: ['ci', '--ignore-scripts'],
    network: 'bridge',
    purpose: 'dependency-install',
  });
  assert.match(runner.calls[0].args.join(' '), /--network bridge/u);
});

test('sandbox rejects arbitrary commands and mounts outside the run root', async (t) => {
  const fixture = await createFixture(t);
  const sandbox = new SandboxService({
    runner: createRunner(),
    runRoot: fixture.runRoot,
  });
  await assert.rejects(
    () => sandbox.run({
      sandboxId: 'a'.repeat(16),
      snapshotPath: fixture.snapshotPath,
      command: 'powershell',
      args: [],
    }),
    /not allowed/u,
  );
  await assert.rejects(
    () => sandbox.run({
      sandboxId: 'a'.repeat(16),
      snapshotPath: fixture.runRoot,
      command: 'npm',
      args: ['test'],
    }),
    /snapshot under SANDBOX_RUN_ROOT/u,
  );
});

test('timeout-compatible result still triggers best-effort container removal', async (t) => {
  const fixture = await createFixture(t);
  const runner = createRunner([{
    exitCode: null,
    timedOut: true,
    stdout: '',
    stderr: '',
    outputTruncated: false,
  }]);
  const sandbox = new SandboxService({ runner, runRoot: fixture.runRoot });
  const result = await sandbox.run({
    sandboxId: 'a'.repeat(16),
    snapshotPath: fixture.snapshotPath,
    command: 'npm',
    args: ['test'],
    purpose: 'test',
  });

  assert.equal(result.timedOut, true);
  assert.deepEqual(runner.calls[1].args.slice(0, 2), ['rm', '--force']);
});

test('sandbox forwards only the scheduler-owned AbortSignal to its container process', async (t) => {
  const fixture = await createFixture(t);
  const runner = createRunner();
  const sandbox = new SandboxService({ runner, runRoot: fixture.runRoot });
  const controller = new AbortController();
  await sandbox.run({
    sandboxId: 'a'.repeat(16),
    snapshotPath: fixture.snapshotPath,
    command: 'npm',
    args: ['test'],
    signal: controller.signal,
  });
  assert.equal(runner.calls[0].signal, controller.signal);
  assert.equal(runner.calls[1].signal, undefined);
});
