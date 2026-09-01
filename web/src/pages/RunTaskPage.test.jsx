import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RunTaskPage } from './RunTaskPage';
import { render } from '../test/render';

function createApi() {
  return {
    getAgents: vi.fn().mockResolvedValue({ agents: [
      { id: 'opencode', name: 'OpenCode', available: true, runtime: 'docker' },
      { id: 'qwen-code', name: 'Qwen Code', available: true, runtime: 'docker' },
      { id: 'aider', name: 'Aider', available: false, runtime: 'docker' },
    ] }),
    analyzeTask: vi.fn().mockResolvedValue({ classification: { coding: 80 }, ranking: [] }),
    startExecution: vi.fn().mockResolvedValue({ runId: 'run-single', state: 'starting' }),
    startCompetition: vi.fn().mockResolvedValue({ runId: 'run-competition', state: 'starting' }),
  };
}

describe('Run Task page', () => {
  it('validates task and workspace before execution', async () => {
    const api = createApi();
    render(<RunTaskPage api={api} onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Task is required');
    expect(api.startExecution).not.toHaveBeenCalled();
  });

  it('submits Auto Agent request and prevents duplicate clicks while pending', async () => {
    const api = createApi();
    const onNavigate = vi.fn();
    render(<RunTaskPage api={api} onNavigate={onNavigate} />);
    await userEvent.type(screen.getByLabelText('What do you want the agents to do?'), 'Fix API validation');
    await userEvent.type(screen.getByLabelText('Workspace / Repo Path'), 'C:\\repo');
    await userEvent.click(screen.getByLabelText('Analyze before execution'));
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(api.startExecution).toHaveBeenCalledWith({ task: 'Fix API validation', workspace: 'C:\\repo' });
    expect(onNavigate).toHaveBeenCalledWith('/runs/run-single');
  });

  it('submits selected Agents for competition and marks unavailable Agent disabled', async () => {
    const api = createApi();
    const onNavigate = vi.fn();
    render(<RunTaskPage api={api} onNavigate={onNavigate} />);
    await screen.findByLabelText(/Competition/u);
    await userEvent.type(screen.getByLabelText('What do you want the agents to do?'), 'Improve docs');
    await userEvent.type(screen.getByLabelText('Workspace / Repo Path'), 'C:\\repo');
    await userEvent.click(screen.getByLabelText(/^Competition/u));
    await screen.findByText('Aider');
    expect(screen.getByLabelText(/Aider/u)).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Analyze before execution'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Competition' }));
    expect(api.startCompetition).toHaveBeenCalledWith({ task: 'Improve docs', workspace: 'C:\\repo', agents: ['opencode', 'qwen-code'] });
    expect(onNavigate).toHaveBeenCalledWith('/runs/run-competition');
  });
});
