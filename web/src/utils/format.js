export const CATEGORY_LABELS = {
  coding: 'Coding',
  debugging: 'Debugging',
  refactor: 'Refactor',
  git: 'Git',
  review: 'Review',
  architecture: 'Architecture',
  multiFile: 'Multi-file',
  terminal: 'Terminal',
  autonomous: 'Autonomous',
  smallChange: 'Small change',
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS);

export function formatScore(value, fallback = '—') {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/u, '') : fallback;
}

export function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
}

export function formatDuration(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (['pass', 'completed', 'merged', 'approved', 'ok', 'available', 'online', 'ready'].includes(value)) return 'success';
  if (value.includes('warning') || value === 'degraded' || value === 'pending') return 'warning';
  if (['fail', 'failed', 'evaluation_failed', 'rejected', 'unavailable', 'offline'].includes(value)) return 'danger';
  return 'neutral';
}
