const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const agentRoutes = require('./routes/agent.routes');
const healthRoutes = require('./routes/health.routes');
const historyRoutes = require('./routes/history.routes');
const ollamaRoutes = require('./routes/ollama.routes');
const performanceRoutes = require('./routes/performance.routes');
const routerRoutes = require('./routes/router.routes');
const taskRoutes = require('./routes/task.routes');

function createApp({
  frontendDistPath = path.resolve(__dirname, '..', 'web', 'dist'),
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRoutes);
  app.use('/api', ollamaRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api/performance', performanceRoutes);
  app.use('/api/router', routerRoutes);
  app.use('/api/tasks', taskRoutes);

  const frontendIndex = path.join(frontendDistPath, 'index.html');

  if (fs.existsSync(frontendIndex)) {
    app.use(express.static(frontendDistPath, { index: false }));
    app.use((request, response, next) => {
      if (request.method !== 'GET'
        || request.path.startsWith('/api')
        || request.path === '/health'
        || !request.get('accept')?.includes('text/html')) {
        next();
        return;
      }

      response.sendFile(frontendIndex);
    });
  }

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
