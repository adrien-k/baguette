/**
 * Fields required by messages.create (matches composer / agent defaults).
 * Pass `agent` from the agents table when available; otherwise falls back to merged session fields.
 */
export function builderMessageCreateFields(session, { model, model_params, agent } = {}) {
  const source = agent ?? session;
  const resolvedModel = model ?? source?.model;
  const resolvedParams = model_params ?? source?.model_params;
  if (!resolvedModel) {
    throw new Error('model is required for messages.create');
  }
  const agentType = agent?.agent_type === 'reviewer' ? 'reviewer' : 'builder';
  const fields = {
    agent_type: agentType,
    agent_sdk: source?.agent_sdk || 'claude',
    model: resolvedModel,
  };
  if (agent?.id != null) fields.agent_id = agent.id;
  if (resolvedParams != null) fields.model_params = resolvedParams;
  if (source?.agent_config_id != null) fields.agent_config_id = source.agent_config_id;
  return fields;
}
