const express = require('express');

const agentRoutes = require('./routes/agent.routes');
const healthRoutes = require('./routes/health.routes');
const ollamaRoutes = require('./routes/ollama.routes');
const routerRoutes = require('./routes/router.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRoutes);
  app.use('/api', ollamaRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/router', routerRoutes);

  app.use((request, response) => {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  return app;
}

module.exports = { createApp };
