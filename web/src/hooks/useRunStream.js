import { useEffect, useState } from 'react';
import { subscribeToRun } from '../api/runs.api';

const FRONTEND_EVENT_LIMIT = 300;

export function useRunStream(runId, {
  api,
  subscribe = subscribeToRun,
  eventLimit = FRONTEND_EVENT_LIMIT,
} = {}) {
  const [view, setView] = useState({
    loading: true,
    session: null,
    events: [],
    connected: false,
    connectionState: 'connecting',
    error: null,
    expired: false,
  });

  useEffect(() => {
    if (!runId || !api) return undefined;
    let active = true;
    let subscription;

    const refreshSnapshot = async () => {
      try {
        const session = await api.getRun(runId);
        if (!active) return;
        setView((current) => ({
          ...current,
          loading: false,
          session,
          error: null,
          expired: false,
        }));
        return true;
      } catch (error) {
        if (!active) return;
        setView((current) => ({
          ...current,
          loading: false,
          error,
          expired: error.status === 404 || error.code === 'RUN_NOT_FOUND',
          connectionState: 'disconnected',
        }));
        return false;
      }
    };

    const handleEvent = (event) => {
      if (!active) return;

      if (event.type === 'session_snapshot' && event.data?.snapshot) {
        setView((current) => ({
          ...current,
          session: event.data.snapshot,
          loading: false,
        }));
        return;
      }

      setView((current) => {
        if (current.events.some((item) => item.id === event.id)) return current;
        const events = [...current.events, event]
          .sort((left, right) => left.id - right.id)
          .slice(-eventLimit);
        const terminal = ['run_completed', 'run_failed', 'job_cancelled', 'job_interrupted']
          .includes(event.type);
        const eventState = {
          run_completed: 'completed',
          run_failed: 'failed',
          job_queued: 'queued',
          job_starting: 'starting',
          job_running: 'running',
          job_cancel_requested: 'cancel_requested',
          job_cancelled: 'cancelled',
          job_interrupted: 'interrupted',
        }[event.type];
        return {
          ...current,
          loading: false,
          events,
          session: current.session
            ? {
              ...current.session,
              currentStage: event.stage,
              lastEventId: Math.max(current.session.lastEventId || 0, event.id),
              state: eventState || (event.stage === 'evaluation'
                ? 'evaluating'
                : current.session.state),
            }
            : current.session,
          connectionState: terminal ? 'complete' : current.connectionState,
        };
      });

      if (['run_completed', 'run_failed', 'job_cancelled', 'job_interrupted'].includes(event.type)) {
        refreshSnapshot();
        subscription?.close();
      }
    };

    refreshSnapshot().then((available) => {
      if (!active || !available) return;
      subscription = subscribe(runId, {
        onOpen: () => {
          if (active) setView((current) => ({
            ...current,
            connected: true,
            connectionState: 'live',
          }));
        },
        onEvent: handleEvent,
        onError: (error) => {
          if (active) setView((current) => ({
            ...current,
            connected: false,
            connectionState: ['completed', 'failed', 'cancelled', 'interrupted']
              .includes(current.session?.state)
              ? 'complete'
              : 'reconnecting',
            error: error.code === 'INVALID_RUN_EVENT' ? error : current.error,
          }));
        },
      });
    });

    return () => {
      active = false;
      subscription?.close();
    };
  }, [api, eventLimit, runId, subscribe]);

  return view;
}

export { FRONTEND_EVENT_LIMIT };
