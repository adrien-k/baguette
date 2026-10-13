/** @typedef {{ id: number; name?: string; agent_type?: string; status?: string; is_primary?: number | boolean }} SessionAgentSummary */

/**
 * Agents embedded on session DTOs from the server (`mergeSessionAgentFields`).
 * @param {object | null | undefined} session
 * @returns {SessionAgentSummary[]}
 */
function sessionAgents(session) {
  return Array.isArray(session?.agents) ? session.agents : [];
}

export function reviewerFromSession(session) {
  const agents = sessionAgents(session);
  const fromList = agents.find((a) => a.agent_type === 'reviewer');
  if (fromList) return fromList;
  if (session?.reviewer_agent_id) {
    return {
      id: session.reviewer_agent_id,
      agent_type: 'reviewer',
      status: session.review_status,
      name: 'Reviewer',
    };
  }
  if (session?.review_status != null) {
    return { agent_type: 'reviewer', status: session.review_status, name: 'Reviewer' };
  }
  return null;
}

export function agentTypeLabel(agentType) {
  return agentType === 'reviewer' ? 'Reviewer' : 'Builder';
}

/** True when stored name is just the default type label (e.g. "Builder" / "builder"). */
export function agentNameMatchesType(name, agentType) {
  if (!name || !agentType) return false;
  const normalized = name.trim().toLowerCase();
  const type = agentType.trim().toLowerCase();
  const label = agentTypeLabel(agentType).toLowerCase();
  return normalized === type || normalized === label;
}

/** Primary label for lists and composer chrome. */
export function agentDisplayTitle(agent) {
  if (!agent) return 'Agent';
  const typeLabel = agentTypeLabel(agent.agent_type);
  if (agentNameMatchesType(agent.name, agent.agent_type)) return typeLabel;
  const name = agent.name?.trim();
  return name || typeLabel;
}

/** Show the type pill when the name is not redundant with agent_type. */
export function agentShowsTypeBadge(agent) {
  if (!agent?.agent_type) return false;
  return !agentNameMatchesType(agent.name, agent.agent_type);
}

/** Menu row label when switching agents. */
export function agentMenuOptionLabel(agent) {
  const typeLabel = agentTypeLabel(agent.agent_type);
  if (agentNameMatchesType(agent.name, agent.agent_type)) return typeLabel;
  const name = agent.name?.trim();
  return name ? `${name} (${typeLabel})` : typeLabel;
}

export function isAgentTurnActive(status) {
  return status === 'running' || status === 'approval';
}

export function isAnyAgentRunning(session) {
  const agents = sessionAgents(session);
  if (agents.length > 0) {
    return agents.some((a) => isAgentTurnActive(a.status));
  }
  if (session?.review_status && isAgentTurnActive(session.review_status)) return true;
  return session?.status === 'running';
}

export function isReviewInProgressForSession(session) {
  if (!session || session.archived_at) return false;
  const reviewer = reviewerFromSession(session);
  return reviewer != null && isAgentTurnActive(reviewer.status);
}

export function reviewerCompletedTransition(prevStatus, nextStatus) {
  return prevStatus !== undefined && prevStatus !== nextStatus && nextStatus === 'completed';
}
