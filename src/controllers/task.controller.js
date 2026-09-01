const {
  RepositoryValidationError,
  WorkspaceValidationError,
  agentExecutorService,
} = require('../services/agent-executor.service');
const {
  CompetitionValidationError,
  competitionService,
} = require('../services/competition.service');
const {
  HistoryPersistenceError,
} = require('../services/history.service');
const {
  CandidateReviewError,
  candidateReviewService,
} = require('../services/candidate-review.service');
const {
  ApprovalError,
  approvalService,
} = require('../services/approval.service');
const {
  AgentExecutionBackendError,
} = require('../services/agent-execution-backend.service');
const {
  AgentSandboxError,
} = require('../services/sandbox-agent-runner.service');

function sendValidationError(response, error) {
  if (error instanceof WorkspaceValidationError) {
    response.status(400).json({ error: error.message, code: error.code });
    return true;
  }

  if (error instanceof RepositoryValidationError) {
    const statusCode = error.code === 'REPOSITORY_NOT_CLEAN' ? 409 : 400;
    response.status(statusCode).json({ error: error.message, code: error.code });
    return true;
  }

  if (error instanceof CompetitionValidationError) {
    response.status(400).json({ error: error.message, code: error.code });
    return true;
  }

  if (error instanceof HistoryPersistenceError) {
    response.status(500).json({
      error: error.message,
      code: error.code,
    });
    return true;
  }

  if (error instanceof CandidateReviewError || error instanceof ApprovalError) {
    response.status(error.statusCode || 409).json({
      error: error.message,
      code: error.code,
    });
    return true;
  }

  if (error instanceof AgentExecutionBackendError
    || error instanceof AgentSandboxError) {
    response.status(error.statusCode || 503).json({
      error: error.message,
      code: error.code,
    });
    return true;
  }

  return false;
}

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
    if (sendValidationError(response, error)) {
      return;
    }

    console.error('Agent execution failed:', error.message);
    response.status(500).json({ error: 'Unable to execute agent task' });
  }
}

async function competeTask(request, response) {
  const { task, workspace, agents } = request.body || {};
  const validTask = typeof task === 'string' && task.trim() !== '';
  const validWorkspace = typeof workspace === 'string' && workspace.trim() !== '';

  if (!validTask || !validWorkspace) {
    response.status(400).json({
      error: 'task and workspace are required',
    });
    return;
  }

  if (agents !== undefined && !Array.isArray(agents)) {
    response.status(400).json({
      error: 'agents must be an array of agent IDs',
      code: 'INVALID_AGENT_LIST',
    });
    return;
  }

  try {
    const result = await competitionService.compete({
      task,
      workspace,
      agentIds: agents,
    });
    response.status(200).json(result);
  } catch (error) {
    if (sendValidationError(response, error)) {
      return;
    }

    console.error('Agent competition failed:', error.message);
    response.status(500).json({ error: 'Unable to run agent competition' });
  }
}

async function getCandidate(request, response) {
  try {
    response.status(200).json(
      await candidateReviewService.review(request.params.id),
    );
  } catch (error) {
    if (sendValidationError(response, error)) {
      return;
    }

    console.error('Candidate review failed:', error.message);
    response.status(500).json({ error: 'Unable to review task candidate' });
  }
}

async function approveTask(request, response) {
  const { expectedFingerprint } = request.body || {};

  if (typeof expectedFingerprint !== 'string'
    || expectedFingerprint.trim() === '') {
    response.status(400).json({
      error: 'expectedFingerprint is required',
      code: 'invalid_expected_fingerprint',
    });
    return;
  }

  try {
    response.status(200).json(
      await approvalService.approve(
        request.params.id,
        expectedFingerprint.trim(),
      ),
    );
  } catch (error) {
    if (sendValidationError(response, error)) {
      return;
    }

    console.error('Candidate approval failed:', error.message);
    response.status(500).json({ error: 'Unable to approve task candidate' });
  }
}

async function rejectTask(request, response) {
  try {
    response.status(200).json(
      await approvalService.reject(request.params.id),
    );
  } catch (error) {
    if (sendValidationError(response, error)) {
      return;
    }

    console.error('Candidate rejection failed:', error.message);
    response.status(500).json({ error: 'Unable to reject task candidate' });
  }
}

module.exports = {
  approveTask,
  competeTask,
  executeTask,
  getCandidate,
  rejectTask,
  sendValidationError,
};
