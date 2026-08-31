const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const DEFAULT_PORT = 3000;
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';
const DEFAULT_AGENT_PROCESS_TIMEOUT_MS = 600_000;
const DEFAULT_AGENT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_AGENT_EXECUTION_BACKEND = 'docker';
const DEFAULT_AGENT_SANDBOX_IMAGE = 'local-agent-router/agent-sandbox:1';
const DEFAULT_EVALUATOR_MAX_CHANGED_FILES = 50;
const DEFAULT_EVALUATOR_MAX_DIFF_BYTES = 524_288;
const DEFAULT_COMPETITION_MAX_AGENTS = 3;
const DEFAULT_COMPETITION_EXECUTION_MODE = 'sequential';
const DEFAULT_COMPETITION_QUALITY_WEIGHT = 0.70;
const DEFAULT_COMPETITION_ROUTER_WEIGHT = 0.20;
const DEFAULT_COMPETITION_SPEED_WEIGHT = 0.10;
const DEFAULT_DATABASE_PATH = './data/agent-router.db';
const DEFAULT_ADAPTIVE_STATIC_WEIGHT = 0.50;
const DEFAULT_ADAPTIVE_HISTORY_WEIGHT = 0.30;
const DEFAULT_ADAPTIVE_RECENT_WEIGHT = 0.20;
const DEFAULT_ADAPTIVE_MIN_SAMPLES = 3;
const DEFAULT_ADAPTIVE_RECENT_SAMPLE_SIZE = 10;
const DEFAULT_SANDBOX_IMAGE = 'local-agent-router/node-sandbox:1';
const DEFAULT_SANDBOX_MEMORY = '2g';
const DEFAULT_SANDBOX_CPUS = 2;
const DEFAULT_SANDBOX_PIDS_LIMIT = 256;
const DEFAULT_SANDBOX_TIMEOUT_MS = 300_000;
const DEFAULT_SANDBOX_INSTALL_TIMEOUT_MS = 300_000;
const DEFAULT_SANDBOX_RUN_ROOT = './.sandbox-runs';

function parsePort(value) {
  if (value === undefined || value === '') {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}

function parseBaseUrl(value) {
  const configuredValue = value?.trim() || DEFAULT_OLLAMA_BASE_URL;
  let url;

  try {
    url = new URL(configuredValue);
  } catch {
    throw new Error('OLLAMA_BASE_URL must be a valid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('OLLAMA_BASE_URL must use http or https');
  }

  return url.toString().replace(/\/$/, '');
}

function parseModel(value) {
  return value?.trim() || DEFAULT_OLLAMA_MODEL;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  return value === 'true';
}

function parsePositiveInteger(value, defaultValue, variableName) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${variableName} must be a positive integer`);
  }

  return parsedValue;
}

function parseOptionalPath(value) {
  return value?.trim() || null;
}

function parseDatabasePath(value) {
  if (value === undefined) {
    return DEFAULT_DATABASE_PATH;
  }

  const databasePath = value.trim();

  if (!databasePath) {
    throw new Error('DATABASE_PATH must be a non-empty string');
  }

  return databasePath;
}

function parseNonNegativeNumber(value, defaultValue, variableName) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`${variableName} must be a non-negative number`);
  }

  return parsedValue;
}

function parsePositiveNumber(value, defaultValue, variableName) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${variableName} must be a positive number`);
  }

  return parsedValue;
}

function parseSandboxImage(value, variableName = 'SANDBOX_IMAGE') {
  const image = value?.trim() || DEFAULT_SANDBOX_IMAGE;

  if (image.startsWith('-') || !/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$/u.test(image)) {
    throw new Error(`${variableName} must be a valid Docker image reference`);
  }

  return image;
}

function parseDockerMemory(value) {
  const memory = value?.trim().toLowerCase() || DEFAULT_SANDBOX_MEMORY;

  if (!/^\d+(?:\.\d+)?[bkmg]$/u.test(memory)) {
    throw new Error('SANDBOX_MEMORY must be a positive Docker memory value');
  }

  return memory;
}

function parseAgentExecutionBackend(value) {
  const backend = value?.trim().toLowerCase()
    || DEFAULT_AGENT_EXECUTION_BACKEND;

  if (!['host', 'docker', 'sbx'].includes(backend)) {
    throw new Error('AGENT_EXECUTION_BACKEND must be host, docker, or sbx');
  }

  return backend;
}

function parseCompetitionExecutionMode(value) {
  const mode = value?.trim() || DEFAULT_COMPETITION_EXECUTION_MODE;

  if (mode !== 'sequential') {
    throw new Error(
      'COMPETITION_EXECUTION_MODE must be sequential in Phase 8',
    );
  }

  return mode;
}

function validateCompetitionWeights(weights, tolerance = 1e-9) {
  const total = weights.quality + weights.router + weights.speed;

  if (Math.abs(total - 1) > tolerance) {
    throw new Error('Competition weights must sum to 1.0');
  }

  return Object.freeze(weights);
}

function validateAdaptiveWeights(weights, tolerance = 1e-9) {
  const total = weights.static + weights.history + weights.recent;

  if (Math.abs(total - 1) > tolerance) {
    throw new Error('Adaptive routing weights must sum to 1.0');
  }

  return Object.freeze(weights);
}

const competitionWeights = validateCompetitionWeights({
  quality: parseNonNegativeNumber(
    process.env.COMPETITION_QUALITY_WEIGHT,
    DEFAULT_COMPETITION_QUALITY_WEIGHT,
    'COMPETITION_QUALITY_WEIGHT',
  ),
  router: parseNonNegativeNumber(
    process.env.COMPETITION_ROUTER_WEIGHT,
    DEFAULT_COMPETITION_ROUTER_WEIGHT,
    'COMPETITION_ROUTER_WEIGHT',
  ),
  speed: parseNonNegativeNumber(
    process.env.COMPETITION_SPEED_WEIGHT,
    DEFAULT_COMPETITION_SPEED_WEIGHT,
    'COMPETITION_SPEED_WEIGHT',
  ),
});

const adaptiveWeights = validateAdaptiveWeights({
  static: parseNonNegativeNumber(
    process.env.ADAPTIVE_STATIC_WEIGHT,
    DEFAULT_ADAPTIVE_STATIC_WEIGHT,
    'ADAPTIVE_STATIC_WEIGHT',
  ),
  history: parseNonNegativeNumber(
    process.env.ADAPTIVE_HISTORY_WEIGHT,
    DEFAULT_ADAPTIVE_HISTORY_WEIGHT,
    'ADAPTIVE_HISTORY_WEIGHT',
  ),
  recent: parseNonNegativeNumber(
    process.env.ADAPTIVE_RECENT_WEIGHT,
    DEFAULT_ADAPTIVE_RECENT_WEIGHT,
    'ADAPTIVE_RECENT_WEIGHT',
  ),
});

const config = Object.freeze({
  port: parsePort(process.env.PORT),
  serviceName: 'local-ai-agent-router',
  ollama: Object.freeze({
    baseUrl: parseBaseUrl(process.env.OLLAMA_BASE_URL),
    model: parseModel(process.env.OLLAMA_MODEL),
  }),
  agentExecution: Object.freeze({
    enabled: parseBoolean(process.env.AGENT_EXECUTION_ENABLED),
    backend: parseAgentExecutionBackend(
      process.env.AGENT_EXECUTION_BACKEND,
    ),
    sandboxImage: parseSandboxImage(
      process.env.AGENT_SANDBOX_IMAGE || DEFAULT_AGENT_SANDBOX_IMAGE,
      'AGENT_SANDBOX_IMAGE',
    ),
    timeoutMs: parsePositiveInteger(
      process.env.AGENT_PROCESS_TIMEOUT_MS,
      DEFAULT_AGENT_PROCESS_TIMEOUT_MS,
      'AGENT_PROCESS_TIMEOUT_MS',
    ),
    maxOutputBytes: parsePositiveInteger(
      process.env.AGENT_MAX_OUTPUT_BYTES,
      DEFAULT_AGENT_MAX_OUTPUT_BYTES,
      'AGENT_MAX_OUTPUT_BYTES',
    ),
    worktreeRoot: parseOptionalPath(process.env.AGENT_WORKTREE_ROOT),
  }),
  evaluator: Object.freeze({
    runProjectScripts: parseBoolean(
      process.env.EVALUATOR_RUN_PROJECT_SCRIPTS,
    ),
    maxChangedFiles: parsePositiveInteger(
      process.env.EVALUATOR_MAX_CHANGED_FILES,
      DEFAULT_EVALUATOR_MAX_CHANGED_FILES,
      'EVALUATOR_MAX_CHANGED_FILES',
    ),
    maxDiffBytes: parsePositiveInteger(
      process.env.EVALUATOR_MAX_DIFF_BYTES,
      DEFAULT_EVALUATOR_MAX_DIFF_BYTES,
      'EVALUATOR_MAX_DIFF_BYTES',
    ),
  }),
  competition: Object.freeze({
    maxAgents: parsePositiveInteger(
      process.env.COMPETITION_MAX_AGENTS,
      DEFAULT_COMPETITION_MAX_AGENTS,
      'COMPETITION_MAX_AGENTS',
    ),
    executionMode: parseCompetitionExecutionMode(
      process.env.COMPETITION_EXECUTION_MODE,
    ),
    weights: competitionWeights,
  }),
  database: Object.freeze({
    path: parseDatabasePath(process.env.DATABASE_PATH),
  }),
  adaptiveRouting: Object.freeze({
    enabled: parseBoolean(process.env.ADAPTIVE_ROUTING_ENABLED, true),
    weights: adaptiveWeights,
    minSamples: parsePositiveInteger(
      process.env.ADAPTIVE_MIN_SAMPLES,
      DEFAULT_ADAPTIVE_MIN_SAMPLES,
      'ADAPTIVE_MIN_SAMPLES',
    ),
    recentSampleSize: parsePositiveInteger(
      process.env.ADAPTIVE_RECENT_SAMPLE_SIZE,
      DEFAULT_ADAPTIVE_RECENT_SAMPLE_SIZE,
      'ADAPTIVE_RECENT_SAMPLE_SIZE',
    ),
  }),
  sandbox: Object.freeze({
    enabled: parseBoolean(process.env.SANDBOX_ENABLED, true),
    image: parseSandboxImage(process.env.SANDBOX_IMAGE),
    memory: parseDockerMemory(process.env.SANDBOX_MEMORY),
    cpus: parsePositiveNumber(
      process.env.SANDBOX_CPUS,
      DEFAULT_SANDBOX_CPUS,
      'SANDBOX_CPUS',
    ),
    pidsLimit: parsePositiveInteger(
      process.env.SANDBOX_PIDS_LIMIT,
      DEFAULT_SANDBOX_PIDS_LIMIT,
      'SANDBOX_PIDS_LIMIT',
    ),
    timeoutMs: parsePositiveInteger(
      process.env.SANDBOX_TIMEOUT_MS,
      DEFAULT_SANDBOX_TIMEOUT_MS,
      'SANDBOX_TIMEOUT_MS',
    ),
    installTimeoutMs: parsePositiveInteger(
      process.env.SANDBOX_INSTALL_TIMEOUT_MS,
      DEFAULT_SANDBOX_INSTALL_TIMEOUT_MS,
      'SANDBOX_INSTALL_TIMEOUT_MS',
    ),
    installDependencies: parseBoolean(
      process.env.SANDBOX_INSTALL_DEPENDENCIES,
      true,
    ),
    keepRuns: parseBoolean(process.env.SANDBOX_KEEP_RUNS),
    runRoot: process.env.SANDBOX_RUN_ROOT?.trim()
      || DEFAULT_SANDBOX_RUN_ROOT,
  }),
});

module.exports = {
  config,
  parseBaseUrl,
  parseAgentExecutionBackend,
  parseBoolean,
  parseDatabasePath,
  parseModel,
  parseCompetitionExecutionMode,
  parseNonNegativeNumber,
  parsePositiveNumber,
  parseOptionalPath,
  parsePort,
  parsePositiveInteger,
  validateAdaptiveWeights,
  validateCompetitionWeights,
  parseDockerMemory,
  parseSandboxImage,
};
