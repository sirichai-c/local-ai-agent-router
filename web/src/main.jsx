import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PreferencesProvider } from './context/PreferencesContext';
import { I18nProvider } from './i18n/I18nContext';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider><PreferencesProvider><App /></PreferencesProvider></I18nProvider>
  </StrictMode>,
);
