const { createApp } = require('./app');
const { config } = require('./config/env');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`${config.serviceName} listening on port ${config.port}`);
});

server.on('error', (error) => {
  console.error('Failed to start HTTP server:', error.message);
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`${signal} received; closing HTTP server`);

  server.close((error) => {
    if (error) {
      console.error('Failed to close HTTP server:', error.message);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
