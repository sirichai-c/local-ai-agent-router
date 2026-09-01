import { usePreferences } from '../context/PreferencesContext';
import { useI18n } from '../i18n/I18nContext';
import { formatScore } from '../utils/format';
import { EmptyState, StatusBadge } from './ui';

export function AgentRanking({ analysis }) {
  const { t } = useI18n();
  const { detailMode } = usePreferences();
  const ranking = analysis?.ranking || [];
  if (!ranking.length) return <EmptyState>{t('analysis.noResult')}</EmptyState>;
  return <div className="ranking-list">
    {(analysis.recommendedAgent || analysis.selectedAgent) && <div className="routing-summary"><span>{t('analysis.recommended')} <strong>{analysis.recommendedAgent?.name || analysis.recommendedAgent?.id || '—'}</strong></span><span>{t('analysis.selected')} <strong>{analysis.selectedAgent?.name || analysis.selectedAgent?.id || t('analysis.noAgent')}</strong></span></div>}
    {ranking.map((agent, index) => <article className="ranking-row" key={agent.id}><span className="rank-number">{index + 1}</span><div className="ranking-agent"><strong>{agent.name || agent.id}</strong><small>{agent.id}</small></div><div className="ranking-scores"><strong>{formatScore(agent.score)}</strong>{detailMode === 'advanced' && <><span>{t('analysis.static')} {formatScore(agent.staticScore)}</span>{agent.historicalScore != null && <span>{t('analysis.history')} {formatScore(agent.historicalScore)}</span>}{agent.recentScore != null && <span>{t('analysis.recent')} {formatScore(agent.recentScore)}</span>}</>}</div><div className="ranking-state"><StatusBadge value={agent.available ? 'available' : 'unavailable'} /><small>{agent.adaptive ? `${t('analysis.adaptiveActive')} · ${agent.sampleSize} ${t('common.samples')}` : t('analysis.staticOnly')}</small></div></article>)}
  </div>;
}

export function Classification({ classification = {} }) {
  const { t } = useI18n();
  const categories = Object.entries(classification).filter(([, score]) => Number(score) > 0);
  if (!categories.length) return <EmptyState>{t('analysis.noResult')}</EmptyState>;
  return <div className="category-grid">{categories.map(([category, score]) => <div className="category-score" key={category}><span>{t(`category.${category}`)}</span><strong>{formatScore(score)}</strong><div className="score-track"><i style={{ width: `${Math.max(0, Math.min(100, Number(score)))}%` }} /></div></div>)}</div>;
}
