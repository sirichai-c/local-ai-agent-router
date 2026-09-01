import { useEffect, useState } from 'react';
import { EmptyState, ErrorNotice, LoadingState, PageHeader, Panel, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n/I18nContext';
import { formatDate } from '../utils/format';

export function CompetitionsPage({ api, onNavigate }) {
  const { t } = useI18n(); const [state, setState] = useState({ loading: true, tasks: [], error: null });
  useEffect(() => { let active = true; api.getHistory(100).then((response) => { if (active) setState({ loading: false, tasks: (response.tasks || []).filter((task) => task.mode === 'competition'), error: null }); }).catch((error) => { if (active) setState({ loading: false, tasks: [], error }); }); return () => { active = false; }; }, [api]);
  return <><PageHeader eyebrow="WORK" title={t('competition.title')} description={t('competition.subtitle')} action={<button type="button" onClick={() => onNavigate('/new-task')}>{t('task.runCompetition')}</button>} /><ErrorNotice error={state.error} />{state.loading ? <LoadingState /> : state.tasks.length ? <div className="competition-list">{state.tasks.map((task) => <Panel key={task.id} className="competition-list-card"><button type="button" className="competition-card-button" onClick={() => onNavigate(`/history/${task.id}`)}><div><strong>{task.task}</strong><small>{formatDate(task.createdAt)}</small></div><div className="competition-card-meta"><span>{task.winnerAgentId ? `${t('competition.best')}: ${task.winnerAgentId}` : t('competition.noRanking')}</span><StatusBadge value={task.decision !== 'pending' ? task.decision : task.status} /></div></button></Panel>)}</div> : <EmptyState>{t('competition.noRuns')}</EmptyState>}</>;
}
