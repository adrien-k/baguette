import { BadRequest, Forbidden } from '@feathersjs/errors';
import { resolveTurnModel } from '../../../shared/turn-model.js';
import { agentSdkSupportsModelParams } from '../../../shared/agent-sdk-model-params.js';
import { loadOwnedAgentConfig } from '../agent-config-resolver.js';

function normalizeAgentType(value) {
  return value === 'reviewer' ? 'reviewer' : 'builder';
}

/** Row column value for an agent config id: integer, or null. */
function coerceAgentConfigId(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function agent_config_idForSession(session, agent_type) {
  const seeded =
    agent_type === 'reviewer'
      ? (session.review_agent_config_id ?? session.agent_config_id)
      : session.agent_config_id;
  return coerceAgentConfigId(seeded);
}

function agentSdkForSession(session, agentType) {
  if (agentType === 'reviewer') {
    return session.review_agent_sdk || session.agent_sdk || 'claude';
  }
  return session.agent_sdk || 'claude';
}

/**
 * Required identity columns for session_messages / queued_messages rows.
 * Callers must supply explicit turn model via `overrides` or session defaults.
 */
export function sessionMessageIdentity(session, agentType, overrides = {}) {
  if (!session) throw new BadRequest('Session not found');
  const agent_type = normalizeAgentType(overrides.agent_type ?? agentType);
  const { model, modelParams } = resolveTurnModel(overrides, session);
  const agent_sdk =
    overrides.agent_sdk != null && String(overrides.agent_sdk).trim() !== ''
      ? String(overrides.agent_sdk).trim()
      : agentSdkForSession(session, agent_type);
  if (!model) throw new BadRequest('model is required');
  const row = { agent_type, agent_sdk, model };
  if (modelParams != null && agentSdkSupportsModelParams(agent_sdk)) {
    row.model_params = modelParams;
  }
  // Turn snapshot: the row carries the agent config the turn runs with (explicit
  // override wins; otherwise seeded from the session/channel pair).
  row.agent_config_id =
    coerceAgentConfigId(overrides.agent_config_id) ??
    agent_config_idForSession(session, agent_type);
  return row;
}

function assertIdentityFields(data, { requireAgentType = true } = {}) {
  const missing = [];
  if (requireAgentType && !data.agent_type) missing.push('agent_type');
  if (!data.agent_sdk || String(data.agent_sdk).trim() === '') missing.push('agent_sdk');
  if (data.model == null || String(data.model).trim() === '') missing.push('model');
  if (missing.length) {
    throw new BadRequest(`Missing required message fields: ${missing.join(', ')}`);
  }
}

/** Validate agent_type, agent_sdk, and model on messages.create (no inference). */
export async function requireMessageIdentity(context) {
  const data = context.data;
  if (!data?.session_id) throw new BadRequest('session_id is required');

  if (context.params?.provider && normalizeAgentType(data.agent_type) === 'reviewer') {
    throw new Forbidden('Review messages cannot be created from the client');
  }

  assertIdentityFields(data);
  data.agent_type = normalizeAgentType(data.agent_type);

  // A turn never runs on another user's config: validate explicitly provided ids.
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
  assertIdentityFields(data);
  data.agent_type = normalizeAgentType(data.agent_type);
  return context;
}
