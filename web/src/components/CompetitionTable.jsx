import { useI18n } from '../i18n/I18nContext';
import { formatDuration, formatScore } from '../utils/format';
import { EmptyState, StatusBadge } from './ui';

export function CompetitionTable({ result }) {
  const { t } = useI18n();
  const candidates = new Map((result?.candidates || []).map((candidate) => [candidate.agent?.id, candidate]));
  const ranking = result?.ranking || [];
  if (!ranking.length) return <EmptyState>{t('competition.noRanking')}</EmptyState>;
  return <div className="table-scroll"><table><thead><tr><th>{t('competition.agent')}</th><th>{t('competition.router')}</th><th>{t('competition.quality')}</th><th>{t('competition.speed')}</th><th>{t('competition.final')}</th><th>{t('evaluation.verdict')}</th><th>Status</th><th>{t('competition.candidate')}</th></tr></thead><tbody>{ranking.map((entry) => {
    const candidate = candidates.get(entry.agentId) || {};
    const winner = result.winner?.agentId === entry.agentId && entry.eligible;
    return <tr key={entry.agentId} className={winner ? 'winner-row' : ''}><td><strong>{candidate.agent?.name || entry.agentId}</strong><small className="table-subtitle">{formatDuration(entry.durationMs)}</small></td><td>{formatScore(entry.routerScore)}</td><td>{formatScore(entry.evaluationScore)}</td><td>{formatScore(entry.speedScore)}</td><td><strong>{formatScore(entry.competitionScore)}</strong></td><td><StatusBadge value={candidate.evaluation?.verdict || 'unknown'} /></td><td><StatusBadge value={entry.status} /></td><td>{winner ? <span className="winner-label">{t('competition.best')}</span> : entry.eligible ? 'Eligible' : 'Not eligible'}</td></tr>;
  })}</tbody></table></div>;
}
