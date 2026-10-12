/** Fields required by messages.create for builder chat (matches composer / session defaults). */
export function builderMessageCreateFields(session, { model, model_params } = {}) {
  const resolvedModel = model ?? session?.model;
  const resolvedParams = model_params ?? session?.model_params;
  if (!resolvedModel) {
    throw new Error('model is required for messages.create');
  }
  const fields = {
    agent_type: 'builder',
    agent_sdk: session?.agent_sdk || 'claude',
    model: resolvedModel,
  };
  if (resolvedParams != null) fields.model_params = resolvedParams;
  return fields;
}

/**
 * Whole review turn snapshot for session-review.start / send / reviewNewCommits:
 * the agent config and the model pair ride on the post itself (explicit, even when
 * null), so the turn is what the reviewer panel currently shows — not a session
 * fallback the post forgot to name.
 */
export function reviewComposerAgentFields({
  agent_sdk,
  model,
  model_params,
  review_agent_config_id,
} = {}) {
  const resolvedModel = model != null && String(model).trim() !== '' ? String(model).trim() : null;
  if (!resolvedModel) {
    throw new Error('model is required to start or continue a review');
  }
  return {
    agent_sdk: agent_sdk || 'claude',
    model: resolvedModel,
    model_params: model_params ?? null,
    review_agent_config_id: review_agent_config_id ?? null,
  };
}
