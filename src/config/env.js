const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const DEFAULT_PORT = 3000;
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen3.5:4b';

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

const config = Object.freeze({
  port: parsePort(process.env.PORT),
  serviceName: 'local-ai-agent-router',
  ollama: Object.freeze({
    baseUrl: parseBaseUrl(process.env.OLLAMA_BASE_URL),
    model: parseModel(process.env.OLLAMA_MODEL),
  }),
});

module.exports = { config, parseBaseUrl, parseModel, parsePort };
