import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LiveRunPage } from './LiveRunPage';
import { render } from '../test/render';

function runEvent(id, type, stage, status = 'completed', data = {}) {
  return {
    id,
    runId: 'run-1',
    timestamp: '2026-09-01T00:00:00.000Z',
    type,
    stage,
    status,
    messageKey: type === 'agent_running' ? 'run.agentRunning' : type === 'candidate_ready' ? 'run.candidateReady' : 'run.staticCheck',
    data,
  };
}

function useStream(value) {
  return () => ({
    loading: false,
    connected: true,
    connectionState: 'live',
    error: null,
    expired: false,
    events: [],
    session: { id: 'run-1', type: 'single', state: 'running', currentStage: 'agent', result: null },
    ...value,
  });
}

describe('Live Run page', () => {
  it('renders live timeline, structured activity, and safe terminal withholding', async () => {
    const attack = '<script>alert(1)</script>';
    render(<LiveRunPage api={{}} runId="run-1" useStream={useStream({
      events: [
        runEvent(1, 'run_started', 'initializing'),
        runEvent(2, 'router_completed', 'routing'),
        runEvent(3, 'repository_validated', 'repository'),
        runEvent(4, 'worktree_created', 'worktree'),
        runEvent(5, 'agent_running', 'agent', 'running', { agentId: attack }),
        runEvent(6, 'evaluation_starting', 'evaluation', 'running'),
        runEvent(7, 'static_check', 'evaluation', 'completed', { checkType: 'javascript-syntax', file: 'src/app.js' }),
      ],
    })} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Agent running')).toBeInTheDocument();
    expect(screen.getByText(attack)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('Evaluation running')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(screen.getByText(/Live stdout and stderr are withheld/u)).toBeInTheDocument();
  });

  it('shows final evaluation and Review Candidate only after backend readiness', () => {
    render(<LiveRunPage api={{}} runId="run-1" useStream={useStream({
      connectionState: 'complete',
      events: [runEvent(1, 'candidate_ready', 'candidate', 'completed', { taskId: 'task-1' })],
      session: {
        id: 'run-1',
        type: 'single',
        state: 'completed',
        taskId: 'task-1',
        result: {
          status: 'completed',
          taskId: 'task-1',
          candidateAvailable: true,
          evaluation: { score: 96, verdict: 'pass', staticChecks: [], project: { scripts: {} } },
        },
      },
    })} />);
    expect(screen.getByText('96')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review Candidate/u })).toHaveAttribute('href', '/candidates/task-1');
    expect(screen.getByText('Session finished')).toBeInTheDocument();
  });

  it('renders sequential competition progress and the backend final winner', () => {
    const events = [
      runEvent(1, 'competition_started', 'competition', 'running', { agentIds: ['qwen-code', 'opencode'] }),
      runEvent(2, 'competition_candidate_starting', 'competition', 'running', { agentId: 'qwen-code' }),
      runEvent(3, 'competition_candidate_completed', 'competition', 'completed', { agentId: 'qwen-code', score: 96, verdict: 'pass', status: 'completed' }),
      runEvent(4, 'competition_candidate_starting', 'competition', 'running', { agentId: 'opencode' }),
    ];
    render(<LiveRunPage api={{}} runId="run-1" useStream={useStream({
      events,
      session: { id: 'run-1', type: 'competition', state: 'running', currentStage: 'competition', result: null },
    })} />);
    expect(screen.getAllByText('qwen-code').length).toBeGreaterThan(0);
    expect(screen.getAllByText('opencode').length).toBeGreaterThan(0);
    expect(screen.getByText('96 · pass')).toBeInTheDocument();
  });

  it('shows reconnecting and failed-run states without claiming the Agent stopped', () => {
    render(<LiveRunPage api={{}} runId="run-1" useStream={useStream({
      connected: false,
      connectionState: 'reconnecting',
      events: [runEvent(1, 'agent_failed', 'agent', 'failed', { agentId: 'qwen-code' })],
      session: {
        id: 'run-1',
        type: 'single',
        state: 'failed',
        currentStage: 'failed',
        result: null,
        error: { code: 'RUN_FAILED', message: 'The accepted run failed safely.' },
      },
    })} />);
    expect(screen.getByText(/Agent may still be running/u)).toBeInTheDocument();
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getByText('The accepted run failed safely.')).toBeInTheDocument();
  });

  it('shows a controlled expired-session state', () => {
    render(<LiveRunPage api={{}} runId="expired" useStream={useStream({ expired: true, session: null })} />);
    expect(screen.getByText(/ended or expired/u)).toBeInTheDocument();
  });

  it('shows queue position and waits for backend cancellation confirmation', async () => {
    const api = {
      cancelJob: vi.fn().mockResolvedValue({ job: { status: 'cancel_requested' } }),
      retryJob: vi.fn(),
    };
    render(<LiveRunPage api={api} runId="run-1" useStream={useStream({
      events: [runEvent(1, 'job_created', 'queue'), runEvent(2, 'queue_position', 'queue', 'pending', { position: 2, priority: 75 })],
      session: { id: 'run-1', jobId: 'job-1', type: 'single', state: 'queued', currentStage: 'queue', result: null },
    })} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel Job' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('leave the queue');
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel Job' }).at(-1));
    expect(api.cancelJob).toHaveBeenCalledWith('job-1');
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
  });

  it('retries an interrupted Job as a new run', async () => {
    const onNavigate = vi.fn();
    const api = {
      cancelJob: vi.fn(),
      retryJob: vi.fn().mockResolvedValue({ runId: 'retry-run' }),
    };
    render(<LiveRunPage api={api} runId="run-1" onNavigate={onNavigate} useStream={useStream({
      events: [],
      connectionState: 'complete',
      session: { id: 'run-1', jobId: 'job-1', type: 'single', state: 'interrupted', currentStage: 'failed', result: null },
    })} />);
    expect(screen.getByText(/Router stopped while this Job was active/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.retryJob).toHaveBeenCalledWith('job-1');
    expect(onNavigate).toHaveBeenCalledWith('/runs/retry-run');
  });
});
