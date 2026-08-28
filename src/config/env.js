const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const DEFAULT_PORT = 3000;

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

const config = Object.freeze({
  port: parsePort(process.env.PORT),
  serviceName: 'local-ai-agent-router',
});

module.exports = { config, parsePort };
