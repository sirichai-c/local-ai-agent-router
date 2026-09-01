import { useState } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { useI18n } from '../i18n/I18nContext';
import { formatDuration, formatScore } from '../utils/format';
import { CompetitionTable } from './CompetitionTable';
import { EvaluationCard } from './EvaluationCard';
import { EmptyState, Metric, Panel, StatusBadge } from './ui';

function ChangedFiles({ files = [], untrackedFiles = [] }) {
  const { t } = useI18n();
  if (!files.length && !untrackedFiles.length) return <EmptyState>{t('common.none')}</EmptyState>;
  return <div className="file-columns"><div><h3>{t('candidate.changedFiles')}</h3><ul className="file-list">{files.map((file) => { const path = typeof file === 'string' ? file : file.path; const status = typeof file === 'string' ? null : file.status; return <li key={path}><span className="file-status">{status || '•'}</span><code>{path}</code></li>; })}</ul></div><div><h3>{t('candidate.untracked')}</h3>{untrackedFiles.length ? <ul className="file-list">{untrackedFiles.map((file) => <li key={file}><span className="file-status untracked">?</span><code>{file}</code></li>)}</ul> : <p className="subtle">{t('common.none')}</p>}</div></div>;
}

function Timeline({ result }) {
  const { t } = useI18n();
  const completed = Boolean(result);
  const hasWorkspace = Boolean(result?.workspace || result?.repository || result?.candidates?.length);
  const hasEvaluation = Boolean(result?.evaluation || result?.candidates?.some((item) => item.evaluation));
  const hasCandidate = Boolean(result?.candidateFingerprint || result?.winner);
  const steps = [['analyzed', true], ['selected', true], ['repository', hasWorkspace], ['worktree', hasWorkspace], ['agent', completed], ['evaluation', hasEvaluation], ['candidate', hasCandidate]];
  return <ol className="timeline">{steps.map(([key, done]) => <li className={done ? 'done' : ''} key={key}><span>{done ? '✓' : '○'}</span>{t(`run.step.${key}`)}</li>)}</ol>;
}

function OutputTabs({ execution, evaluation }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('activity');
  const stdout = execution?.stdout || execution?.output;
  const stderr = execution?.stderr;
  return <Panel title={t('run.session')}><div className="tab-list" role="tablist"><button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>{t('run.activity')}</button><button type="button" role="tab" aria-selected={tab === 'terminal'} className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}>{t('run.terminal')}</button></div>{tab === 'activity' ? <div className="evidence-sections"><section><span className="evidence-label unverified">{t('run.agentOutput')} · {t('run.unverified')}</span><p>{stdout ? String(stdout).slice(0, 2000) : t('run.noOutput')}</p></section><section><span className="evidence-label verified">{t('run.systemEvidence')} · {t('run.verified')}</span><p>{evaluation ? `${t('evaluation.verdict')}: ${evaluation.verdict}; ${t('evaluation.score')}: ${formatScore(evaluation.score)}` : t('evaluation.noResult')}</p></section></div> : <pre className="terminal-output">{[stdout, stderr].filter(Boolean).join('\n') || t('run.noOutput')}</pre>}</Panel>;
}

export function ExecutionSummary({ result }) {
  const { t } = useI18n();
  const { detailMode } = usePreferences();
  if (!result) return null;
  const competition = Array.isArray(result.candidates);
  const taskId = result.taskId || result.competitionId || result.history?.taskId;
  if (competition) return <div className="result-stack"><Panel title={t('competition.best')} className="best-candidate-panel">{result.winner ? <div className="best-candidate"><span>{result.winner.agentId}</span><strong>{formatScore(result.winner.competitionScore || result.winner.score)}</strong><StatusBadge value={result.winner.verdict || 'pass'} /><small>{t('competition.best')}</small></div> : <EmptyState>{t('competition.noRanking')}</EmptyState>}</Panel><Panel title={t('competition.title')}><CompetitionTable result={result} /></Panel>{result.candidates.map((candidate) => <details className="candidate-result" key={candidate.agent.id}><summary>{candidate.agent.name || candidate.agent.id} · {candidate.status} · {formatScore(candidate.evaluation?.score)}</summary><ChangedFiles files={candidate.changedFiles} untrackedFiles={candidate.untrackedFiles} /><EvaluationCard evaluation={candidate.evaluation} /></details>)}{taskId && <a className="button-link standalone-link" href={`/candidates/${encodeURIComponent(taskId)}`}>{t('candidate.title')} →</a>}</div>;
  return <div className="result-stack"><PageSessionHeader result={result} taskId={taskId} advanced={detailMode === 'advanced'} /><div className="run-session-grid"><Panel title={t('run.timeline')}><Timeline result={result} /></Panel><OutputTabs execution={result.execution} evaluation={result.evaluation} /></div>{result.evaluation && <EvaluationCard evaluation={result.evaluation} />}{result.changes && <Panel title={t('run.systemEvidence')}><ChangedFiles files={result.changes.files} untrackedFiles={result.changes.untrackedFiles} /></Panel>}{taskId && result.candidateFingerprint && <a className="button-link standalone-link" href={`/candidates/${encodeURIComponent(taskId)}`}>{t('candidate.title')} →</a>}</div>;
}

function PageSessionHeader({ result, taskId, advanced }) {
  const { t } = useI18n();
  return <Panel title={t('run.title')}><div className="metric-grid metric-grid-compact"><Metric label={t('run.taskId')} value={taskId || t('common.notAvailable')} mono /><Metric label={t('run.agent')} value={result.selectedAgent?.name || result.selectedAgent?.id || t('common.notAvailable')} /><Metric label="Status" value={<StatusBadge value={result.status} />} /><Metric label={t('run.duration')} value={formatDuration(result.execution?.durationMs)} />{advanced && <><Metric label={t('run.branch')} value={result.workspace?.branch} mono /><Metric label={t('run.worktree')} value={result.workspace?.worktree} mono /></>}</div>{result.message && <p>{result.message}</p>}</Panel>;
}
