import { useEffect, useState } from 'react';
import { CATEGORIES, CATEGORY_LABELS, formatDuration, formatPercent, formatScore } from '../utils/format';
import { EmptyState, ErrorNotice, LoadingState, Metric, Panel, StatusBadge } from '../components/ui';

function Stats({ stats, category = false }) {
  if (!stats || stats.sampleSize === 0) return <EmptyState>No performance history yet.</EmptyState>;
  return <div className="metric-grid metric-grid-compact">
    <Metric label="Samples" value={stats.sampleSize} />
    <Metric label={category ? 'Weighted evaluation' : 'Average evaluation'} value={formatScore(category ? stats.weightedEvaluationScore : stats.averageEvaluationScore)} />
    <Metric label="Pass rate" value={formatPercent(stats.passRate)} />
    {!category && <Metric label="Success rate" value={formatPercent(stats.successRate)} />}
    {!category && <Metric label="Warning rate" value={formatPercent(stats.warningRate)} />}
    {!category && <Metric label="Failure rate" value={formatPercent(stats.failureRate)} />}
    <Metric label="Average duration" value={formatDuration(stats.averageDurationMs)} />
  </div>;
}

export function PerformancePage({ api }) {
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState('');
  const [category, setCategory] = useState('coding');
  const [performance, setPerformance] = useState(null);
  const [categoryStats, setCategoryStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    api.getAgents().then((response) => {
      if (!active) return;
      const nextAgents = response.agents || [];
      setAgents(nextAgents);
      setAgentId((current) => current || nextAgents[0]?.id || '');
    }).catch((requestError) => { if (active) setError(requestError); });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!agentId) { setLoading(false); return undefined; }
    let active = true;
    setLoading(true); setError(null);
    Promise.all([api.getAgentPerformance(agentId), api.getCategoryPerformance(agentId, category)])
      .then(([overall, categoryResponse]) => { if (active) { setPerformance(overall); setCategoryStats(categoryResponse.performance); } })
      .catch((requestError) => { if (active) setError(requestError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agentId, api, category]);

  return (
    <>
      <header className="page-heading"><div><span className="eyebrow">Adaptive routing evidence</span><h1>Agent performance</h1><p>Deterministic statistics from persisted execution results.</p></div></header>
      <Panel title="Select evidence">
        <div className="filter-row"><label htmlFor="performance-agent">Agent</label><select id="performance-agent" value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} {agent.available ? '' : '(unavailable)'}</option>)}</select><label htmlFor="performance-category">Category</label><select id="performance-category" value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((name) => <option key={name} value={name}>{CATEGORY_LABELS[name]}</option>)}</select></div>
      </Panel>
      <ErrorNotice error={error} />
      {loading ? <LoadingState label="Calculating performance…" /> : !performance ? <EmptyState>No Agent performance available.</EmptyState> : (
        <div className="result-stack">
          <Panel title="Agent"><div className="agent-title"><div><h2>{performance.agent.name || performance.agent.id}</h2><small>{performance.agent.id}</small></div><StatusBadge value={performance.agent.available ? 'available' : 'unavailable'} /></div></Panel>
          <Panel title="Global performance"><Stats stats={performance.global} /></Panel>
          <Panel title="Recent performance"><Stats stats={performance.recent} /></Panel>
          <Panel title={`${CATEGORY_LABELS[category]} performance`}><Stats stats={categoryStats} category /></Panel>
        </div>
      )}
    </>
  );
}
