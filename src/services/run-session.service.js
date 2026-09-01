const crypto = require('node:crypto');

const { config } = require('../config/env');

const RUN_TYPES = Object.freeze(new Set(['single', 'competition']));
const RUN_STATES = Object.freeze(new Set([
  'starting',
  'running',
  'evaluating',
  'completed',
  'failed',
]));
const RUN_STAGES = Object.freeze(new Set([
  'initializing',
  'routing',
  'repository',
  'worktree',
  'agent',
  'evaluation',
  'competition',
  'candidate',
  'complete',
  'failed',
]));
const RUN_EVENT_TYPES = Object.freeze(new Set([
  'run_started',
  'router_analyzing',
  'router_completed',
  'repository_validating',
  'repository_validated',
  'worktree_creating',
  'worktree_created',
  'agent_starting',
  'agent_running',
  'agent_completed',
  'agent_failed',
  'evaluation_starting',
  'static_check',
  'sandbox_check_started',
  'sandbox_check_completed',
  'evaluation_completed',
  'competition_started',
  'competition_candidate_starting',
  'competition_candidate_completed',
  'competition_ranking',
  'candidate_ready',
  'run_completed',
  'run_failed',
]));
const RUN_EVENT_STATUSES = Object.freeze(new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'warning',
]));

class RunSessionError extends Error {
  constructor(message, code = 'RUN_SESSION_ERROR', statusCode = 400) {
    super(message);
    this.name = 'RunSessionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function clonePublic(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('run event must be an object');
  }

  if (!RUN_EVENT_TYPES.has(event.type)) {
    throw new RunSessionError('Run event type is not allowed.', 'RUN_EVENT_TYPE_INVALID');
  }

  if (!RUN_STAGES.has(event.stage)) {
    throw new RunSessionError('Run event stage is not allowed.', 'RUN_EVENT_STAGE_INVALID');
  }

  if (!RUN_EVENT_STATUSES.has(event.status)) {
    throw new RunSessionError('Run event status is not allowed.', 'RUN_EVENT_STATUS_INVALID');
  }

  if (typeof event.messageKey !== 'string'
    || !/^run\.[a-zA-Z0-9.]+$/u.test(event.messageKey)) {
    throw new RunSessionError('Run event messageKey is invalid.', 'RUN_EVENT_MESSAGE_INVALID');
  }

  const data = event.data === undefined ? {} : event.data;

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RunSessionError('Run event data must be an object.', 'RUN_EVENT_DATA_INVALID');
  }

  const serialized = JSON.stringify(data);

  if (Buffer.byteLength(serialized, 'utf8') > 8_192) {
    throw new RunSessionError('Run event data exceeds the safety limit.', 'RUN_EVENT_DATA_TOO_LARGE');
  }

  return { ...event, data: clonePublic(data) };
}

class RunSessionService {
  constructor({
    eventLimit = config.realtime.eventLimit,
    sessionTtlMs = config.realtime.sessionTtlMs,
    idFactory = () => crypto.randomUUID(),
    clock = () => new Date(),
    cleanupIntervalMs = Math.min(sessionTtlMs, 60_000),
    startCleanupTimer = true,
  } = {}) {
    if (!Number.isSafeInteger(eventLimit) || eventLimit < 1) {
      throw new TypeError('eventLimit must be a positive integer');
    }

    if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1) {
      throw new TypeError('sessionTtlMs must be a positive integer');
    }

    this.eventLimit = eventLimit;
    this.sessionTtlMs = sessionTtlMs;
    this.idFactory = idFactory;
    this.clock = clock;
    this.sessions = new Map();
    this.cleanupTimer = null;

    if (startCleanupTimer) {
      this.cleanupTimer = setInterval(
        () => this.cleanupExpired(),
        Math.max(1_000, cleanupIntervalMs),
      );
      this.cleanupTimer.unref?.();
    }
  }

  create(type) {
    if (!RUN_TYPES.has(type)) {
      throw new RunSessionError('Run type must be single or competition.', 'RUN_TYPE_INVALID');
    }

    let id;

    do {
      id = this.idFactory();
    } while (this.sessions.has(id));

    const startedAt = this.clock().toISOString();
    const session = {
      id,
      type,
      state: 'starting',
      startedAt,
      completedAt: null,
      taskId: null,
      competitionId: null,
      currentStage: 'initializing',
      nextEventId: 1,
      events: [],
      result: null,
      error: null,
      listeners: new Set(),
    };
    this.sessions.set(id, session);
    return this.snapshot(id);
  }

  getInternal(id) {
    this.cleanupExpired();
    return this.sessions.get(id) || null;
  }

  snapshot(id) {
    const session = this.getInternal(id);

    if (!session) return null;

    return clonePublic({
      id: session.id,
      type: session.type,
      state: session.state,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      taskId: session.taskId,
      competitionId: session.competitionId,
      currentStage: session.currentStage,
      lastEventId: session.nextEventId - 1,
      result: session.result,
      error: session.error,
    });
  }

  updateIdentity(id, { taskId, competitionId } = {}) {
    const session = this.getInternal(id);

    if (!session) throw new RunSessionError('Run session not found.', 'RUN_NOT_FOUND', 404);

    if (typeof taskId === 'string' && taskId) session.taskId = taskId;
    if (typeof competitionId === 'string' && competitionId) {
      session.competitionId = competitionId;
      session.taskId = competitionId;
    }

    return this.snapshot(id);
  }

  append(id, input) {
    const session = this.getInternal(id);

    if (!session) throw new RunSessionError('Run session not found.', 'RUN_NOT_FOUND', 404);

    if (RUN_STATES.has(session.state)
      && ['completed', 'failed'].includes(session.state)) {
      throw new RunSessionError('Run session is already finished.', 'RUN_ALREADY_FINISHED', 409);
    }

    const validated = validateEvent(input);
    const event = Object.freeze({
      id: session.nextEventId,
      runId: session.id,
      timestamp: this.clock().toISOString(),
      ...validated,
    });
    session.nextEventId += 1;
    session.currentStage = event.stage;

    if (event.type === 'evaluation_starting') session.state = 'evaluating';
    else if (event.type !== 'run_started') session.state = 'running';

    session.events.push(event);
    if (session.events.length > this.eventLimit) {
      session.events.splice(0, session.events.length - this.eventLimit);
    }

    for (const listener of session.listeners) listener(clonePublic(event));
    return clonePublic(event);
  }

  eventsAfter(id, lastEventId = 0) {
    const session = this.getInternal(id);

    if (!session) return null;

    const normalized = Number.isSafeInteger(lastEventId) && lastEventId >= 0
      ? lastEventId
      : 0;
    return clonePublic(session.events.filter((event) => event.id > normalized));
  }

  oldestEventId(id) {
    const session = this.getInternal(id);
    return session?.events[0]?.id ?? null;
  }

  subscribe(id, listener) {
    const session = this.getInternal(id);

    if (!session) throw new RunSessionError('Run session not found.', 'RUN_NOT_FOUND', 404);
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');

    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  listenerCount(id) {
    return this.getInternal(id)?.listeners.size ?? 0;
  }

  complete(id, result, eventData = {}) {
    const session = this.getInternal(id);

    if (!session) throw new RunSessionError('Run session not found.', 'RUN_NOT_FOUND', 404);
    session.result = clonePublic(result);
    const event = this.append(id, {
      type: 'run_completed',
      stage: 'complete',
      status: 'completed',
      messageKey: 'run.completed',
      data: eventData,
    });
    session.state = 'completed';
    session.completedAt = this.clock().toISOString();
    return event;
  }

  fail(id, error, eventData = {}) {
    const session = this.getInternal(id);

    if (!session) throw new RunSessionError('Run session not found.', 'RUN_NOT_FOUND', 404);
    session.error = clonePublic(error);
    const event = this.append(id, {
      type: 'run_failed',
      stage: 'failed',
      status: 'failed',
      messageKey: 'run.failed',
      data: {
        ...eventData,
        code: error?.code || eventData.code || 'RUN_EXECUTION_FAILED',
        message: error?.message || 'The accepted real-time run failed.',
        stage: eventData.stage || 'failed',
      },
    });
    session.state = 'failed';
    session.completedAt = this.clock().toISOString();
    return event;
  }

  cleanupExpired() {
    const now = this.clock().getTime();
    let removed = 0;

    for (const [id, session] of this.sessions) {
      if (!session.completedAt) continue;
      if (now - new Date(session.completedAt).getTime() < this.sessionTtlMs) continue;
      session.listeners.clear();
      this.sessions.delete(id);
      removed += 1;
    }

    return removed;
  }

  close() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    for (const session of this.sessions.values()) session.listeners.clear();
  }
}

const runSessionService = new RunSessionService();

module.exports = {
  RUN_EVENT_STATUSES,
  RUN_EVENT_TYPES,
  RUN_STAGES,
  RUN_STATES,
  RUN_TYPES,
  RunSessionError,
  RunSessionService,
  runSessionService,
  validateEvent,
};
