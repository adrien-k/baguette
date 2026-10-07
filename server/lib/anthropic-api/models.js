import { createAnthropicApiClient } from './client.js';

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * @param {{ baseUrl: string, apiKey?: string | null, authToken?: string | null }} config
 * @param {{ limit?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<Array<{ id: string, display_name: string, description: null }>>}
 */
export async function listAnthropicApiModels(config, options = {}) {
  const limit = options.limit ?? 100;
  const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const client = createAnthropicApiClient(config);
  const { data, error, response } = await client.GET('/v1/models', {
    params: { query: { limit } },
    signal,
  });
  if (error || !response?.ok) {
    const status = response?.status ?? 'unknown';
    const detail =
      typeof error === 'object' && error && 'message' in error
        ? String(error.message)
        : JSON.stringify(error ?? {}).slice(0, 200);
    const err = new Error(`Gateway model list failed (HTTP ${status}): ${detail}`);
    if (typeof response?.status === 'number') err.status = response.status;
    err.apiError = error;
    throw err;
  }
  const rows = Array.isArray(data?.data) ? data.data : [];
  const models = rows
    .map((m) => ({
      id: m.id ?? m.name,
      display_name: m.display_name ?? m.name ?? m.id,
      description: null,
    }))
    .filter((m) => typeof m.id === 'string' && m.id);
  if (!models.length) throw new Error('Gateway returned no models');
  return models;
}

/**
 * @param {{ baseUrl: string, apiKey?: string | null, authToken?: string | null }} config
 * @param {{ model: string, signal?: AbortSignal }} body
 */
export async function probeAnthropicMessages(config, { model, signal }) {
  const client = createAnthropicApiClient(config);
  return client.POST('/v1/messages', {
    body: {
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    },
    signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
}
