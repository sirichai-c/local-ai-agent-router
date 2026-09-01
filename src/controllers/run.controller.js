const { config } = require('../config/env');
const { sendValidationError } = require('./task.controller');
const {
  CompetitionValidationError,
  normalizeAgentIds,
} = require('../services/competition.service');
const {
  RunStartError,
  runCoordinatorService,
} = require('../services/run-coordinator.service');
const { runSessionService } = require('../services/run-session.service');

function validateTaskInput(body) {
  const { task, workspace } = body || {};
  return typeof task === 'string' && task.trim() !== ''
    && typeof workspace === 'string' && workspace.trim() !== '';
}

function sendRunError(response, error) {
  if (error instanceof RunStartError) {
    response.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return true;
  }

  return sendValidationError(response, error);
}

function createRunController({
  coordinator = runCoordinatorService,
  sessions = runSessionService,
  heartbeatMs = config.realtime.heartbeatMs,
} = {}) {
  async function startExecution(request, response) {
    if (!validateTaskInput(request.body)) {
      response.status(400).json({ error: 'task and workspace are required' });
      return;
    }

    try {
      const session = await coordinator.startSingle({
        task: request.body.task,
        workspace: request.body.workspace,
      });
      response.status(202).json({
        runId: session.id,
        type: session.type,
        state: session.state,
      });
    } catch (error) {
      if (sendRunError(response, error)) return;
      console.error('Unable to start real-time execution:', error.message);
      response.status(500).json({
        error: 'Unable to start real-time execution',
        code: 'RUN_START_FAILED',
      });
    }
  }

  async function startCompetition(request, response) {
    if (!validateTaskInput(request.body)) {
      response.status(400).json({ error: 'task and workspace are required' });
      return;
    }

    let agentIds;

    try {
      agentIds = normalizeAgentIds(request.body.agents);
      if (agentIds && agentIds.length > config.competition.maxAgents) {
        throw new CompetitionValidationError(
          `A competition supports at most ${config.competition.maxAgents} agents`,
          'TOO_MANY_AGENTS',
        );
      }
    } catch (error) {
      if (sendRunError(response, error)) return;
      throw error;
    }

    try {
      const session = await coordinator.startCompetition({
        task: request.body.task,
        workspace: request.body.workspace,
        agentIds,
      });
      response.status(202).json({
        runId: session.id,
        type: session.type,
        state: session.state,
      });
    } catch (error) {
      if (sendRunError(response, error)) return;
      console.error('Unable to start real-time competition:', error.message);
      response.status(500).json({
        error: 'Unable to start real-time competition',
        code: 'RUN_START_FAILED',
      });
    }
  }

  function getRun(request, response) {
    const snapshot = sessions.snapshot(request.params.runId);

    if (!snapshot) {
      response.status(404).json({
        error: 'Run session not found',
        code: 'RUN_NOT_FOUND',
      });
      return;
    }

    response.status(200).json(snapshot);
  }

  function streamEvents(request, response) {
    const snapshot = sessions.snapshot(request.params.runId);

    if (!snapshot) {
      response.status(404).json({
        error: 'Run session not found',
        code: 'RUN_NOT_FOUND',
      });
      return;
    }

    const rawLastEventId = request.get('last-event-id');
    const lastEventId = rawLastEventId === undefined || rawLastEventId === ''
      ? 0
      : Number(rawLastEventId);

    if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) {
      response.status(400).json({
        error: 'Last-Event-ID must be a non-negative integer',
        code: 'INVALID_LAST_EVENT_ID',
      });
      return;
    }

    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders?.();
    response.write('retry: 3000\n\n');

    const writeEvent = (event) => {
      response.write(`id: ${event.id}\n`);
      response.write('event: run_event\n');
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = sessions.subscribe(request.params.runId, writeEvent);
    const oldestEventId = sessions.oldestEventId(request.params.runId);

    if (oldestEventId !== null && lastEventId < oldestEventId - 1) {
      writeEvent({
        id: snapshot.lastEventId,
        runId: snapshot.id,
        timestamp: new Date().toISOString(),
        type: 'session_snapshot',
        stage: snapshot.currentStage,
        status: snapshot.state,
        messageKey: 'run.snapshot',
        data: { snapshot },
      });
    } else {
      for (const event of sessions.eventsAfter(request.params.runId, lastEventId)) {
        writeEvent(event);
      }
    }

    const heartbeat = setInterval(() => {
      response.write(`: heartbeat ${Date.now()}\n\n`);
    }, heartbeatMs);
    heartbeat.unref?.();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.on('close', cleanup);
    response.on('close', cleanup);
  }

  return {
    getRun,
    startCompetition,
    startExecution,
    streamEvents,
  };
}

const runController = createRunController();

module.exports = {
  createRunController,
  runController,
  sendRunError,
  validateTaskInput,
};
