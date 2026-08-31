import { CATEGORY_LABELS, formatScore } from '../utils/format';
import { EmptyState, StatusBadge } from './ui';

export function AgentRanking({ analysis }) {
  const ranking = analysis?.ranking || [];

  if (ranking.length === 0) return <EmptyState>No router analysis yet.</EmptyState>;

  return (
    <div className="ranking-list">
      {(analysis.recommendedAgent || analysis.selectedAgent) && (
        <div className="routing-summary">
          <span>Recommended <strong>{analysis.recommendedAgent?.name || analysis.recommendedAgent?.id || '—'}</strong></span>
          <span>Selected <strong>{analysis.selectedAgent?.name || analysis.selectedAgent?.id || 'No available Agent'}</strong></span>
        </div>
      )}
      {ranking.map((agent, index) => (
        <article className="ranking-row" key={agent.id}>
          <span className="rank-number">{index + 1}</span>
          <div className="ranking-agent">
            <strong>{agent.name || agent.id}</strong>
            <small>{agent.id}</small>
          </div>
          <div className="ranking-scores">
            <strong>{formatScore(agent.score)}</strong>
            <span>Static {formatScore(agent.staticScore)}</span>
            {agent.historicalScore !== null && agent.historicalScore !== undefined && (
              <span>History {formatScore(agent.historicalScore)}</span>
            )}
            {agent.recentScore !== null && agent.recentScore !== undefined && (
              <span>Recent {formatScore(agent.recentScore)}</span>
            )}
          </div>
          <div className="ranking-state">
            <StatusBadge value={agent.available ? 'available' : 'unavailable'} />
            <small>{agent.adaptive ? `Adaptive · ${agent.sampleSize} samples` : 'Static score'}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

export function Classification({ classification = {} }) {
  const categories = Object.entries(classification).filter(([, score]) => Number(score) > 0);
  if (categories.length === 0) return <EmptyState>No task categories detected.</EmptyState>;

  return (
    <div className="category-grid">
      {categories.map(([category, score]) => (
        <div className="category-score" key={category}>
          <span>{CATEGORY_LABELS[category] || category}</span>
          <strong>{formatScore(score)}</strong>
          <div className="score-track"><i style={{ width: `${Math.min(100, Number(score))}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
