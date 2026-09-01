const { createApp } = require('./app');
const { config } = require('./config/env');
const { databaseService } = require('./services/database.service');
const { jobManagerService } = require('./services/job-manager.service');

jobManagerService.start();
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`${config.serviceName} listening on port ${config.port}`);
});

server.on('error', (error) => {
  console.error('Failed to start HTTP server:', error.message);
  process.exitCode = 1;
});

let shutdownStarted = false;

async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`${signal} received; closing HTTP server`);
  const managerShutdown = jobManagerService.shutdown();
  void managerShutdown.finally(() => server.closeAllConnections?.());

  server.close(async (error) => {
    await managerShutdown;
    databaseService.close();

    if (error) {
      console.error('Failed to close HTTP server:', error.message);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
