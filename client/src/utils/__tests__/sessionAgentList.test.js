import { describe, it, expect } from 'vitest';
import { buildSessionAgentList } from '../sessionAgentList.js';

function agent(id, fields = {}) {
  return { id, ref: id, name: `Agent ${id}`, agent_type: 'builder', ...fields };
}

describe('buildSessionAgentList', () => {
  it('returns every agent in one flat level, ref ascending', () => {
    const agents = [
      agent(1, { is_primary: 1, agent_type: 'builder' }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 1, ref: 3 }),
      agent(2, { agent_type: 'reviewer', ref: 2 }),
    ];
    const list = buildSessionAgentList(agents);
    expect(list.map((a) => a.id)).toEqual([1, 2, 3]);
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

  it('returns an empty list for no agents', () => {
    expect(buildSessionAgentList([])).toEqual([]);
    expect(buildSessionAgentList(null)).toEqual([]);
  });
});
