import { useCallback, useState } from 'react';
import { DiffViewer } from '../components/DiffViewer';
import { ConfirmDialog, EmptyState, ErrorNotice, LoadingState, Metric, Panel, StatusBadge } from '../components/ui';
import { formatScore } from '../utils/format';

function initialTaskId() {
  return new URLSearchParams(window.location.search).get('taskId') || '';
}

const REVIEW_CONFLICTS = new Set([
  'candidate_changed', 'fingerprint_mismatch', 'stale_base',
  'repository_not_clean', 'wrong_target_branch',
]);

export function CandidatePage({ api }) {
  const [taskId, setTaskId] = useState(initialTaskId);
  const [review, setReview] = useState(null);
  const [actionResult, setActionResult] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [validation, setValidation] = useState('');

  const loadCandidate = useCallback(async () => {
    if (!taskId.trim()) { setValidation('Task ID is required.'); return; }
    setLoading(true); setError(null); setValidation(''); setActionResult(null);
    try { setReview(await api.getCandidate(taskId.trim())); }
    catch (requestError) { setError(requestError); setReview(null); }
    finally { setLoading(false); }
  }, [api, taskId]);

  const decide = async (decision) => {
    setBusy(true); setError(null);
    try {
      const response = decision === 'approve'
        ? await api.approveCandidate(taskId.trim(), review.candidate.fingerprint)
        : await api.rejectCandidate(taskId.trim());
      setActionResult(response);
      setConfirm(null);
      try { setReview(await api.getCandidate(taskId.trim())); } catch { /* cleanup can remove the worktree */ }
    } catch (requestError) {
      setError(requestError);
      setConfirm(null);
    } finally { setBusy(false); }
  };

  const conflict = error?.status === 409 && REVIEW_CONFLICTS.has(error.code);
  const task = review?.task;
  const candidate = review?.candidate;
  const pending = task?.decision === 'pending';

  return (
    <>
      <header className="page-heading"><div><span className="eyebrow">Human review</span><h1>Candidate review</h1><p>Approve only the exact fingerprint shown in the reviewed state.</p></div></header>
      <Panel title="Find candidate">
        <div className="inline-form">
          <label htmlFor="candidate-task">Task or competition ID</label>
          <input id="candidate-task" value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="task-id" />
          <button type="button" onClick={loadCandidate} disabled={loading}>Load candidate</button>
        </div>
        {validation && <div className="validation-error" role="alert">{validation}</div>}
        <ErrorNotice error={error} action={conflict ? <button type="button" className="button-secondary" onClick={loadCandidate}>Refresh candidate for review</button> : null} />
        {conflict && <p className="conflict-guidance">The candidate must be refreshed and reviewed again. Approval was not retried.</p>}
        {loading && <LoadingState label="Inspecting current candidate worktree…" />}
      </Panel>

      {review && (
        <div className="result-stack">
          <Panel title="Approval state">
            <div className="metric-grid metric-grid-compact">
              <Metric label="Decision" value={<StatusBadge value={task.decision} />} />
              <Metric label="Approvable" value={<StatusBadge value={review.approvable ? 'yes' : 'no'} tone={review.approvable ? 'success' : 'danger'} />} detail={review.reason || 'Fresh candidate matches evaluated fingerprint'} />
              <Metric label="Target branch" value={task.targetBranch || '—'} />
              <Metric label="Base commit" value={<code>{task.baseCommit || '—'}</code>} />
            </div>
          </Panel>
          <Panel title="Candidate evidence">
            <div className="metric-grid metric-grid-compact">
              <Metric label="Agent" value={candidate.agentId} />
              <Metric label="Status" value={<StatusBadge value={candidate.status} />} />
              <Metric label="Evaluation" value={`${formatScore(candidate.evaluationScore)} / 100`} />
              <Metric label="Verdict" value={<StatusBadge value={candidate.verdict} />} />
              <Metric label="Competition score" value={formatScore(candidate.competitionScore)} />
              <Metric label="Branch" value={<code>{candidate.branch || '—'}</code>} />
            </div>
            <div className="fingerprint"><span>Candidate fingerprint</span><code>{candidate.fingerprint || 'Not captured'}</code></div>
            <h3>Changed files</h3>
            {candidate.changedFiles?.length ? <ul className="file-list">{candidate.changedFiles.map((file) => <li key={typeof file === 'string' ? file : file.path}><code>{typeof file === 'string' ? file : file.path}</code></li>)}</ul> : <EmptyState>No changed files reported.</EmptyState>}
            <DiffViewer diff={candidate.trackedDiff} untrackedFiles={candidate.untrackedFiles} redacted={candidate.diffRedacted} />
          </Panel>

          {pending && (
            <Panel title="Human decision">
              <p>Winning or passing evaluation does not merge code. A human decision is required.</p>
              <div className="form-actions">
                <button type="button" className="button-danger" disabled={busy} onClick={() => setConfirm('reject')}>Reject candidate</button>
                <button type="button" disabled={busy || !review.approvable || !candidate.fingerprint} onClick={() => setConfirm('approve')}>Approve candidate</button>
              </div>
            </Panel>
          )}
        </div>
      )}

      {!review && !loading && !error && <EmptyState>Enter a task ID to inspect a candidate.</EmptyState>}

      {actionResult && (
        <Panel title={actionResult.status === 'rejected' || actionResult.status === 'already_rejected' ? 'Rejected' : 'Approved'}>
          {actionResult.status === 'rejected' || actionResult.status === 'already_rejected' ? (
            <p>Target repository was not modified.</p>
          ) : (
            <div className="metric-grid metric-grid-compact">
              <Metric label="Status" value={<StatusBadge value={actionResult.status} />} />
              <Metric label="Candidate commit" value={<code>{actionResult.candidateCommit || '—'}</code>} />
              <Metric label="Merge commit" value={<code>{actionResult.mergeCommit || '—'}</code>} />
              <Metric label="Remote push" value="Not performed" />
            </div>
          )}
          {actionResult.cleanupWarnings?.length > 0 && <div className="state-message state-warning">Cleanup warnings: {actionResult.cleanupWarnings.join(', ')}</div>}
        </Panel>
      )}

      <ConfirmDialog open={confirm === 'approve'} title="Approve Candidate?" confirmLabel="Approve" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => decide('approve')}>
        <p>This will create a candidate commit, merge it into the local target branch, and clean up Agent worktrees.</p><p><strong>It will not push to a remote.</strong></p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'reject'} title="Reject Candidate?" confirmLabel="Reject" tone="danger" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => decide('reject')}>
        <p>This will discard disposable Agent candidates and keep the target branch unchanged.</p>
      </ConfirmDialog>
    </>
  );
}
