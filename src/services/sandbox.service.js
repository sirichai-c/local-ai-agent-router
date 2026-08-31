const fs = require('node:fs/promises');
const path = require('node:path');

const { config } = require('../config/env');
const { isInsideWorkspace } = require('../utils/workspace-path.util');
const { processRunnerService } = require('./process-runner.service');

const CONTAINER_COMMANDS = Object.freeze(new Set(['node', 'npm']));
const CONTAINER_ENVIRONMENT = Object.freeze({
  CI: 'true',
  HOME: '/tmp/home',
  npm_config_cache: '/tmp/npm-cache',
});

class SandboxError extends Error {
  constructor(message, code = 'SANDBOX_ERROR') {
    super(message);
    this.name = 'SandboxError';
    this.code = code;
  }
}

function validateContainerName(name) {
  if (typeof name !== 'string'
    || !/^[a-z0-9][a-z0-9_.-]{2,62}$/u.test(name)) {
    throw new SandboxError('Docker container name is invalid.', 'INVALID_CONTAINER_NAME');
  }

  return name;
}

function validateMountPath(mountPath) {
  if (mountPath.includes(',')) {
    throw new SandboxError(
      'Docker bind source paths containing commas are not supported safely.',
      'UNSAFE_DOCKER_MOUNT_PATH',
    );
  }

  return mountPath;
}

class SandboxService {
  constructor({
    runner = processRunnerService,
    enabled = config.sandbox.enabled,
    image = config.sandbox.image,
    memory = config.sandbox.memory,
    cpus = config.sandbox.cpus,
    pidsLimit = config.sandbox.pidsLimit,
    timeoutMs = config.sandbox.timeoutMs,
    runRoot = config.sandbox.runRoot,
    cwd = process.cwd(),
    dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker',
  } = {}) {
    this.runner = runner;
    this.enabled = enabled;
    this.image = image;
    this.memory = memory;
    this.cpus = cpus;
    this.pidsLimit = pidsLimit;
    this.timeoutMs = timeoutMs;
    this.runRoot = path.resolve(cwd, runRoot);
    this.dockerCommand = dockerCommand;
  }

  async inspectAvailability() {
    if (!this.enabled) {
      return { available: false, reason: 'sandbox_disabled' };
    }

    const result = await this.runner.runProcess({
      command: this.dockerCommand,
      args: ['image', 'inspect', this.image],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
    });

    return {
      available: result.exitCode === 0 && !result.timedOut,
      reason: result.exitCode === 0 ? null : 'sandbox_image_unavailable',
      image: this.image,
    };
  }

  async resolveSnapshotPath(snapshotPath) {
    const realRunRoot = await fs.realpath(this.runRoot);
    const realSnapshot = await fs.realpath(path.resolve(snapshotPath));
    const snapshotStat = await fs.lstat(realSnapshot);

    if (!snapshotStat.isDirectory()
      || snapshotStat.isSymbolicLink()
      || !isInsideWorkspace(realRunRoot, realSnapshot)
      || realSnapshot === realRunRoot) {
      throw new SandboxError(
        'Sandbox mount must be a snapshot under SANDBOX_RUN_ROOT.',
        'UNSAFE_SANDBOX_MOUNT',
      );
    }

    return validateMountPath(realSnapshot);
  }

  buildRunArgs({
    containerName,
    snapshotPath,
    command,
    args,
    network,
  }) {
    if (!CONTAINER_COMMANDS.has(command)) {
      throw new SandboxError(
        `Container command is not allowed: ${command}`,
        'CONTAINER_COMMAND_NOT_ALLOWED',
      );
    }

    if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
      throw new TypeError('Container args must be an array of strings');
    }

    if (!['bridge', 'none'].includes(network)) {
      throw new SandboxError('Container network policy is invalid.', 'INVALID_NETWORK_POLICY');
    }

    const dockerArgs = [
      'run',
      '--name', validateContainerName(containerName),
      '--rm',
      '--init',
      '--memory', this.memory,
      '--cpus', String(this.cpus),
      '--pids-limit', String(this.pidsLimit),
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--read-only',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
      '--network', network,
      '--mount', `type=bind,source=${snapshotPath},target=/workspace`,
      '--workdir', '/workspace',
      '--user', '1000:1000',
    ];

    for (const [key, value] of Object.entries(CONTAINER_ENVIRONMENT)) {
      dockerArgs.push('--env', `${key}=${value}`);
    }

    dockerArgs.push(this.image, command, ...args);
    return dockerArgs;
  }

  async removeContainer(containerName) {
    return this.runner.runProcess({
      command: this.dockerCommand,
      args: ['rm', '--force', validateContainerName(containerName)],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
    });
  }

  async run({
    sandboxId,
    snapshotPath,
    command,
    args = [],
    network = 'none',
    timeoutMs = this.timeoutMs,
    purpose = 'check',
  }) {
    if (!this.enabled) {
      throw new SandboxError('Sandbox execution is disabled.', 'SANDBOX_DISABLED');
    }

    const resolvedSnapshot = await this.resolveSnapshotPath(snapshotPath);
    const suffix = String(purpose).toLowerCase().replace(/[^a-z0-9-]/gu, '-');
    const containerName = validateContainerName(`lar-${sandboxId}-${suffix}`);
    const dockerArgs = this.buildRunArgs({
      containerName,
      snapshotPath: resolvedSnapshot,
      command,
      args,
      network,
    });
    let result;

    try {
      result = await this.runner.runProcess({
        command: this.dockerCommand,
        args: dockerArgs,
        cwd: process.cwd(),
        env: {},
        timeoutMs,
      });
    } finally {
      await this.removeContainer(containerName);
    }

    return {
      ...result,
      sandbox: true,
      containerName,
      image: this.image,
      network,
    };
  }
}

const sandboxService = new SandboxService();

module.exports = {
  CONTAINER_COMMANDS,
  CONTAINER_ENVIRONMENT,
  SandboxError,
  SandboxService,
  sandboxService,
  validateContainerName,
  validateMountPath,
};
