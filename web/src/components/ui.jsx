import { useEffect, useRef } from 'react';
import { statusTone } from '../utils/format';

export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || action) && (
        <header className="panel-header">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ value, tone = statusTone(value) }) {
  return <span className={`status-badge status-${tone}`}>{value || 'unknown'}</span>;
}

export function LoadingState({ label = 'Loading…' }) {
  return <div className="state-message" role="status"><span className="spinner" />{label}</div>;
}

export function EmptyState({ children }) {
  return <div className="state-message state-empty">{children}</div>;
}

export function ErrorNotice({ error, action }) {
  if (!error) return null;
  const prefix = error.status === 409
    ? 'State conflict'
    : error.status === 400
      ? 'Invalid request'
      : error.status === 404
        ? 'Not found'
        : error.status >= 500
          ? 'Server error'
          : 'Request error';

  return (
    <div className="error-notice" role="alert">
      <div><strong>{prefix}:</strong> {error.message || String(error)}</div>
      {error.code && <code>{error.code}</code>}
      {action}
    </div>
  );
}

export function Metric({ label, value, detail }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel, tone = 'primary', busy, onConfirm, onCancel }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <div className="dialog-content">{children}</div>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="button-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className={`button-${tone}`} disabled={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
