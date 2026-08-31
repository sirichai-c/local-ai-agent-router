const fs = require('node:fs/promises');
const path = require('node:path');

const { config } = require('../config/env');
const { getSandboxAgent } = require('../config/sandbox-agents');
const { isInsideWorkspace } = require('../utils/workspace-path.util');
const { processRunnerService } = require('./process-runner.service');
const {
  pathsReferToSameLocation,
  sanitizeAgentId,
  worktreeService,
} = require('./worktree.service');

const AGENT_CONTAINER_ENVIRONMENT = Object.freeze({
  CI: 'true',
  HOME: '/tmp',
  XDG_CONFIG_HOME: '/tmp',
  XDG_DATA_HOME: '/tmp',
  XDG_CACHE_HOME: '/tmp',
});

class AgentSandboxError extends Error {
  constructor(message, code = 'AGENT_SANDBOX_ERROR') {
    super(message);
    this.name = 'AgentSandboxError';
    this.code = code;
    this.statusCode = 503;
  }
}

function toContainerOllamaUrl(baseUrl) {
  const url = new URL(baseUrl);

  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.hostname = 'host.docker.internal';
  }

  return url.toString().replace(/\/$/u, '');
}

function validateAgentEnvironment(agentConfig, environment = {}) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new TypeError('Agent invocation environment must be an object');
  }

  const allowed = new Set(agentConfig.environment);
  const validated = {};

  for (const [key, value] of Object.entries(environment)) {
    if (!allowed.has(key)) {
      throw new AgentSandboxError(
        `Agent environment key is not allowed in sandbox: ${key}`,
        'AGENT_SANDBOX_ENV_NOT_ALLOWED',
      );
    }

    if (typeof value !== 'string') {
      throw new TypeError('Agent sandbox environment values must be strings');
    }

    validated[key] = value;
  }

  return validated;
}

class SandboxAgentRunnerService {
  constructor({
    runner = processRunnerService,
    worktrees = worktreeService,
    image = config.agentExecution.sandboxImage,
    memory = config.sandbox.memory,
    cpus = config.sandbox.cpus,
    pidsLimit = config.sandbox.pidsLimit,
    timeoutMs = config.agentExecution.timeoutMs,
    maxOutputBytes = config.agentExecution.maxOutputBytes,
    dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker',
    availabilityTtlMs = 30_000,
    clock = () => Date.now(),
  } = {}) {
    this.runner = runner;
    this.worktrees = worktrees;
    this.image = image;
    this.memory = memory;
    this.cpus = cpus;
    this.pidsLimit = pidsLimit;
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.dockerCommand = dockerCommand;
    this.availabilityTtlMs = availabilityTtlMs;
    this.clock = clock;
    this.cachedAvailability = null;
  }

  async inspectImage({ force = false } = {}) {
    const now = this.clock();

    if (!force && this.cachedAvailability
      && now - this.cachedAvailability.checkedAt < this.availabilityTtlMs) {
      return this.cachedAvailability;
    }

    const result = await this.runner.runProcess({
      command: this.dockerCommand,
      args: ['image', 'inspect', this.image],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
    });
    this.cachedAvailability = {
      available: result.exitCode === 0 && !result.timedOut,
      backend: 'docker',
      image: this.image,
      reason: result.exitCode === 0 ? null : 'agent_sandbox_image_unavailable',
      checkedAt: now,
    };

    return this.cachedAvailability;
  }

  async getCapability(agentId) {
    const agentConfig = getSandboxAgent(agentId);

    if (!agentConfig) {
      return {
        available: false,
        backend: 'docker',
        image: this.image,
        command: null,
        reason: 'agent_not_in_sandbox_image',
      };
    }

    const image = await this.inspectImage();
    return {
      ...image,
      command: agentConfig.command,
    };
  }

  async assertAvailable(agentId) {
    const capability = await this.getCapability(agentId);

    if (!capability.available) {
      throw new AgentSandboxError(
        `Docker sandbox is unavailable for ${agentId}: ${capability.reason}`,
        'AGENT_SANDBOX_UNAVAILABLE',
      );
    }

    return capability;
  }

  async validateWorktree(agent, worktree) {
    if (!worktree?.repo || !worktree.worktreePath || !worktree.taskId) {
      throw new AgentSandboxError(
        'Agent sandbox requires a generated worktree context.',
        'AGENT_SANDBOX_WORKTREE_INVALID',
      );
    }

    const agentId = sanitizeAgentId(agent.id);
    const expectedName = `${worktree.taskId}-${agentId}`;
    const root = path.resolve(this.worktrees.getWorktreeRoot(worktree.repo));
    const expected = path.resolve(root, expectedName);
    const supplied = path.resolve(worktree.worktreePath);
    let realRoot;
    let realWorktree;

    try {
      [realRoot, realWorktree] = await Promise.all([
        fs.realpath(root),
        fs.realpath(supplied),
      ]);
    } catch {
      throw new AgentSandboxError(
        'Agent sandbox worktree path could not be verified.',
        'AGENT_SANDBOX_WORKTREE_INVALID',
      );
    }

    if (supplied.includes(',')
      || !isInsideWorkspace(realRoot, realWorktree)
      || realWorktree === realRoot
      || !await pathsReferToSameLocation(expected, supplied)) {
      throw new AgentSandboxError(
        'Agent sandbox mount does not match the generated worktree policy.',
        'AGENT_SANDBOX_WORKTREE_INVALID',
      );
    }

    return realWorktree;
  }

  buildDockerArgs({
    name,
    workspace,
    command,
    args,
    environment,
  }) {
    const dockerArgs = [
      'run',
      '--name', name,
      '--rm',
      '--init',
      '--memory', this.memory,
      '--cpus', String(this.cpus),
      '--pids-limit', String(this.pidsLimit),
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--read-only',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=1g',
      '--network', 'bridge',
      '--add-host', 'host.docker.internal:host-gateway',
      '--mount', `type=bind,source=${workspace},target=/workspace`,
      '--workdir', '/workspace',
      '--user', '1000:1000',
    ];

    for (const [key, value] of Object.entries({
      ...AGENT_CONTAINER_ENVIRONMENT,
      ...environment,
    })) {
      dockerArgs.push('--env', `${key}=${value}`);
    }

    dockerArgs.push(this.image, command, ...args);
    return dockerArgs;
  }

  async removeContainer(name) {
    return this.runner.runProcess({
      command: this.dockerCommand,
      args: ['rm', '--force', name],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
    });
  }

  async runContainer({ name, workspace, command, args, environment, timeoutMs }) {
    const dockerArgs = this.buildDockerArgs({
      name,
      workspace,
      command,
      args,
      environment,
    });
    let result;

    try {
      result = await this.runner.runProcess({
        command: this.dockerCommand,
        args: dockerArgs,
        cwd: process.cwd(),
        env: {},
        timeoutMs,
        maxOutputBytes: this.maxOutputBytes,
      });
    } finally {
      await this.removeContainer(name);
    }

    return result;
  }

  async verifyOllama({ worktree, ollamaBaseUrl }) {
    const endpoint = `${toContainerOllamaUrl(ollamaBaseUrl)}/api/tags`;
    const name = `lar-agent-${worktree.taskId}-ollama`;
    const script = [
      "fetch(process.argv[1])",
      ".then((response) => { if (!response.ok) throw new Error('bad status'); return response.json(); })",
      ".then(() => process.stdout.write('ollama-ok'))",
      ".catch(() => { process.exitCode = 2; });",
    ].join('');
    const result = await this.runContainer({
      name,
      workspace: worktree.worktreePath,
      command: 'node',
      args: ['-e', script, endpoint],
      environment: {},
      timeoutMs: 30_000,
    });

    if (result.exitCode !== 0 || result.timedOut) {
      throw new AgentSandboxError(
        'Agent sandbox cannot reach the configured host Ollama endpoint.',
        'AGENT_SANDBOX_OLLAMA_UNAVAILABLE',
      );
    }

    return endpoint;
  }

  async run({ invocation, agent, worktree, ollamaBaseUrl }) {
    const agentConfig = getSandboxAgent(agent.id);
    await this.assertAvailable(agent.id);
    const workspace = await this.validateWorktree(agent, worktree);

    if (invocation.command !== agentConfig.command) {
      throw new AgentSandboxError(
        'Adapter command does not match the trusted sandbox command.',
        'AGENT_SANDBOX_COMMAND_INVALID',
      );
    }

    if (!Array.isArray(invocation.args)
      || invocation.args.some((argument) => typeof argument !== 'string')) {
      throw new TypeError('Agent invocation args must be strings');
    }

    const environment = validateAgentEnvironment(agentConfig, invocation.env);
    const verifiedWorktree = {
      ...worktree,
      worktreePath: workspace,
    };
    const ollamaEndpoint = await this.verifyOllama({
      worktree: verifiedWorktree,
      ollamaBaseUrl,
    });
    const name = `lar-agent-${worktree.taskId}-${sanitizeAgentId(agent.id)}`;
    const result = await this.runContainer({
      name,
      workspace,
      command: agentConfig.command,
      args: invocation.args,
      environment,
      timeoutMs: invocation.timeoutMs || this.timeoutMs,
    });

    return {
      ...result,
      sandbox: {
        backend: 'docker',
        image: this.image,
        containerName: name,
        network: 'bridge',
        ollamaEndpoint,
        ollamaVerified: true,
        worktreeMount: '/workspace',
      },
    };
  }
}

const sandboxAgentRunnerService = new SandboxAgentRunnerService();

module.exports = {
  AGENT_CONTAINER_ENVIRONMENT,
  AgentSandboxError,
  SandboxAgentRunnerService,
  sandboxAgentRunnerService,
  toContainerOllamaUrl,
  validateAgentEnvironment,
};
