import { useEffect, useState } from 'react';
import { formatDate, formatScore } from '../utils/format';
import { EmptyState, ErrorNotice, LoadingState, Metric, Panel, StatusBadge } from '../components/ui';

export function DashboardPage({ api, onNavigate }) {
  const [state, setState] = useState({ loading: true, error: null, health: null, ollama: null, models: null, agents: [], tasks: [], performance: [] });

  useEffect(() => {
    let active = true;
    async function load() {
      const core = await Promise.allSettled([
        api.getHealth(), api.getOllamaHealth(), api.getModels(), api.getAgents(), api.getHistory(5),
      ]);
      if (!active) return;
      const agents = core[3].status === 'fulfilled' ? core[3].value.agents || [] : [];
      const performance = await Promise.all(agents.map(async (agent) => {
        try { return await api.getAgentPerformance(agent.id); } catch { return null; }
      }));
      if (!active) return;
      const firstFailure = core.find((entry) => entry.status === 'rejected');
      setState({
        loading: false,
        error: firstFailure?.reason || null,
        health: core[0].status === 'fulfilled' ? core[0].value : null,
        ollama: core[1].status === 'fulfilled' ? core[1].value : null,
        models: core[2].status === 'fulfilled' ? core[2].value : null,
        agents,
        tasks: core[4].status === 'fulfilled' ? core[4].value.tasks || [] : [],
        performance: performance.filter(Boolean),
      });
    }
    load();
    return () => { active = false; };
  }, [api]);

  return (
    <>
      <header className="page-heading"><div><span className="eyebrow">Overview</span><h1>System dashboard</h1><p>Current local runtime, agent availability, and recent evidence.</p></div><button type="button" onClick={() => onNavigate('/run')}>Run a task</button></header>
      {state.loading ? <LoadingState label="Loading local system state…" /> : (
        <>
          <ErrorNotice error={state.error} />
          <div className="metric-grid overview-metrics">
            <Metric label="Backend" value={<StatusBadge value={state.health?.status || 'unreachable'} />} detail={state.health?.service} />
            <Metric label="Ollama" value={<StatusBadge value={state.ollama?.status || 'unreachable'} />} detail={state.ollama?.model} />
            <Metric label="Current model" value={state.models?.configuredModel || state.ollama?.model || '—'} detail={state.models?.configuredModelAvailable ? 'Installed locally' : 'Availability unknown'} />
            <Metric label="Agents available" value={`${state.agents.filter((agent) => agent.available).length} / ${state.agents.length}`} detail={state.agents[0]?.runtime ? `Runtime: ${state.agents[0].runtime}` : null} />
          </div>
          <div className="two-column">
            <Panel title="Agents">
              {state.agents.length ? <div className="card-list">{state.agents.map((agent) => (
                <article className="agent-card" key={agent.id}><div><strong>{agent.name}</strong><small>{agent.runtime || 'runtime unknown'} · {agent.sandbox?.backend || 'host'}</small></div><StatusBadge value={agent.available ? 'available' : 'unavailable'} /></article>
              ))}</div> : <EmptyState>No Agent registry data available.</EmptyState>}
            </Panel>
            <Panel title="Recent activity" action={<button type="button" className="button-link" onClick={() => onNavigate('/history')}>View history</button>}>
              {state.tasks.length ? <div className="activity-list">{state.tasks.map((task) => (
                <article key={task.id}><div><strong>{task.task}</strong><small>{formatDate(task.createdAt)} · {task.mode}</small></div><StatusBadge value={task.decision !== 'pending' ? task.decision : task.status} /></article>
              ))}</div> : <EmptyState>No task history yet.</EmptyState>}
            </Panel>
          </div>
          <Panel title="Performance summary">
            {state.performance.some((item) => item.global?.sampleSize > 0) ? <div className="performance-grid">{state.performance.filter((item) => item.global?.sampleSize > 0).map((item) => (
              <article className="performance-card" key={item.agent.id}><strong>{item.agent.name || item.agent.id}</strong><span className="large-number">{formatScore(item.global.averageEvaluationScore)}</span><small>Average evaluation · {item.global.sampleSize} samples</small></article>
            ))}</div> : <EmptyState>No performance history yet.</EmptyState>}
          </Panel>
        </>
      )}
    </>
  );
}
