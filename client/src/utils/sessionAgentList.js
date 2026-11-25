import {
  isAgentAwaitingUser,
  isAgentTurnActive,
  isPrimaryAgent,
  isReviewerAgent,
  isSubagentBuilder,
  sortSessionAgentsByLastActivityDesc,
  sortSessionAgentsByRefAsc,
} from './sessionAgents.js';

/**
 * @typedef {{ agent: object; children: SessionAgentTreeNode[] }} SessionAgentTreeNode
 */

/**
 * First builder in display order — builders sorted by most recent last activity
 * first (`updated_at` desc), with `ref` ascending as tie-breaker.
 *
 * @param {Array<object> | null | undefined} agents
 * @returns {object | null}
 */
export function firstSessionBuilder(agents) {
  if (!Array.isArray(agents) || !agents.length) return null;
  const builders = sortSessionAgentsByRefAsc(agents).filter((a) => a.agent_type === 'builder');
  if (!builders.length) return null;
  return sortSessionAgentsByLastActivityDesc(builders)[0] ?? null;
}

/**
 * Build the sidebar agent tree for a session:
 * - Top-level builders ordered by last activity (most recent first), ties broken by ref asc.
 * - Reviewer(s) placed after builders.
 * - Subagents nested under their parent (`parent_agent_id`), recursively if a subagent
 *   spawned another subagent. Subagents with a missing/unknown parent attach to the
 *   primary builder (or first builder), or sit at the end if the session has no builders.
 * - Sibling subagents under the same parent are ordered by last activity desc (ref asc tie-break).
 *
 * @param {Array<object> | null | undefined} agents
 * @returns {{ builders: SessionAgentTreeNode[]; reviewers: SessionAgentTreeNode[]; orphans: SessionAgentTreeNode[] }}
 */
export function buildSessionAgentTree(agents) {
  if (!Array.isArray(agents) || !agents.length) {
    return { builders: [], reviewers: [], orphans: [] };
  }

  const refSorted = sortSessionAgentsByRefAsc(agents);
  const byId = new Map(refSorted.map((a) => [a.id, a]));
  const nodeById = new Map(refSorted.map((a) => [a.id, { agent: a, children: [] }]));

  const builders = sortSessionAgentsByLastActivityDesc(
    refSorted.filter((a) => a.agent_type === 'builder')
  );
  const reviewers = refSorted.filter(isReviewerAgent);
  const primaryOrFirstBuilder = builders.find(isPrimaryAgent) ?? builders[0] ?? null;

  const subagents = sortSessionAgentsByLastActivityDesc(
    refSorted.filter(
      (a) => isSubagentBuilder(a) || (!isReviewerAgent(a) && a.agent_type !== 'builder')
    )
  );

  const orphanNodes = [];

  for (const sub of subagents) {
    const node = nodeById.get(sub.id);
    const parentId = sub.parent_agent_id;
    // Guard against self-parenting or cycles by checking the ancestor chain.
    let validParentId = null;
    if (parentId != null && parentId !== sub.id && byId.has(parentId)) {
      const seen = new Set([sub.id]);
      let cursor = parentId;
      let cycle = false;
      while (cursor != null) {
        if (seen.has(cursor)) {
          cycle = true;
          break;
        }
        seen.add(cursor);
        const parent = byId.get(cursor);
        cursor = parent?.parent_agent_id ?? null;
      }
      if (!cycle) validParentId = parentId;
    }

    if (validParentId != null) {
      nodeById.get(validParentId).children.push(node);
    } else if (primaryOrFirstBuilder) {
      nodeById.get(primaryOrFirstBuilder.id).children.push(node);
    } else {
      orphanNodes.push(node);
    }
  }

  return {
    builders: builders.map((a) => nodeById.get(a.id)),
    reviewers: reviewers.map((a) => nodeById.get(a.id)),
    orphans: orphanNodes,
  };
}

/**
 * True when any descendant of `node` (at any depth, excluding `node` itself) matches `agentId`.
 *
 * @param {SessionAgentTreeNode} node
 * @param {number | string | null | undefined} agentId
 * @returns {boolean}
 */
export function nodeHasDescendantAgent(node, agentId) {
  if (agentId == null || agentId === '') return false;
  const target = Number(agentId);
  if (!Number.isFinite(target)) return false;
  for (const child of node.children ?? []) {
    if (Number(child.agent.id) === target) return true;
    if (nodeHasDescendantAgent(child, target)) return true;
  }
  return false;
}

/**
 * Aggregate count and highest-priority live status across all descendants of `node`.
 *
 * @param {SessionAgentTreeNode} node
 * @returns {{ count: number; hasRunning: boolean; hasApproval: boolean; hasFailed: boolean }}
 */
export function summarizeNodeDescendants(node) {
  let count = 0;
  let hasRunning = false;
  let hasApproval = false;
  let hasFailed = false;

  const visit = (children) => {
    for (const child of children ?? []) {
      count += 1;
      const status = child.agent?.status;
      if (isAgentTurnActive(status) || status === 'provisioning') hasRunning = true;
      else if (isAgentAwaitingUser(status)) hasApproval = true;
      else if (status === 'failed' || status === 'error') hasFailed = true;
      visit(child.children);
    }
  };

  visit(node.children);
  return { count, hasRunning, hasApproval, hasFailed };
}
