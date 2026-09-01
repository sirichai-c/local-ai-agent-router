import { useEffect, useState } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { useI18n } from '../i18n/I18nContext';
import { Icon } from './Icon';

const GROUPS = [
  ['nav.group.overview', [['/', 'nav.overview', 'home'], ['/new-task', 'nav.newTask', 'plus']]],
  ['nav.group.work', [['/runs', 'nav.runs', 'play'], ['/queue', 'nav.queue', 'queue'], ['/competitions', 'nav.competitions', 'competition'], ['/candidates', 'nav.candidates', 'candidate']]],
  ['nav.group.insights', [['/history', 'nav.history', 'history'], ['/performance', 'nav.performance', 'performance']]],
  ['nav.group.system', [['/agents', 'nav.agents', 'agent'], ['/models', 'nav.models', 'model'], ['/system', 'nav.system', 'system'], ['/settings', 'nav.settings', 'settings']]],
];

export function AppShell({ api, path, onNavigate, children }) {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme, detailMode, setDetailMode } = usePreferences();
  const [services, setServices] = useState({ backend: 'offline', ollama: 'offline' });
  useEffect(() => {
    let active = true;
    Promise.allSettled([api.getHealth(), api.getOllamaHealth()]).then(([health, ollama]) => {
      if (active) setServices({ backend: health.status === 'fulfilled' && health.value?.status === 'ok' ? 'online' : 'offline', ollama: ollama.status === 'fulfilled' && ollama.value?.status === 'ok' ? 'online' : 'offline' });
    });
    return () => { active = false; };
  }, [api]);
  const go = (event, href) => { event.preventDefault(); onNavigate(href); };
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" onClick={(event) => go(event, '/')}><span className="brand-mark">LA</span><span><strong>{t('app.name')}</strong><small>{t('app.subtitle')}</small></span></a>
      <nav aria-label="Primary navigation">{GROUPS.map(([group, items]) => <section className="nav-group" key={group}><h2>{t(group)}</h2>{items.map(([href, label, icon]) => <a className={path === href || (href === '/new-task' && path === '/run') ? 'active' : ''} href={href} key={href} onClick={(event) => go(event, href)}><Icon name={icon} /><span>{t(label)}</span></a>)}</section>)}</nav>
      <div className="sidebar-footer"><div className="service-row"><span><i className={`service-dot ${services.backend}`} />{t('system.backend')}</span><small>{t(`status.${services.backend}`)}</small></div><div className="service-row"><span><i className={`service-dot ${services.ollama}`} />{t('system.ollama')}</span><small>{t(`status.${services.ollama}`)}</small></div><div className="sidebar-controls"><button type="button" className="icon-button language-button" onClick={() => setLanguage(language === 'th' ? 'en' : 'th')} aria-label={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}><Icon name="globe" />{language.toUpperCase()}</button><button type="button" className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? t('theme.dark') : t('theme.light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div></div>
    </aside>
    <main className="main-content"><div className="topbar"><div className="segmented" aria-label={t('settings.detailMode')}><button type="button" className={detailMode === 'simple' ? 'active' : ''} onClick={() => setDetailMode('simple')}>{t('mode.simple')}</button><button type="button" className={detailMode === 'advanced' ? 'active' : ''} onClick={() => setDetailMode('advanced')}>{t('mode.advanced')}</button></div></div>{children}</main>
  </div>;
}
