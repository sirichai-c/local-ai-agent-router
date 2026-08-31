const path = require('node:path');
const { spawn } = require('node:child_process');

const { config } = require('../config/env');

const DEFAULT_ALLOWED_COMMANDS = Object.freeze([
  'git',
  'git.exe',
  'opencode',
  'opencode.exe',
  'opencode.cmd',
  'qwen',
  'qwen.exe',
  'qwen.cmd',
  'qwen-code',
  'qwen-code.exe',
  'qwen-code.cmd',
  'aider',
  'aider.exe',
  'aider.cmd',
  'node',
  'node.exe',
  'docker',
  'docker.exe',
]);

function killProcessTree(child, {
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  if (platform !== 'win32' || !Number.isInteger(child.pid)) {
    child.kill('SIGKILL');
    return;
  }

  // child.kill() does not reliably terminate descendant processes on Windows.
  // taskkill receives only the numeric PID created by this runner; no HTTP input
  // is used to form either the command or its arguments.
  const killer = spawnImpl(
    'taskkill.exe',
    ['/pid', String(child.pid), '/t', '/f'],
    {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    },
  );

  killer.once('error', () => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Best effort only. Full process isolation arrives in Phase 11.
    }
  });
}

class ProcessRunner {
  constructor({
    spawnImpl = spawn,
    processTreeKiller = killProcessTree,
    allowedCommands = DEFAULT_ALLOWED_COMMANDS,
    defaultTimeoutMs = config.agentExecution.timeoutMs,
    defaultMaxOutputBytes = config.agentExecution.maxOutputBytes,
  } = {}) {
    this.spawnImpl = spawnImpl;
    this.processTreeKiller = processTreeKiller;
    this.allowedCommands = new Set(
      allowedCommands.map((command) => command.toLowerCase()),
    );
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.defaultMaxOutputBytes = defaultMaxOutputBytes;
  }

  validateInput({ command, args, cwd, env, timeoutMs, maxOutputBytes }) {
    if (typeof command !== 'string' || command.trim() === '') {
      throw new TypeError('command must be a non-empty string');
    }

    const executableName = path.basename(command).toLowerCase();

    if (!this.allowedCommands.has(executableName)) {
      throw new Error(`Command is not allowed: ${executableName}`);
    }

    if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
      throw new TypeError('args must be an array of strings');
    }

    if (typeof cwd !== 'string' || cwd.trim() === '') {
      throw new TypeError('cwd must be a non-empty string');
    }

    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      throw new TypeError('env must be an object');
    }

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new TypeError('timeoutMs must be a positive integer');
    }

    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
      throw new TypeError('maxOutputBytes must be a positive integer');
    }
  }

  runProcess({
    command,
    args = [],
    cwd,
    env = {},
    timeoutMs = this.defaultTimeoutMs,
    maxOutputBytes = this.defaultMaxOutputBytes,
  }) {
    this.validateInput({
      command,
      args,
      cwd,
      env,
      timeoutMs,
      maxOutputBytes,
    });

    return new Promise((resolve) => {
      const stdoutChunks = [];
      const stderrChunks = [];
      let capturedBytes = 0;
      let outputTruncated = false;
      let timedOut = false;
      let settled = false;
      let processError = null;
      let timeoutHandle;
      let forceKillHandle;
      let child;

      const appendOutput = (chunks, data) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const remainingBytes = maxOutputBytes - capturedBytes;

        if (remainingBytes <= 0) {
          outputTruncated = true;
          return;
        }

        const capturedChunk = buffer.subarray(0, remainingBytes);
        chunks.push(capturedChunk);
        capturedBytes += capturedChunk.length;

        if (capturedChunk.length < buffer.length) {
          outputTruncated = true;
        }
      };

      const finish = (exitCode, signal = null) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutHandle);
        clearTimeout(forceKillHandle);

        resolve({
          command,
          args: [...args],
          cwd,
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          signal,
          timedOut,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          outputTruncated,
          error: processError?.message || null,
        });
      };

      try {
        child = this.spawnImpl(command, args, {
          cwd,
          shell: false,
          windowsHide: true,
          env: {
            ...process.env,
            ...env,
          },
        });
      } catch (error) {
        processError = error;
        appendOutput(stderrChunks, `Process failed to start: ${error.message}`);
        finish(null);
        return;
      }

      child.stdout?.on('data', (data) => appendOutput(stdoutChunks, data));
      child.stderr?.on('data', (data) => appendOutput(stderrChunks, data));

      child.once('error', (error) => {
        processError = error;
        appendOutput(stderrChunks, `Process error: ${error.message}`);

        if (!child.pid) {
          finish(null);
        }
      });

      child.once('close', (exitCode, signal) => finish(exitCode, signal));
      child.stdin?.end();

      timeoutHandle = setTimeout(() => {
        timedOut = true;

        try {
          child.kill();
          forceKillHandle = setTimeout(() => {
            try {
              this.processTreeKiller(child);
            } catch {
              // Best effort only. Full process-tree isolation arrives in Phase 11.
            }
          }, 1_000);
        } catch (error) {
          processError = error;
          appendOutput(stderrChunks, `Process termination failed: ${error.message}`);
        }
      }, timeoutMs);
    });
  }
}

const processRunnerService = new ProcessRunner();

module.exports = {
  DEFAULT_ALLOWED_COMMANDS,
  ProcessRunner,
  killProcessTree,
  processRunnerService,
};
