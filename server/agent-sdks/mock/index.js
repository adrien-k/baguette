import { isMockAgentSdkEnabled, listMockModels } from '../../../shared/mock-agent-sdk.js';
import { BadRequest } from 'feathers/errors';
import { claudeBuildToolCallComplete, claudeBuildToolCallStart } from '../claude/mapping.ts';
import { registerMockAgentService } from './agent-service.ts';
import { MOCK_AGENT_SDK, MOCK_AGENT_SDK_LABEL, MOCK_AGENT_SERVICE_PATH } from './meta.js';

/**
 * Mock agent SDK plugin (contract: `agent-sdks/registry.js`).
 * The mock SDK piggy-backs on the claude message-stream builders (no task
 * tracking), matching the pre-plugin behaviour in message-writer-factory.
 */
export const mockAgentSdkPlugin = {
  key: MOCK_AGENT_SDK,
  label: MOCK_AGENT_SDK_LABEL,
  servicePath: MOCK_AGENT_SERVICE_PATH,

  // Mock catalogs are keyed by api_key (catalog/…); an empty key still works.
  requiresApiKey: false,
  supportsModelParams: false,
  requiresModelParamsOnTurn: false,
  usesAgentPricingTable: false,
  storedSessionIdColumn: null,

  credentialSchema: {
    envVarOptions: null,
    defaultEnvVar: null,
    hasApiUrl: false,
    secretLabel: 'Mock catalog key',
    secretHint: 'Optional. Use mock-catalog-alt for the alternate dev model list.',
    secretPlaceholder: 'mock-catalog-alt',
    secretPlaceholderByEnvVar: null,
  },

  register(app, { servicePath } = {}) {
    registerMockAgentService(app, servicePath);
  },

  listModels(config) {
    if (!isMockAgentSdkEnabled()) return { models: [], rejected_models: [] };
    const catalogKey = config?.api_key?.trim() || '';
    return { models: listMockModels(catalogKey), rejected_models: [] };
  },

  testConnectivity() {
    if (!isMockAgentSdkEnabled()) {
      throw new BadRequest('Mock agent is not enabled on this server');
    }
    return { ok: true, checks: [{ id: 'mock', label: 'Mock agent', ok: true }] };
  },

  toolCallBuilders() {
    return {
      buildToolCallStart: claudeBuildToolCallStart,
      buildToolCallComplete: claudeBuildToolCallComplete,
    };
  },

  resolveModelParams() {
    return [];
  },

  adaptTools() {
    // Mock does not wrap a custom tool list.
    return [];
  },

  hasStoredSession() {
    return false;
  },

  normalizePickerModelId(id) {
    return id;
  },
};
