import { formatDuration, formatScore } from '../utils/format';
import { EmptyState, StatusBadge } from './ui';

export function CompetitionTable({ result }) {
  const candidatesById = new Map((result?.candidates || []).map((candidate) => [candidate.agent?.id, candidate]));
  const ranking = result?.ranking || [];

  if (ranking.length === 0) return <EmptyState>No competition ranking available.</EmptyState>;

  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Agent</th><th>Router</th><th>Evaluation</th><th>Speed</th><th>Competition</th><th>Verdict</th><th>Status</th><th>Result</th></tr></thead>
        <tbody>
          {ranking.map((entry) => {
            const candidate = candidatesById.get(entry.agentId) || {};
            const winner = result.winner?.agentId === entry.agentId;
            return (
              <tr key={entry.agentId}>
                <td><strong>{candidate.agent?.name || entry.agentId}</strong><small className="table-subtitle">{formatDuration(entry.durationMs)}</small></td>
                <td>{formatScore(entry.routerScore)}</td>
                <td>{formatScore(entry.evaluationScore)}</td>
                <td>{formatScore(entry.speedScore)}</td>
                <td>{formatScore(entry.competitionScore)}</td>
                <td><StatusBadge value={candidate.evaluation?.verdict || 'unknown'} /></td>
                <td><StatusBadge value={entry.status} /></td>
                <td>{winner ? <span className="winner-label">★ Best candidate</span> : (entry.eligible ? 'Eligible' : 'Not eligible')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
