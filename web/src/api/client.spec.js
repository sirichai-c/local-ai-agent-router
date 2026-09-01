import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError } from './client';

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => (body === null ? '' : JSON.stringify(body)) };
}

describe('API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('constructs Auto Agent execution request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 'completed' }));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient.executeTask({ task: 'Fix validation', workspace: 'C:\\repo' });
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/execute', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ task: 'Fix validation', workspace: 'C:\\repo' }),
    }));
  });

  it('constructs explicit competition request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 'completed' }));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient.competeTask({ task: 'Improve README', workspace: 'C:\\repo', agents: ['opencode', 'qwen-code'] });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tasks/compete');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ task: 'Improve README', workspace: 'C:\\repo', agents: ['opencode', 'qwen-code'] });
  });

  it('starts a real-time single run and loads its snapshot', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ runId: 'run-1', state: 'starting' }, { status: 202 }))
      .mockResolvedValueOnce(response({ id: 'run-1', state: 'running' }));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient.startExecution({ task: 'Fix validation', workspace: 'C:\\repo' });
    await apiClient.getRun('run-1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/runs/execute');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      task: 'Fix validation',
      workspace: 'C:\\repo',
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/runs/run-1');
  });

  it('starts a real-time competition with the explicit Agent list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ runId: 'run-2' }, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient.startCompetition({
      task: 'Improve README',
      workspace: 'C:\\repo',
      agents: ['qwen-code', 'opencode'],
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/runs/compete');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).agents).toEqual(['qwen-code', 'opencode']);
  });

  it('submits and manages persistent Jobs without accepting process identifiers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ job: { id: 'job-1', status: 'queued' }, runId: 'run-1' }, { status: 202 }))
      .mockResolvedValueOnce(response({ job: { id: 'job-1', priority: 75 } }))
      .mockResolvedValueOnce(response({ job: { id: 'job-1', status: 'cancel_requested' } }));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient.submitJob({
      type: 'competition',
      task: 'Improve README',
      workspace: 'C:\\repo',
      agents: ['qwen-code', 'opencode'],
      priority: 50,
    });
    await apiClient.updateJobPriority('job-1', 75);
    await apiClient.cancelJob('job-1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/jobs');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      type: 'competition',
      task: 'Improve README',
      workspace: 'C:\\repo',
      agents: ['qwen-code', 'opencode'],
      priority: 50,
    });
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({});
  });

  it('passes candidate fingerprint exactly in approve body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ status: 'merged' }));
    vi.stubGlobal('fetch', fetchMock);
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    await apiClient.approveCandidate('task-1', fingerprint);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedFingerprint: fingerprint });
  });

  it('classifies HTTP 409 using the safe backend error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { code: 'candidate_changed', message: 'Candidate changed.' } }, { ok: false, status: 409 })));
    await expect(apiClient.approveCandidate('task-1', `sha256:${'a'.repeat(64)}`)).rejects.toMatchObject({ status: 409, code: 'candidate_changed', message: 'Candidate changed.' });
  });

  it('classifies network failures as backend unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(apiClient.getHealth()).rejects.toEqual(expect.objectContaining({ code: 'BACKEND_UNAVAILABLE' }));
  });

  it('does not expose arbitrary stack properties as its message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { code: 'SERVER', message: 'Safe message', stack: 'secret internals' } }, { ok: false, status: 500 })));
    let caught;
    try { await apiClient.getHealth(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.message).toBe('Safe message');
    expect(caught.message).not.toContain('secret internals');
  });
});
