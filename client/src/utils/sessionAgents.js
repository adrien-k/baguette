import {
  agentAccessibleTitle,
  agentDisplayTitle,
  agentNameMatchesType,
  agentTypeLabel,
} from '../../../shared/agent-display-title.js';

/** @typedef {{ id: number; ref?: number; name?: string; agent_type?: string; status?: string; is_primary?: number | boolean }} SessionAgentSummary */

export { agentAccessibleTitle, agentNameMatchesType, agentDisplayTitle };

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

/**
 * The session-list caret must not hide other agents while one of them is the
 * open chat — collapsing would drop the selected row out of the tree.
 * @param {SessionAgentSummary[]} agents
 * @param {number | string | null | undefined} currentAgentId
 */
export function isAgentTreeCollapseLocked(agents, currentAgentId) {
  if (currentAgentId == null || currentAgentId === '') return false;
  const selected = (agents ?? []).find((agent) => Number(agent.id) === Number(currentAgentId));
  return Boolean(selected && !isPrimaryAgent(selected));
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

/**
 * Last-activity timestamp in ms (`updated_at` — bumped on every agent patch).
 * Returns 0 when unknown so timed agents sort ahead; SQLite CURRENT_TIMESTAMP
 * values ("YYYY-MM-DD HH:MM:SS", UTC) are normalized to ISO before parsing.
 */
function agentLastActivityMs(agent) {
  const raw = agent?.updated_at;
  if (!raw) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw}Z` : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Most recent activity first. Stable sort: ties and agents without a
 * timestamp keep their input order (feed it ref-ascending for a stable,
 * creation-ordered fallback).
 */
export function sortSessionAgentsByLastActivityDesc(agents) {
  return [...agents].sort((a, b) => agentLastActivityMs(b) - agentLastActivityMs(a));
}

/** MCP StartSubagent agents (`agent_type` subagent). */
export function isSubagentBuilder(agent) {
  return agent?.agent_type === 'subagent';
}

/**
 * Extra builder started from the composer (not the session primary, not an MCP subagent).
 * These are the only agents whose title can be renamed in the session list.
 */
export function isSecondaryBuilder(agent) {
  return agent?.agent_type === 'builder' && !isPrimaryAgent(agent);
}

/** Primary or secondary builder — shares the session worktree (not subagent/reviewer). */
function isComposerBuilderAgent(agent) {
  return agent?.agent_type === 'builder';
}

/** Git sync / merge / push footer on builder chats only (primary and secondary). */
export function showSessionChatFooterExtrasForAgent(activeAgent) {
  if (!activeAgent) return true;
  return isComposerBuilderAgent(activeAgent);
}

/** Session reviewer row (`agent_type` reviewer) — managed from the review UI, not editable. */
export function isReviewerAgent(agent) {
  return agent?.agent_type === 'reviewer';
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
  // Defined fields only, so partial patches do not clobber embedded tree fields.
  const summary = {};
  for (const key of [
    'id',
    'ref',
    'name',
    'agent_type',
    'status',
    'is_primary',
    // Sidebar agent-list fields (provider icon, model label).
    'agent_config_id',
    'agent_sdk',
    'model',
    'parent_agent_id',
    'updated_at',
  ]) {
    if (agent[key] !== undefined) summary[key] = agent[key];
  }
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

/** Label for agents still running besides the currently selected one. */
export function otherAgentsRunningLabel(count) {
  if (count === 1) return '1 other agent running';
  return `${count} other agents running`;
}

/**
 * Split session agents for the composer switcher: running turns first, then idle.
 * @param {SessionAgentSummary[]} agents
 * @returns {{ running: SessionAgentSummary[]; other: SessionAgentSummary[] }}
 */
export function partitionSessionAgentsByRunning(agents) {
  const running = [];
  const other = [];
  for (const agent of agents) {
    if (isAgentTurnActive(agent.status)) running.push(agent);
    else other.push(agent);
  }
  return { running, other };
}

/**
 * When both running and idle agents exist, group menu rows under section headings.
 * @template T
 * @param {SessionAgentSummary[]} agents
 * @param {(agent: SessionAgentSummary) => T} mapOption
 * @returns {{ heading: string; options: T[] }[] | null} `null` when a single group suffices.
 */
export function agentSwitcherDropdownSections(agents, mapOption) {
  const { running, other } = partitionSessionAgentsByRunning(agents);
  if (!running.length || !other.length) return null;
  return [
    { heading: 'Running', options: running.map(mapOption) },
    { heading: 'Idle', options: other.map(mapOption) },
  ];
}

export function isReviewInProgressForSession(session) {
  if (!session || session.archived_at) return false;
  const reviewer = reviewerFromSession(session);
  return reviewer != null && isAgentTurnActive(reviewer.status);
}

export function reviewerCompletedTransition(prevStatus, nextStatus) {
  return prevStatus !== undefined && prevStatus !== nextStatus && nextStatus === 'completed';
}
