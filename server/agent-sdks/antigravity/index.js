import { listAntigravityModels, clearAntigravityModelsCache } from './models.js';
import { runAntigravityConnectivityTest } from './connectivity.js';
import { resolveAntigravityAgentModelParams } from './model-params.js';
import { antigravityBuildToolCallComplete, antigravityBuildToolCallStart } from './mapping.ts';
import { registerAntigravityAgentService } from './agent-service.ts';
import { toolListToAntigravityMcpTools } from './adapt-tools.js';
import {
  ANTIGRAVITY_AGENT_SDK_KEY,
  ANTIGRAVITY_AGENT_SDK_LABEL,
  ANTIGRAVITY_AGENT_SERVICE_PATH,
} from './meta.js';

/**
 * Antigravity agent SDK plugin (contract: `agent-sdks/registry.js`).
 * Driven via `agy acp` and `@agentclientprotocol/sdk`.
 */
export const antigravityAgentSdkPlugin = {
  key: ANTIGRAVITY_AGENT_SDK_KEY,
  label: ANTIGRAVITY_AGENT_SDK_LABEL,
  servicePath: ANTIGRAVITY_AGENT_SERVICE_PATH,

  supportsModelParams: true,
  requiresModelParamsOnTurn: false,
  usesAgentPricingTable: true,
  storedSessionIdColumn: 'antigravity_session_id',
  requiresApiKey: false,

  credentialSchema: {
    envVarOptions: null,
    defaultEnvVar: null,
    hasApiUrl: false,
    secretPlaceholder: 'Optional GEMINI_API_KEY (uses local agy login by default)',
    secretPlaceholderByEnvVar: null,
    credentialHelpBanner:
      'Uses your local `agy` CLI login by default. Optionally supply a Gemini API key or set `ANTIGRAVITY_BIN` in Extra env.',
  },

  register(app, { servicePath } = {}) {
    registerAntigravityAgentService(app, servicePath);
  },

  clearModelsCache(config) {
    return clearAntigravityModelsCache(config);
  },

  async listModels(config, { refresh = false } = {}) {
    const models = await listAntigravityModels(config, { refresh });
    return { models: models ?? [], rejected_models: [] };
  },

  testConnectivity(config) {
    return runAntigravityConnectivityTest(config);
  },

  toolCallBuilders() {
    return {
      buildToolCallStart: antigravityBuildToolCallStart,
      buildToolCallComplete: antigravityBuildToolCallComplete,
    };
  },

  resolveModelParams({ models, modelId }) {
    return resolveAntigravityAgentModelParams({
      models,
      modelId,
      modelParams: undefined,
    });
  },

  adaptTools(genericToolList) {
    return toolListToAntigravityMcpTools(genericToolList);
  },

  hasStoredSession(agent) {
    return Boolean(agent?.antigravity_session_id);
  },

  normalizePickerModelId(id) {
    return id;
  },
};
