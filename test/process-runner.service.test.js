const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const {
  ProcessRunner,
} = require('../src/services/process-runner.service');

function createNodeRunner() {
  return new ProcessRunner({
    allowedCommands: [path.basename(process.execPath)],
    defaultTimeoutMs: 2_000,
    defaultMaxOutputBytes: 1_024,
  });
}

test('process runner captures output from an allowlisted command', async () => {
  const result = await createNodeRunner().runProcess({
    command: process.execPath,
    args: ['-e', "process.stdout.write('safe-output')"],
    cwd: process.cwd(),
    env: {},
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'safe-output');
  assert.equal(result.stderr, '');
  assert.equal(result.timedOut, false);
  assert.equal(result.outputTruncated, false);
});

test('process runner rejects a command outside its allowlist', () => {
  assert.throws(
    () => createNodeRunner().runProcess({
      command: 'arbitrary-command.exe',
      cwd: process.cwd(),
    }),
    /Command is not allowed/,
  );
});

test('process runner terminates a process after a short test timeout', async () => {
  const result = await createNodeRunner().runProcess({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 5000)'],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 100,
  });

  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test('process runner truncates combined output at the configured byte limit', async () => {
  const result = await createNodeRunner().runProcess({
    command: process.execPath,
    args: ['-e', "process.stdout.write('x'.repeat(200))"],
    cwd: process.cwd(),
    env: {},
    maxOutputBytes: 32,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.byteLength(result.stdout), 32);
  assert.equal(result.outputTruncated, true);
});

test('process runner aborts only the child it owns and distinguishes cancellation from timeout', async () => {
  const controller = new AbortController();
  const running = createNodeRunner().runProcess({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 5000)'],
    cwd: process.cwd(),
    env: {},
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.notEqual(result.exitCode, 0);
});

test('pre-aborted process requests never spawn', async () => {
  const spawnCalls = [];
  const controller = new AbortController();
  controller.abort();
  const runner = new ProcessRunner({
    spawnImpl: (...args) => { spawnCalls.push(args); },
    allowedCommands: ['node.exe'],
    defaultTimeoutMs: 100,
    defaultMaxOutputBytes: 100,
  });
  const result = await runner.runProcess({
    command: 'node.exe', args: [], cwd: process.cwd(), env: {}, signal: controller.signal,
  });
  assert.equal(result.aborted, true);
  assert.equal(spawnCalls.length, 0);
});
