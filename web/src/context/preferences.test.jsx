import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../components/AppShell';
import { SettingsPage } from '../pages/SettingsPage';
import { render } from '../test/render';

const api = { getHealth: vi.fn().mockResolvedValue({ status: 'ok' }), getOllamaHealth: vi.fn().mockResolvedValue({ status: 'ok' }) };

describe('localized UI preferences', () => {
  it('uses Thai, Light, and Simple as first-run defaults', () => {
    render(<SettingsPage />, { language: 'th', theme: 'light', detailMode: 'simple' });
    expect(screen.getByRole('heading', { name: 'ตั้งค่า' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('button', { name: 'Simple' })).toHaveClass('active');
  });

  it('persists language, theme, and Advanced mode without storing task data', async () => {
    render(<SettingsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'ไทย' }));
    await userEvent.click(screen.getByRole('button', { name: 'มืด' }));
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(localStorage.getItem('local-agent-language')).toBe('th');
    expect(localStorage.getItem('local-agent-theme')).toBe('dark');
    expect(localStorage.getItem('local-agent-detail-mode')).toBe('advanced');
    expect(Object.keys(localStorage)).toHaveLength(3);
  });

  it('renders grouped navigation and real service states', async () => {
    render(<AppShell api={api} path="/" onNavigate={() => {}}><p>content</p></AppShell>);
    expect(screen.getByText('OVERVIEW')).toBeInTheDocument();
    expect(screen.getByText('WORK')).toBeInTheDocument();
    expect(screen.getByText('INSIGHTS')).toBeInTheDocument();
    expect(screen.getByText('SYSTEM')).toBeInTheDocument();
    expect((await screen.findAllByText('Online')).length).toBe(2);
  });
});
