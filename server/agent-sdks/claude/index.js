import { listClaudeModels } from './gateway-models.js';
import { runClaudeConnectivityTest } from './connectivity.js';
import { resolveClaudeAgentModelParams } from './model-params.js';
import { claudeToolCallBuilders } from './tool-call-builders.ts';
import { registerClaudeAgentService } from './agent-service.ts';
import { parseCursorModelPrefsJson } from '../../../shared/cursor-model-prefs.js';
import { normalizeClaudeCodePickerModelId } from '../../../shared/claude-code-model-list.js';
import {
  ANTHROPIC_API_KEY_ENV,
  CLAUDE_API_KEY_ENV_OPTIONS,
} from '../../../shared/agent-config-api-key-env.js';
import { toolListToClaudeMcpServer } from './adapt-tools.js';
import { resetUsageTotals } from './usage-totals.js';
import { normalizeAnthropicBaseUrl } from './env.js';
import { CLAUDE_AGENT_SDK_KEY, CLAUDE_AGENT_SDK_LABEL, CLAUDE_AGENT_SERVICE_PATH } from './meta.js';

/**
 * Claude agent SDK plugin (contract: `agent-sdks/registry.js`).
 * Everything claude-specific is reachable from this folder; SDK-agnostic code
 * must use the registry, not imports from this file.
 */
export const claudeAgentSdkPlugin = {
  key: CLAUDE_AGENT_SDK_KEY,
  label: CLAUDE_AGENT_SDK_LABEL,
  servicePath: CLAUDE_AGENT_SERVICE_PATH,

  supportsModelParams: true,
  requiresModelParamsOnTurn: false,
  usesAgentPricingTable: false,
  storedSessionIdColumn: 'claude_session_id',

  credentialSchema: {
    envVarOptions: CLAUDE_API_KEY_ENV_OPTIONS,
    defaultEnvVar: ANTHROPIC_API_KEY_ENV,
    hasApiUrl: true,
    secretPlaceholder: 'sk-ant-…',
    secretPlaceholderByEnvVar: null,
  },

  register(app, { servicePath } = {}) {
    registerClaudeAgentService(app, servicePath);
  },

  listModels(config, { refresh = false, user = null } = {}) {
    return listClaudeModels(config, { refresh, user });
  },

  testConnectivity(config) {
    return runClaudeConnectivityTest(config);
  },

  toolCallBuilders() {
    return claudeToolCallBuilders();
  },

  resolveModelParams({ models, modelId, user }) {
    const cursorModelPrefs = parseCursorModelPrefsJson(user?.agent_preferences);
    return resolveClaudeAgentModelParams({
      models,
      modelId,
      modelParams: undefined,
      cursorModelPrefs,
    });
  },

  adaptTools(genericToolList) {
    return toolListToClaudeMcpServer(genericToolList);
  },

  hasStoredSession(agent) {
    return Boolean(agent?.claude_session_id);
  },

  normalizePickerModelId(id, pickerIds) {
    return normalizeClaudeCodePickerModelId(id, pickerIds);
  },

  normalizeApiUrl(url) {
    return normalizeAnthropicBaseUrl(url);
  },

  resetUsageTotals,
};
