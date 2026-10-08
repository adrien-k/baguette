import { BadRequest } from '@feathersjs/errors';
import {
  orderedParamIdsFromVariants,
  paramValueOptionsFromVariants,
} from '../../shared/model-variants.js';
import { loadModelsForSdk } from './baguette-models-for-user.js';
import { userRowForAgentSdk } from './agent-context.js';
import { parseAgentSessionDefaultsJson } from '../../shared/agent-session-defaults.js';

export {
  coerceModelParams,
  isLastUsedAgentDefaults,
  LAST_USED_AGENT_SDK,
  mergeAgentSessionDefaults,
  parseAgentSessionDefaultsJson,
  resolveCreateSessionAgentFields,
  stringifyAgentSessionDefaults,
  withLastUsedFlag,
} from '../../shared/agent-session-defaults.js';

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

  if (defaults.model_params && defaults.agent_sdk !== 'cursor') {
    throw new BadRequest('model_params is only valid when agent_sdk is cursor');
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
    if (!models.some((m) => m.id === defaults.model)) {
      throw new BadRequest(`Unknown ${sdk} model "${defaults.model}". Refresh models in Settings.`);
    }
    if (defaults.model_params?.length) {
      const modelObj = models.find((m) => m.id === defaults.model);
      validateModelParamsForVariants(modelObj?.variants ?? [], defaults.model_params);
    }
  }

  return defaults;
}
