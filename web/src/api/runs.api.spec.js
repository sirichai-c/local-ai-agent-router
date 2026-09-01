import { describe, expect, it, vi } from 'vitest';
import { subscribeToRun } from './runs.api';

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.close = vi.fn();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, value = {}) {
    for (const listener of this.listeners.get(type) || []) listener(value);
  }
}

describe('real-time EventSource API', () => {
  it('uses the run SSE endpoint and parses structured run_event JSON', () => {
    let source;
    const onEvent = vi.fn();
    const subscription = subscribeToRun('run/unsafe', {
      onEvent,
      eventSourceFactory: (url) => {
        source = new FakeEventSource(url);
        return source;
      },
    });
    expect(source.url).toBe('/api/runs/run%2Funsafe/events');
    source.emit('run_event', { data: JSON.stringify({ id: 1, type: 'run_started' }) });
    expect(onEvent).toHaveBeenCalledWith({ id: 1, type: 'run_started' });
    subscription.close();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it('reports malformed events and connection errors without executing content', () => {
    let source;
    const onError = vi.fn();
    subscribeToRun('run-1', {
      onError,
      eventSourceFactory: (url) => {
        source = new FakeEventSource(url);
        return source;
      },
    });
    source.emit('run_event', { data: '<script>alert(1)</script>' });
    source.emit('error');
    expect(onError).toHaveBeenNthCalledWith(1, expect.objectContaining({ code: 'INVALID_RUN_EVENT' }));
    expect(onError).toHaveBeenNthCalledWith(2, expect.objectContaining({ code: 'RUN_STREAM_DISCONNECTED' }));
    expect(document.querySelector('script')).toBeNull();
  });
});
