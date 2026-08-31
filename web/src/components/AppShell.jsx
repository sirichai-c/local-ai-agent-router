const NAV_ITEMS = [
  ['/', 'Dashboard'],
  ['/run', 'Run Task'],
  ['/candidates', 'Candidates'],
  ['/history', 'History'],
  ['/performance', 'Performance'],
  ['/system', 'System'],
];

export function AppShell({ path, onNavigate, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">LR</span>
          <div><strong>Local AI</strong><small>Agent Router</small></div>
        </div>
        <nav aria-label="Primary navigation">
          {NAV_ITEMS.map(([href, label]) => (
            <a
              className={path === href ? 'active' : ''}
              href={href}
              key={href}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(href);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">Local-first · Human-approved</div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
