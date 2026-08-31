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
