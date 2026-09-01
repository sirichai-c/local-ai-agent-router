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
});
