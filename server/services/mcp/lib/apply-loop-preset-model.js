import { stringifyModelParamsForStorage } from '../../../../shared/agent-session-defaults.js';
import { resolveMcpBuilderModel } from '../../agent-mcp-model-resolver.js';

export async function applyLoopPresetModel(app, userId, data) {
  const presetModelId = data.preset_model_id ?? null;
  delete data.preset_model_id;

  let repoId = null;
  if (data.repo_full_name) {
    const repo = await app.get('db')('repos').where({ full_name: data.repo_full_name }).first();
    repoId = repo?.id ?? null;
  }

  const resolved = await resolveMcpBuilderModel(app.get('db'), userId, {
    preset_model_id: presetModelId,
    repo_id: repoId,
  });

  data.agent_config_id = resolved.agent_config_id;
  data.agent_sdk = resolved.agent_sdk;
  data.model = resolved.model;
  data.model_params = stringifyModelParamsForStorage(resolved.model_params);
}
