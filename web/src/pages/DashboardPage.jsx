import { useEffect, useMemo, useState } from 'react';
import { AgentRanking, Classification } from '../components/AgentRanking';
import { TaskForm } from '../components/TaskForm';
import { EmptyState, ErrorNotice, LoadingState, Metric, Panel, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n/I18nContext';
import { formatDate, formatScore } from '../utils/format';

const EMPTY_FORM = { task: '', workspace: '', mode: 'auto', agents: [], analyzeFirst: true, priority: 50 };
export function DashboardPage({ api, onNavigate }) {
  const { t } = useI18n(); const [form, setForm] = useState(EMPTY_FORM); const [analysisBusy, setAnalysisBusy] = useState(false); const [analysis, setAnalysis] = useState(null); const [validation, setValidation] = useState('');
  const [state, setState] = useState({ loading: true, error: null, health: null, ollama: null, models: null, agents: [], tasks: [], performance: [] });
  useEffect(() => {
    let active = true;
    (async () => {
      const core = await Promise.allSettled([api.getHealth(), api.getOllamaHealth(), api.getModels(), api.getAgents(), api.getHistory(10)]);
      if (!active) return;
      const agents = core[3].status === 'fulfilled' ? core[3].value.agents || [] : [];
      const performance = await Promise.all(agents.map(async (agent) => { try { return await api.getAgentPerformance(agent.id); } catch { return null; } }));
      if (active) setState({ loading: false, error: core.find((entry) => entry.status === 'rejected')?.reason || null, health: core[0].status === 'fulfilled' ? core[0].value : null, ollama: core[1].status === 'fulfilled' ? core[1].value : null, models: core[2].status === 'fulfilled' ? core[2].value : null, agents, tasks: core[4].status === 'fulfilled' ? core[4].value.tasks || [] : [], performance: performance.filter(Boolean) });
    })();
    return () => { active = false; };
  }, [api]);
  const greeting = useMemo(() => { const hour = new Date().getHours(); return t(hour < 12 ? 'overview.greeting.morning' : hour < 17 ? 'overview.greeting.afternoon' : 'overview.greeting.evening'); }, [t]);
  const pending = state.tasks.filter((task) => (task.decision || 'pending') === 'pending' && ['completed', 'completed_with_warnings'].includes(task.status));
  const analyze = async () => { if (!form.task.trim()) { setValidation(t('task.validation.task')); return; } setAnalysisBusy(true); setValidation(''); try { setAnalysis(await api.analyzeTask(form.task)); } catch (error) { setState((current) => ({ ...current, error })); } finally { setAnalysisBusy(false); } };
  return <>
    <header className="overview-heading"><span className="eyebrow">{t('overview.eyebrow')}</span><h1>{greeting}</h1><p>{t('overview.question')}</p></header>
    <div className="overview-layout">
      <section className="composer-panel"><TaskForm form={form} setForm={setForm} agents={state.agents} busy={analysisBusy} onAnalyze={analyze} onRun={() => onNavigate('/new-task')} compact />{validation && <div className="validation-error" role="alert">{validation}</div>}</section>
      <aside className="overview-side"><Panel title={t('overview.systemStatus')}><div className="compact-status"><span>{t('system.backend')}</span><StatusBadge value={state.health?.status === 'ok' ? 'online' : 'offline'} /><span>{t('system.ollama')}</span><StatusBadge value={state.ollama?.status === 'ok' ? 'online' : 'offline'} /><span>{t('system.model')}</span><strong>{state.models?.configuredModel || state.ollama?.model || t('common.notAvailable')}</strong></div></Panel><Panel title={t('overview.resources')}><div className="resource-placeholder"><Metric label={t('system.cpu')} value={t('common.notAvailable')} /><Metric label={t('system.ram')} value={t('common.notAvailable')} /><Metric label={t('system.gpu')} value={t('common.notAvailable')} /></div><small>{t('system.resourceNote')}</small></Panel></aside>
    </div>
    {analysis && <div className="two-column overview-analysis"><Panel title={t('analysis.categories')}><Classification classification={analysis.classification} /></Panel><Panel title={t('analysis.ranking')}><AgentRanking analysis={analysis} /></Panel></div>}
    {state.loading ? <LoadingState /> : <>
      <ErrorNotice error={state.error} />
      <div className="two-column">
        <Panel title={t('overview.needsReview')}>{pending.length ? <div className="activity-list">{pending.slice(0, 5).map((task) => <button type="button" className="activity-row" key={task.id} onClick={() => onNavigate(`/candidates/${task.id}`)}><span><strong>{task.task}</strong><small>{task.winnerAgentId || task.mode} · {formatDate(task.completedAt || task.createdAt)}</small></span><StatusBadge value="pending" /></button>)}</div> : <EmptyState>{t('overview.noReview')}</EmptyState>}</Panel>
        <Panel title={t('overview.recentRuns')} action={<button type="button" className="button-link" onClick={() => onNavigate('/history')}>{t('common.view')}</button>}>{state.tasks.length ? <div className="activity-list">{state.tasks.slice(0, 5).map((task) => <article key={task.id}><div><strong>{task.task}</strong><small>{task.winnerAgentId || task.mode} · {formatDate(task.createdAt)}</small></div><StatusBadge value={task.decision !== 'pending' ? task.decision : task.status} /></article>)}</div> : <EmptyState>{t('overview.noRuns')}</EmptyState>}</Panel>
      </div>
      <Panel title={t('performance.title')}>{state.performance.some((item) => item.global?.sampleSize > 0) ? <div className="performance-grid">{state.performance.filter((item) => item.global?.sampleSize > 0).map((item) => <article className="performance-card" key={item.agent.id}><strong>{item.agent.name || item.agent.id}</strong><span className="large-number">{formatScore(item.global.averageEvaluationScore)}</span><small>{item.global.sampleSize} {t('common.samples')}</small></article>)}</div> : <EmptyState>{t('performance.noHistory')}</EmptyState>}</Panel>
    </>}
  </>;
}
