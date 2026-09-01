import { useEffect, useState } from 'react';
import { apiClient } from './api/client';
import { AppShell } from './components/AppShell';
import { AgentsPage } from './pages/AgentsPage';
import { CandidatePage } from './pages/CandidatePage';
import { CandidatesPage } from './pages/CandidatesPage';
import { CompetitionsPage } from './pages/CompetitionsPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { ModelsPage } from './pages/ModelsPage';
import { LiveRunPage } from './pages/LiveRunPage';
import { PerformancePage } from './pages/PerformancePage';
import { RunTaskPage } from './pages/RunTaskPage';
import { RunsPage } from './pages/RunsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SystemPage } from './pages/SystemPage';
import './styles.css';

function normalizePath(pathname) {
  if (/^\/candidates\/[^/]+$/u.test(pathname) || /^\/history\/[^/]+$/u.test(pathname) || /^\/runs\/[^/]+$/u.test(pathname)) return pathname;
  return new Set(['/', '/new-task', '/run', '/runs', '/competitions', '/candidates', '/history', '/performance', '/agents', '/models', '/system', '/settings']).has(pathname) ? pathname : '/';
}

export function App({ api = apiClient }) {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  useEffect(() => { const onPopState = () => setPath(normalizePath(window.location.pathname)); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, []);
  const navigate = (nextPath) => { window.history.pushState({}, '', nextPath); setPath(normalizePath(nextPath)); };
  let page;
  if (path === '/new-task' || path === '/run') page = <RunTaskPage api={api} onNavigate={navigate} />;
  else if (path.startsWith('/runs/')) page = <LiveRunPage api={api} runId={decodeURIComponent(path.slice('/runs/'.length))} />;
  else if (path === '/runs') page = <RunsPage api={api} onNavigate={navigate} />;
  else if (path === '/competitions') page = <CompetitionsPage api={api} onNavigate={navigate} />;
  else if (path === '/candidates') page = <CandidatesPage api={api} onNavigate={navigate} />;
  else if (path.startsWith('/candidates/')) page = <CandidatePage api={api} routeTaskId={decodeURIComponent(path.slice('/candidates/'.length))} />;
  else if (path === '/history') page = <HistoryPage api={api} />;
  else if (path.startsWith('/history/')) page = <HistoryPage api={api} routeTaskId={decodeURIComponent(path.slice('/history/'.length))} />;
  else if (path === '/performance') page = <PerformancePage api={api} />;
  else if (path === '/agents') page = <AgentsPage api={api} />;
  else if (path === '/models') page = <ModelsPage api={api} />;
  else if (path === '/system') page = <SystemPage api={api} />;
  else if (path === '/settings') page = <SettingsPage />;
  else page = <DashboardPage api={api} onNavigate={navigate} />;
  return <AppShell api={api} path={path} onNavigate={navigate}>{page}</AppShell>;
}
