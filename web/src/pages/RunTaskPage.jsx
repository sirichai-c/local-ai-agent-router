import { useEffect, useState } from 'react';
import { AgentRanking, Classification } from '../components/AgentRanking';
import { ExecutionSummary } from '../components/ExecutionSummary';
import { TaskForm } from '../components/TaskForm';
import { ErrorNotice, LoadingState, Panel } from '../components/ui';

const EMPTY_FORM = { task: '', workspace: '', mode: 'auto', agents: [], analyzeFirst: true };

export function RunTaskPage({ api }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [agents, setAgents] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [validation, setValidation] = useState('');

  useEffect(() => {
    let active = true;
    api.getAgents().then((response) => { if (active) setAgents(response.agents || []); }).catch((loadError) => { if (active) setError(loadError); });
    return () => { active = false; };
  }, [api]);

  const validate = (forRun) => {
    if (!form.task.trim()) return 'Task is required.';
    if (forRun && !form.workspace.trim()) return 'Workspace path is required.';
    if (forRun && form.mode === 'competition' && form.agents.length < 2) return 'Select at least two available Agents.';
    return '';
  };

  const analyze = async () => {
    const problem = validate(false);
    setValidation(problem);
    if (problem) return null;
    setBusy(true); setError(null);
    try {
      const nextAnalysis = await api.analyzeTask(form.task);
      setAnalysis(nextAnalysis);
      return nextAnalysis;
    } catch (requestError) {
      setError(requestError);
      return null;
    } finally { setBusy(false); }
  };

  const run = async () => {
    const problem = validate(true);
    setValidation(problem);
    if (problem) return;
    setBusy(true); setError(null); setResult(null);
    try {
      if (form.analyzeFirst) setAnalysis(await api.analyzeTask(form.task));
      const response = form.mode === 'competition'
        ? await api.competeTask({ task: form.task, workspace: form.workspace, agents: form.agents })
        : await api.executeTask({ task: form.task, workspace: form.workspace });
      setResult(response);
    } catch (requestError) { setError(requestError); }
    finally { setBusy(false); }
  };

  return (
    <>
      <header className="page-heading"><div><span className="eyebrow">Task console</span><h1>Run a coding task</h1><p>Analyze routing evidence, then run one Agent or a same-base competition.</p></div></header>
      <div className="task-layout">
        <Panel title="Task request">
          <TaskForm form={form} setForm={setForm} agents={agents} busy={busy} onAnalyze={analyze} onRun={run} />
          {validation && <div className="validation-error" role="alert">{validation}</div>}
          <ErrorNotice error={error} />
          {busy && <LoadingState label={form.mode === 'competition' ? 'Competition is running sequentially…' : 'Agent is running…'} />}
        </Panel>
        <div className="analysis-column">
          <Panel title="Task classification"><Classification classification={analysis?.classification} /></Panel>
          <Panel title="Agent ranking"><AgentRanking analysis={analysis} /></Panel>
        </div>
      </div>
      <ExecutionSummary result={result} />
    </>
  );
}
