import { formatDuration, formatScore } from '../utils/format';
import { EvaluationCard } from './EvaluationCard';
import { CompetitionTable } from './CompetitionTable';
import { EmptyState, Metric, Panel, StatusBadge } from './ui';

function ChangedFiles({ files = [], untrackedFiles = [] }) {
  if (files.length === 0 && untrackedFiles.length === 0) return <EmptyState>No changed files reported.</EmptyState>;
  return (
    <div className="file-columns">
      <div><h3>Changed files</h3><ul className="file-list">{files.map((file) => <li key={typeof file === 'string' ? file : file.path}><code>{typeof file === 'string' ? file : file.path}</code></li>)}</ul></div>
      <div><h3>Untracked files</h3>{untrackedFiles.length ? <ul className="file-list">{untrackedFiles.map((file) => <li key={file}><code>{file}</code></li>)}</ul> : <p className="subtle">None reported.</p>}</div>
    </div>
  );
}

export function ExecutionSummary({ result }) {
  if (!result) return null;
  const isCompetition = Array.isArray(result.candidates);
  const taskId = result.taskId || result.competitionId || result.history?.taskId;

  if (isCompetition) {
    return (
      <div className="result-stack">
        <Panel title="Competition result">
          <div className="metric-grid metric-grid-compact">
            <Metric label="Competition ID" value={taskId || '—'} />
            <Metric label="Status" value={<StatusBadge value={result.status} />} />
            <Metric label="Execution" value={result.executionMode || 'sequential'} />
            <Metric label="Winner" value={result.winner ? `${result.winner.agentId} · best candidate` : 'No valid candidate'} />
          </div>
          {result.message && <p>{result.message}</p>}
        </Panel>
        <Panel title="Deterministic ranking"><CompetitionTable result={result} /></Panel>
        {(result.candidates || []).map((candidate) => (
          <details className="candidate-result" key={candidate.agent.id}>
            <summary>{candidate.agent.name || candidate.agent.id} · {candidate.status} · Evaluation {formatScore(candidate.evaluation?.score)}</summary>
            <ChangedFiles files={candidate.changedFiles} untrackedFiles={candidate.untrackedFiles} />
            <EvaluationCard evaluation={candidate.evaluation} />
          </details>
        ))}
        {taskId && <a className="button-link standalone-link" href={`/candidates?taskId=${encodeURIComponent(taskId)}`}>Review winner candidate →</a>}
      </div>
    );
  }

  return (
    <div className="result-stack">
      <Panel title="Execution result">
        <div className="metric-grid metric-grid-compact">
          <Metric label="Task ID" value={taskId || 'Not created'} />
          <Metric label="Agent" value={result.selectedAgent?.name || result.selectedAgent?.id || '—'} />
          <Metric label="Status" value={<StatusBadge value={result.status} />} />
          <Metric label="Duration" value={formatDuration(result.execution?.durationMs)} />
          <Metric label="Branch" value={result.workspace?.branch || '—'} />
          <Metric label="Worktree" value={result.workspace?.worktree || '—'} />
        </div>
        {result.message && <p>{result.message}</p>}
      </Panel>
      {result.evaluation && <EvaluationCard evaluation={result.evaluation} />}
      {result.changes && <Panel title="Repository evidence"><ChangedFiles files={result.changes.files} untrackedFiles={result.changes.untrackedFiles} /></Panel>}
      {taskId && result.candidateFingerprint && <a className="button-link standalone-link" href={`/candidates?taskId=${encodeURIComponent(taskId)}`}>Review candidate →</a>}
    </div>
  );
}
