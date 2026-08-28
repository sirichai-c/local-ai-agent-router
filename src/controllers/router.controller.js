const { routerService } = require('../services/router.service');

async function analyzeTask(request, response) {
  const { task } = request.body || {};

  if (typeof task !== 'string' || task.trim() === '') {
    response.status(400).json({
      error: 'task is required',
    });
    return;
  }

  try {
    const analysis = await routerService.analyzeTask(task);
    response.status(200).json(analysis);
  } catch (error) {
    console.error('Task routing failed:', error.message);
    response.status(500).json({
      error: 'Unable to analyze task',
    });
  }
}

module.exports = { analyzeTask };
