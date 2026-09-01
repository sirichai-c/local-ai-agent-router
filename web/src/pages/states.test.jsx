import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { HistoryPage } from './HistoryPage';
import { PerformancePage } from './PerformancePage';
import { SystemPage } from './SystemPage';
import { render } from '../test/render';

describe('empty and failure states', () => {
  it('shows History empty state', async () => {
    render(<HistoryPage api={{ getHistory: vi.fn().mockResolvedValue({ count: 0, tasks: [] }) }} />);
    expect(await screen.findByText('No task history yet.')).toBeInTheDocument();
  });

  it('shows Performance no-history state', async () => {
    const zero = { sampleSize: 0, averageEvaluationScore: null, successRate: null, passRate: null, warningRate: null, failureRate: null, averageDurationMs: null };
    const api = {
      getAgents: vi.fn().mockResolvedValue({ agents: [{ id: 'qwen-code', name: 'Qwen Code', available: true }] }),
      getAgentPerformance: vi.fn().mockResolvedValue({ agent: { id: 'qwen-code', name: 'Qwen Code', available: true }, global: zero, recent: zero }),
      getCategoryPerformance: vi.fn().mockResolvedValue({ performance: { sampleSize: 0 } }),
    };
    render(<PerformancePage api={api} />);
    expect((await screen.findAllByText('No performance history yet.')).length).toBeGreaterThan(0);
  });

  it('shows backend unavailable instead of a blank Dashboard', async () => {
    const unavailable = Object.assign(new Error('Backend is unreachable.'), { code: 'BACKEND_UNAVAILABLE', status: 0 });
    const reject = vi.fn().mockRejectedValue(unavailable);
    render(<DashboardPage api={{ getHealth: reject, getOllamaHealth: reject, getModels: reject, getAgents: reject, getHistory: reject, getAgentPerformance: reject }} onNavigate={() => {}} />);
    expect(await screen.findByText(/Backend is unreachable/u)).toBeInTheDocument();
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);
  });

  it('shows read-only scheduler capacity on the System page', async () => {
    const api = {
      getHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'router' }),
      getOllamaHealth: vi.fn().mockResolvedValue({ status: 'ok', model: 'qwen3:8b' }),
      getModels: vi.fn().mockResolvedValue({ configuredModel: 'qwen3:8b', models: [] }),
      getAgents: vi.fn().mockResolvedValue({ agents: [] }),
      getJobStats: vi.fn().mockResolvedValue({ status: 'running', active: 1, maxConcurrent: 1, queued: 4 }),
    };
    render(<SystemPage api={api} />);
    expect(await screen.findByText('Job Scheduler')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
