import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { StatusBadge } from './ui';
import { usePreferences } from '../context/PreferencesContext';

export function TaskForm({ form, setForm, agents, busy, onAnalyze, onRun, compact = false }) {
  const { t } = useI18n();
  const { detailMode } = usePreferences();
  const availableAgents = agents.filter((agent) => agent.available);
  useEffect(() => {
    if (form.mode !== 'competition') return;
    const selected = form.agents.filter((id) => availableAgents.some((agent) => agent.id === id));
    if (selected.length === 0 && availableAgents.length >= 2) setForm((current) => ({ ...current, agents: availableAgents.slice(0, 2).map((agent) => agent.id) }));
  }, [availableAgents, form.agents, form.mode, setForm]);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const toggleAgent = (agentId) => update('agents', form.agents.includes(agentId) ? form.agents.filter((id) => id !== agentId) : [...form.agents, agentId]);
  return <form className={`task-form ${compact ? 'task-form-compact' : ''}`} onSubmit={(event) => { event.preventDefault(); onRun(); }}>
    <label htmlFor="task">{t('task.prompt')}</label>
    <textarea id="task" rows={compact ? 4 : 8} value={form.task} onChange={(event) => update('task', event.target.value)} placeholder={t('task.placeholder')} disabled={busy} />
    <label htmlFor="workspace">{t('task.workspace')}</label>
    <input id="workspace" value={form.workspace} onChange={(event) => update('workspace', event.target.value)} placeholder="C:\Projects\my-api" disabled={busy} />
    {!compact && <small className="field-help">{t('task.workspaceHint')}</small>}
    <fieldset><legend>{t('task.mode')}</legend><div className="mode-grid">
      <label className="option-card"><input type="radio" name="mode" value="auto" checked={form.mode === 'auto'} onChange={() => update('mode', 'auto')} disabled={busy} /><span><strong>{t('task.auto')}</strong><small>{t('task.autoHelp')}</small></span></label>
      <label className="option-card"><input type="radio" name="mode" value="competition" checked={form.mode === 'competition'} onChange={() => update('mode', 'competition')} disabled={busy} /><span><strong>{t('task.competition')}</strong><small>{t('task.competitionHelp')}</small></span></label>
    </div></fieldset>
    {form.mode === 'competition' && <fieldset><legend>{t('task.competitors')}</legend><div className="agent-options">{agents.map((agent) => <label className={`agent-option ${agent.available ? '' : 'disabled'}`.trim()} key={agent.id}><input type="checkbox" checked={form.agents.includes(agent.id)} onChange={() => toggleAgent(agent.id)} disabled={busy || !agent.available} /><span><strong>{agent.name}</strong><small>{agent.runtime || 'host'}</small></span><StatusBadge value={agent.available ? 'available' : 'unavailable'} /></label>)}</div></fieldset>}
    {!compact && <div className="priority-field"><label htmlFor="priority">{t('job.priority')}</label><select id="priority" value={form.priority ?? 50} disabled={busy} onChange={(event) => update('priority', Number(event.target.value))}><option value="25">{t('job.priority.low')}</option><option value="50">{t('job.priority.normal')}</option><option value="75">{t('job.priority.high')}</option><option value="100">{t('job.priority.urgent')}</option></select>{detailMode === 'advanced' && <label className="numeric-priority">{t('job.priority.numeric')}<input type="number" min="0" max="100" value={form.priority ?? 50} disabled={busy} onChange={(event) => update('priority', Number(event.target.value))} /></label>}</div>}
    {!compact && <label className="checkbox-row"><input type="checkbox" checked={form.analyzeFirst} onChange={(event) => update('analyzeFirst', event.target.checked)} disabled={busy} />{t('task.analyzeFirst')}</label>}
    <div className="form-actions"><button type="button" className="button-secondary" onClick={onAnalyze} disabled={busy}>{t('task.analyze')}</button>{!compact && <button type="submit" disabled={busy}>{busy ? t('common.loading') : form.mode === 'competition' ? t('task.runCompetition') : t('task.run')}</button>}</div>
  </form>;
}
