import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QueuePage } from './QueuePage';
import { render } from '../test/render';

function jobsResponse() {
  return {
    scheduler: { status: 'running', active: 1, maxConcurrent: 1, queued: 1 },
    jobs: [
      { id: 'job-running', runId: 'run-running', task: 'Running task', type: 'single', status: 'running', priority: 50, attempt: 1, createdAt: '2026-09-01T00:00:00.000Z', startedAt: '2026-09-01T00:00:01.000Z' },
      { id: 'job-queued', runId: 'run-queued', task: 'Urgent queued task', type: 'single', status: 'queued', priority: 100, attempt: 1, queuePosition: 1, createdAt: '2026-09-01T00:00:02.000Z' },
      { id: 'job-failed', runId: 'run-failed', task: 'Failed task', type: 'competition', status: 'failed', priority: 75, attempt: 2, parentJobId: 'job-parent', createdAt: '2026-09-01T00:00:03.000Z', completedAt: '2026-09-01T00:00:04.000Z' },
      { id: 'job-interrupted', runId: 'run-interrupted', task: 'Interrupted task', type: 'single', status: 'interrupted', priority: 50, attempt: 1, createdAt: '2026-09-01T00:00:05.000Z' },
    ],
  };
}

function api() {
  return {
    getJobs: vi.fn().mockResolvedValue(jobsResponse()),
    cancelJob: vi.fn().mockResolvedValue({ job: { status: 'cancelled' } }),
    retryJob: vi.fn().mockResolvedValue({ runId: 'run-retry', job: { id: 'job-retry' } }),
    updateJobPriority: vi.fn().mockResolvedValue({ job: { priority: 75 } }),
  };
}

describe('Queue page', () => {
  it('renders scheduler, running, queued, priority, attempt, and interrupted states', async () => {
    const client = api();
    render(<QueuePage api={client} onNavigate={vi.fn()} />);
    expect(await screen.findByText('Running task')).toBeInTheDocument();
    expect(screen.getByText('Urgent queued task')).toBeInTheDocument();
    expect(screen.getByText('Queue position 1')).toBeInTheDocument();
    expect(screen.getByText(/Retry of Job/u)).toBeInTheDocument();
    expect(screen.getByText(/Router stopped while this Job was active/u)).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('changes queued priority and confirms queued cancellation', async () => {
    const client = api();
    render(<QueuePage api={client} onNavigate={vi.fn()} />);
    await screen.findByText('Urgent queued task');
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[0], '75');
    await waitFor(() => expect(client.updateJobPriority).toHaveBeenCalledWith('job-queued', 75));
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel Job' });
    await userEvent.click(cancelButtons.at(-1));
    expect(screen.getByRole('dialog')).toHaveTextContent('leave the queue');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel Job' }));
    await waitFor(() => expect(client.cancelJob).toHaveBeenCalledWith('job-queued'));
  });

  it('confirms active cancellation and retries failed or interrupted attempts as new runs', async () => {
    const client = api();
    const onNavigate = vi.fn();
    render(<QueuePage api={client} onNavigate={onNavigate} />);
    await screen.findByText('Running task');
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel Job' })[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('current Agent execution');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel Job' }));
    await waitFor(() => expect(client.cancelJob).toHaveBeenCalledWith('job-running'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => expect(client.retryJob).toHaveBeenCalledWith('job-failed'));
    expect(onNavigate).toHaveBeenCalledWith('/runs/run-retry');
  });
});
