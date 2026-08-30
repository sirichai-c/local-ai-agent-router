const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  resolveExecutionCommand,
} = require('../src/utils/execution-command.util');

test('Windows execution resolution prefers a verified native executable', async () => {
  const agent = {
    execution: {
      windows: {
        nativeExecutableRelativePath: 'node_modules/opencode-ai/bin/opencode.exe',
      },
    },
  };
  const result = await resolveExecutionCommand(agent, {
    exists: true,
    path: 'C:\\npm\\opencode',
    paths: ['C:\\npm\\opencode', 'C:\\npm\\opencode.cmd'],
  }, {
    platform: 'win32',
    statImpl: async (candidate) => ({
      isFile: () => candidate.endsWith('opencode.exe'),
    }),
  });

  assert.deepEqual(result, {
    command: 'C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe',
    args: [],
  });
});

test('Windows command shim remains installed but has no execution command', async () => {
  const result = await resolveExecutionCommand({}, {
    exists: true,
    path: 'C:\\npm\\qwen.cmd',
    paths: ['C:\\npm\\qwen.cmd'],
  }, {
    platform: 'win32',
  });

  assert.equal(result, null);
});

test('POSIX execution resolution uses the detected executable path', async () => {
  const result = await resolveExecutionCommand({}, {
    exists: true,
    path: '/usr/local/bin/aider',
    paths: ['/usr/local/bin/aider'],
  }, {
    platform: 'linux',
  });

  assert.deepEqual(result, {
    command: '/usr/local/bin/aider',
    args: [],
  });
});

test('Windows npm CLI resolves to Node with a fixed package entry point', async () => {
  const existingPaths = new Set([
    'C:\\runtime\\node.exe',
    'C:\\npm\\node_modules\\@qwen-code\\qwen-code\\cli-entry.js',
  ]);
  const result = await resolveExecutionCommand({
    execution: {
      windows: {
        nodeEntryRelativePath: 'node_modules/@qwen-code/qwen-code/cli-entry.js',
      },
    },
  }, {
    exists: true,
    path: 'C:\\npm\\qwen.cmd',
    paths: ['C:\\npm\\qwen.cmd'],
  }, {
    platform: 'win32',
    nodeExecutable: 'C:\\runtime\\node.exe',
    statImpl: async (candidate) => ({
      isFile: () => existingPaths.has(candidate),
    }),
  });

  assert.deepEqual(result, {
    command: 'C:\\runtime\\node.exe',
    args: [
      'C:\\npm\\node_modules\\@qwen-code\\qwen-code\\cli-entry.js',
    ],
  });
});
