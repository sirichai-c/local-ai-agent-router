import { useEffect, useState } from 'react';
import { AgentRanking, Classification } from '../components/AgentRanking';
import { TaskForm } from '../components/TaskForm';
import { ErrorNotice, LoadingState, PageHeader, Panel } from '../components/ui';
import { useI18n } from '../i18n/I18nContext';

const EMPTY_FORM = { task: '', workspace: '', mode: 'auto', agents: [], analyzeFirst: true, priority: 50 };
export function RunTaskPage({ api, onNavigate }) {
  const { t } = useI18n();
  const [form, setForm] = useState(EMPTY_FORM); const [agents, setAgents] = useState([]); const [analysis, setAnalysis] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(null); const [validation, setValidation] = useState('');
  useEffect(() => { let active = true; api.getAgents().then((response) => { if (active) setAgents(response.agents || []); }).catch((requestError) => { if (active) setError(requestError); }); return () => { active = false; }; }, [api]);
  const validate = (forRun) => !form.task.trim() ? t('task.validation.task') : forRun && !form.workspace.trim() ? t('task.validation.workspace') : forRun && form.mode === 'competition' && form.agents.length < 2 ? t('task.validation.competitors') : '';
  const analyze = async () => { const problem = validate(false); setValidation(problem); if (problem) return null; setBusy(true); setError(null); try { const value = await api.analyzeTask(form.task); setAnalysis(value); return value; } catch (requestError) { setError(requestError); return null; } finally { setBusy(false); } };
  const run = async () => { const problem = validate(true); setValidation(problem); if (problem) return; setBusy(true); setError(null); try { if (form.analyzeFirst) setAnalysis(await api.analyzeTask(form.task)); const submitted = await api.submitJob({ type: form.mode === 'competition' ? 'competition' : 'single', task: form.task, workspace: form.workspace, agents: form.mode === 'competition' ? form.agents : undefined, priority: form.priority }); onNavigate(`/runs/${encodeURIComponent(submitted.runId)}`); } catch (requestError) { setError(requestError); } finally { setBusy(false); } };
  return <><PageHeader eyebrow={t('task.eyebrow')} title={t('task.newTitle')} description={t('overview.description')} /><div className="task-layout"><Panel title={t('task.prompt')}><TaskForm form={form} setForm={setForm} agents={agents} busy={busy} onAnalyze={analyze} onRun={run} />{validation && <div className="validation-error" role="alert">{validation}</div>}<ErrorNotice error={error} />{busy && <LoadingState label={form.mode === 'competition' ? t('task.competitionStarting') : t('task.starting')} />}</Panel><div className="analysis-column"><Panel title={t('analysis.categories')}><Classification classification={analysis?.classification} /></Panel><Panel title={t('analysis.ranking')}><AgentRanking analysis={analysis} /></Panel></div></div></>;
}
