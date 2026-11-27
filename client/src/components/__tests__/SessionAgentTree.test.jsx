// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../feathers.js', () => ({
  agentsService: { patch: vi.fn(), setPrimary: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn() },
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

  it('renders the edit button right next to the agent label when there is room, and clicking it starts rename', () => {
    const onSelectAgent = vi.fn();
    render(
      <SessionAgentTree
        agents={sampleAgents}
        currentAgentId={1}
        canManage
        onSelectAgent={onSelectAgent}
      />
    );

    const featureRow = screen
      .getAllByTestId('agent-tree-row')
      .find((r) => r.getAttribute('data-agent-name') === 'Feature builder');
    expect(featureRow).toBeTruthy();
    const editWrapper = within(featureRow).getByTestId('agent-tree-edit');
    expect(editWrapper.getAttribute('data-overlay')).toBe('false');
    expect(within(featureRow).getByTestId('agent-tree-set-primary')).toBeTruthy();

    const renameBtn = within(featureRow).getByRole('button', { name: 'Rename Feature builder' });
    fireEvent.click(renameBtn);
    expect(onSelectAgent).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Feature builder')).toBeTruthy();
  });

  it('overlays the edit button over the agent label when the label takes the whole available width', () => {
    const protoClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const protoScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const protoOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        if (this.classList?.contains('flex-1')) return 140;
        if (this.tagName === 'SPAN' && this.classList?.contains('truncate')) return 120;
        return 120;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        if (this.tagName === 'SPAN' && this.classList?.contains('truncate')) return 220;
        return 120;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return 14;
      },
    });

    try {
      render(
        <SessionAgentTree
          agents={sampleAgents}
          currentAgentId={1}
          canManage
          onSelectAgent={vi.fn()}
        />
      );

      const featureRow = screen
        .getAllByTestId('agent-tree-row')
        .find((r) => r.getAttribute('data-agent-name') === 'Feature builder');
      const editWrapper = within(featureRow).getByTestId('agent-tree-edit');
      expect(editWrapper.getAttribute('data-overlay')).toBe('true');
      expect(editWrapper.className).toContain('absolute');
      expect(editWrapper.className).toContain('right-0');
    } finally {
      if (protoClientWidth)
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', protoClientWidth);
      if (protoScrollWidth)
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', protoScrollWidth);
      if (protoOffsetWidth)
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', protoOffsetWidth);
    }
  });

  it('shows rename on the primary builder when the user can manage', () => {
    render(
      <SessionAgentTree
        agents={sampleAgents}
        currentAgentId={1}
        canManage
        onSelectAgent={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Rename Builder' })).toBeTruthy();
  });

  it('shows make-primary on secondary builders when the user can manage', () => {
    render(
      <SessionAgentTree
        agents={sampleAgents}
        currentAgentId={2}
        canManage
        onSelectAgent={vi.fn()}
      />
    );
    expect(screen.getByTestId('agent-tree-set-primary')).toBeTruthy();
    expect(screen.queryAllByTestId('agent-tree-set-primary')).toHaveLength(1);
  });
});
