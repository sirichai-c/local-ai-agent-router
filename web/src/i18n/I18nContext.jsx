import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { translations } from './translations';

const LANGUAGE_KEY = 'local-agent-language';
const I18nContext = createContext(null);

function readLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return stored === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(readLanguage);

  const setLanguage = useCallback((next) => {
    const safeLanguage = next === 'en' ? 'en' : 'th';
    setLanguageState(safeLanguage);
    try { localStorage.setItem(LANGUAGE_KEY, safeLanguage); } catch { /* preference persistence is optional */ }
  }, []);

  const t = useCallback((key, variables = {}) => {
    const template = translations[language][key] ?? translations.en[key] ?? key;
    return Object.entries(variables).reduce(
      (value, [name, replacement]) => value.replaceAll(`{{${name}}}`, String(replacement)),
      template,
    );
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
