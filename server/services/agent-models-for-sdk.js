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
export async function listModelsForAgentConfig(sdk, config, { refresh = false } = {}) {
  if (!config?.api_key) return [];
  switch (sdk) {
    case 'claude':
      return listClaudeModels(config, { refresh });
    case 'cursor':
      if (refresh) return refreshCursorModels(config.api_key);
      return listCursorModels(config.api_key);
    case 'pi':
      return listPiModels(
        config.api_key,
        config.api_key_env_var || defaultAgentConfigApiKeyEnvVar('pi'),
        { refresh }
      );
    case 'mock':
      if (!isMockAgentSdkEnabled()) return [];
      return listMockModels();
    default:
      return [];
  }
}
