import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingState,
  Metric,
  PageHeader,
  Panel,
  StatusBadge,
} from '../components/ui';
import { useI18n } from '../i18n/I18nContext';
import { formatDate, formatDuration } from '../utils/format';

const ACTIVE = new Set(['starting', 'running', 'evaluating', 'cancel_requested']);
const RETRYABLE = new Set(['failed', 'cancelled', 'interrupted']);

function priorityKey(priority) {
  if (priority >= 100) return 'urgent';
  if (priority >= 75) return 'high';
  if (priority >= 50) return 'normal';
  return 'low';
}

function elapsed(job) {
  if (!job.startedAt) return null;
  const end = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
  return Math.max(0, end - new Date(job.startedAt).getTime());
}

function JobCard({ job, busy, onCancel, onRetry, onPriority, onOpen }) {
  const { t } = useI18n();
  return <article className="job-card">
    <button type="button" className="job-card-main" onClick={() => onOpen(job.runId)}>
      <span><strong>{job.task}</strong><small>{job.type} · {t('job.attempt')} {job.attempt} · {formatDate(job.createdAt)}</small></span>
      <span className="job-card-state"><StatusBadge value={job.status} />{job.status === 'queued' && <small>{t('job.position')} {job.queuePosition}</small>}</span>
    </button>
    <div className="job-card-meta"><span>{t('job.priority')}: <strong>{t(`job.priority.${priorityKey(job.priority)}`)}</strong> ({job.priority})</span>{job.startedAt && <span>{t('run.duration')}: {formatDuration(elapsed(job))}</span>}{job.parentJobId && <span className="mono">{t('job.retryOf')}: {job.parentJobId}</span>}</div>
    <div className="job-actions">
      {job.status === 'queued' && <label>{t('job.changePriority')}<select value={job.priority} disabled={busy} onChange={(event) => onPriority(job.id, Number(event.target.value))}><option value="25">{t('job.priority.low')}</option><option value="50">{t('job.priority.normal')}</option><option value="75">{t('job.priority.high')}</option><option value="100">{t('job.priority.urgent')}</option></select></label>}
      {(job.status === 'queued' || ACTIVE.has(job.status)) && <button type="button" className="button-danger" disabled={busy || job.status === 'cancel_requested'} onClick={() => onCancel(job)}>{job.status === 'cancel_requested' ? t('job.cancelling') : t('job.cancel')}</button>}
      {RETRYABLE.has(job.status) && <button type="button" disabled={busy} onClick={() => onRetry(job)}>{t('job.retry')}</button>}
    </div>
    {job.status === 'interrupted' && <p className="job-note">{t('job.interruptedHelp')}</p>}
  </article>;
}

export function QueuePage({ api, onNavigate }) {
  const { t } = useI18n();
  const [state, setState] = useState({ loading: true, jobs: [], scheduler: null, error: null });
  const [actionJob, setActionJob] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setState((current) => ({ ...current, loading: true }));
    try {
      const response = await api.getJobs({ limit: 100 });
      setState({ loading: false, jobs: response.jobs || [], scheduler: response.scheduler || null, error: null });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error }));
    }
  }, [api]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load({ quiet: true }), 3_000);
    return () => clearInterval(timer);
  }, [load]);

  const groups = useMemo(() => ({
    active: state.jobs.filter((job) => ACTIVE.has(job.status)),
    queued: state.jobs.filter((job) => job.status === 'queued')
      .sort((left, right) => (left.queuePosition || 0) - (right.queuePosition || 0)),
    recent: state.jobs.filter((job) => !ACTIVE.has(job.status) && job.status !== 'queued'),
  }), [state.jobs]);

  const cancel = async () => {
    setBusy(true);
    try {
      await api.cancelJob(actionJob.id);
      setActionJob(null);
      await load({ quiet: true });
    } catch (error) {
      setState((current) => ({ ...current, error }));
    } finally {
      setBusy(false);
    }
  };
  const retry = async (job) => {
    setBusy(true);
    try {
      const result = await api.retryJob(job.id);
      onNavigate(`/runs/${encodeURIComponent(result.runId)}`);
    } catch (error) {
      setState((current) => ({ ...current, error }));
    } finally {
      setBusy(false);
    }
  };
  const priority = async (jobId, value) => {
    setBusy(true);
    try {
      await api.updateJobPriority(jobId, value);
      await load({ quiet: true });
    } catch (error) {
      setState((current) => ({ ...current, error }));
    } finally {
      setBusy(false);
    }
  };
  const card = (job) => <JobCard key={job.id} job={job} busy={busy} onCancel={setActionJob} onRetry={retry} onPriority={priority} onOpen={(runId) => onNavigate(`/runs/${encodeURIComponent(runId)}`)} />;

  return <>
    <PageHeader eyebrow="JOB MANAGER" title={t('job.queueTitle')} description={t('job.queueSubtitle')} />
    <ErrorNotice error={state.error} />
    {state.scheduler && <Panel title={t('job.scheduler')}><div className="metric-grid metric-grid-compact"><Metric label={t('job.schedulerStatus')} value={<StatusBadge value={state.scheduler.status} />} /><Metric label={t('job.active')} value={`${state.scheduler.active} / ${state.scheduler.maxConcurrent}`} /><Metric label={t('job.queued')} value={state.scheduler.queued} /></div></Panel>}
    {state.loading ? <LoadingState /> : <div className="queue-sections">
      <Panel title={t('job.running')}>{groups.active.length ? <div className="job-list">{groups.active.map(card)}</div> : <EmptyState>{t('job.noRunning')}</EmptyState>}</Panel>
      <Panel title={t('job.queued')}>{groups.queued.length ? <div className="job-list">{groups.queued.map(card)}</div> : <EmptyState>{t('job.noQueued')}</EmptyState>}</Panel>
      <Panel title={t('job.recent')}>{groups.recent.length ? <div className="job-list">{groups.recent.map(card)}</div> : <EmptyState>{t('job.noRecent')}</EmptyState>}</Panel>
    </div>}
    <ConfirmDialog open={Boolean(actionJob)} title={t('job.cancelTitle')} confirmLabel={t('job.cancel')} tone="danger" busy={busy} onConfirm={cancel} onCancel={() => setActionJob(null)}><p>{ACTIVE.has(actionJob?.status) ? t('job.cancelRunningHelp') : t('job.cancelQueuedHelp')}</p><p>{t('job.partialWorkHelp')}</p></ConfirmDialog>
  </>;
}

export { priorityKey };
