import { useEffect, useState } from 'react';
import { EmptyState, ErrorNotice, LoadingState, PageHeader, Panel, StatusBadge } from '../components/ui';
import { useI18n } from '../i18n/I18nContext';
import { formatDate } from '../utils/format';

export function CandidatesPage({ api, onNavigate }) {
  const { t } = useI18n(); const [state, setState] = useState({ loading: true, tasks: [], error: null });
  useEffect(() => { let active = true; api.getHistory(100).then((response) => { if (active) setState({ loading: false, tasks: (response.tasks || []).filter((task) => ['completed', 'completed_with_warnings', 'merged'].includes(task.status) || ['approved', 'rejected'].includes(task.decision)), error: null }); }).catch((error) => { if (active) setState({ loading: false, tasks: [], error }); }); return () => { active = false; }; }, [api]);
  return <><PageHeader eyebrow="HUMAN REVIEW" title={t('candidate.listTitle')} description={t('candidate.subtitle')} /><ErrorNotice error={state.error} />{state.loading ? <LoadingState /> : <Panel>{state.tasks.length ? <div className="session-list">{state.tasks.map((task) => <button type="button" className="session-row" key={task.id} onClick={() => onNavigate(`/candidates/${task.id}`)}><span><strong>{task.task}</strong><small>{task.winnerAgentId || task.mode} · {formatDate(task.createdAt)}</small></span><StatusBadge value={task.decision || 'pending'} /></button>)}</div> : <EmptyState>{t('candidate.noCandidates')}</EmptyState>}</Panel>}</>;
}
