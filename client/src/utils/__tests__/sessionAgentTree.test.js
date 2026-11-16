import { describe, it, expect } from 'vitest';
import { buildSessionAgentTree } from '../sessionAgentTree.js';

function agent(id, fields = {}) {
  return { id, ref: id, name: `Agent ${id}`, agent_type: 'builder', ...fields };
}

describe('buildSessionAgentTree', () => {
  it('puts the primary builder first, reviewer and extra builders at the top level', () => {
    const agents = [
      agent(1, { is_primary: 1, agent_type: 'builder' }),
      agent(2, { agent_type: 'reviewer' }),
      agent(3, { agent_type: 'builder', is_primary: 0, ref: 3 }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.map((n) => n.agent.id)).toEqual([1, 2, 3]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it('nests subagents of the primary builder under the primary row', () => {
    const agents = [
      agent(1, { is_primary: 1 }),
      agent(2, { agent_type: 'subagent', parent_agent_id: 1, ref: 2 }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 1, ref: 3 }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.map((n) => n.agent.id)).toEqual([1]);
    expect(tree[0].children.map((n) => n.agent.id)).toEqual([2, 3]);
  });

  it('nests subagents under the extra builder that spawned them', () => {
    const agents = [
      agent(1, { is_primary: 1 }),
      agent(2, { agent_type: 'builder', is_primary: 0, ref: 2 }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 2, ref: 3 }),
      agent(4, { agent_type: 'reviewer', ref: 4 }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.map((n) => n.agent.id)).toEqual([1, 2, 4]);
    expect(tree[1].children.map((n) => n.agent.id)).toEqual([3]);
  });

  it('nests orphaned subagents under the primary builder row', () => {
    const agents = [
      agent(1, { is_primary: 1 }),
      agent(2, { agent_type: 'subagent', parent_agent_id: 99, ref: 2 }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.map((n) => n.agent.id)).toEqual([1]);
    expect(tree[0].children.map((n) => n.agent.id)).toEqual([2]);
  });

  it('keeps subagents at the top level when no primary builder exists', () => {
    const agents = [agent(2, { agent_type: 'subagent' })];
    const tree = buildSessionAgentTree(agents);
    expect(tree.map((n) => n.agent.id)).toEqual([2]);
  });

  it('sorts roots and children by ref ascending', () => {
    const agents = [
      agent(1, { is_primary: 1, ref: 1 }),
      agent(5, { agent_type: 'subagent', parent_agent_id: 1, ref: 2 }),
      agent(4, { agent_type: 'subagent', parent_agent_id: 1, ref: 3 }),
      agent(3, { agent_type: 'reviewer', ref: 4 }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.map((n) => n.agent.id)).toEqual([1, 3]);
    expect(tree[0].children.map((n) => n.agent.id)).toEqual([5, 4]);
  });

  it('returns an empty tree for no agents', () => {
    expect(buildSessionAgentTree([])).toEqual([]);
    expect(buildSessionAgentTree(null)).toEqual([]);
  });
});
