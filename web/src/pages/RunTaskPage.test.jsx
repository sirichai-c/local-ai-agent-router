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
    submitJob: vi.fn().mockImplementation(async ({ type }) => ({
      runId: type === 'competition' ? 'run-competition' : 'run-single',
      job: { id: `job-${type}`, status: 'queued' },
    })),
  };
}

describe('Run Task page', () => {
  it('validates task and workspace before execution', async () => {
    const api = createApi();
    render(<RunTaskPage api={api} onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Task is required');
    expect(api.submitJob).not.toHaveBeenCalled();
  });

  it('submits Auto Agent request and prevents duplicate clicks while pending', async () => {
    const api = createApi();
    const onNavigate = vi.fn();
    render(<RunTaskPage api={api} onNavigate={onNavigate} />);
    await userEvent.type(screen.getByLabelText('What do you want the agents to do?'), 'Fix API validation');
    await userEvent.type(screen.getByLabelText('Workspace / Repo Path'), 'C:\\repo');
    await userEvent.click(screen.getByLabelText('Analyze before execution'));
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(api.submitJob).toHaveBeenCalledWith({
      type: 'single',
      task: 'Fix API validation',
      workspace: 'C:\\repo',
      agents: undefined,
      priority: 50,
    });
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
    expect(api.submitJob).toHaveBeenCalledWith({
      type: 'competition',
      task: 'Improve docs',
      workspace: 'C:\\repo',
      agents: ['opencode', 'qwen-code'],
      priority: 50,
    });
    expect(onNavigate).toHaveBeenCalledWith('/runs/run-competition');
  });

  it('submits the selected Job priority and exposes numeric priority in Advanced mode', async () => {
    const api = createApi();
    render(<RunTaskPage api={api} onNavigate={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('What do you want the agents to do?'), 'Urgent docs fix');
    await userEvent.type(screen.getByLabelText('Workspace / Repo Path'), 'C:\\repo');
    await userEvent.selectOptions(screen.getByLabelText('Priority'), '100');
    await userEvent.click(screen.getByLabelText('Analyze before execution'));
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(api.submitJob).toHaveBeenCalledWith(expect.objectContaining({ priority: 100 }));
  });
});
