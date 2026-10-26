import { BadRequest } from 'feathers/errors';
import { resolveTurnModel } from '../../../shared/turn-model.js';
import { agentSdkSupportsModelParams } from '../../../shared/agent-sdk-model-params.js';
import { loadOwnedAgentConfig } from '../agent-config-resolver.js';
import { getPrimaryBuilderAgent } from '../agents-db.js';

/** Row column value for an agent config id: integer, or null. */
function coerceAgentConfigId(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function agentSdkForAgent(agent) {
  return agent.agent_sdk || 'claude';
}

/** Standard user turn payload stored in `message_json` (composer / plan buttons). */
export function buildUserTurnMessageJson(content) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: String(content) },
  });
}

/** AskUserQuestions reply payload (inline answers UI). */
export function buildAskUserAnswerMessageJson(content, answers = []) {
  return JSON.stringify({
    type: 'user',
    subtype: 'ask_user_answer',
    content: String(content),
    answers,
  });
}

/**
 * Resolve `agent_id` for a session message create; defaults to the primary builder.
 * @param {import('knex').Knex} db
 * @param {number} sessionId
 * @param {number | null | undefined} agentId
 */
async function resolveMessageAgentIdForSession(db, sessionId, agentId) {
  if (agentId != null) {
    const agent = await db('agents').where({ id: agentId, session_id: sessionId }).first();
    if (!agent) throw new BadRequest('Agent not found');
    return agent.id;
  }
  const primary = await getPrimaryBuilderAgent(db, sessionId);
  if (!primary) throw new BadRequest('Agent not found');
  return primary.id;
}

/**
 * Required identity columns for session_messages / queued_messages rows.
 * `agent` must be an `agents` table row.
 */
export function sessionMessageIdentity(agent, overrides = {}) {
  if (!agent?.id) throw new BadRequest('Agent not found');
  const { model, modelParams } = resolveTurnModel(overrides, agent);
  const agent_sdk =
    overrides.agent_sdk != null && String(overrides.agent_sdk).trim() !== ''
      ? String(overrides.agent_sdk).trim()
      : agentSdkForAgent(agent);
  if (!model) throw new BadRequest('model is required');
  const row = { agent_id: agent.id, agent_sdk, model };
  if (modelParams != null && agentSdkSupportsModelParams(agent_sdk)) {
    row.model_params = modelParams;
  }
  row.agent_config_id =
    coerceAgentConfigId(overrides.agent_config_id) ?? coerceAgentConfigId(agent.agent_config_id);
  return row;
}

function assertIdentityFields(data) {
  const missing = [];
  if (!data.agent_sdk || String(data.agent_sdk).trim() === '') missing.push('agent_sdk');
  if (data.model == null || String(data.model).trim() === '') missing.push('model');
  if (data.agent_id == null) missing.push('agent_id');
  if (missing.length) {
    throw new BadRequest(`Missing required message fields: ${missing.join(', ')}`);
  }
}

/** Validate agent_sdk, model, and agent_id on messages.create. */
export async function requireMessageIdentity(context) {
  const data = context.data;
  if (!data?.session_id) throw new BadRequest('session_id is required');

  const db = context.app.get('db');
  data.agent_id = await resolveMessageAgentIdForSession(db, data.session_id, data.agent_id);
  delete data.agent_type;

  assertIdentityFields(data);

  if (data.agent_config_id != null && data.agent_config_id !== '') {
    const configId = coerceAgentConfigId(data.agent_config_id);
    if (configId == null) {
      data.agent_config_id = null;
    } else {
      await loadOwnedAgentConfig(context.app.get('db'), configId, context.params.user?.id);
      data.agent_config_id = configId;
    }
  }
  return context;
}

/** Validate agent_sdk, model, and agent_id on queued-messages.create. */
export async function requireQueuedMessageIdentity(context) {
  if (context.method !== 'create') return context;
  const data = context.data;
  if (!data?.session_id) throw new BadRequest('session_id is required');
  const db = context.app.get('db');
  data.agent_id = await resolveMessageAgentIdForSession(db, data.session_id, data.agent_id);
  delete data.agent_type;
  assertIdentityFields(data);
  return context;
}
