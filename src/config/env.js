const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const DEFAULT_PORT = 3000;
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';
const DEFAULT_AGENT_PROCESS_TIMEOUT_MS = 600_000;
const DEFAULT_AGENT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_EVALUATOR_MAX_CHANGED_FILES = 50;
const DEFAULT_EVALUATOR_MAX_DIFF_BYTES = 524_288;
const DEFAULT_COMPETITION_MAX_AGENTS = 3;
const DEFAULT_COMPETITION_EXECUTION_MODE = 'sequential';
const DEFAULT_COMPETITION_QUALITY_WEIGHT = 0.70;
const DEFAULT_COMPETITION_ROUTER_WEIGHT = 0.20;
const DEFAULT_COMPETITION_SPEED_WEIGHT = 0.10;

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

const config = Object.freeze({
  port: parsePort(process.env.PORT),
  serviceName: 'local-ai-agent-router',
  ollama: Object.freeze({
    baseUrl: parseBaseUrl(process.env.OLLAMA_BASE_URL),
    model: parseModel(process.env.OLLAMA_MODEL),
  }),
  agentExecution: Object.freeze({
    enabled: parseBoolean(process.env.AGENT_EXECUTION_ENABLED),
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
});

module.exports = {
  config,
  parseBaseUrl,
  parseBoolean,
  parseModel,
  parseCompetitionExecutionMode,
  parseNonNegativeNumber,
  parseOptionalPath,
  parsePort,
  parsePositiveInteger,
  validateCompetitionWeights,
};
