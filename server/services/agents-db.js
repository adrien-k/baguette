/**
 * DB helpers for `agents` rows (internal — Feathers service owns external API).
 */
import { BadRequest } from '@feathersjs/errors';

export async function getPrimaryBuilderAgent(db, sessionId) {
  return db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
}

export async function getReviewerAgent(db, sessionId) {
  return db('agents').where({ session_id: sessionId, agent_type: 'reviewer' }).first();
}

export async function getAgentById(db, agentId) {
  return db('agents').where({ id: agentId }).first();
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
  const [id] = await db('agents').insert({
    session_id: sessionId,
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

  const [id] = await db('agents').insert({
    session_id: sessionId,
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
