import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRunStream } from './useRunStream';

const running = {
  id: 'run-1',
  type: 'single',
  state: 'running',
  currentStage: 'routing',
  lastEventId: 0,
  result: null,
};

describe('useRunStream', () => {
  it('connects, deduplicates replayed events, handles reconnect, and loads completion', async () => {
    const completed = { ...running, state: 'completed', currentStage: 'complete', result: { status: 'completed', taskId: 'task-1' } };
    const api = { getRun: vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(completed) };
    const controls = {};
    const close = vi.fn();
    const subscribe = vi.fn((runId, handlers) => {
      Object.assign(controls, handlers);
      return { close };
    });
    const { result, unmount } = renderHook(() => useRunStream('run-1', { api, subscribe }));
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    act(() => controls.onOpen());
    expect(result.current.connectionState).toBe('live');
    const event = { id: 1, type: 'agent_running', stage: 'agent', status: 'running', messageKey: 'run.agentRunning', data: { agentId: 'qwen-code' } };
    act(() => { controls.onEvent(event); controls.onEvent(event); });
    expect(result.current.events).toHaveLength(1);
    act(() => controls.onError({ code: 'RUN_STREAM_DISCONNECTED' }));
    expect(result.current.connectionState).toBe('reconnecting');
    act(() => controls.onEvent({ id: 2, type: 'run_completed', stage: 'complete', status: 'completed', messageKey: 'run.completed', data: {} }));
    await waitFor(() => expect(result.current.session?.result?.taskId).toBe('task-1'));
    expect(result.current.connectionState).toBe('complete');
    expect(close).toHaveBeenCalled();
    unmount();
  });

  it('closes EventSource on unmount while the backend run remains independent', async () => {
    const close = vi.fn();
    const subscribe = vi.fn(() => ({ close }));
    const api = { getRun: vi.fn().mockResolvedValue(running) };
    const { unmount } = renderHook(() => useRunStream('run-1', { api, subscribe }));
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    unmount();
    expect(close).toHaveBeenCalledOnce();
    expect(api.getRun).toHaveBeenCalledOnce();
  });

  it('shows an expired state and does not open EventSource for a missing run', async () => {
    const error = Object.assign(new Error('not found'), { status: 404, code: 'RUN_NOT_FOUND' });
    const api = { getRun: vi.fn().mockRejectedValue(error) };
    const subscribe = vi.fn();
    const { result } = renderHook(() => useRunStream('expired', { api, subscribe }));
    await waitFor(() => expect(result.current.expired).toBe(true));
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('tracks queued positions and closes on backend-confirmed cancellation', async () => {
    const cancelled = { ...running, jobId: 'job-1', state: 'cancelled', currentStage: 'queue' };
    const api = {
      getRun: vi.fn()
        .mockResolvedValueOnce({ ...running, jobId: 'job-1', state: 'queued', currentStage: 'queue' })
        .mockResolvedValueOnce(cancelled),
    };
    const controls = {};
    const close = vi.fn();
    const subscribe = vi.fn((_runId, handlers) => {
      Object.assign(controls, handlers);
      return { close };
    });
    const { result } = renderHook(() => useRunStream('run-1', { api, subscribe }));
    await waitFor(() => expect(subscribe).toHaveBeenCalledOnce());
    act(() => controls.onEvent({ id: 1, type: 'queue_position', stage: 'queue', status: 'pending', messageKey: 'run.queuePosition', data: { position: 2 } }));
    expect(result.current.events[0].data.position).toBe(2);
    act(() => controls.onEvent({ id: 2, type: 'job_cancel_requested', stage: 'queue', status: 'warning', messageKey: 'run.jobCancelRequested', data: {} }));
    expect(result.current.session.state).toBe('cancel_requested');
    act(() => controls.onEvent({ id: 3, type: 'job_cancelled', stage: 'queue', status: 'cancelled', messageKey: 'run.jobCancelled', data: {} }));
    await waitFor(() => expect(result.current.session.state).toBe('cancelled'));
    expect(result.current.connectionState).toBe('complete');
    expect(close).toHaveBeenCalled();
  });
});
