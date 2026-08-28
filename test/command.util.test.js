const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CommandDetectionError,
  findCommand,
  getLocatorCommand,
} = require('../src/utils/command.util');

test('getLocatorCommand selects the operating system PATH utility', () => {
  assert.equal(getLocatorCommand('win32'), 'where.exe');
  assert.equal(getLocatorCommand('linux'), 'which');
  assert.equal(getLocatorCommand('darwin'), 'which');
});

test('findCommand uses where.exe safely and returns all detected paths', async () => {
  let invocation;
  const result = await findCommand('opencode', {
    platform: 'win32',
    execFileImpl: async (file, args, options) => {
      invocation = { file, args, options };
      return {
        stdout: 'C:\\tools\\opencode.cmd\r\nC:\\other\\opencode.cmd\r\n',
        stderr: '',
      };
    },
  });

  assert.equal(invocation.file, 'where.exe');
  assert.deepEqual(invocation.args, ['opencode']);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(result, {
    exists: true,
    path: 'C:\\tools\\opencode.cmd',
    paths: ['C:\\tools\\opencode.cmd', 'C:\\other\\opencode.cmd'],
  });
});

test('findCommand treats a missing command as a normal result', async () => {
  const result = await findCommand('aider', {
    platform: 'win32',
    execFileImpl: async () => {
      const error = new Error('not found');
      error.code = 1;
      throw error;
    },
  });

  assert.deepEqual(result, {
    exists: false,
    path: null,
    paths: [],
  });
});

test('findCommand surfaces an operating system detection failure', async () => {
  await assert.rejects(
    () => findCommand('opencode', {
      platform: 'win32',
      execFileImpl: async () => {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      },
    }),
    CommandDetectionError,
  );
});

test('findCommand rejects values that are not executable names', async () => {
  await assert.rejects(
    () => findCommand('../unsafe'),
    TypeError,
  );
});
