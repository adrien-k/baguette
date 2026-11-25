import { refreshCursorModels, listCursorModels, clearCursorModelsCache } from './models.js';
import { runCursorConnectivityTest } from './connectivity.js';
import { resolveCursorModelParams } from '../../../shared/model-variants.js';
import { parseCursorModelPrefsJson } from '../../../shared/cursor-model-prefs.js';
import { acpToolCallBuilders } from '../acp-mapping.ts';
import { registerGenericAgentService } from '../generic-agent-service.ts';
import { CursorDriver } from './driver.ts';
import { toolListToCursorCustomTools } from './adapt-tools.js';
import { fetchCursorSubscriptionLimits } from './subscription-limits.js';
import { usageLabelExtras } from './usage-label-extras.js';
import { CURSOR_AGENT_SDK_KEY, CURSOR_AGENT_SDK_LABEL, CURSOR_AGENT_SERVICE_PATH } from './meta.js';

/**
 * Cursor agent SDK plugin (contract: `agent-sdks/registry.js`).
 * Everything cursor-specific is reachable from this folder; SDK-agnostic code
 * must use the registry, not imports from this file.
 */
export const cursorAgentSdkPlugin = {
  key: CURSOR_AGENT_SDK_KEY,
  label: CURSOR_AGENT_SDK_LABEL,
  servicePath: CURSOR_AGENT_SERVICE_PATH,

  supportsModelParams: true,
  requiresModelParamsOnTurn: true,
  usesAgentPricingTable: true,
  appliesUserModelPrefs: true,
  storedSessionIdColumn: 'cursor_agent_id',

  credentialSchema: {
    envVarOptions: null,
    defaultEnvVar: null,
    hasApiUrl: false,
    secretPlaceholder: 'cursor-…',
    secretPlaceholderByEnvVar: null,
  },

  register(app, { servicePath } = {}) {
    registerGenericAgentService(
      app,
      {
        key: CURSOR_AGENT_SDK_KEY,
        label: CURSOR_AGENT_SDK_LABEL,
        servicePath: CURSOR_AGENT_SERVICE_PATH,
        storedSessionIdColumn: 'cursor_agent_id',
        registerCompactionHook: false,
        emitAppErrorEvenWithWriter: true,
        createDriver: ({ app: svcApp, config }) => new CursorDriver(svcApp, config),
      },
      servicePath
    );
  },

  clearModelsCache() {
    return clearCursorModelsCache();
  },

  async listModels(config, { refresh = false } = {}) {
    const models = refresh
      ? await refreshCursorModels(config.api_key)
      : await listCursorModels(config.api_key);
    return { models: models ?? [], rejected_models: [] };
  },

  testConnectivity(config) {
    return runCursorConnectivityTest(config);
  },

  toolCallBuilders() {
    return acpToolCallBuilders();
  },

  resolveModelParams({ models, modelId, user }) {
    const cursorModelPrefs = parseCursorModelPrefsJson(user?.agent_preferences);
    return resolveCursorModelParams({
      models,
      modelId,
      modelParamsJson: undefined,
      cursorModelPrefs,
    });
  },

  adaptTools(genericToolList) {
    return toolListToCursorCustomTools(genericToolList);
  },

  hasStoredSession(agent) {
    return Boolean(agent?.cursor_agent_id);
  },

  normalizePickerModelId(id) {
    return id;
  },

  usageLabelExtras,

  fetchSubscriptionLimits: fetchCursorSubscriptionLimits,
};
