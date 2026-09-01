import { useEffect, useState } from 'react';
import { EmptyState, ErrorNotice, LoadingState, PageHeader, Panel, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n/I18nContext';
import { formatDate } from '../utils/format';

export function RunsPage({ api, onNavigate }) {
  const { t } = useI18n(); const [state, setState] = useState({ loading: true, tasks: [], error: null });
  useEffect(() => { let active = true; api.getHistory(50).then((response) => { if (active) setState({ loading: false, tasks: (response.tasks || []).filter((task) => task.mode === 'single'), error: null }); }).catch((error) => { if (active) setState({ loading: false, tasks: [], error }); }); return () => { active = false; }; }, [api]);
  return <><PageHeader eyebrow="WORK" title={t('nav.runs')} description={t('history.subtitle')} action={<button type="button" onClick={() => onNavigate('/new-task')}>{t('task.newTitle')}</button>} /><ErrorNotice error={state.error} />{state.loading ? <LoadingState /> : <Panel>{state.tasks.length ? <div className="session-list">{state.tasks.map((task) => <button type="button" className="session-row" key={task.id} onClick={() => onNavigate(`/history/${task.id}`)}><span><strong>{task.task}</strong><small>{formatDate(task.createdAt)} · {task.winnerAgentId || 'Auto Agent'}</small></span><StatusBadge value={task.decision !== 'pending' ? task.decision : task.status} /></button>)}</div> : <EmptyState>{t('history.noHistory')}</EmptyState>}</Panel>}</>;
}
