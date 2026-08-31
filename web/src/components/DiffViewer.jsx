import { useMemo, useState } from 'react';
import { EmptyState } from './ui';

const PREVIEW_LIMIT = 80_000;

export function DiffViewer({ diff, untrackedFiles = [], redacted = false }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof diff === 'string' ? diff : '';
  const isLarge = text.length > PREVIEW_LIMIT;
  const shown = useMemo(
    () => (isLarge && !expanded ? `${text.slice(0, PREVIEW_LIMIT)}\n… diff preview truncated …` : text),
    [expanded, isLarge, text],
  );

  return (
    <div className="diff-viewer">
      <h3>Tracked diff</h3>
      {redacted ? (
        <div className="state-message state-warning">Diff redacted because sensitive paths were detected.</div>
      ) : shown ? (
        <>
          {isLarge && (
            <div className="diff-toolbar">
              <span>Diff is large ({text.length.toLocaleString()} characters).</span>
              <button type="button" className="button-link" onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Collapse' : 'Show full diff'}
              </button>
            </div>
          )}
          <pre className="diff-text" data-testid="diff-text">{shown}</pre>
        </>
      ) : <EmptyState>No tracked diff available.</EmptyState>}

      <h3>Untracked files</h3>
      {untrackedFiles.length > 0 ? (
        <ul className="file-list" data-testid="untracked-files">
          {untrackedFiles.map((file) => <li key={file}><code>{file}</code></li>)}
        </ul>
      ) : <EmptyState>No untracked files.</EmptyState>}
      <p className="subtle">Untracked file contents are not implied to be part of the tracked diff.</p>
    </div>
  );
}
