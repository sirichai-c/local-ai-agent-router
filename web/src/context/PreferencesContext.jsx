import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const THEME_KEY = 'local-agent-theme';
const DETAIL_KEY = 'local-agent-detail-mode';
const PreferencesContext = createContext(null);

function readPreference(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function PreferencesProvider({ children }) {
  const [theme, setTheme] = useState(() => readPreference(THEME_KEY, ['light', 'dark', 'system'], 'light'));
  const [detailMode, setDetailMode] = useState(() => readPreference(DETAIL_KEY, ['simple', 'advanced'], 'simple'));

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      root.style.colorScheme = dark ? 'dark' : 'light';
    };
    applyTheme();
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (theme === 'system') media?.addEventListener?.('change', applyTheme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* preference persistence is optional */ }
    return () => media?.removeEventListener?.('change', applyTheme);
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(DETAIL_KEY, detailMode); } catch { /* preference persistence is optional */ }
  }, [detailMode]);

  const value = useMemo(() => ({
    theme,
    setTheme,
    detailMode,
    setDetailMode,
    advanced: detailMode === 'advanced',
  }), [theme, detailMode]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside PreferencesProvider');
  return context;
}
