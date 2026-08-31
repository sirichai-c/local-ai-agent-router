import { useEffect, useState } from 'react';
import { EmptyState, ErrorNotice, LoadingState, Metric, Panel, StatusBadge } from '../components/ui';
import { formatDate, formatDuration, formatScore } from '../utils/format';

export function HistoryPage({ api }) {
  const [limit, setLimit] = useState(20);
  const [tasks, setTasks] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getHistory(limit).then((response) => { if (active) setTasks(response.tasks || []); }).catch((requestError) => { if (active) setError(requestError); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, limit]);

  const loadDetail = async (taskId) => {
    setDetailLoading(true); setError(null);
    try { setDetail(await api.getHistoryTask(taskId)); }
    catch (requestError) { setError(requestError); }
    finally { setDetailLoading(false); }
  };

  return (
    <>
      <header className="page-heading"><div><span className="eyebrow">Persistent memory</span><h1>Execution history</h1><p>Stored metadata only—no raw stdout, stderr, diff, or secrets.</p></div></header>
      <ErrorNotice error={error} />
      <Panel title="Recent tasks">
        {loading ? <LoadingState /> : tasks.length === 0 ? <EmptyState>No task history yet.</EmptyState> : (
          <>
            <div className="table-scroll"><table><thead><tr><th>Date</th><th>Task</th><th>Mode</th><th>Status</th><th>Winner</th><th>Decision</th><th>Runs</th></tr></thead><tbody>
              {tasks.map((task) => <tr className="clickable-row" key={task.id} onClick={() => loadDetail(task.id)}><td>{formatDate(task.createdAt)}</td><td><strong>{task.task}</strong><small className="table-subtitle">{task.id}</small></td><td>{task.mode}</td><td><StatusBadge value={task.status} /></td><td>{task.winnerAgentId || '—'}</td><td><StatusBadge value={task.decision || 'pending'} /></td><td>{task.runCount}</td></tr>)}
            </tbody></table></div>
            {tasks.length >= limit && <button type="button" className="button-secondary load-more" onClick={() => setLimit((value) => Math.min(100, value + 20))} disabled={limit >= 100}>Load more</button>}
          </>
        )}
      </Panel>

      {detailLoading && <LoadingState label="Loading task detail…" />}
      {detail && (
        <Panel title="Task detail" action={<button type="button" className="button-link" onClick={() => setDetail(null)}>Close</button>}>
          <div className="metric-grid metric-grid-compact">
            <Metric label="ID" value={detail.id} /><Metric label="Mode" value={detail.mode} /><Metric label="Status" value={<StatusBadge value={detail.status} />} /><Metric label="Decision" value={<StatusBadge value={detail.decision} />} />
            <Metric label="Target branch" value={detail.targetBranch || '—'} /><Metric label="Winner" value={detail.winnerAgentId || '—'} /><Metric label="Candidate commit" value={detail.candidateCommit || '—'} /><Metric label="Merge commit" value={detail.mergeCommit || '—'} />
          </div>
          <h3>Task</h3><p className="preserve-text">{detail.task}</p>
          <h3>Classification</h3><div className="tag-list">{Object.entries(detail.classification || {}).map(([name, value]) => <span key={name}>{name}: {formatScore(value)}</span>)}</div>
          <h3>Agent runs</h3>
          {detail.runs?.length ? <div className="table-scroll"><table><thead><tr><th>Agent</th><th>Status</th><th>Router</th><th>Evaluation</th><th>Competition</th><th>Verdict</th><th>Duration</th></tr></thead><tbody>{detail.runs.map((run) => <tr key={run.id}><td>{run.agentId}</td><td><StatusBadge value={run.status} /></td><td>{formatScore(run.routerScore)}</td><td>{formatScore(run.evaluationScore)}</td><td>{formatScore(run.competitionScore)}</td><td><StatusBadge value={run.verdict} /></td><td>{formatDuration(run.durationMs)}</td></tr>)}</tbody></table></div> : <EmptyState>No Agent runs stored.</EmptyState>}
        </Panel>
      )}
    </>
  );
}
