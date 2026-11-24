// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../feathers.js', () => ({
  agentsService: { patch: vi.fn() },
}));
vi.mock('../SessionCard.jsx', () => ({
  SessionStatusIcon: () => null,
}));
vi.mock('../../context/AgentConfigContext.jsx', () => ({
  useAgentConfigContext: () => ({ getConfig: () => null }),
}));
vi.mock('../../hooks/useAgentConfigModels.js', () => ({
  useAgentConfigModels: () => ({ models: [] }),
}));
vi.mock('../Tooltip.jsx', () => ({
  default: ({ children }) => <span>{children}</span>,
}));

import SessionAgentTree from '../SessionAgentTree.jsx';

afterEach(cleanup);

const sampleAgents = [
  {
    id: 1,
    ref: 1,
    name: 'Builder',
    agent_type: 'builder',
    is_primary: 1,
    status: 'stopped',
    updated_at: '2026-01-01T10:00:00Z',
  },
  {
    id: 2,
    ref: 2,
    name: 'Feature builder',
    agent_type: 'builder',
    is_primary: 0,
    status: 'stopped',
    updated_at: '2026-01-01T15:00:00Z',
  },
  {
    id: 3,
    ref: 3,
    name: 'Reviewer',
    agent_type: 'reviewer',
    is_primary: 0,
    status: 'stopped',
    updated_at: '2026-01-01T20:00:00Z',
  },
  {
    id: 4,
    ref: 4,
    name: 'Scout',
    agent_type: 'subagent',
    is_primary: 0,
    parent_agent_id: 1,
    status: 'running',
    updated_at: '2026-01-01T18:00:00Z',
  },
];

describe('SessionAgentTree', () => {
  it('places Add builder at the very top, orders builders by last activity then reviewer, and has no pin buttons', () => {
    const onAddBuilder = vi.fn();
    render(
      <SessionAgentTree
        agents={sampleAgents}
        currentAgentId={2}
        canManage
        onSelectAgent={vi.fn()}
        onAddBuilder={onAddBuilder}
        showAddBuilder
      />
    );

    const tree = screen.getByTestId('session-agent-tree');
    const addBtn = screen.getByTestId('agent-tree-add-builder');
    expect(tree.firstElementChild).toBe(addBtn);

    fireEvent.click(addBtn);
    expect(onAddBuilder).toHaveBeenCalledTimes(1);

    const rows = screen.getAllByTestId('agent-tree-row');
    expect(rows.map((r) => r.getAttribute('data-agent-name'))).toEqual([
      'Feature builder',
      'Builder',
      'Reviewer',
    ]);

    expect(screen.queryByRole('button', { name: /pin agent/i })).toBeNull();
  });

  it('nests subagents under their parent builder behind a toggle pill', () => {
    const onSelectAgent = vi.fn();
    render(
      <SessionAgentTree
        agents={sampleAgents}
        currentAgentId={2}
        canManage
        onSelectAgent={onSelectAgent}
      />
    );

    expect(screen.queryByText('Scout')).toBeNull();

    const toggle = screen.getByTestId('builder-subagents-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Scout')).toBeTruthy();
    expect(onSelectAgent).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(screen.queryByText('Scout')).toBeNull();
  });

  it('auto-expands the parent builder when a nested subagent is currently selected', () => {
    render(
      <SessionAgentTree
        agents={sampleAgents}
        currentAgentId={4}
        canManage
        onSelectAgent={vi.fn()}
      />
    );

    expect(screen.getByText('Scout')).toBeTruthy();
    const toggle = screen.getByTestId('builder-subagents-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
