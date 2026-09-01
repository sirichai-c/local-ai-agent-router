import { useEffect, useMemo, useRef, useState } from 'react';
import { EvaluationCard } from '../components/EvaluationCard';
import { CompetitionTable } from '../components/CompetitionTable';
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
  Metric,
  PageHeader,
  Panel,
  StatusBadge,
} from '../components/ui';
import { useRunStream } from '../hooks/useRunStream';
import { useI18n } from '../i18n/I18nContext';
import { formatDuration, formatScore } from '../utils/format';

const TIMELINE_STEPS = [
  ['started', ['run_started'], []],
  ['routing', ['router_completed'], ['router_analyzing']],
  ['repository', ['repository_validated'], ['repository_validating']],
  ['worktree', ['worktree_created'], ['worktree_creating']],
  ['agent', ['agent_completed'], ['agent_starting', 'agent_running']],
  ['evaluation', ['evaluation_completed'], ['evaluation_starting', 'static_check', 'sandbox_check_started']],
  ['candidate', ['candidate_ready'], []],
];

function eventDetail(event) {
  const data = event.data || {};
  return [
    data.agentId,
    data.targetBranch,
    data.check,
    data.verdict,
    Number.isFinite(data.score) ? `${data.score}/100` : null,
  ].filter(Boolean).join(' · ');
}

function LiveTimeline({ events }) {
  const { t } = useI18n();
  return <ol className="timeline live-timeline">{TIMELINE_STEPS.map(([key, completeTypes, runningTypes]) => {
    const relevant = events.filter((event) => completeTypes.includes(event.type)
      || runningTypes.includes(event.type)
      || (key === 'agent' && event.type === 'agent_failed')
      || (event.type === 'run_failed' && event.data?.stage === key));
    const latest = relevant.at(-1);
    const failed = latest?.type === 'agent_failed' || latest?.type === 'run_failed';
    const complete = completeTypes.includes(latest?.type);
    const running = runningTypes.includes(latest?.type);
    const state = failed ? 'failed' : complete ? 'completed' : running ? 'running' : 'pending';
    return <li className={state} key={key}><span aria-hidden="true">{state === 'completed' ? '✓' : state === 'failed' ? '!' : state === 'running' ? '●' : '○'}</span><div><strong>{t(`run.live.step.${key}`)}</strong><small>{t(`run.live.state.${state}`)}</small></div></li>;
  })}</ol>;
}

function ConnectionStatus({ state }) {
  const { t } = useI18n();
  const value = state === 'live' ? 'running' : state === 'complete' ? 'completed' : state === 'reconnecting' ? 'warning' : 'offline';
  return <div className="connection-status"><StatusBadge value={value} /><span>{t(`run.connection.${state}`)}</span></div>;
}

function LiveActivity({ events }) {
  const { t } = useI18n();
  const listRef = useRef(null);
  const [nearBottom, setNearBottom] = useState(true);

  useEffect(() => {
    const node = listRef.current;
    if (node && nearBottom) node.scrollTop = node.scrollHeight;
  }, [events.length, nearBottom]);

  const jumpLatest = () => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    setNearBottom(true);
  };

  return <div className="activity-stream-wrap">
    <div className="activity-stream" ref={listRef} aria-live="polite" onScroll={(event) => { const node = event.currentTarget; setNearBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 64); }}>
      {events.length ? events.map((event) => <article className={`run-event run-event-${event.status}`} key={event.id}><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString()}</time><span className="run-event-marker" aria-hidden="true" /><div><strong>{t(event.messageKey)}</strong>{eventDetail(event) && <small>{eventDetail(event)}</small>}</div></article>) : <EmptyState>{t('run.activityWaiting')}</EmptyState>}
    </div>
    {!nearBottom && <button type="button" className="button-secondary jump-latest" onClick={jumpLatest}>{t('run.jumpLatest')}</button>}
  </div>;
}

function LiveEvaluation({ events, evaluation }) {
  const { t } = useI18n();
  if (evaluation) return <EvaluationCard evaluation={evaluation} />;
  const checks = events.filter((event) => ['static_check', 'sandbox_check_started', 'sandbox_check_completed'].includes(event.type));
  const evaluating = events.some((event) => event.type === 'evaluation_starting');
  return <Panel title={t('evaluation.title')}><div className="live-evaluation-heading"><StatusBadge value={evaluating ? 'running' : 'pending'} /><span>{evaluating ? t('run.evaluationInProgress') : t('run.evaluationPending')}</span></div>{checks.length ? <ul className="check-list">{checks.map((event) => <li className="check-row" key={event.id}><StatusBadge value={event.status} /><span>{event.data?.file || event.data?.check || event.data?.checkType || t('evaluation.title')}</span></li>)}</ul> : <p className="subtle">{t('run.evaluationNoChecks')}</p>}</Panel>;
}

function CompetitionProgress({ events, result }) {
  const { t } = useI18n();
  const agents = useMemo(() => {
    const states = new Map();
    const started = events.find((event) => event.type === 'competition_started');
    for (const agentId of started?.data?.agentIds || []) states.set(agentId, { agentId, status: 'pending' });
    for (const event of events) {
      const agentId = event.data?.agentId;
      if (!agentId) continue;
      if (event.type === 'competition_candidate_starting') states.set(agentId, { agentId, status: 'running' });
      if (event.type === 'competition_candidate_completed') states.set(agentId, { agentId, status: event.data.status, score: event.data.score, verdict: event.data.verdict });
    }
    return [...states.values()];
  }, [events]);
  if (result?.ranking) return <Panel title={t('competition.title')}><CompetitionTable result={result} /></Panel>;
  return <Panel title={t('run.competitionProgress')}>{agents.length ? <div className="live-competitors">{agents.map((agent) => <article key={agent.agentId}><strong>{agent.agentId}</strong><StatusBadge value={agent.status} />{agent.score !== undefined && agent.score !== null && <span>{formatScore(agent.score)} · {agent.verdict}</span>}</article>)}</div> : <EmptyState>{t('run.competitionWaiting')}</EmptyState>}</Panel>;
}

export function LiveRunPage({ api, runId, useStream = useRunStream }) {
  const { t } = useI18n();
  const live = useStream(runId, { api });
  const [tab, setTab] = useState('activity');
  const session = live.session;
  const result = session?.result;
  const taskId = session?.taskId || session?.competitionId || result?.taskId || result?.competitionId;

  if (live.loading) return <LoadingState label={t('run.connecting')} />;
  if (live.expired) return <><PageHeader eyebrow="REAL-TIME" title={t('run.liveTitle')} /><Panel><EmptyState>{t('run.expired')}</EmptyState>{taskId && <a className="button-link standalone-link" href={`/history/${encodeURIComponent(taskId)}`}>{t('run.viewHistory')}</a>}</Panel></>;

  return <>
    <PageHeader eyebrow="REAL-TIME" title={t('run.liveTitle')} description={t('run.liveSubtitle')} action={<ConnectionStatus state={live.connectionState} />} />
    <ErrorNotice error={live.error} />
    {session?.state === 'failed' && <div className="state-message error-message" role="alert"><strong>{t('run.failed')}</strong><span>{session.error?.message || t('errors.server')}</span></div>}
    {live.connectionState === 'reconnecting' && <div className="state-message warning-message">{t('run.connectionLost')}</div>}
    <Panel><div className="metric-grid metric-grid-compact"><Metric label={t('run.runId')} value={runId} mono /><Metric label={t('run.taskId')} value={taskId || t('common.notAvailable')} mono /><Metric label="Status" value={<StatusBadge value={session?.state || 'starting'} />} /><Metric label={t('run.duration')} value={formatDuration(result?.execution?.durationMs)} /></div></Panel>
    <div className="run-session-grid"><Panel title={t('run.timeline')}><LiveTimeline events={live.events} /></Panel><Panel title={t('run.session')}><div className="tab-list" role="tablist"><button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>{t('run.activity')}</button><button type="button" role="tab" aria-selected={tab === 'terminal'} className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}>{t('run.terminal')}</button></div>{tab === 'activity' ? <LiveActivity events={live.events} /> : <div className="terminal-withheld"><strong>{t('run.terminalProtected')}</strong><p>{session?.state === 'completed' || session?.state === 'failed' ? t('run.terminalFinalUnavailable') : t('run.terminalWithheld')}</p></div>}</Panel></div>
    {session?.type === 'competition' && <CompetitionProgress events={live.events} result={result} />}
    <LiveEvaluation events={live.events} evaluation={result?.evaluation} />
    {result?.candidateAvailable && taskId && <a className="button-link standalone-link" href={`/candidates/${encodeURIComponent(taskId)}`}>{t('run.reviewCandidate')} →</a>}
  </>;
}
