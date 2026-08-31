import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentRanking } from './AgentRanking';
import { CompetitionTable } from './CompetitionTable';
import { DiffViewer } from './DiffViewer';
import { EvaluationCard } from './EvaluationCard';

describe('evidence components', () => {
  it('renders effective, static, historical, and recent router scores', () => {
    render(<AgentRanking analysis={{ ranking: [{ id: 'qwen-code', name: 'Qwen Code', available: true, score: 93, staticScore: 88, historicalScore: 98, recentScore: 95, sampleSize: 12, adaptive: true }] }} />);
    expect(screen.getByText('Qwen Code')).toBeInTheDocument();
    expect(screen.getByText('93')).toBeInTheDocument();
    expect(screen.getByText('Static 88')).toBeInTheDocument();
    expect(screen.getByText('History 98')).toBeInTheDocument();
    expect(screen.getByText('Recent 95')).toBeInTheDocument();
  });

  it.each(['pass', 'warning', 'fail'])('shows evaluator %s verdict as text', (verdict) => {
    render(<EvaluationCard evaluation={{ score: 90, verdict, staticChecks: [], project: { scripts: {} }, reasons: [] }} />);
    expect(screen.getByText(verdict.toUpperCase())).toBeInTheDocument();
  });

  it('renders untrusted diff as text without creating HTML elements', () => {
    const attack = '<script>alert("x")</script>';
    render(<DiffViewer diff={attack} untrackedFiles={[]} />);
    expect(screen.getByTestId('diff-text')).toHaveTextContent(attack);
    expect(document.querySelector('script')).toBeNull();
  });

  it('shows untracked files separately from tracked diff', () => {
    render(<DiffViewer diff={'diff --git a/a.js b/a.js'} untrackedFiles={['src/new-file.js']} />);
    expect(screen.getByTestId('diff-text')).not.toHaveTextContent('src/new-file.js');
    expect(screen.getByTestId('untracked-files')).toHaveTextContent('src/new-file.js');
  });

  it('shows deterministic competition evidence and labels winner as a candidate', () => {
    render(<CompetitionTable result={{
      winner: { agentId: 'qwen-code' },
      candidates: [
        { agent: { id: 'qwen-code', name: 'Qwen Code' }, evaluation: { verdict: 'pass' } },
        { agent: { id: 'opencode', name: 'OpenCode' }, evaluation: { verdict: 'warning' } },
      ],
      ranking: [
        { agentId: 'qwen-code', routerScore: 92, evaluationScore: 97, speedScore: 80, competitionScore: 93, status: 'completed', eligible: true, durationMs: 2000 },
        { agentId: 'opencode', routerScore: 90, evaluationScore: 92, speedScore: 100, competitionScore: 92, status: 'completed_with_warnings', eligible: true, durationMs: 1600 },
      ],
    }} />);
    expect(screen.getByText('★ Best candidate')).toBeInTheDocument();
    expect(screen.getByText('Qwen Code')).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.queryByText('Merged')).not.toBeInTheDocument();
  });
});
