import { listPiModels } from './models.js';
import { runPiConnectivityTest } from './connectivity.js';
import { resolvePiAgentModelParams } from './model-params.js';
import { piBuildToolCallComplete, piBuildToolCallStart } from './mapping.ts';
import { registerPiAgentService } from './agent-service.ts';
import { PI_API_KEY_ENV_VARS } from '../../../shared/agent-config-api-key-env.js';
import {
  DEFAULT_PI_API_KEY_ENV_VAR,
  LUNAROUTE_PI_API_KEY_ENV_VAR,
} from '../../../shared/pi-api-key-env-vars.js';
import { toolListToPiCustomTools } from './adapt-tools.js';
import { PI_AGENT_SDK_KEY, PI_AGENT_SDK_LABEL, PI_AGENT_SERVICE_PATH } from './meta.js';

/**
 * Pi agent SDK plugin (contract: `agent-sdks/registry.js`).
 * Everything pi-specific is reachable from this folder; SDK-agnostic code must
 * use the registry, not imports from this file.
 */
export const piAgentSdkPlugin = {
  key: PI_AGENT_SDK_KEY,
  label: PI_AGENT_SDK_LABEL,
  servicePath: PI_AGENT_SERVICE_PATH,

  supportsModelParams: true,
  requiresModelParamsOnTurn: false,
  usesAgentPricingTable: true,
  storedSessionIdColumn: 'pi_session_id',

  credentialSchema: {
    envVarOptions: PI_API_KEY_ENV_VARS.map((e) => ({ value: e.env, label: e.label })),
    defaultEnvVar: DEFAULT_PI_API_KEY_ENV_VAR,
    hasApiUrl: false,
    secretPlaceholder: 'provider API key',
    secretPlaceholderByEnvVar: {
      [LUNAROUTE_PI_API_KEY_ENV_VAR]: 'lr_…',
    },
  },

  register(app, { servicePath } = {}) {
    registerPiAgentService(app, servicePath);
  },

  async listModels(config, { refresh = false } = {}) {
    const models = await listPiModels(
      config.api_key,
      config.api_key_env_var || DEFAULT_PI_API_KEY_ENV_VAR,
      { refresh, config }
    );
    return { models: models ?? [], rejected_models: [] };
  },

  testConnectivity(config) {
    return runPiConnectivityTest(config);
  },

  toolCallBuilders() {
    return {
      buildToolCallStart: piBuildToolCallStart,
      buildToolCallComplete: piBuildToolCallComplete,
    };
  },

  resolveModelParams({ models, modelId }) {
    return resolvePiAgentModelParams({
      models,
      modelId,
      modelParams: undefined,
    });
  },

  adaptTools(genericToolList) {
    return toolListToPiCustomTools(genericToolList);
  },

  hasStoredSession(agent) {
    return Boolean(agent?.pi_session_id);
  },

  normalizePickerModelId(id) {
    return id;
  },
};
