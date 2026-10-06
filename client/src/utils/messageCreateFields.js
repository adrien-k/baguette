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

/** agent_sdk + turn model snapshot for session-review.start / send / reviewNewCommits. */
export function reviewComposerAgentFields({ agent_sdk, model, model_params } = {}) {
  const fields = { agent_sdk: agent_sdk || 'claude' };
  const resolvedModel = model != null && String(model).trim() !== '' ? String(model).trim() : null;
  if (!resolvedModel) {
    throw new Error('model is required to start or continue a review');
  }
  fields.model = resolvedModel;
  if (model_params != null) fields.model_params = model_params;
  return fields;
}
