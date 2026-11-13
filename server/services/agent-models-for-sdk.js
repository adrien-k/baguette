import { getSdkPlugin } from '../agent-sdks/registry.js';
import { ensureBuiltInSdkPluginsRegistered } from '../agent-sdks/ensure-builtins-registered.js';

/**
 * List models for an agent SDK using a decrypted agent_configs row (plus draft
 * overrides). Delegates to the SDK plugin registered in `agent-sdks/index.js`.
 * @param {string} sdk
 * @param {object | null | undefined} config — decrypted agent_config shape
 * @param {{ refresh?: boolean, user?: object | null }} [opts]
 */
export async function listModelsForAgentConfig(sdk, config, { refresh = false, user = null } = {}) {
  await ensureBuiltInSdkPluginsRegistered();
  const plugin = getSdkPlugin(sdk);
  if (!plugin?.listModels) return { models: [], rejected_models: [] };
  // SDKs that read keyed catalogs (mock) work with an empty api_key; the rest
  // only list models once a credential exists.
  if (plugin.requiresApiKey !== false && !config?.api_key) {
    return { models: [], rejected_models: [] };
  }
  return plugin.listModels(config, { refresh, user });
}
