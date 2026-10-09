import { BadRequest, Forbidden } from '@feathersjs/errors';
import { resolveTurnModel } from '../../../shared/turn-model.js';

function normalizeAgentType(value) {
  return value === 'reviewer' ? 'reviewer' : 'builder';
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
  if (modelParams != null && agent_sdk === 'cursor') {
    row.model_params = modelParams;
  }
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
