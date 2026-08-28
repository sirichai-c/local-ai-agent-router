const {
  WorkspaceValidationError,
  agentPlannerService,
} = require('../services/agent-planner.service');
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

async function planTask(request, response) {
  const { task, workspace } = request.body || {};
  const validTask = typeof task === 'string' && task.trim() !== '';
  const validWorkspace = typeof workspace === 'string' && workspace.trim() !== '';

  if (!validTask || !validWorkspace) {
    response.status(400).json({
      error: 'task and workspace are required',
    });
    return;
  }

  try {
    const plan = await agentPlannerService.planTask({ task, workspace });
    response.status(200).json(plan);
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      response.status(400).json({
        error: error.message,
        code: error.code,
      });
      return;
    }

    console.error('Agent planning failed:', error.message);
    response.status(500).json({
      error: 'Unable to plan agent execution',
    });
  }
}

module.exports = { analyzeTask, planTask };
