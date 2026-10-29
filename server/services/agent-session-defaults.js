import { BadRequest } from 'feathers/errors';
import {
  orderedParamIdsFromVariants,
  paramValueOptionsFromVariants,
} from '../../shared/model-variants.js';
import { normalizeClaudeCodePickerModelId } from '../../shared/claude-code-model-list.js';
import { loadModelsForSdk } from './baguette-models-for-user.js';
import { userRowForAgentSdk } from './agent-context.js';
import { parseAgentSessionDefaultsJson } from '../../shared/agent-session-defaults.js';
import { agentSdkSupportsModelParams } from '../../shared/agent-sdk-model-params.js';

function validateModelParamsForVariants(variants, modelParams) {
  if (!modelParams?.length) return;
  const orderedIds = orderedParamIdsFromVariants(variants);
  for (const { id, value } of modelParams) {
    if (!orderedIds.includes(id)) {
      throw new BadRequest(`Unknown model param "${id}" for this model`);
    }
    const options = paramValueOptionsFromVariants(variants, id, modelParams);
    if (!options.includes(value)) {
      throw new BadRequest(`Invalid value "${value}" for model param "${id}"`);
    }
  }
}

export async function validateAgentSessionDefaults(
  user,
  input,
  { app, agentConfigId = null } = {}
) {
  const defaults = parseAgentSessionDefaultsJson(input);

  if (!defaults.agent_sdk && !defaults.model && !defaults.model_params) {
    return defaults;
  }

  if (defaults.model && !defaults.agent_sdk) {
    throw new BadRequest('agent_sdk is required when model is set');
  }

  if (defaults.model_params && !agentSdkSupportsModelParams(defaults.agent_sdk)) {
    throw new BadRequest('model_params is only valid for cursor, claude, or pi agent_sdk');
  }

  if (defaults.model_params && !defaults.model) {
    throw new BadRequest('model is required when model_params is set');
  }

  const userForSdk = userRowForAgentSdk(user) ?? user;

  if (defaults.agent_sdk) {
    if (!app.service('agent-configs').getSdkMeta(defaults.agent_sdk)) {
      throw new BadRequest(`Unknown agent SDK "${defaults.agent_sdk}"`);
    }
  }

  if (defaults.model) {
    const sdk = defaults.agent_sdk;
    const models = await loadModelsForSdk(userForSdk, sdk, null, app, { agentConfigId });
    const pickerIds = new Set(models.map((m) => m.id));
    const modelId =
      sdk === 'claude'
        ? normalizeClaudeCodePickerModelId(defaults.model, pickerIds)
        : defaults.model;
    if (!models.some((m) => m.id === modelId)) {
      throw new BadRequest(`Unknown ${sdk} model "${defaults.model}". Refresh models in Settings.`);
    }
    if (defaults.model_params?.length) {
      const modelObj = models.find((m) => m.id === modelId);
      validateModelParamsForVariants(modelObj?.variants ?? [], defaults.model_params);
    }
    if (modelId !== defaults.model) {
      return { ...defaults, model: modelId };
    }
  }

  return defaults;
}
