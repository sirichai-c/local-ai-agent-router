import { formatScore } from '../utils/format';
import { EmptyState, Metric, Panel, StatusBadge } from './ui';

function CheckRow({ check }) {
  const status = check.executed === false || check.skipped
    ? 'not run'
    : check.passed === true
      ? 'pass'
      : check.passed === false
        ? 'fail'
        : 'unknown';
  const label = check.file || check.type || check.name || 'Check';

  return (
    <li className="check-row">
      <StatusBadge value={status} />
      <span>{label}</span>
      {(check.reason || check.message) && <small>{check.reason || check.message}</small>}
    </li>
  );
}

export function EvaluationCard({ evaluation, compact = false }) {
  if (!evaluation) return <EmptyState>No evaluator result available.</EmptyState>;
  const projectScripts = evaluation.project?.scripts || {};
  const projectChecks = Object.entries(projectScripts).map(([name, check]) => ({ name, type: `npm-${name}`, ...check }));
  const sandbox = evaluation.project?.sandbox;
  const sandboxExecuted = sandbox?.executed === true;
  const checkNetworks = [...new Set(projectChecks.filter((check) => check.executed).map((check) => check.network).filter(Boolean))];

  return (
    <Panel title="Evaluation" className="evaluation-card">
      <div className="metric-grid metric-grid-compact">
        <Metric label="Score" value={`${formatScore(evaluation.score)} / 100`} />
        <Metric label="Verdict" value={<StatusBadge value={String(evaluation.verdict || 'unknown').toUpperCase()} />} />
        {sandbox !== undefined && (
          <Metric label="Sandboxed" value={sandboxExecuted ? 'Yes' : 'No'} detail={sandbox?.reason || sandbox?.image} />
        )}
        {checkNetworks.length > 0 && <Metric label="Project script network" value={checkNetworks.join(', ')} />}
      </div>

      {!compact && evaluation.staticChecks?.length > 0 && (
        <div className="check-group">
          <h3>Static checks</h3>
          <ul className="check-list">{evaluation.staticChecks.map((check, index) => <CheckRow check={check} key={`${check.file}-${index}`} />)}</ul>
        </div>
      )}

      {!compact && projectChecks.length > 0 && (
        <div className="check-group">
          <h3>Project checks</h3>
          <ul className="check-list">{projectChecks.map((check) => <CheckRow check={check} key={check.name} />)}</ul>
        </div>
      )}

      {!compact && evaluation.reasons?.length > 0 && (
        <div className="check-group">
          <h3>Evidence</h3>
          <ul className="reason-list">
            {evaluation.reasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>
                <code>{reason.code}</code>
                <span>{reason.message || (reason.impact ? `${reason.impact} points` : 'No deduction')}</span>
                {reason.file && <small>{reason.file}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
