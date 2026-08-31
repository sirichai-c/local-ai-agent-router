import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CandidatePage } from './CandidatePage';

const fingerprint = `sha256:${'b'.repeat(64)}`;

function review(overrides = {}) {
  return {
    task: { id: 'task-1', task: 'Update README', mode: 'single', status: 'completed', targetBranch: 'main', baseCommit: 'abc123', decision: 'pending' },
    candidate: { agentId: 'qwen-code', status: 'completed', evaluationScore: 98, verdict: 'pass', competitionScore: null, branch: 'agent/task-1-qwen-code', worktree: 'C:\\repo\\.agent-worktrees\\task-1-qwen-code', changedFiles: ['README.md'], untrackedFiles: ['notes.txt'], trackedDiff: '+<script>alert("x")</script>', diffRedacted: false, fingerprint },
    approvable: true,
    reason: null,
    ...overrides,
  };
}

function apiFor(candidateReview = review()) {
  return {
    getCandidate: vi.fn().mockResolvedValue(candidateReview),
    approveCandidate: vi.fn().mockResolvedValue({ status: 'merged', candidateCommit: 'commit-1', mergeCommit: 'merge-1', cleanupWarnings: [] }),
    rejectCandidate: vi.fn().mockResolvedValue({ status: 'rejected', cleanupWarnings: [] }),
  };
}

async function load(api) {
  window.history.replaceState({}, '', '/candidates?taskId=task-1');
  render(<CandidatePage api={api} />);
  await userEvent.click(screen.getByRole('button', { name: 'Load candidate' }));
  await screen.findByText('Candidate evidence');
}

describe('Candidate Review page', () => {
  it('requires confirmation and sends the exact reviewed fingerprint', async () => {
    const api = apiFor();
    await load(api);
    await userEvent.click(screen.getByRole('button', { name: 'Approve candidate' }));
    expect(api.approveCandidate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Approve Candidate?' });
    expect(dialog).toHaveTextContent('It will not push to a remote');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(api.approveCandidate).toHaveBeenCalledWith('task-1', fingerprint);
    expect(await screen.findByText('merge-1')).toBeInTheDocument();
    expect(screen.getByText('Not performed')).toBeInTheDocument();
  });

  it('requires confirmation before rejection and reports target untouched', async () => {
    const api = apiFor();
    await load(api);
    await userEvent.click(screen.getByRole('button', { name: 'Reject candidate' }));
    expect(api.rejectCandidate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Reject Candidate?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(api.rejectCandidate).toHaveBeenCalledWith('task-1');
    expect(await screen.findByText('Target repository was not modified.')).toBeInTheDocument();
  });

  it('handles candidate_changed conflict without claiming success or retrying', async () => {
    const api = apiFor();
    api.approveCandidate.mockRejectedValue(Object.assign(new Error('Candidate is no longer approvable.'), { status: 409, code: 'candidate_changed' }));
    await load(api);
    await userEvent.click(screen.getByRole('button', { name: 'Approve candidate' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('candidate_changed')).toBeInTheDocument();
    expect(screen.getByText(/must be refreshed and reviewed again/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh candidate for review' })).toBeInTheDocument();
    expect(api.approveCandidate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  });

  it('disables approval for backend-declared unsafe candidates', async () => {
    const unsafe = review({ approvable: false, reason: 'candidate_unsafe' });
    const api = apiFor(unsafe);
    await load(api);
    expect(screen.getByRole('button', { name: 'Approve candidate' })).toBeDisabled();
    expect(screen.getByText('candidate_unsafe')).toBeInTheDocument();
  });
});
