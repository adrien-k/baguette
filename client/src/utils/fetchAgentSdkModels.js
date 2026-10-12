import { agentConfigsService } from '../feathers.js';

/**
 * List models for a saved or draft agent configuration.
 * Credential overrides are sent in the POST body (never query params).
 * @param {{ agentConfigId?: number | null, sdk?: string | null, refresh?: boolean, credentialFields?: Record<string, string> }} options
 */
export async function fetchAgentConfigModels({
  agentConfigId = null,
  sdk = null,
  refresh = false,
  credentialFields = {},
} = {}) {
  if (agentConfigId == null && !sdk) {
    throw new Error('agentConfigId or sdk is required to load agent models');
  }
  const payload = { ...credentialFields };
  if (agentConfigId != null) payload.id = agentConfigId;
  else payload.sdk = sdk;
  if (refresh) payload.refresh = true;
  const result = await agentConfigsService.listModels(payload);
  return {
    models: result?.models ?? [],
    rejected_models: result?.rejected_models ?? [],
  };
}
