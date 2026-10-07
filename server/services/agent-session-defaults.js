import { BadRequest } from '@feathersjs/errors';
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
import { requireRepoAccessForUserDb, userRowForAgentSdk } from './agent-sdk/agent-context.js';
import { firstEnabledAgentSdkKey } from './agent-sdk/default-agent-sdk.js';

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

export async function validateAgentSessionDefaults(user, input, { userId, repoId, app } = {}) {
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

  let repo = null;
  if (defaults.agent_sdk || defaults.model) {
    if (repoId == null || repoId === '') {
      throw new BadRequest('repo_id is required');
    }
    if (userId == null) {
      throw new BadRequest('userId is required for agent defaults validation');
    }
    const knex = app?.get?.('db');
    if (!knex) {
      throw new BadRequest('app db is required for agent defaults validation');
    }
    repo = await requireRepoAccessForUserDb(knex, Number(repoId), userId);
    if (!repo) {
      throw new BadRequest('Repository not found or not linked to your account');
    }
  }

  if (defaults.agent_sdk) {
    const enabled = await app.service('agent-sdks').isEnabled(defaults.agent_sdk, { user, repo });
    if (!enabled) {
      throw new BadRequest(
        `Agent SDK "${defaults.agent_sdk}" is not available for this repository. Add keys in Settings → Agent or repository settings.`
      );
    }
  }

  if (defaults.model) {
    const sdk = defaults.agent_sdk;
    const models = await loadModelsForSdk(user, sdk, repo, app);
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
export async function resolveDefaultAgent(db, userId, app) {
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
  const userRow = userId == null ? null : await db('users').where({ id: userId }).first();
  const user = userRowForAgentSdk(userRow);
  const defaultSdk = user && app ? await firstEnabledAgentSdkKey(app, { user, repo: null }) : null;
  return {
    agent_sdk: lastUsed?.agent_sdk ?? defaultSdk,
    model: lastUsed?.model ?? null,
    model_params: lastUsed?.model_params ?? null,
    source: 'last_used',
  };
}
