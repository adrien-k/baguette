import { BadRequest } from 'feathers/errors';
import { getSdkPlugin } from '../agent-sdks/registry.js';
import { ensureBuiltInSdkPluginsRegistered } from '../agent-sdks/ensure-builtins-registered.js';

/**
 * Connectivity test for a decrypted agent_configs row (draft or saved).
 * Delegates to the SDK plugin registered in `agent-sdks/index.js`.
 * @param {object} config — includes sdk, api_key, api_url, api_key_env_var
 */
export async function testFromAgentConfig(config) {
  await ensureBuiltInSdkPluginsRegistered();
  const plugin = getSdkPlugin(config?.sdk);
  if (!plugin?.testConnectivity) {
    throw new BadRequest(`Unsupported sdk "${config?.sdk}"`);
  }
  return plugin.testConnectivity(config);
}
