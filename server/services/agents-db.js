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
