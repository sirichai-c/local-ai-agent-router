import { usePreferences } from '../context/PreferencesContext';
import { useI18n } from '../i18n/I18nContext';
import { PageHeader, Panel } from '../components/ui';

export function SettingsPage() {
  const { t, language, setLanguage } = useI18n(); const { theme, setTheme, detailMode, setDetailMode } = usePreferences();
  const Choice = ({ value, current, onChange, label }) => <button type="button" className={`preference-choice ${value === current ? 'active' : ''}`} onClick={() => onChange(value)}>{label}</button>;
  return <><PageHeader eyebrow="UI PREFERENCES" title={t('settings.title')} description={t('settings.subtitle')} /><Panel title={t('settings.language')}><div className="preference-grid"><Choice value="th" current={language} onChange={setLanguage} label={t('language.th')} /><Choice value="en" current={language} onChange={setLanguage} label={t('language.en')} /></div></Panel><Panel title={t('settings.theme')}><div className="preference-grid"><Choice value="light" current={theme} onChange={setTheme} label={t('theme.light')} /><Choice value="dark" current={theme} onChange={setTheme} label={t('theme.dark')} /><Choice value="system" current={theme} onChange={setTheme} label={t('theme.system')} /></div></Panel><Panel title={t('settings.detailMode')}><div className="preference-grid"><Choice value="simple" current={detailMode} onChange={setDetailMode} label={t('mode.simple')} /><Choice value="advanced" current={detailMode} onChange={setDetailMode} label={t('mode.advanced')} /></div></Panel><Panel title={t('settings.security')}><p>{t('settings.securityNote')}</p></Panel></>;
}
