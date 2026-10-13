import { BadRequest } from '@feathersjs/errors';
import { resolveTurnModel } from '../../../shared/turn-model.js';
import { agentSdkSupportsModelParams } from '../../../shared/agent-sdk-model-params.js';
import { loadOwnedAgentConfig } from '../agent-config-resolver.js';
import { getPrimaryBuilderAgent, getReviewerAgent } from '../agents-db.js';

function normalizeAgentType(value) {
  return value === 'reviewer' ? 'reviewer' : 'builder';
}

/** Row column value for an agent config id: integer, or null. */
function coerceAgentConfigId(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function agentSdkForAgent(agent) {
  return agent.agent_sdk || 'claude';
}

async function defaultAgentIdForMessage(db, sessionId, agentType) {
  const agent_type = normalizeAgentType(agentType);
  if (agent_type === 'reviewer') {
    const reviewer = await getReviewerAgent(db, sessionId);
    return reviewer?.id ?? null;
  }
  const primary = await getPrimaryBuilderAgent(db, sessionId);
  return primary?.id ?? null;
}

/**
 * Required identity columns for session_messages / queued_messages rows.
 * `agent` is the agents table row defaults apply from.
 */
function resolveMessageAgentId(agent, agentType) {
  const agent_type = normalizeAgentType(agentType ?? agent.agent_type);
  if (agent.builder_agent_id != null || agent.reviewer_agent_id != null) {
    const id = agent_type === 'reviewer' ? agent.reviewer_agent_id : agent.builder_agent_id;
    if (id != null) return id;
  }
  if (agent.agent_type && agent.session_id != null) {
    return agent.id;
  }
  throw new BadRequest('Agent not found');
}

export function sessionMessageIdentity(agent, agentType, overrides = {}) {
  if (!agent) throw new BadRequest('Agent not found');
  const agent_type = normalizeAgentType(overrides.agent_type ?? agentType ?? agent.agent_type);
  const { model, modelParams } = resolveTurnModel(overrides, agent);
  const agent_sdk =
    overrides.agent_sdk != null && String(overrides.agent_sdk).trim() !== ''
      ? String(overrides.agent_sdk).trim()
      : agentSdkForAgent(agent);
  if (!model) throw new BadRequest('model is required');
  const agent_id = resolveMessageAgentId(agent, agent_type);
  if (agent_id == null) throw new BadRequest('Agent not found');
  const row = { agent_type, agent_sdk, model, agent_id };
  if (modelParams != null && agentSdkSupportsModelParams(agent_sdk)) {
    row.model_params = modelParams;
  }
  row.agent_config_id =
    coerceAgentConfigId(overrides.agent_config_id) ?? coerceAgentConfigId(agent.agent_config_id);
  return row;
}

function assertIdentityFields(data, { requireAgentType = true } = {}) {
  const missing = [];
  if (requireAgentType && !data.agent_type) missing.push('agent_type');
  if (!data.agent_sdk || String(data.agent_sdk).trim() === '') missing.push('agent_sdk');
  if (data.model == null || String(data.model).trim() === '') missing.push('model');
  if (data.agent_id == null) missing.push('agent_id');
  if (missing.length) {
    throw new BadRequest(`Missing required message fields: ${missing.join(', ')}`);
  }
}

/** Validate agent_type, agent_sdk, and model on messages.create (no inference). */
export async function requireMessageIdentity(context) {
  const data = context.data;
  if (!data?.session_id) throw new BadRequest('session_id is required');

  const db = context.app.get('db');
  if (data.agent_type) {
    data.agent_type = normalizeAgentType(data.agent_type);
  }
  if (data.agent_id == null) {
    data.agent_id = await defaultAgentIdForMessage(db, data.session_id, data.agent_type);
  }

  assertIdentityFields(data);
  data.agent_type = normalizeAgentType(data.agent_type);

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

/** Validate agent_type, agent_sdk, and model on queued-messages.create. */
export async function requireQueuedMessageIdentity(context) {
  if (context.method !== 'create') return context;
  const data = context.data;
  if (!data?.session_id) throw new BadRequest('session_id is required');
  const db = context.app.get('db');
  if (data.agent_type) {
    data.agent_type = normalizeAgentType(data.agent_type);
  }
  if (data.agent_id == null) {
    data.agent_id = await defaultAgentIdForMessage(db, data.session_id, data.agent_type);
  }
  assertIdentityFields(data);
  data.agent_type = normalizeAgentType(data.agent_type);
  return context;
}
