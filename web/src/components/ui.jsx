import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { statusTone } from '../utils/format';

export function PageHeader({ eyebrow, title, description, action }) {
  return <header className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}

export function Panel({ title, action, children, className = '' }) {
  return <section className={`panel ${className}`.trim()}>{(title || action) && <header className="panel-header">{title && <h2>{title}</h2>}{action}</header>}{children}</section>;
}

export function StatusBadge({ value, tone = statusTone(value), label }) {
  const { t } = useI18n();
  const normalized = String(value || 'unknown').toLowerCase().replace(/\s+/gu, '_');
  const translated = label || t(`status.${normalized}`);
  return <span className={`status-badge status-${tone}`}><span aria-hidden="true" className="status-dot" />{translated === `status.${normalized}` ? (value || 'unknown') : translated}</span>;
}

export function LoadingState({ label }) {
  const { t } = useI18n();
  return <div className="state-message" role="status"><span className="spinner" />{label || t('common.loading')}</div>;
}

export function EmptyState({ children }) { return <div className="state-message state-empty">{children}</div>; }

const CONFLICT_KEYS = {
  candidate_changed: 'candidate.conflict.changed', fingerprint_mismatch: 'candidate.conflict.changed', stale_base: 'candidate.conflict.stale',
  repository_not_clean: 'candidate.conflict.dirty', wrong_target_branch: 'candidate.conflict.branch', already_approved: 'candidate.conflict.approved', already_rejected: 'candidate.conflict.rejected',
};

export function ErrorNotice({ error, action }) {
  const { t } = useI18n();
  if (!error) return null;
  const prefix = error.status === 409 ? t('error.conflict') : error.status === 400 ? t('error.invalid') : error.status === 404 ? t('error.notFound') : error.status >= 500 ? t('error.server') : error.code === 'BACKEND_UNAVAILABLE' ? t('error.network') : t('error.request');
  const message = CONFLICT_KEYS[error.code] ? t(CONFLICT_KEYS[error.code]) : error.message || String(error);
  return <div className="error-notice" role="alert"><div><strong>{prefix}</strong><p>{message}</p></div>{error.code && <code>{error.code}</code>}{action}</div>;
}

export function Metric({ label, value, detail, mono = false }) {
  const { t } = useI18n();
  return <div className="metric"><span>{label}</span><strong className={mono ? 'mono truncate-value' : ''} title={mono && typeof value === 'string' ? value : undefined}>{value ?? t('common.notAvailable')}</strong>{detail && <small>{detail}</small>}</div>;
}

export function ConfirmDialog({ open, title, children, confirmLabel, tone = 'primary', busy, confirmDisabled = false, onConfirm, onCancel }) {
  const { t } = useI18n();
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const handleKey = (event) => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><div className="dialog-content">{children}</div><div className="dialog-actions"><button ref={cancelRef} type="button" className="button-secondary" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button><button type="button" className={`button-${tone}`} disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? t('common.loading') : confirmLabel}</button></div></div></div>;
}
