import { useEffect, useState } from 'react';
import { apiClient } from './api/client';
import { AppShell } from './components/AppShell';
import { CandidatePage } from './pages/CandidatePage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PerformancePage } from './pages/PerformancePage';
import { RunTaskPage } from './pages/RunTaskPage';
import { SystemPage } from './pages/SystemPage';
import './styles.css';

const ROUTES = new Set(['/', '/run', '/candidates', '/history', '/performance', '/system']);

function normalizePath(pathname) {
  return ROUTES.has(pathname) ? pathname : '/';
}

export function App({ api = apiClient }) {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextPath) => {
    window.history.pushState({}, '', nextPath);
    setPath(nextPath);
  };

  let page;
  if (path === '/run') page = <RunTaskPage api={api} />;
  else if (path === '/candidates') page = <CandidatePage api={api} />;
  else if (path === '/history') page = <HistoryPage api={api} />;
  else if (path === '/performance') page = <PerformancePage api={api} />;
  else if (path === '/system') page = <SystemPage api={api} />;
  else page = <DashboardPage api={api} onNavigate={navigate} />;

  return <AppShell path={path} onNavigate={navigate}>{page}</AppShell>;
}
