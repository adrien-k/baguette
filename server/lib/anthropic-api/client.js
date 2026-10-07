import createClient from 'openapi-fetch';

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Auth headers for Anthropic-API-compatible gateways (Bearer for tokens, x-api-key for keys).
 * @param {{ apiKey?: string | null, authToken?: string | null }} config
 */
export function anthropicApiAuthHeaders({ apiKey, authToken } = {}) {
  const headers = { 'anthropic-version': ANTHROPIC_VERSION };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  else if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
}

/**
 * @param {{ baseUrl: string, apiKey?: string | null, authToken?: string | null }} config
 */
export function createAnthropicApiClient(config) {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const authHeaders = anthropicApiAuthHeaders(config);
  return createClient({
    baseUrl,
    headers: authHeaders,
  });
}
