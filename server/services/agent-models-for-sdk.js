import { defaultAgentConfigApiKeyEnvVar } from '../../shared/agent-config-api-key-env.js';
import { isMockAgentSdkEnabled, listMockModels } from '../../shared/mock-agent-sdk.js';
import { listClaudeModels } from './claude-gateway-models.js';
import { listCursorModels, refreshCursorModels } from './cursor-models.js';
import { listPiModels } from './pi-models.js';

/**
 * List models for an agent SDK using a decrypted agent_configs row (plus draft overrides).
 * @param {string} sdk
 * @param {object | null | undefined} config — decrypted agent_config shape
 * @param {{ refresh?: boolean }} [opts]
 */
export async function listModelsForAgentConfig(sdk, config, { refresh = false, user = null } = {}) {
  if (!config?.api_key) return { models: [], rejected_models: [] };
  switch (sdk) {
    case 'claude': {
      const result = await listClaudeModels(config, { refresh, user });
      return result;
    }
    case 'cursor': {
      const models = refresh
        ? await refreshCursorModels(config.api_key)
        : await listCursorModels(config.api_key);
      return { models: models ?? [], rejected_models: [] };
    }
    case 'pi': {
      const models = await listPiModels(
        config.api_key,
        config.api_key_env_var || defaultAgentConfigApiKeyEnvVar('pi'),
        { refresh, config }
      );
      return { models: models ?? [], rejected_models: [] };
    }
    case 'mock': {
      if (!isMockAgentSdkEnabled()) return { models: [], rejected_models: [] };
      return { models: listMockModels(), rejected_models: [] };
    }
    default:
      return { models: [], rejected_models: [] };
  }
}
