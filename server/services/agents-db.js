/**
 * DB helpers for `agents` rows (internal — Feathers service owns external API).
 */
import { BadRequest } from 'feathers/errors';
import { nextSessionItemRef } from './session-item-ref.js';

export async function getPrimaryBuilderAgent(db, sessionId) {
  return db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
}

export async function getReviewerAgent(db, sessionId) {
  return db('agents').where({ session_id: sessionId, agent_type: 'reviewer' }).first();
}

export async function getAgentById(db, agentId) {
  return db('agents').where({ id: agentId }).first();
}

export async function getAgentBySessionRef(db, sessionId, ref) {
  return db('agents').where({ session_id: sessionId, ref }).first();
}

/**
 * Resolve the agents row for a message / queued row via `agent_id` (required).
 * @param {import('knex').Knex} db
 * @param {{ session_id: number; agent_id?: number | null }} row
 */
export async function resolveAgentRowForMessage(db, row) {
  if (row.agent_id == null) {
    throw new BadRequest('agent_id is required');
  }
  const byId = await getAgentById(db, row.agent_id);
  if (!byId || byId.session_id !== row.session_id) {
    throw new BadRequest('Agent not found');
  }
  return byId;
}

export async function listAgentsForSession(db, sessionId) {
  return db('agents').where({ session_id: sessionId }).orderBy('id', 'asc');
}

/**
 * Summed usage cost per agent id for a session (agents without usage are absent).
 * @returns {Promise<Map<number, number>>} agent_id → summed `cost_usd`
 */
export async function listAgentCostsForSession(db, sessionId) {
  const rows = await db('usage')
    .where({ session_id: sessionId })
    .whereNotNull('agent_id')
    .select('agent_id')
    .sum('cost_usd as cost_usd')
    .groupBy('agent_id');
  return new Map(rows.map((r) => [r.agent_id, parseFloat(r.cost_usd ?? 0)]));
}

/**
 * @param {import('knex').Knex} db
 * @param {number} sessionId
 * @param {{ status?: string, active_only?: boolean }} [filter]
 */
export async function listSubagentsForSession(db, sessionId, { status, active_only } = {}) {
  let q = db('agents')
    .where({ session_id: sessionId, agent_type: 'subagent' })
    .orderBy('id', 'asc');
  if (active_only) {
    q = q.whereIn('status', ['running', 'approval']);
  } else if (status != null && String(status).trim() !== '') {
    q = q.where({ status: String(status).trim() });
  }
  return q;
}

/** Running or awaiting-approval subagents spawned by `parentAgentId` via StartSubagent. */
export async function listActiveChildAgents(db, parentAgentId) {
  return db('agents')
    .where({ parent_agent_id: parentAgentId })
    .whereIn('status', ['running', 'approval'])
    .orderBy('id', 'asc');
}

/** In-memory SDK session key for a builder chat turn (primary uses session id). */
export function builderChatActiveKey(agent) {
  if (!agent?.id) throw new BadRequest('Agent not found');
  if (agent.is_primary) return agent.session_id;
  return agent.id;
}

/**
 * @param {import('knex').Knex} db
 * @param {number} sessionId
 * @param {{
 *   agent_config_id: number | null,
 *   agent_sdk?: string | null,
 *   model?: string | null,
 *   model_params?: string | null,
 *   status?: string,
 * }} fields
 */
export async function insertPrimaryBuilderAgent(db, sessionId, fields) {
  const ref = await nextSessionItemRef(db, 'agents', sessionId);
  const [id] = await db('agents').insert({
    session_id: sessionId,
    ref,
    name: 'Builder',
    agent_type: 'builder',
    is_primary: 1,
    status: fields.status ?? 'stopped',
    agent_config_id: fields.agent_config_id ?? null,
    agent_sdk: fields.agent_sdk ?? null,
    model: fields.model ?? null,
    model_params: fields.model_params ?? null,
    current_turn_id: 0,
  });
  return id;
}

/**
 * Insert the session's single reviewer row, or return existing id.
 */
export async function ensureReviewerAgentRow(db, sessionId, fields) {
  const existing = await getReviewerAgent(db, sessionId);
  if (existing) return existing;

  const ref = await nextSessionItemRef(db, 'agents', sessionId);
  const [id] = await db('agents').insert({
    session_id: sessionId,
    ref,
    name: 'Reviewer',
    agent_type: 'reviewer',
    is_primary: 0,
    status: fields.status ?? 'stopped',
    agent_config_id: fields.agent_config_id ?? null,
    agent_sdk: fields.agent_sdk ?? null,
    model: fields.model ?? null,
    model_params: fields.model_params ?? null,
    initial_prompt: fields.initial_prompt ?? null,
    current_turn_id: 0,
  });
  return await getAgentById(db, id);
}

const AGENT_OBSERVER_NOTIFY_ON = ['turn_end', 'once'];

/** Bail out of the wake-up-cycle BFS after this many distinct agents (fail-safe reject). */
const AGENT_OBSERVER_CYCLE_CHECK_LIMIT = 1000;

/**
 * True when adding the edge observedAgentId → observerAgentId would close a cycle in
 * the wake-up graph (a path from the observer back to the observed already exists).
 * Every wake-up starts a real turn for the observer, so a cycle would ping-pong
 * turns forever with no user interaction.
 */
async function wouldCreateObserverCycle(db, observedAgentId, observerAgentId) {
  const visited = new Set();
  let frontier = [observerAgentId];
  let visitedCount = 0;
  while (frontier.length) {
    const next = [];
    for (const current of frontier) {
      if (visited.has(current)) continue;
      if (current === observedAgentId) return true;
      visited.add(current);
      visitedCount += 1;
      if (visitedCount > AGENT_OBSERVER_CYCLE_CHECK_LIMIT) return true;
      const observers = await db('agent_observers')
        .where({ agent_id: current })
        .pluck('observer_agent_id');
      next.push(...observers);
    }
    frontier = next;
  }
  return false;
}

/**
 * Insert a turn-end observer row (observed agent + watcher agent), or return the
 * existing row id for the pair. `notifyOn` must be 'turn_end' or 'once'.
 *
 * Guards: self-watches (an agent observing its own turns would re-trigger itself on
 * every turn end) and watches that would close a wake-up cycle (mutual or transitive)
 * are rejected — every wake-up starts a real turn for the observer, so either would
 * loop forever with no user interaction.
 */
export async function insertAgentObserver(db, { agentId, observerAgentId, notifyOn = 'turn_end' }) {
  if (!agentId || !observerAgentId)
    throw new BadRequest('agentId and observerAgentId are required');
  if (!AGENT_OBSERVER_NOTIFY_ON.includes(notifyOn)) {
    throw new BadRequest(`notify_on must be one of: ${AGENT_OBSERVER_NOTIFY_ON.join(', ')}`);
  }
  const existing = await db('agent_observers')
    .where({ agent_id: agentId, observer_agent_id: observerAgentId })
    .first();
  if (existing) return existing.id;
  if (agentId === observerAgentId) {
    throw new BadRequest('An agent cannot observe itself — turn-end wake-ups would loop forever.');
  }
  if (await wouldCreateObserverCycle(db, agentId, observerAgentId)) {
    throw new BadRequest(
      'This watch would create a wake-up loop — the observer already transitively observes this agent.'
    );
  }
  const [id] = await db('agent_observers').insert({
    agent_id: agentId,
    observer_agent_id: observerAgentId,
    notify_on: notifyOn,
  });
  return id;
}

/** Agent ids from `agentIds` that currently have at least one observer row. */
export async function notifyParentAgentIds(db, agentIds) {
  const ids = (agentIds ?? []).filter((id) => id != null);
  if (!ids.length) return new Set();
  const rows = await db('agent_observers').whereIn('agent_id', ids).select('agent_id');
  return new Set(rows.map((row) => row.agent_id));
}
