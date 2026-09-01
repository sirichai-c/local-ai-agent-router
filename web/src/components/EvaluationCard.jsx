import { usePreferences } from '../context/PreferencesContext';
import { useI18n } from '../i18n/I18nContext';
import { formatScore } from '../utils/format';
import { EmptyState, Metric, Panel, StatusBadge } from './ui';

function CheckRow({ check }) {
  const status = check.executed === false || check.skipped ? 'not_run' : check.passed === true ? 'pass' : check.passed === false ? 'fail' : 'unknown';
  return <li className="check-row"><StatusBadge value={status} /><span>{check.file || check.type || check.name || 'Check'}</span>{(check.reason || check.message) && <small>{check.reason || check.message}</small>}</li>;
}

export function EvaluationCard({ evaluation, compact = false }) {
  const { t } = useI18n();
  const { detailMode } = usePreferences();
  if (!evaluation) return <EmptyState>{t('evaluation.noResult')}</EmptyState>;
  const projectChecks = Object.entries(evaluation.project?.scripts || {}).map(([name, check]) => ({ name, type: `npm-${name}`, ...check }));
  const sandbox = evaluation.project?.sandbox;
  const networks = [...new Set(projectChecks.filter((check) => check.executed).map((check) => check.network).filter(Boolean))];
  return <Panel title={t('evaluation.title')} className="evaluation-card">
    <div className="evaluation-hero"><div className="score-orb"><strong>{formatScore(evaluation.score)}</strong><small>/ 100</small></div><StatusBadge value={String(evaluation.verdict || 'unknown')} /></div>
    <div className="metric-grid metric-grid-compact"><Metric label={t('evaluation.sandbox')} value={sandbox?.executed === true ? t('evaluation.protected') : t('common.notAvailable')} detail={sandbox?.image || sandbox?.reason} />{networks.length > 0 && <Metric label={t('evaluation.network')} value={networks.join(', ')} />}</div>
    {!compact && evaluation.staticChecks?.length > 0 && <div className="check-group"><h3>{t('evaluation.staticChecks')}</h3><ul className="check-list">{evaluation.staticChecks.map((check, index) => <CheckRow check={check} key={`${check.file || check.type}-${index}`} />)}</ul></div>}
    {!compact && projectChecks.length > 0 && <div className="check-group"><h3>{t('evaluation.projectChecks')}</h3><ul className="check-list">{projectChecks.map((check) => <CheckRow check={check} key={check.name} />)}</ul></div>}
    {!compact && detailMode === 'advanced' && evaluation.reasons?.length > 0 && <div className="check-group"><h3>{t('evaluation.evidence')}</h3><ul className="reason-list">{evaluation.reasons.map((reason, index) => <li key={`${reason.code}-${index}`}><code>{reason.code}</code><span>{reason.message || (reason.impact ? `${reason.impact} points` : 'No deduction')}</span>{reason.file && <small>{reason.file}</small>}</li>)}</ul></div>}
  </Panel>;
}
