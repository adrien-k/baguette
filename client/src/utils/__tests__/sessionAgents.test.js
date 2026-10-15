import { describe, it, expect } from 'vitest';
import {
  activeAgentsRunningLabel,
  agentDisplayTitle,
  agentMenuOptionLabel,
  agentNameMatchesType,
  countActiveAgentsForSession,
  isPrimaryAgent,
  isSubagentBuilder,
  sortSessionAgentsByRefAsc,
} from '../sessionAgents.js';

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

describe('countActiveAgentsForSession', () => {
  it('counts agents with running or approval status', () => {
    const session = {
      agents: [
        { id: 1, status: 'running' },
        { id: 2, status: 'idle' },
        { id: 3, status: 'approval' },
        { id: 4, status: 'running' },
      ],
    };
    expect(countActiveAgentsForSession(session)).toBe(3);
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

describe('isSubagentBuilder', () => {
  it('is true only for MCP read-only non-primary builders', () => {
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 1 })).toBe(false);
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 0 })).toBe(false);
    expect(isSubagentBuilder({ agent_type: 'subagent', is_primary: 0 })).toBe(true);
    expect(isSubagentBuilder({ agent_type: 'reviewer', is_primary: 0 })).toBe(false);
  });
});
