import { useEffect, useState } from 'react';
import { EmptyState, ErrorNotice, LoadingState, Metric, Panel, StatusBadge } from '../components/ui';

export function SystemPage({ api }) {
  const [state, setState] = useState({ loading: true, errors: [], health: null, ollama: null, models: null, agents: [] });

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.getHealth(), api.getOllamaHealth(), api.getModels(), api.getAgents()]).then((results) => {
      if (!active) return;
      setState({
        loading: false,
        errors: results.filter((result) => result.status === 'rejected').map((result) => result.reason),
        health: results[0].status === 'fulfilled' ? results[0].value : null,
        ollama: results[1].status === 'fulfilled' ? results[1].value : null,
        models: results[2].status === 'fulfilled' ? results[2].value : null,
        agents: results[3].status === 'fulfilled' ? results[3].value.agents || [] : [],
      });
    });
    return () => { active = false; };
  }, [api]);

  return (
    <>
      <header className="page-heading"><div><span className="eyebrow">Local runtime</span><h1>System status</h1><p>Read-only view of backend, Ollama, models, Agents, and execution runtime.</p></div></header>
      {state.loading ? <LoadingState label="Checking system services…" /> : (
        <>
          {state.errors.map((error, index) => <ErrorNotice error={error} key={`${error.code}-${index}`} />)}
          <Panel title="Services"><div className="metric-grid metric-grid-compact"><Metric label="Backend" value={<StatusBadge value={state.health?.status || 'unreachable'} />} detail={state.health?.service} /><Metric label="Ollama" value={<StatusBadge value={state.ollama?.status || 'unreachable'} />} detail={state.ollama?.model} /><Metric label="Canonical model" value={state.models?.configuredModel || state.ollama?.model || '—'} /><Metric label="Model available" value={<StatusBadge value={state.models?.configuredModelAvailable ? 'yes' : 'no'} tone={state.models?.configuredModelAvailable ? 'success' : 'danger'} />} /></div></Panel>
          <Panel title="Local models">{state.models?.models?.length ? <div className="table-scroll"><table><thead><tr><th>Model</th><th>Family</th><th>Parameters</th><th>Quantization</th></tr></thead><tbody>{state.models.models.map((model) => <tr key={model.name || model.model}><td><strong>{model.name || model.model}</strong></td><td>{model.details?.family || '—'}</td><td>{model.details?.parameter_size || '—'}</td><td>{model.details?.quantization_level || '—'}</td></tr>)}</tbody></table></div> : <EmptyState>No local models reported.</EmptyState>}</Panel>
          <Panel title="Agent registry">{state.agents.length ? <div className="table-scroll"><table><thead><tr><th>Agent</th><th>Host installed</th><th>Effective availability</th><th>Runtime</th><th>Sandbox backend</th><th>Version</th></tr></thead><tbody>{state.agents.map((agent) => <tr key={agent.id}><td><strong>{agent.name}</strong><small className="table-subtitle">{agent.id}</small></td><td><StatusBadge value={agent.host?.installed || agent.installed ? 'yes' : 'no'} tone={agent.host?.installed || agent.installed ? 'success' : 'neutral'} /></td><td><StatusBadge value={agent.available ? 'available' : 'unavailable'} /></td><td>{agent.runtime || '—'}</td><td>{agent.sandbox?.backend || '—'} · {agent.sandbox?.available ? 'ready' : 'not ready'}</td><td>{agent.host?.version || agent.version || '—'}</td></tr>)}</tbody></table></div> : <EmptyState>No Agent registry data available.</EmptyState>}</Panel>
        </>
      )}
    </>
  );
}
