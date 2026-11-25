import { describe, it, expect } from 'vitest';
import {
  buildSessionAgentTree,
  firstSessionBuilder,
  nodeHasDescendantAgent,
  summarizeNodeDescendants,
} from '../sessionAgentList.js';

function agent(id, fields = {}) {
  return { id, ref: id, name: `Agent ${id}`, agent_type: 'builder', ...fields };
}

describe('firstSessionBuilder', () => {
  it('returns the most recently active builder', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T10:00:00Z' }),
      agent(2, { is_primary: 0, updated_at: '2024-01-01T15:00:00Z' }),
      agent(3, { agent_type: 'reviewer', updated_at: '2024-01-01T20:00:00Z' }),
      agent(4, { agent_type: 'subagent', parent_agent_id: 1, updated_at: '2024-01-01T22:00:00Z' }),
    ];
    expect(firstSessionBuilder(agents)?.id).toBe(2);
  });

  it('breaks ties by ref ascending', () => {
    const agents = [
      agent(2, { ref: 2, is_primary: 0, updated_at: '2024-01-01T10:00:00Z' }),
      agent(1, { ref: 1, is_primary: 1, updated_at: '2024-01-01T10:00:00Z' }),
    ];
    expect(firstSessionBuilder(agents)?.id).toBe(1);
  });

  it('returns null when no builders exist', () => {
    expect(firstSessionBuilder([])).toBeNull();
    expect(firstSessionBuilder(null)).toBeNull();
    expect(firstSessionBuilder([agent(1, { agent_type: 'reviewer' })])).toBeNull();
  });
});

describe('buildSessionAgentTree', () => {
  it('orders builders by last activity desc and places reviewer after builders', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T10:00:00Z' }),
      agent(2, { is_primary: 0, updated_at: '2024-01-01T14:00:00Z' }),
      agent(3, { agent_type: 'reviewer', updated_at: '2024-01-01T20:00:00Z' }),
      agent(4, { is_primary: 0, updated_at: '2024-01-01T12:00:00Z' }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.builders.map((n) => n.agent.id)).toEqual([2, 4, 1]);
    expect(tree.reviewers.map((n) => n.agent.id)).toEqual([3]);
    expect(tree.orphans).toEqual([]);
  });

  it('nests subagents under their parent builder ordered by last activity desc', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T10:00:00Z' }),
      agent(2, { is_primary: 0, updated_at: '2024-01-01T15:00:00Z' }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 1, updated_at: '2024-01-01T11:00:00Z' }),
      agent(4, { agent_type: 'subagent', parent_agent_id: 1, updated_at: '2024-01-01T13:00:00Z' }),
      agent(5, { agent_type: 'subagent', parent_agent_id: 2, updated_at: '2024-01-01T16:00:00Z' }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.builders.map((n) => n.agent.id)).toEqual([2, 1]);
    expect(tree.builders[0].children.map((n) => n.agent.id)).toEqual([5]);
    expect(tree.builders[1].children.map((n) => n.agent.id)).toEqual([4, 3]);
  });

  it('supports recursively nested subagents', () => {
    const agents = [
      agent(1, { is_primary: 1 }),
      agent(2, { agent_type: 'subagent', parent_agent_id: 1 }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 2 }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.builders[0].children.map((n) => n.agent.id)).toEqual([2]);
    expect(tree.builders[0].children[0].children.map((n) => n.agent.id)).toEqual([3]);
  });

  it('attaches subagents with unknown parent_agent_id to the primary builder', () => {
    const agents = [
      agent(1, { is_primary: 1, updated_at: '2024-01-01T10:00:00Z' }),
      agent(2, { is_primary: 0, updated_at: '2024-01-01T15:00:00Z' }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 999 }),
    ];
    const tree = buildSessionAgentTree(agents);
    const primaryNode = tree.builders.find((n) => n.agent.id === 1);
    expect(primaryNode.children.map((n) => n.agent.id)).toEqual([3]);
  });

  it('breaks ties in ref-ascending order and parses SQLite timestamps as UTC', () => {
    const agents = [
      agent(1, { is_primary: 1, ref: 1, updated_at: '2024-01-01T12:00:00Z' }),
      agent(2, { is_primary: 0, ref: 2, updated_at: '2024-01-01 12:00:01' }),
      agent(4, { is_primary: 0, ref: 4, updated_at: '2024-01-01T12:00:00Z' }),
      agent(3, { is_primary: 0, ref: 3, updated_at: '2024-01-01T12:00:00Z' }),
    ];
    const tree = buildSessionAgentTree(agents);
    expect(tree.builders.map((n) => n.agent.id)).toEqual([2, 1, 3, 4]);
  });

  it('returns empty sections for empty input', () => {
    expect(buildSessionAgentTree([])).toEqual({ builders: [], reviewers: [], orphans: [] });
    expect(buildSessionAgentTree(null)).toEqual({ builders: [], reviewers: [], orphans: [] });
  });
});

describe('nodeHasDescendantAgent & summarizeNodeDescendants', () => {
  it('detects nested descendants and summarizes live status', () => {
    const agents = [
      agent(1, { is_primary: 1, status: 'stopped' }),
      agent(2, { agent_type: 'subagent', parent_agent_id: 1, status: 'stopped' }),
      agent(3, { agent_type: 'subagent', parent_agent_id: 2, status: 'running' }),
    ];
    const [root] = buildSessionAgentTree(agents).builders;
    expect(nodeHasDescendantAgent(root, 1)).toBe(false);
    expect(nodeHasDescendantAgent(root, 2)).toBe(true);
    expect(nodeHasDescendantAgent(root, 3)).toBe(true);
    expect(nodeHasDescendantAgent(root, '3')).toBe(true);
    expect(nodeHasDescendantAgent(root, 99)).toBe(false);

    expect(summarizeNodeDescendants(root)).toEqual({
      count: 2,
      hasRunning: true,
      hasApproval: false,
      hasFailed: false,
    });
  });
});
