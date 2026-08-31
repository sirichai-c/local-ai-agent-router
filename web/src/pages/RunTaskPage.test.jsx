import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RunTaskPage } from './RunTaskPage';

function createApi() {
  return {
    getAgents: vi.fn().mockResolvedValue({ agents: [
      { id: 'opencode', name: 'OpenCode', available: true, runtime: 'docker' },
      { id: 'qwen-code', name: 'Qwen Code', available: true, runtime: 'docker' },
      { id: 'aider', name: 'Aider', available: false, runtime: 'docker' },
    ] }),
    analyzeTask: vi.fn().mockResolvedValue({ classification: { coding: 80 }, ranking: [] }),
    executeTask: vi.fn().mockResolvedValue({ status: 'execution_disabled' }),
    competeTask: vi.fn().mockResolvedValue({ status: 'execution_disabled', candidates: [], ranking: [] }),
  };
}

describe('Run Task page', () => {
  it('validates task and workspace before execution', async () => {
    const api = createApi();
    render(<RunTaskPage api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run Agent' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Task is required');
    expect(api.executeTask).not.toHaveBeenCalled();
  });

  it('submits Auto Agent request and prevents duplicate clicks while pending', async () => {
    const api = createApi();
    render(<RunTaskPage api={api} />);
    await userEvent.type(screen.getByLabelText('Task'), 'Fix API validation');
    await userEvent.type(screen.getByLabelText('Workspace path'), 'C:\\repo');
    await userEvent.click(screen.getByLabelText('Analyze before execution'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Agent' }));
    expect(api.executeTask).toHaveBeenCalledWith({ task: 'Fix API validation', workspace: 'C:\\repo' });
    expect(screen.getByText('execution_disabled')).toBeInTheDocument();
  });

  it('submits selected Agents for competition and marks unavailable Agent disabled', async () => {
    const api = createApi();
    render(<RunTaskPage api={api} />);
    await screen.findByLabelText(/Multi-Agent Competition/u);
    await userEvent.type(screen.getByLabelText('Task'), 'Improve docs');
    await userEvent.type(screen.getByLabelText('Workspace path'), 'C:\\repo');
    await userEvent.click(screen.getByLabelText(/Multi-Agent Competition/u));
    await screen.findByText('Aider');
    expect(screen.getByLabelText(/Aider/u)).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Analyze before execution'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Competition' }));
    expect(api.competeTask).toHaveBeenCalledWith({ task: 'Improve docs', workspace: 'C:\\repo', agents: ['opencode', 'qwen-code'] });
  });
});
