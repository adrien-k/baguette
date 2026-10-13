import { isBaguetteUserMessage, isHumanUserMessage } from './turn-model.js';
import { normalizeUserPayloadForStorage } from './normalize-user-payload.js';

function parsePayload(messageJson) {
  try {
    return JSON.parse(messageJson || '{}');
  } catch {
    return {};
  }
}

/**
 * Atomically increment agents.current_turn_id and return the new value.
 * @param {import('knex').Knex} db
 * @param {number} agentId
 * @returns {Promise<number|null>}
 */
async function allocateNextTurnId(db, agentId) {
  const rows = await db('agents')
    .where({ id: agentId })
    .increment('current_turn_id', 1)
    .returning('current_turn_id');
  if (!rows?.length) return null;
  const row = rows[0];
  return row?.current_turn_id ?? row ?? null;
}

/**
 * @param {object} agent
 * @param {object} data - messages.create data
 * @param {{ force?: boolean }} opts
 */
export function resolveTurnIdForUserCreate(agent, data, opts) {
  const parsed = parsePayload(data.message_json);
  const normalized = normalizeUserPayloadForStorage(parsed);
  const isUserTurn =
    data.type === 'user' && (isHumanUserMessage(normalized) || isBaguetteUserMessage(normalized));
  if (!isUserTurn) return { turnId: data.turn_id ?? null, increment: false };

  const running = agent.status === 'running';
  const activeTurn = agent.active_turn_id;
  const isReviewer = agent.agent_type === 'reviewer';

  const steering = Boolean(opts.force) && isHumanUserMessage(normalized);

  if (running && steering && activeTurn != null) {
    return { turnId: activeTurn, increment: false };
  }

  if (running && !steering && isReviewer && isHumanUserMessage(normalized) && activeTurn != null) {
    return { turnId: activeTurn, increment: false };
  }

  if (running && !steering && isBaguetteUserMessage(normalized) && activeTurn != null) {
    return { turnId: activeTurn, increment: false };
  }

  return { turnId: null, increment: true };
}

/**
 * Feathers before.create hook helper.
 */
export async function assignTurnOnUserMessageCreate(context) {
  const data = context.data;
  if (!data?.session_id || data.type !== 'user') return context;

  const db = context.app.get('db');
  const session = await db('sessions').where({ id: data.session_id }).first();
  if (!session) return context;

  let agent;
  if (data.agent_id != null) {
    agent = await db('agents').where({ id: data.agent_id, session_id: data.session_id }).first();
  }
  if (!agent) {
    agent = await db('agents').where({ session_id: data.session_id, is_primary: 1 }).first();
    if (agent) data.agent_id = agent.id;
  }
  if (!agent) return context;

  const { turnId, increment } = resolveTurnIdForUserCreate(agent, data, {
    force: context.params._force,
  });

  if (increment) {
    const allocated = await allocateNextTurnId(db, agent.id);
    if (allocated != null) data.turn_id = allocated;
  } else if (turnId != null) {
    data.turn_id = turnId;
  }

  if (data.agent_config_id == null) {
    data.agent_config_id = agent.agent_config_id ?? null;
  }
  if (!data.agent_type) {
    data.agent_type = agent.agent_type === 'reviewer' ? 'reviewer' : 'builder';
  }
  if (!data.agent_sdk) {
    data.agent_sdk = agent.agent_sdk ?? 'claude';
  }

  const parsed = parsePayload(data.message_json);
  data.message_json = JSON.stringify(normalizeUserPayloadForStorage(parsed));

  return context;
}
