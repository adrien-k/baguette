/**
 * Fields required by messages.create (matches composer / agent defaults).
 * `agent` must be an agents row with `id`. `session` is only used when `model` / `model_params` /
 * `agent_sdk` / `agent_config_id` are not passed explicitly on the options object.
 */
export function builderMessageCreateFields(session, { model, model_params, agent } = {}) {
  const source = agent ?? session;
  const resolvedModel = model ?? source?.model;
  const resolvedParams = model_params ?? source?.model_params;
  if (!resolvedModel) {
    throw new Error('model is required for messages.create');
  }
  if (agent?.id == null) {
    throw new Error('agent.id is required for messages.create');
  }
  const fields = {
    agent_id: agent.id,
    agent_sdk: source?.agent_sdk || 'claude',
    model: resolvedModel,
  };
  if (resolvedParams != null) fields.model_params = resolvedParams;
  if (source?.agent_config_id != null) fields.agent_config_id = source.agent_config_id;
  return fields;
}
