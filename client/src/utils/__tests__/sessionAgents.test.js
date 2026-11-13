import { describe, it, expect } from 'vitest';
import {
  activeAgentsRunningLabel,
  agentDisplayTitle,
  agentMenuOptionLabel,
  agentNameMatchesType,
  agentSwitcherDropdownSections,
  agentTitleFromPrompt,
  countActiveAgentsForSession,
  isAgentAwaitingUser,
  isAgentTurnActive,
  isAnyAgentAwaitingUser,
  isPrimaryAgent,
  isSubagentBuilder,
  partitionSessionAgentsByRunning,
  sortSessionAgentsByRefAsc,
} from '../sessionAgents.js';

describe('agentTitleFromPrompt', () => {
  it('uses the first four words', () => {
    expect(agentTitleFromPrompt('one two three four five')).toBe('one two three four');
  });

  it('falls back to Builder for empty prompts', () => {
    expect(agentTitleFromPrompt('   ')).toBe('Builder');
  });
});

describe('agent display labels', () => {
  it('treats default names as matching agent type', () => {
    expect(agentNameMatchesType('Builder', 'builder')).toBe(true);
    expect(agentNameMatchesType('builder', 'builder')).toBe(true);
    expect(agentNameMatchesType('Reviewer', 'reviewer')).toBe(true);
    expect(agentNameMatchesType('Code review bot', 'reviewer')).toBe(false);
  });

  it('shows only the type label when name matches type', () => {
    const agent = { name: 'Builder', agent_type: 'builder' };
    expect(agentDisplayTitle(agent)).toBe('Builder');
    expect(agentMenuOptionLabel(agent)).toBe('Builder');
  });

  it('shows custom name and badge when name differs from type', () => {
    const agent = { name: 'Ship it', agent_type: 'builder' };
    expect(agentDisplayTitle(agent)).toBe('Ship it');
    expect(agentMenuOptionLabel(agent)).toBe('Ship it (Builder)');
  });

  it('detects primary agent', () => {
    expect(isPrimaryAgent({ is_primary: 1 })).toBe(true);
    expect(isPrimaryAgent({ is_primary: 0 })).toBe(false);
    expect(isPrimaryAgent({ is_primary: true })).toBe(true);
  });

  it('sorts agents by ref ascending', () => {
    const agents = [
      { id: 10, ref: 3 },
      { id: 5, ref: 1 },
      { id: 7, ref: 2 },
    ];
    expect(sortSessionAgentsByRefAsc(agents).map((a) => a.ref)).toEqual([1, 2, 3]);
  });

  it('prefixes menu label with session ref when present', () => {
    const agent = { ref: 3, name: 'Builder', agent_type: 'builder' };
    expect(agentMenuOptionLabel(agent)).toBe('#3 Builder');
  });
});

describe('agent turn status helpers', () => {
  it('treats only running as an active turn', () => {
    expect(isAgentTurnActive('running')).toBe(true);
    expect(isAgentTurnActive('approval')).toBe(false);
    expect(isAgentAwaitingUser('approval')).toBe(true);
  });
});

describe('countActiveAgentsForSession', () => {
  it('counts only running agents', () => {
    const session = {
      agents: [
        { id: 1, status: 'running' },
        { id: 2, status: 'idle' },
        { id: 3, status: 'approval' },
        { id: 4, status: 'running' },
      ],
    };
    expect(countActiveAgentsForSession(session)).toBe(2);
  });

  it('detects awaiting-user agents separately', () => {
    const session = {
      agents: [{ id: 1, status: 'approval' }],
      status: 'stopped',
    };
    expect(countActiveAgentsForSession(session)).toBe(0);
    expect(isAnyAgentAwaitingUser(session)).toBe(true);
  });

  it('returns 0 for archived sessions', () => {
    expect(
      countActiveAgentsForSession({
        archived_at: '2026-01-01',
        agents: [{ id: 1, status: 'running' }],
      })
    ).toBe(0);
  });

  it('formats running label', () => {
    expect(activeAgentsRunningLabel(1)).toBe('1 agent running');
    expect(activeAgentsRunningLabel(3)).toBe('3 agents running');
  });
});

describe('partitionSessionAgentsByRunning', () => {
  it('splits running from other statuses', () => {
    const agents = [
      { id: 1, status: 'idle' },
      { id: 2, status: 'running' },
      { id: 3, status: 'approval' },
      { id: 4, status: 'running' },
    ];
    expect(partitionSessionAgentsByRunning(agents)).toEqual({
      running: [
        { id: 2, status: 'running' },
        { id: 4, status: 'running' },
      ],
      other: [
        { id: 1, status: 'idle' },
        { id: 3, status: 'approval' },
      ],
    });
  });
});

describe('agentSwitcherDropdownSections', () => {
  it('returns null when all agents share the same running state', () => {
    const idleOnly = [{ id: 1, status: 'idle' }];
    expect(agentSwitcherDropdownSections(idleOnly, (a) => a.id)).toBeNull();
    const runningOnly = [{ id: 1, status: 'running' }];
    expect(agentSwitcherDropdownSections(runningOnly, (a) => a.id)).toBeNull();
  });

  it('returns Running and Idle sections when both are present', () => {
    const agents = [
      { id: 1, status: 'running', name: 'A' },
      { id: 2, status: 'idle', name: 'B' },
    ];
    expect(agentSwitcherDropdownSections(agents, (a) => a.name)).toEqual([
      { heading: 'Running', options: ['A'] },
      { heading: 'Idle', options: ['B'] },
    ]);
  });
});

describe('isSubagentBuilder', () => {
  it('is true only for MCP read-only non-primary builders', () => {
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 1 })).toBe(false);
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 0 })).toBe(false);
    expect(isSubagentBuilder({ agent_type: 'subagent', is_primary: 0 })).toBe(true);
    expect(isSubagentBuilder({ agent_type: 'reviewer', is_primary: 0 })).toBe(false);
  });
});
