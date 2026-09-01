import { render as testingRender } from '@testing-library/react';
import { PreferencesProvider } from '../context/PreferencesContext';
import { I18nProvider } from '../i18n/I18nContext';

export function render(ui, { language = 'en', theme = 'light', detailMode = 'simple', ...options } = {}) {
  localStorage.setItem('local-agent-language', language);
  localStorage.setItem('local-agent-theme', theme);
  localStorage.setItem('local-agent-detail-mode', detailMode);
  return testingRender(<I18nProvider><PreferencesProvider>{ui}</PreferencesProvider></I18nProvider>, options);
}
