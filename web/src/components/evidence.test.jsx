import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentRanking } from './AgentRanking';
import { CompetitionTable } from './CompetitionTable';
import { DiffViewer } from './DiffViewer';
import { EvaluationCard } from './EvaluationCard';
import { render } from '../test/render';

describe('evidence components', () => {
  it('shows effective score in Simple and components only in Advanced', () => {
    const analysis = { ranking: [{ id: 'qwen-code', name: 'Qwen Code', available: true, score: 93, staticScore: 88, historicalScore: 98, recentScore: 95, sampleSize: 12, adaptive: true }] };
    const simple = render(<AgentRanking analysis={analysis} />);
    expect(screen.getByText('93')).toBeInTheDocument(); expect(screen.queryByText('Static 88')).toBeNull(); simple.unmount();
    render(<AgentRanking analysis={analysis} />, { detailMode: 'advanced' });
    expect(screen.getByText('Static 88')).toBeInTheDocument(); expect(screen.getByText('History 98')).toBeInTheDocument(); expect(screen.getByText('Recent 95')).toBeInTheDocument();
  });
  it.each(['pass', 'warning', 'fail'])('shows evaluator %s verdict as text', (verdict) => {
    render(<EvaluationCard evaluation={{ score: 90, verdict, staticChecks: [], project: { scripts: {} }, reasons: [] }} />);
    expect(screen.getByText(new RegExp(verdict, 'i'))).toBeInTheDocument();
  });
  it.each(['<script>alert("x")</script>', '<img src=x onerror=alert(1)>'])('renders untrusted diff as inert text: %s', (attack) => {
    render(<DiffViewer diff={attack} untrackedFiles={[]} />);
    expect(screen.getByTestId('diff-text')).toHaveTextContent(attack); expect(document.querySelector('script')).toBeNull(); expect(document.querySelector('img')).toBeNull();
  });
  it('shows untracked files separately from tracked diff', () => {
    render(<DiffViewer diff="diff --git a/a.js b/a.js" untrackedFiles={['src/new-file.js']} />);
    expect(screen.getByTestId('diff-text')).not.toHaveTextContent('src/new-file.js'); expect(screen.getByTestId('untracked-files')).toHaveTextContent('src/new-file.js');
  });
  it('uses backend winner and never promotes an ineligible failed Agent', () => {
    render(<CompetitionTable result={{ winner: { agentId: 'qwen-code' }, candidates: [{ agent: { id: 'qwen-code', name: 'Qwen Code' }, evaluation: { verdict: 'pass' } }, { agent: { id: 'opencode', name: 'OpenCode' }, evaluation: { verdict: 'fail' } }], ranking: [{ agentId: 'qwen-code', routerScore: 92, evaluationScore: 97, speedScore: 80, competitionScore: 93, status: 'completed', eligible: true }, { agentId: 'opencode', routerScore: 99, evaluationScore: 10, speedScore: 100, competitionScore: 95, status: 'failed', eligible: false }] }} />);
    const winner = screen.getByText('Best Candidate'); expect(winner.closest('tr')).toHaveTextContent('Qwen Code'); expect(winner.closest('tr')).not.toHaveTextContent('OpenCode');
  });
});
