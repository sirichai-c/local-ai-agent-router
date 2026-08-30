const {
  RepositoryValidationError,
  WorkspaceValidationError,
  agentExecutorService,
} = require('../services/agent-executor.service');

async function executeTask(request, response) {
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
    const result = await agentExecutorService.executeTask({ task, workspace });
    response.status(200).json(result);
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      response.status(400).json({ error: error.message, code: error.code });
      return;
    }

    if (error instanceof RepositoryValidationError) {
      const statusCode = error.code === 'REPOSITORY_NOT_CLEAN' ? 409 : 400;
      response.status(statusCode).json({ error: error.message, code: error.code });
      return;
    }

    console.error('Agent execution failed:', error.message);
    response.status(500).json({ error: 'Unable to execute agent task' });
  }
}

module.exports = { executeTask };
