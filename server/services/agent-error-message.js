/**
 * Last agent-turn failure copy lives on the agent's latest `turn_result` /
 * legacy `result` row. Status APIs hydrate `error_message` from that row.
 */

import { sessionMessageIdentity } from './feathers/message-create-fields.js';

export function normalizeAgentErrorMessage(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

/** `error_message` for MCP/agent-status payloads — only when the agent is failed. */
export function agentFailureError(agent) {
  if (!agent || agent.status !== 'failed') return null;
  return normalizeAgentErrorMessage(agent.error_message);
}

function errorMessageFromTurnResultRow(row) {
  if (!row?.message_json) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.message_json);
  } catch {
    return null;
  }
  const type = parsed?.type ?? row.type;
  if (type === 'turn_result') {
    if (parsed.status !== 'error') return null;
    return normalizeAgentErrorMessage(parsed.error_message);
  }
  if (type === 'result' || row.type === 'result') {
    if (parsed.subtype === 'success' && !parsed.is_error) return null;
    return normalizeAgentErrorMessage(parsed.error_message ?? parsed.result ?? 'Turn failed');
  }
  return null;
}

/**
 * Latest persisted turn-failure text for an agent (turn_result / legacy result).
 * Status rows are not used — they also carry non-error progress copy.
 * Pass `turnId` to read only that turn (avoids reusing a prior failure on retry).
 *
 * @param {import('knex').Knex} db
 * @param {{ id?: number, session_id?: number } | null | undefined} agent
 * @param {{ turnId?: number | null }} [opts]
 * @returns {Promise<string | null>}
 */
export async function lastPersistedAgentError(db, agent, { turnId } = {}) {
  if (!agent?.id || agent.session_id == null) return null;
  let query = db('session_messages')
    .where({ session_id: agent.session_id, agent_id: agent.id })
    .whereIn('type', ['turn_result', 'result']);
  if (turnId != null) query = query.where({ turn_id: turnId });
  const row = await query.orderBy('id', 'desc').first();
  return errorMessageFromTurnResultRow(row);
}

/**
 * Latest error turn_result per agent id (one query). Used to hydrate status payloads.
 *
 * @param {import('knex').Knex} db
 * @param {{ id?: number }[]} agents
 * @returns {Promise<Map<number, string | null>>}
 */
async function lastPersistedAgentErrorsById(db, agents) {
  const ids = [...new Set(agents.map((agent) => agent?.id).filter((id) => id != null))];
  const byId = new Map();
  if (!ids.length) return byId;
  const latest = await db('session_messages')
    .whereIn('agent_id', ids)
    .whereIn('type', ['turn_result', 'result'])
    .groupBy('agent_id')
    .max('id as max_id')
    .select('agent_id');
  const rowIds = latest.map((row) => row.max_id).filter((id) => id != null);
  if (!rowIds.length) return byId;
  const rows = await db('session_messages').whereIn('id', rowIds);
  for (const row of rows) {
    byId.set(row.agent_id, errorMessageFromTurnResultRow(row));
  }
  return byId;
}

/**
 * Attach `error_message` on failed agents from their latest turn_result.
 * Completed/stopped/running agents get `error_message: null`.
 *
 * @param {import('knex').Knex} db
 * @param {object | object[] | null | undefined} agents
 */
export async function hydrateAgentFailureErrors(db, agents) {
  const list = (Array.isArray(agents) ? agents : [agents]).filter(Boolean);
  for (const agent of list) {
    if (agent.status !== 'failed') agent.error_message = null;
  }
  const failed = list.filter((agent) => agent.status === 'failed');
  if (!failed.length) return agents;
  const byId = await lastPersistedAgentErrorsById(db, failed);
  for (const agent of failed) {
    agent.error_message = byId.get(agent.id) ?? null;
  }
  return agents;
}

/**
 * Resolve the text stored on a failed agent: explicit argument first, then the
 * latest turn_result row (already persisted before some SDK terminal patches).
 *
 * @param {import('knex').Knex} db
 * @param {object} agent
 * @param {unknown} errorMessage
 */
export async function resolveFailedAgentError(db, agent, errorMessage) {
  const explicit = normalizeAgentErrorMessage(errorMessage);
  if (explicit) return explicit;
  return lastPersistedAgentError(db, agent);
}

/**
 * Guarantee a `turn_result` error row for a failed turn. No-ops when this turn
 * already has one. Returns the error text (same-turn row wins over the explicit
 * argument). When `active_turn_id` is set, a prior turn's error is not reused.
 *
 * @param {import('feathers').Application} app
 * @param {object} agent
 * @param {number} userId
 * @param {unknown} errorMessage
 * @returns {Promise<string | null>}
 */
export async function ensureFailedTurnResult(app, agent, userId, errorMessage) {
  if (!agent?.id || agent.session_id == null) {
    return normalizeAgentErrorMessage(errorMessage);
  }
  const db = app.get('db');
  const turnId = agent.active_turn_id ?? null;
  const existing = await lastPersistedAgentError(db, agent, turnId != null ? { turnId } : {});
  if (existing) return existing;
  const text = normalizeAgentErrorMessage(errorMessage);
  if (!text) return null;
  try {
    await app.service('messages').create(
      {
        session_id: agent.session_id,
        ...(agent.active_turn_id != null ? { turn_id: agent.active_turn_id } : {}),
        type: 'turn_result',
        message_json: JSON.stringify({
          type: 'turn_result',
          status: 'error',
          error_message: text,
          total_cost_usd: null,
        }),
        ...sessionMessageIdentity(agent),
      },
      { provider: undefined, user: userId != null ? { id: userId } : undefined }
    );
  } catch {
    // Status patch / notify still proceed with the in-memory text.
  }
  return text;
}
