import { describe, it, expect } from 'vitest';
import { buildSessionAgentList } from '../sessionAgentList.js';

function agent(id, fields = {}) {
  return { id, ref: id, name: `Agent ${id}`, agent_type: 'builder', ...fields };
}

describe('buildSessionAgentList', () => {
  it('returns every agent in one flat level with the builder first', () => {
    const agents = [
      agent(1, { is_primary: 1, agent_type: 'builder' }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 1, ref: 3 }),
      agent(2, { agent_type: 'reviewer', ref: 2 }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it('places the session-pinned agent second when it is not the primary', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T23:00:00Z' }),
      agent(2, { agent_type: 'builder', is_primary: 0, updated_at: '2024-01-01T10:00:00Z' }),
      agent(3, { agent_type: 'subagent', updated_at: '2024-01-01T20:00:00Z' }),
    ];
    const list = buildSessionAgentList(agents, 2);
    expect(list.map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it('ignores pinned_agent_id when it matches the primary', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T00:00:00Z' }),
      agent(2, { agent_type: 'subagent', updated_at: '2024-01-01T20:00:00Z' }),
    ];
    const list = buildSessionAgentList(agents, 1);
    expect(list.map((a) => a.id)).toEqual([1, 2]);
  });

  it('ignores parent_agent_id — subagents are not nested', () => {
    const agents = [
      agent(1, { is_primary: 1 }),
      agent(2, { agent_type: 'builder', is_primary: 0, ref: 2 }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 2, ref: 3 }),
      agent(4, { agent_type: 'subagent', parent_agent_id: 99, ref: 4 }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 2, 3, 4]);
  });

  it('orders subagents by last activity, most recent first', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T00:00:00Z' }),
      agent(2, { agent_type: 'subagent', updated_at: '2024-01-01T10:00:00Z' }),
      agent(3, { agent_type: 'subagent', updated_at: '2024-01-01T12:00:00Z' }),
      agent(4, { agent_type: 'reviewer', updated_at: '2024-01-01T11:00:00Z' }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 3, 4, 2]);
  });

  it('keeps the builder pinned first even when others were active later', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T00:00:00Z' }),
      agent(2, { agent_type: 'subagent', updated_at: '2024-01-01T23:00:00Z' }),
      agent(3, { agent_type: 'subagent', updated_at: '2024-01-01T09:00:00Z' }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it('breaks ties in ref-ascending order', () => {
    const agents = [
      agent(1, { is_primary: 1 }),
      agent(3, { agent_type: 'subagent', updated_at: '2024-01-01T10:00:00Z' }),
      agent(2, { agent_type: 'subagent', updated_at: '2024-01-01T10:00:00Z' }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it('sorts agents without a timestamp after recently active ones', () => {
    const agents = [
      agent(1, { is_primary: 1 }),
      agent(2, { agent_type: 'subagent', updated_at: '2024-01-01T10:00:00Z' }),
      agent(3, { agent_type: 'subagent' }),
      agent(4, { agent_type: 'subagent', updated_at: '2024-01-01T09:00:00Z' }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 2, 4, 3]);
  });

  it('parses SQLite CURRENT_TIMESTAMP values as UTC', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T12:00:00Z' }),
      agent(2, { agent_type: 'subagent', updated_at: '2024-01-01 12:00:01' }),
      agent(3, { agent_type: 'subagent', updated_at: '2024-01-01T13:00:00Z' }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 3, 2]);
  });

  it('sorts by last activity when no primary builder exists', () => {
    const agents = [
      agent(2, { agent_type: 'subagent', updated_at: '2024-01-01T10:00:00Z' }),
      agent(1, { agent_type: 'builder', updated_at: '2024-01-01T12:00:00Z' }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 2]);
  });

  it('returns an empty list for no agents', () => {
    expect(buildSessionAgentList([])).toEqual([]);
    expect(buildSessionAgentList(null)).toEqual([]);
  });
});
