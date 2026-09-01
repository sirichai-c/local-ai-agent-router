export function subscribeToRun(runId, {
  onEvent,
  onOpen,
  onError,
  eventSourceFactory = (url) => new EventSource(url),
} = {}) {
  if (typeof runId !== 'string' || !runId) {
    throw new TypeError('runId is required');
  }

  const source = eventSourceFactory(
    `/api/runs/${encodeURIComponent(runId)}/events`,
  );
  const handleEvent = (message) => {
    try {
      const event = JSON.parse(message.data);
      onEvent?.(event);
    } catch {
      onError?.({ code: 'INVALID_RUN_EVENT', message: 'Invalid real-time event.' });
    }
  };
  source.addEventListener('run_event', handleEvent);
  source.addEventListener('open', () => onOpen?.());
  source.addEventListener('error', () => onError?.({
    code: 'RUN_STREAM_DISCONNECTED',
    message: 'Live connection lost. The Agent may still be running.',
  }));

  return {
    close() {
      source.removeEventListener?.('run_event', handleEvent);
      source.close();
    },
    source,
  };
}
