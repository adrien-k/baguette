import { describe, it, expect } from 'vitest';
import {
  agentDisplayTitle,
  agentMenuOptionLabel,
  agentNameMatchesType,
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

describe('isSubagentBuilder', () => {
  it('is true only for MCP read-only non-primary builders', () => {
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 1 })).toBe(false);
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 0 })).toBe(false);
    expect(isSubagentBuilder({ agent_type: 'builder', is_primary: 0, subagent: 1 })).toBe(true);
    expect(isSubagentBuilder({ agent_type: 'reviewer', is_primary: 0 })).toBe(false);
  });
});
