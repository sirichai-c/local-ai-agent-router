const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const COMMAND_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

class CommandDetectionError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'CommandDetectionError';
  }
}

function getLocatorCommand(platform) {
  return platform === 'win32' ? 'where.exe' : 'which';
}

function parsePaths(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isCommandNotFound(error) {
  return error?.code === 1 || error?.code === '1';
}

async function findCommand(command, {
  platform = process.platform,
  execFileImpl = execFileAsync,
} = {}) {
  if (typeof command !== 'string' || !COMMAND_NAME_PATTERN.test(command)) {
    throw new TypeError('command must be a valid executable name');
  }

  const locatorCommand = getLocatorCommand(platform);

  try {
    const { stdout } = await execFileImpl(locatorCommand, [command], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      shell: false,
      timeout: 5_000,
      windowsHide: true,
    });
    const paths = parsePaths(stdout);

    return {
      exists: paths.length > 0,
      path: paths[0] || null,
      paths,
    };
  } catch (error) {
    if (isCommandNotFound(error)) {
      return {
        exists: false,
        path: null,
        paths: [],
      };
    }

    throw new CommandDetectionError(
      `Unable to inspect the operating system PATH using ${locatorCommand}`,
      { cause: error },
    );
  }
}

module.exports = {
  CommandDetectionError,
  findCommand,
  getLocatorCommand,
  parsePaths,
};
