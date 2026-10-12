import { listAnthropicApiModels } from './anthropic-api/models.js';
import { listLunarouteGatewayModels } from './lunaroute-gateway-models.js';
import { isLunaroutePiApiKeyEnvVar } from '../../shared/pi-api-key-env-vars.js';

const DEFAULT_TIMEOUT_MS = 20_000;

const ANTHROPIC_PI_ENV_VARS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
]);

const ANTHROPIC_TOKEN_ENV_VARS = new Set(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN']);

/**
 * @param {string} envVar
 * @param {string} apiKey
 */
function anthropicProbeConfig(envVar, apiKey) {
  const useToken = ANTHROPIC_TOKEN_ENV_VARS.has(envVar);
  return {
    baseUrl: 'https://api.anthropic.com',
    apiKey: useToken ? null : apiKey,
    authToken: useToken ? apiKey : null,
  };
}

/**
 * @param {Response} res
 */
async function httpErrorDetail(res) {
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    const msg = body?.error?.message ?? body?.message ?? body?.error;
    if (typeof msg === 'string' && msg.trim()) detail = msg.trim();
    else if (typeof msg === 'object' && msg?.message) detail = String(msg.message);
  } catch {
    /* ignore */
  }
  return detail;
}

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {{ signal?: AbortSignal, fetchImpl?: typeof fetch }} [options]
 */
async function fetchOpenAiCompatibleModelList(url, headers, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const res = await fetchImpl(url, { signal, headers });
  if (!res.ok) {
    const detail = await httpErrorDetail(res);
    const err = new Error(`Model list failed (${detail})`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  const entries = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : [];
  return entries.length;
}

/**
 * Network probe: list models using the provider's real API (not Pi's static catalog).
 *
 * @param {{ apiKey: string, envVar: string, providerId: string, config?: object | null, runtime?: { getProvider: (id: string) => { baseUrl?: string, headers?: Record<string, string> } | undefined }, signal?: AbortSignal, fetchImpl?: typeof fetch }} input
 * @returns {Promise<{ modelCount: number }>}
 */
export async function probePiProviderModelCatalog(input) {
  const { apiKey, envVar, providerId, config, runtime } = input;
  const signal = input.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const fetchImpl = input.fetchImpl ?? fetch;

  if (isLunaroutePiApiKeyEnvVar(envVar)) {
    const models = await listLunarouteGatewayModels(apiKey, { config, signal, fetchImpl });
    return { modelCount: models.length };
  }

  if (ANTHROPIC_PI_ENV_VARS.has(envVar)) {
    const models = await listAnthropicApiModels(anthropicProbeConfig(envVar, apiKey), {
      signal,
    });
    return { modelCount: models.length };
  }

  const provider = runtime?.getProvider(providerId);
  const baseUrl = provider?.baseUrl?.replace(/\/$/, '');
  if (!baseUrl) {
    const err = new Error(`Cannot verify credentials for provider "${providerId}"`);
    err.status = 0;
    throw err;
  }

  if (providerId === 'google') {
    const url = `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url, { signal });
    if (!res.ok) {
      const detail = await httpErrorDetail(res);
      const err = new Error(`Model list failed (${detail})`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    const entries = Array.isArray(body?.models) ? body.models : [];
    return { modelCount: entries.length };
  }

  const headers = { Authorization: `Bearer ${apiKey}`, ...(provider.headers ?? {}) };
  const modelCount = await fetchOpenAiCompatibleModelList(`${baseUrl}/models`, headers, {
    signal,
    fetchImpl,
  });
  return { modelCount };
}
