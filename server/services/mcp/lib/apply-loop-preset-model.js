import { stringifyModelParamsForStorage } from '../../../../shared/agent-session-defaults.js';
import { resolveMcpBuilderModel } from '../../agent-mcp-model-resolver.js';

export async function applyLoopPresetModel(app, userId, data) {
  const choice = {
    preset_model_id: data.preset_model_id ?? null,
    agent_config_id: data.agent_config_id ?? null,
    model: data.model ?? null,
    model_params: data.model_params ?? null,
  };
  delete data.preset_model_id;
  delete data.agent_config_id;
  delete data.model;
  delete data.model_params;

  let repoId = null;
  if (data.repo_full_name) {
    const repo = await app.get('db')('repos').where({ full_name: data.repo_full_name }).first();
    repoId = repo?.id ?? null;
  }

  const resolved = await resolveMcpBuilderModel(app.get('db'), userId, {
    ...choice,
    repo_id: repoId,
    app,
  });

  data.agent_config_id = resolved.agent_config_id;
  data.agent_sdk = resolved.agent_sdk;
  data.model = resolved.model;
  data.model_params = stringifyModelParamsForStorage(resolved.model_params);
}
