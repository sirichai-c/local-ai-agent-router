class ExecutionCancelledError extends Error {
  constructor(message = 'Job execution was cancelled.') {
    super(message);
    this.name = 'AbortError';
    this.code = 'JOB_CANCELLED';
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new ExecutionCancelledError();
  }
}

function isCancellationError(error, signal) {
  return signal?.aborted === true
    || error?.name === 'AbortError'
    || error?.code === 'JOB_CANCELLED';
}

module.exports = {
  ExecutionCancelledError,
  isCancellationError,
  throwIfAborted,
};
