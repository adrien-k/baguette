import { isPrimaryAgent, isSubagentBuilder, sortSessionAgentsByRefAsc } from './sessionAgents.js';

/**
 * Sidebar agent-tree node.
 * @typedef {object} SessionAgentTreeNode
 * @property {object} agent Agent summary from the session DTO.
 * @property {SessionAgentTreeNode[]} children Nested agents (subagent children).
 */

/**
 * Build the agent tree for a session's embedded agent summaries.
 *
 * The primary builder is the top node; its subagents nest under it (subagents
 * cannot spawn subagents, so that is always one level). Subagents spawned by
 * an extra builder nest under that builder's row. Reviewer and extra builders
 * sit at the top level.
 *
 * @param {Array<{ id: number, parent_agent_id?: number | null } | object>} agents
 * @returns {SessionAgentTreeNode[]} Root nodes, ref-ascending within each level.
 */
export function buildSessionAgentTree(agents) {
  const list = sortSessionAgentsByRefAsc(agents ?? []);
  const byId = new Map(list.map((agent) => [agent.id, agent]));
  const primary = list.find(isPrimaryAgent) ?? null;

  /** Effective parent row for nesting (null = top level). */
  const parentOf = (agent) => {
    if (agent === primary) return null;
    const parentId = agent.parent_agent_id;
    if (parentId != null && byId.has(parentId) && parentId !== agent.id) {
      return byId.get(parentId);
    }
    // Orphaned subagents fall back under the primary builder row.
    return isSubagentBuilder(agent) && primary ? primary : null;
  };

  const childrenOf = new Map();
  for (const agent of list) {
    const parent = parentOf(agent);
    if (!parent) continue;
    if (!childrenOf.has(parent.id)) childrenOf.set(parent.id, []);
    childrenOf.get(parent.id).push(agent);
  }

  const nodeFor = (agent) => ({
    agent,
    children: (childrenOf.get(agent.id) ?? []).map(nodeFor),
  });

  return list.filter((agent) => parentOf(agent) == null).map(nodeFor);
}
