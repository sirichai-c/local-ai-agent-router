import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { EmptyState } from './ui';

const PREVIEW_LIMIT = 80_000;
function toneForLine(line) { if (line.startsWith('+++') || line.startsWith('---')) return 'diff-header'; if (line.startsWith('+')) return 'diff-add'; if (line.startsWith('-')) return 'diff-remove'; if (line.startsWith('@@')) return 'diff-hunk'; return ''; }

export function DiffViewer({ diff, untrackedFiles = [], redacted = false }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const text = typeof diff === 'string' ? diff : '';
  const isLarge = text.length > PREVIEW_LIMIT;
  const shown = useMemo(() => isLarge && !expanded ? `${text.slice(0, PREVIEW_LIMIT)}\n…` : text, [expanded, isLarge, text]);
  return <div className="diff-viewer">
    {redacted ? <div className="state-message state-warning">{t('candidate.redacted')}</div> : shown ? <>{isLarge && <div className="diff-toolbar"><span>{t('candidate.diffLarge')} ({text.length.toLocaleString()})</span><button type="button" className="button-link" onClick={() => setExpanded((value) => !value)}>{expanded ? t('candidate.collapse') : t('candidate.showFull')}</button></div>}<pre className="diff-text" data-testid="diff-text">{shown.split('\n').map((line, index) => <span className={toneForLine(line)} key={`${index}-${line.slice(0, 16)}`}>{line}{'\n'}</span>)}</pre></> : <EmptyState>{t('candidate.noTrackedDiff')}</EmptyState>}
    <section className="untracked-section"><h3>{t('candidate.untracked')}</h3>{untrackedFiles.length ? <ul className="file-list" data-testid="untracked-files">{untrackedFiles.map((file) => <li key={file}><span className="file-status untracked">?</span><code>{file}</code></li>)}</ul> : <EmptyState>{t('candidate.noUntracked')}</EmptyState>}</section>
  </div>;
}
