/** LunaRoute gateway model catalog for settings (Pi extension is not loaded here). */

const DEFAULT_LUNAROUTE_ROUTING_URL = 'https://gw.lunaroute.com/v1';
const LUNAROUTE_ENV_ROUTING_URL = 'LUNAROUTE_ROUTING_URL';

const DEFAULT_TIMEOUT_MS = 20_000;

/** Keep in sync with `server/pi/extensions/lunaroute-chat/constants.ts`. */
const NON_CHAT_CAPABILITIES = [
  'image_generation',
  'embeddings',
  'rerank',
  'systemone',
  'transcription',
];

/**
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveLunarouteRoutingUrl(env = process.env) {
  const raw = env[LUNAROUTE_ENV_ROUTING_URL];
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim().replace(/\/$/, '');
  }
  return DEFAULT_LUNAROUTE_ROUTING_URL;
}

/**
 * @param {object | null | undefined} config — decrypted agent_config
 * @returns {NodeJS.ProcessEnv}
 */
export function lunarouteEnvFromAgentConfig(config) {
  const env = { ...process.env };
  const raw = config?.extra_env_json;
  if (raw == null || raw === '') return env;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return env;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return env;
  for (const [key, value] of Object.entries(parsed)) {
    if (value != null && value !== '') env[key] = String(value);
  }
  return env;
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {boolean}
 */
function isChatCatalogEntry(entry) {
  if (!entry?.id || !entry.context_window || !entry.max_output_tokens) return false;
  const capabilities = entry.capabilities;
  if (capabilities && typeof capabilities === 'object') {
    for (const capability of NON_CHAT_CAPABILITIES) {
      if (capabilities[capability] === true) return false;
    }
    const reasoning = capabilities.reasoning === true;
    const gatewayPi = entry.client_compat?.pi ?? entry.pi;
    if (reasoning && !gatewayPi) return false;
  }
  return true;
}

/**
 * @param {string} apiKey
 * @param {{ config?: object | null, env?: NodeJS.ProcessEnv, signal?: AbortSignal, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Array<{ id: string, display_name: string, description: null }>>}
 */
export async function listLunarouteGatewayModels(apiKey, options = {}) {
  const env = options.env ?? lunarouteEnvFromAgentConfig(options.config);
  const baseUrl = resolveLunarouteRoutingUrl(env);
  const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;

  const res = await fetchImpl(`${baseUrl}/models`, {
    signal,
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      const msg = body?.error?.message ?? body?.message;
      if (typeof msg === 'string' && msg.trim()) detail = msg.trim();
    } catch {
      /* ignore parse errors */
    }
    const err = new Error(`LunaRoute model list failed (${detail})`);
    err.status = res.status;
    throw err;
  }

  const body = await res.json();
  const entries = Array.isArray(body?.data) ? body.data : [];
  const models = entries
    .filter(isChatCatalogEntry)
    .map((entry) => ({
      id: String(entry.id),
      display_name: String(entry.display_name ?? entry.id),
      description: null,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return models;
}
