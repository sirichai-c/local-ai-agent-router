const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  RunCoordinatorService,
  RunStartError,
} = require('../src/services/run-coordinator.service');
const { RunSessionService } = require('../src/services/run-session.service');

function createHarness({ executeTask, compete, enabled = true } = {}) {
  const scheduled = [];
  const sessions = new RunSessionService({
    idFactory: (() => { let id = 0; return () => `run-${++id}`; })(),
    startCleanupTimer: false,
  });
  const executor = {
    isExecutionEnabled: () => enabled,
    assertExecutionBackendAvailable: async () => {},
    executeTask: executeTask || (async () => ({ status: 'completed' })),
  };
  const competition = {
    compete: compete || (async () => ({ status: 'completed', candidates: [] })),
  };
  const coordinator = new RunCoordinatorService({
    sessions,
    executor,
    competition,
    schedule: (callback) => scheduled.push(callback),
  });
  return { coordinator, scheduled, sessions };
}

function emit(onEvent, type, stage, status = 'completed', data = {}) {
  onEvent({
    type,
    stage,
    status,
    messageKey: 'run.testEvent',
    data,
  });
}

test('single live execution returns immediately then records ordered safe lifecycle events', async () => {
  const { coordinator, scheduled, sessions } = createHarness({
    executeTask: async ({ onEvent }) => {
      emit(onEvent, 'router_analyzing', 'routing', 'running');
      emit(onEvent, 'router_completed', 'routing');
      emit(onEvent, 'repository_validating', 'repository', 'running');
      emit(onEvent, 'repository_validated', 'repository');
      emit(onEvent, 'worktree_creating', 'worktree', 'running');
      emit(onEvent, 'worktree_created', 'worktree');
      emit(onEvent, 'agent_starting', 'agent', 'running');
      emit(onEvent, 'agent_running', 'agent', 'running');
      emit(onEvent, 'agent_completed', 'agent');
      emit(onEvent, 'evaluation_starting', 'evaluation', 'running');
      emit(onEvent, 'static_check', 'evaluation');
      emit(onEvent, 'sandbox_check_started', 'evaluation', 'running');
      emit(onEvent, 'sandbox_check_completed', 'evaluation');
      emit(onEvent, 'evaluation_completed', 'evaluation');
      return {
        status: 'completed',
        taskId: 'task-1',
        selectedAgent: { id: 'qwen-code', name: 'Qwen Code', secret: 'hidden' },
        candidateFingerprint: `sha256:${'a'.repeat(64)}`,
        execution: {
          durationMs: 10,
          stdout: 'SECRET_TOKEN=abc123',
          stderr: '-----BEGIN PRIVATE KEY-----',
          sandbox: { backend: 'docker', image: 'safe:1' },
        },
        evaluation: {
          score: 96,
          verdict: 'pass',
          project: {
            scripts: {
              test: { executed: true, passed: true, stdout: 'SECRET_TOKEN=abc123' },
            },
          },
        },
        changes: { count: 1, files: ['README.md'], diff: 'secret diff' },
      };
    },
  });

  const accepted = await coordinator.startSingle({ task: 'safe', workspace: 'C:\\repo' });
  assert.equal(accepted.state, 'starting');
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();

  const types = sessions.eventsAfter(accepted.id).map((event) => event.type);
  assert.deepEqual(types, [
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
    'evaluation_starting',
    'static_check',
    'sandbox_check_started',
    'sandbox_check_completed',
    'evaluation_completed',
    'candidate_ready',
    'run_completed',
  ]);
  const snapshot = sessions.snapshot(accepted.id);
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.state, 'completed');
  assert.equal(snapshot.taskId, 'task-1');
  assert.equal(serialized.includes('SECRET_TOKEN'), false);
  assert.equal(serialized.includes('PRIVATE KEY'), false);
  assert.equal(serialized.includes('secret diff'), false);
  assert.equal(serialized.includes('candidateFingerprint'), false);
});

test('execution policy rejects before creating a live session', async () => {
  const { coordinator, sessions } = createHarness({ enabled: false });
  await assert.rejects(
    () => coordinator.startSingle({ task: 'safe', workspace: 'C:\\repo' }),
    (error) => error instanceof RunStartError && error.code === 'EXECUTION_DISABLED',
  );
  assert.equal(sessions.sessions.size, 0);
});

test('agent failure emits safe run_failed state without a fake candidate', async () => {
  const { coordinator, scheduled, sessions } = createHarness({
    executeTask: async ({ onEvent }) => {
      emit(onEvent, 'agent_failed', 'agent', 'failed');
      const error = new Error('SECRET_TOKEN=abc123');
      error.code = 'AGENT_PROCESS_FAILED';
      throw error;
    },
  });
  const accepted = await coordinator.startSingle({ task: 'safe', workspace: 'C:\\repo' });
  await scheduled.shift()();
  const snapshot = sessions.snapshot(accepted.id);
  const types = sessions.eventsAfter(accepted.id).map((event) => event.type);
  assert.equal(snapshot.state, 'failed');
  assert.equal(types.includes('run_failed'), true);
  assert.equal(types.includes('candidate_ready'), false);
  assert.equal(JSON.stringify(snapshot).includes('SECRET_TOKEN'), false);
});

test('evaluation_failed remains a completed pipeline with its Phase 7 status', async () => {
  const { coordinator, scheduled, sessions } = createHarness({
    executeTask: async ({ onEvent }) => {
      emit(onEvent, 'evaluation_completed', 'evaluation', 'failed', { verdict: 'fail' });
      return {
        status: 'evaluation_failed',
        taskId: 'task-fail',
        selectedAgent: { id: 'qwen-code', name: 'Qwen Code' },
        evaluation: { score: 10, verdict: 'fail' },
      };
    },
  });
  const accepted = await coordinator.startSingle({ task: 'safe', workspace: 'C:\\repo' });
  await scheduled.shift()();
  const snapshot = sessions.snapshot(accepted.id);
  assert.equal(snapshot.state, 'completed');
  assert.equal(snapshot.result.status, 'evaluation_failed');
  assert.equal(sessions.eventsAfter(accepted.id).some((event) => event.type === 'candidate_ready'), false);
});

test('competition keeps sequential candidate events, ranking, and winner metadata', async () => {
  const { coordinator, scheduled, sessions } = createHarness({
    compete: async ({ onEvent }) => {
      emit(onEvent, 'competition_started', 'competition', 'running', { agentIds: ['qwen-code', 'opencode'] });
      emit(onEvent, 'competition_candidate_starting', 'competition', 'running', { agentId: 'qwen-code' });
      emit(onEvent, 'competition_candidate_completed', 'competition', 'completed', { agentId: 'qwen-code' });
      emit(onEvent, 'competition_candidate_starting', 'competition', 'running', { agentId: 'opencode' });
      emit(onEvent, 'competition_candidate_completed', 'competition', 'failed', { agentId: 'opencode' });
      emit(onEvent, 'competition_ranking', 'competition', 'completed', { winnerAgentId: 'qwen-code' });
      return {
        status: 'completed',
        competitionId: 'competition-1',
        executionMode: 'sequential',
        executionOrder: ['qwen-code', 'opencode'],
        winner: { agentId: 'qwen-code', competitionScore: 94 },
        ranking: [{ agentId: 'qwen-code', competitionScore: 94, eligible: true }],
        candidates: [
          { agent: { id: 'qwen-code', name: 'Qwen Code' }, status: 'completed', evaluation: { score: 96, verdict: 'pass' } },
          { agent: { id: 'opencode', name: 'OpenCode' }, status: 'failed', evaluation: { score: 0, verdict: 'fail' } },
        ],
      };
    },
  });
  const accepted = await coordinator.startCompetition({
    task: 'safe',
    workspace: 'C:\\repo',
    agentIds: ['qwen-code', 'opencode'],
  });
  await scheduled.shift()();
  const snapshot = sessions.snapshot(accepted.id);
  const candidates = sessions.eventsAfter(accepted.id)
    .filter((event) => event.type.startsWith('competition_candidate'))
    .map((event) => `${event.type}:${event.data.agentId}`);
  assert.deepEqual(candidates, [
    'competition_candidate_starting:qwen-code',
    'competition_candidate_completed:qwen-code',
    'competition_candidate_starting:opencode',
    'competition_candidate_completed:opencode',
  ]);
  assert.equal(snapshot.result.winner.agentId, 'qwen-code');
  assert.equal(snapshot.result.executionMode, 'sequential');
  assert.equal(snapshot.state, 'completed');
});
