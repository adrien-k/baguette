import { BadRequest } from '@feathersjs/errors';
import { availableAgentSdks } from '../../shared/agent-sdk-credentials.js';
import {
  isLastUsedAgentDefaults,
  mergeAgentSessionDefaults,
  parseAgentSessionDefaultsJson,
  stringifyAgentSessionDefaults,
} from '../../shared/agent-session-defaults.js';
import { getLastUsedSessionAgent } from './last-used-session-agent.js';
import {
  orderedParamIdsFromVariants,
  paramValueOptionsFromVariants,
} from '../../shared/model-variants.js';
import { loadModelsForSdk } from './baguette-models-for-user.js';

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

export async function validateAgentSessionDefaults(user, input) {
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

  if (defaults.agent_sdk) {
    const allowed = availableAgentSdks(user, null);
    if (!allowed.includes(defaults.agent_sdk)) {
      throw new BadRequest(
        `No API key configured for agent_sdk "${defaults.agent_sdk}". Add keys in Settings → Agent.`
      );
    }
  }

  if (defaults.model) {
    const sdk = defaults.agent_sdk;
    const models = await loadModelsForSdk(user, sdk, null);
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

export function normalizeAgentDefaultsPatch(existingRaw, patch) {
  const merged = mergeAgentSessionDefaults(existingRaw, patch);
  return stringifyAgentSessionDefaults(merged);
}

/**
 * Effective default agent for new sessions: the user's stored defaults when they pin an SDK,
 * otherwise the sdk/model/params of their most recent session. Account-wide — deliberately
 * independent of the selected repo so "Last used agent" resolves the same everywhere.
 *
 * @returns {Promise<{ agent_sdk: string, model: string | null, model_params: Array | null,
 *   source: 'defaults' | 'last_used' }>}
 */
export async function resolveDefaultAgent(db, userId) {
  const defaults = parseAgentSessionDefaultsJson(
    userId == null ? null : (await db('users').where({ id: userId }).first())?.agent_defaults
  );
  if (!isLastUsedAgentDefaults(defaults)) {
    return {
      agent_sdk: defaults.agent_sdk,
      model: defaults.model,
      model_params: defaults.model_params,
      source: 'defaults',
    };
  }
  const lastUsed = await getLastUsedSessionAgent(db, userId);
  return {
    agent_sdk: lastUsed?.agent_sdk ?? 'claude',
    model: lastUsed?.model ?? null,
    model_params: lastUsed?.model_params ?? null,
    source: 'last_used',
  };
}
