/** @typedef {{ id: number; ref?: number; name?: string; agent_type?: string; status?: string; is_primary?: number | boolean }} SessionAgentSummary */

function agentRefPrefix(agent) {
  if (agent?.ref == null) return '';
  return `#${agent.ref} `;
}

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

function agentTypeLabel(agentType) {
  if (agentType === 'reviewer') return 'Reviewer';
  if (agentType === 'subagent') return 'Subagent';
  return 'Builder';
}

/** True when stored name is just the default type label (e.g. "Builder" / "builder"). */
export function agentNameMatchesType(name, agentType) {
  if (!name || !agentType) return false;
  const normalized = name.trim().toLowerCase();
  const type = agentType.trim().toLowerCase();
  const label = agentTypeLabel(agentType).toLowerCase();
  return normalized === type || normalized === label;
}

/** Default name for a secondary builder from the first words of the user's prompt. */
export function agentTitleFromPrompt(prompt, maxWords = 4) {
  const words = String(prompt ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'Builder';
  const title = words.slice(0, maxWords).join(' ');
  const maxLen = 120;
  if (title.length <= maxLen) return title;
  return `${title.slice(0, maxLen - 1)}…`;
}

/** Primary label for lists and composer chrome. */
export function agentDisplayTitle(agent) {
  if (!agent) return 'Agent';
  const typeLabel = agentTypeLabel(agent.agent_type);
  if (agentNameMatchesType(agent.name, agent.agent_type)) return typeLabel;
  const name = agent.name?.trim();
  return name || typeLabel;
}

/** Menu row label when switching agents. */
export function agentMenuOptionLabel(agent) {
  const typeLabel = agentTypeLabel(agent.agent_type);
  let label;
  if (agentNameMatchesType(agent.name, agent.agent_type)) {
    label = typeLabel;
  } else {
    const name = agent.name?.trim();
    label = name ? `${name} (${typeLabel})` : typeLabel;
  }
  const prefix = agentRefPrefix(agent);
  return prefix ? `${prefix}${label}` : label;
}

/** Agent is executing a turn (streaming tools / model output). */
export function isAgentTurnActive(status) {
  return status === 'running';
}

/** Turn ended on AskUserQuestions / CreatePlan / EditPlan — waiting on the user. */
export function isAgentAwaitingUser(status) {
  return status === 'approval';
}

export function isPrimaryAgent(agent) {
  return Boolean(agent && Number(agent.is_primary) === 1);
}

/** Stable list order for agents panel and switchers (ref ascending, then id). */
export function sortSessionAgentsByRefAsc(agents) {
  return [...agents].sort((a, b) => {
    const ar = a.ref ?? Number.MAX_SAFE_INTEGER;
    const br = b.ref ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
    return (a.id ?? 0) - (b.id ?? 0);
  });
}

/** MCP StartSubagent agents (`agent_type` subagent). */
export function isSubagentBuilder(agent) {
  return agent?.agent_type === 'subagent';
}

/** Agent turn finished or idle — safe to remove (server also enforces). */
export function canRemoveAgentWhenIdle(agent) {
  return agent != null && !Number(agent.is_primary) && !isAgentTurnActive(agent.status);
}

export function isAnyAgentRunning(session) {
  return countActiveAgentsForSession(session) > 0;
}

/** Agents currently executing a turn on this session. */
export function countActiveAgentsForSession(session) {
  if (!session || session.archived_at) return 0;
  const agents = sessionAgents(session);
  if (agents.length > 0) {
    return agents.filter((a) => isAgentTurnActive(a.status)).length;
  }
  let count = 0;
  if (session.review_status === 'running') count += 1;
  if (session.status === 'running') count += 1;
  return count;
}

export function isAnyAgentAwaitingUser(session) {
  if (!session || session.archived_at) return false;
  const agents = sessionAgents(session);
  if (agents.length > 0) {
    return agents.some((a) => isAgentAwaitingUser(a.status));
  }
  return session.status === 'approval' || session.review_status === 'approval';
}

/** Merge a realtime `agents` service patch into a session DTO (embedded `agents` list). */
export function applyAgentPatchToSession(session, agent) {
  if (!session?.id || !agent?.session_id || session.id !== agent.session_id) {
    return session;
  }
  const agents = Array.isArray(session.agents) ? [...session.agents] : [];
  const agentIdx = agents.findIndex((a) => a.id === agent.id);
  const summary = {
    id: agent.id,
    ref: agent.ref,
    name: agent.name,
    agent_type: agent.agent_type,
    status: agent.status,
    is_primary: agent.is_primary,
  };
  if (agentIdx >= 0) agents[agentIdx] = { ...agents[agentIdx], ...summary };
  else agents.push(summary);
  const reviewer = agents.find((a) => a.agent_type === 'reviewer');
  return {
    ...session,
    agents,
    review_status: reviewer?.status ?? session.review_status,
    reviewer_agent_id: reviewer?.id ?? session.reviewer_agent_id,
  };
}

export function activeAgentsRunningLabel(count) {
  if (count === 1) return '1 agent running';
  return `${count} agents running`;
}

export function isReviewInProgressForSession(session) {
  if (!session || session.archived_at) return false;
  const reviewer = reviewerFromSession(session);
  return reviewer != null && isAgentTurnActive(reviewer.status);
}

export function reviewerCompletedTransition(prevStatus, nextStatus) {
  return prevStatus !== undefined && prevStatus !== nextStatus && nextStatus === 'completed';
}
