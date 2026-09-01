import { useCallback, useEffect, useMemo, useState } from 'react';
import { DiffViewer } from '../components/DiffViewer';
import { ConfirmDialog, EmptyState, ErrorNotice, LoadingState, Metric, PageHeader, Panel, StatusBadge } from '../components/ui';
import { usePreferences } from '../context/PreferencesContext';
import { useI18n } from '../i18n/I18nContext';
import { formatScore } from '../utils/format';

const REVIEW_CONFLICTS = new Set(['candidate_changed', 'fingerprint_mismatch', 'stale_base', 'repository_not_clean', 'wrong_target_branch']);
function initialTaskId(routeTaskId) { return routeTaskId || new URLSearchParams(window.location.search).get('taskId') || ''; }

export function CandidatePage({ api, routeTaskId = '' }) {
  const { t } = useI18n(); const { detailMode } = usePreferences();
  const [taskId, setTaskId] = useState(() => initialTaskId(routeTaskId));
  const [review, setReview] = useState(null); const [actionResult, setActionResult] = useState(null); const [confirm, setConfirm] = useState(null); const [approvalText, setApprovalText] = useState('');
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(null); const [validation, setValidation] = useState('');
  const loadCandidate = useCallback(async () => {
    if (!taskId.trim()) { setValidation(t('task.validation.task')); return; }
    setLoading(true); setError(null); setValidation(''); setActionResult(null);
    try { setReview(await api.getCandidate(taskId.trim())); } catch (requestError) { setError(requestError); setReview(null); } finally { setLoading(false); }
  }, [api, taskId, t]);
  useEffect(() => { if (routeTaskId) loadCandidate(); }, [routeTaskId]); // direct route loader
  const decide = async (decision) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = decision === 'approve' ? await api.approveCandidate(taskId.trim(), review.candidate.fingerprint) : await api.rejectCandidate(taskId.trim());
      setActionResult(response); setConfirm(null); setApprovalText('');
      try { setReview(await api.getCandidate(taskId.trim())); } catch { /* valid cleanup may remove the worktree */ }
    } catch (requestError) { setError(requestError); setConfirm(null); } finally { setBusy(false); }
  };
  const conflict = error?.status === 409 && REVIEW_CONFLICTS.has(error.code);
  const task = review?.task; const candidate = review?.candidate; const pending = task?.decision === 'pending'; const highRisk = String(candidate?.verdict || '').toLowerCase() === 'warning';
  const files = useMemo(() => (candidate?.changedFiles || []).map((file) => ({
    path: typeof file === 'string' ? file : file.path,
    status: typeof file === 'string' ? null : file.status,
  })), [candidate]);

  return <>
    <PageHeader eyebrow="HUMAN REVIEW" title={t('candidate.title')} description={t('candidate.subtitle')} />
    <Panel title={t('candidate.find')}>
      <div className="inline-form"><label htmlFor="candidate-task">{t('candidate.taskId')}</label><input id="candidate-task" value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="task-id" /><button type="button" onClick={loadCandidate} disabled={loading}>{t('candidate.load')}</button></div>
      {validation && <div className="validation-error" role="alert">{validation}</div>}
      <ErrorNotice error={error} action={conflict ? <button type="button" className="button-secondary" onClick={loadCandidate}>{t('candidate.refreshReview')}</button> : null} />
      {loading && <LoadingState />}
    </Panel>
    {review && <div className="candidate-review-grid">
      <Panel title={t('candidate.files')} className="candidate-files-panel">
        <ul className="file-list">{files.map((file) => <li key={file.path}><span className="file-status">{file.status || '•'}</span><code title={file.path}>{file.path}</code></li>)}</ul>
        {candidate.untrackedFiles?.length > 0 && <><h3>{t('candidate.untracked')}</h3><ul className="file-list">{candidate.untrackedFiles.map((file) => <li key={file}><span className="file-status untracked">?</span><code title={file}>{file}</code></li>)}</ul></>}
      </Panel>
      <Panel title={t('candidate.diff')} className="candidate-diff-panel"><DiffViewer diff={candidate.trackedDiff} untrackedFiles={candidate.untrackedFiles} redacted={candidate.diffRedacted} /></Panel>
      <Panel title={t('candidate.review')} className="candidate-review-panel">
        <div className="review-agent"><strong>{candidate.agentId}</strong><StatusBadge value={candidate.verdict} /><span className="review-score">{formatScore(candidate.evaluationScore)}</span></div>
        <dl className="review-facts">
          <div><dt>{t('candidate.integrity')}</dt><dd><StatusBadge value={review.approvable ? 'pass' : 'fail'} label={review.approvable ? t('candidate.verified') : t('candidate.notVerified')} /></dd></div>
          <div><dt>{t('candidate.decision')}</dt><dd><StatusBadge value={task.decision || 'pending'} /></dd></div>
          <div><dt>{t('candidate.changedFiles')}</dt><dd>{files.length + (candidate.untrackedFiles?.length || 0)}</dd></div>
          <div><dt>{t('candidate.targetBranch')}</dt><dd><code>{task.targetBranch || '—'}</code></dd></div>
          <div><dt>{t('candidate.baseCommit')}</dt><dd><code title={task.baseCommit}>{task.baseCommit || '—'}</code></dd></div>
          {candidate.competitionScore != null && <div><dt>{t('candidate.competitionScore')}</dt><dd>{formatScore(candidate.competitionScore)}</dd></div>}
        </dl>
        {!review.approvable && <div className="state-message state-warning">{review.reason || t('candidate.notVerified')}</div>}
        {detailMode === 'advanced' && <div className="advanced-evidence"><h3>{t('candidate.fingerprint')}</h3><code title={candidate.fingerprint}>{candidate.fingerprint || t('common.notAvailable')}</code><h3>{t('run.branch')}</h3><code title={candidate.branch}>{candidate.branch || '—'}</code><h3>{t('run.worktree')}</h3><code title={candidate.worktree}>{candidate.worktree || '—'}</code></div>}
        {pending && <div className="decision-actions"><button type="button" className="button-danger button-block" disabled={busy} onClick={() => setConfirm('reject')}>{t('candidate.reject')}</button><button type="button" className="button-block" disabled={busy || !review.approvable || !candidate.fingerprint} onClick={() => setConfirm('approve')}>{t('candidate.approve')}</button></div>}
      </Panel>
    </div>}
    {!review && !loading && !error && <EmptyState>{t('candidate.noCandidates')}</EmptyState>}
    {actionResult && <Panel title={actionResult.status?.includes('reject') ? t('candidate.rejected') : t('candidate.approved')}><div className="metric-grid metric-grid-compact"><Metric label="Status" value={<StatusBadge value={actionResult.status} />} />{!actionResult.status?.includes('reject') && <><Metric label="Candidate Commit" value={actionResult.candidateCommit} mono /><Metric label="Merge Commit" value={actionResult.mergeCommit} mono /><Metric label="Remote push" value={t('candidate.remoteNotPushed')} /></>}</div>{actionResult.status?.includes('reject') && <p>{t('candidate.targetUntouched')}</p>}{actionResult.cleanupWarnings?.length > 0 && <div className="state-message state-warning">{actionResult.cleanupWarnings.join(', ')}</div>}</Panel>}
    <ConfirmDialog open={confirm === 'approve'} title={highRisk ? t('candidate.highRiskTitle') : t('candidate.approveTitle')} confirmLabel={t('candidate.approve')} busy={busy} confirmDisabled={highRisk && approvalText.trim().toUpperCase() !== 'APPROVE'} onCancel={() => { setConfirm(null); setApprovalText(''); }} onConfirm={() => decide('approve')}>
      <p>{highRisk ? t('candidate.highRiskBody') : t('candidate.approveBody')}</p><p><strong>{t('candidate.noPush')}</strong></p>{highRisk && <label className="confirm-input">{t('candidate.typeApprove')}<input value={approvalText} onChange={(event) => setApprovalText(event.target.value)} autoComplete="off" /></label>}
    </ConfirmDialog>
    <ConfirmDialog open={confirm === 'reject'} title={t('candidate.rejectTitle')} confirmLabel={t('candidate.reject')} tone="danger" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => decide('reject')}><p>{t('candidate.rejectBody')}</p></ConfirmDialog>
  </>;
}
