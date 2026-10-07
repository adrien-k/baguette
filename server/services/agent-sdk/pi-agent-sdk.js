import { resolveAgentSdkKeys } from '../../../shared/agent-sdk-credentials.js';
import { resolvePiCredentials } from '../pi/pi-config.js';
import { listPiModels, listPiModelsForUser } from '../pi-models.js';

export const PI_AGENT_SDK_KEY = 'pi';
export const PI_AGENT_SDK_LABEL = 'Pi';
export const PI_AGENT_SERVICE_PATH = 'pi-agent';

export function isPiAgentSdkEnabled({ user, repo = null }) {
  const keys = resolveAgentSdkKeys(user, repo);
  return Boolean(keys.pi_api_key);
}

export async function listPiAgentModels({ user, repo = null }, { refresh = false } = {}) {
  if (!isPiAgentSdkEnabled({ user, repo })) return [];
  if (refresh) {
    const { apiKey, envVar } = resolvePiCredentials(user, repo);
    if (!apiKey) return [];
    return listPiModels(apiKey, envVar, { refresh: true });
  }
  return listPiModelsForUser(user, repo);
}
