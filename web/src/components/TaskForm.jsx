import { useEffect } from 'react';

export function TaskForm({ form, setForm, agents, busy, onAnalyze, onRun }) {
  const availableAgents = agents.filter((agent) => agent.available);

  useEffect(() => {
    if (form.mode !== 'competition') return;
    const selected = form.agents.filter((id) => availableAgents.some((agent) => agent.id === id));
    if (selected.length === 0 && availableAgents.length >= 2) {
      setForm((current) => ({ ...current, agents: availableAgents.slice(0, 2).map((agent) => agent.id) }));
    }
  }, [availableAgents, form.agents, form.mode, setForm]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const toggleAgent = (agentId) => update('agents', form.agents.includes(agentId)
    ? form.agents.filter((id) => id !== agentId)
    : [...form.agents, agentId]);

  return (
    <form className="task-form" onSubmit={(event) => { event.preventDefault(); onRun(); }}>
      <label htmlFor="task">Task</label>
      <textarea id="task" rows="7" value={form.task} onChange={(event) => update('task', event.target.value)} placeholder="Describe the coding change and its boundaries…" disabled={busy} />

      <label htmlFor="workspace">Workspace path</label>
      <input id="workspace" value={form.workspace} onChange={(event) => update('workspace', event.target.value)} placeholder="C:\Projects\my-api" disabled={busy} />
      <small className="field-help">This is a path on the backend machine, not a browser upload.</small>

      <fieldset>
        <legend>Execution mode</legend>
        <label className="option-card"><input type="radio" name="mode" value="auto" checked={form.mode === 'auto'} onChange={() => update('mode', 'auto')} disabled={busy} /><span><strong>Auto Agent</strong><small>Router selects the best available Agent.</small></span></label>
        <label className="option-card"><input type="radio" name="mode" value="competition" checked={form.mode === 'competition'} onChange={() => update('mode', 'competition')} disabled={busy} /><span><strong>Multi-Agent Competition</strong><small>Selected Agents start from the same base commit.</small></span></label>
      </fieldset>

      {form.mode === 'competition' && (
        <fieldset>
          <legend>Competitors</legend>
          <div className="agent-options">
            {agents.map((agent) => (
              <label className={`agent-option ${agent.available ? '' : 'disabled'}`.trim()} key={agent.id}>
                <input type="checkbox" checked={form.agents.includes(agent.id)} onChange={() => toggleAgent(agent.id)} disabled={busy || !agent.available} />
                <span><strong>{agent.name}</strong><small>{agent.available ? `${agent.runtime || 'host'} runtime` : 'Currently unavailable'}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="checkbox-row"><input type="checkbox" checked={form.analyzeFirst} onChange={(event) => update('analyzeFirst', event.target.checked)} disabled={busy} /> Analyze before execution</label>

      <div className="form-actions">
        <button type="button" className="button-secondary" onClick={onAnalyze} disabled={busy}>Analyze only</button>
        <button type="submit" disabled={busy}>{busy ? 'Running…' : form.mode === 'competition' ? 'Run Competition' : 'Run Agent'}</button>
      </div>
    </form>
  );
}
