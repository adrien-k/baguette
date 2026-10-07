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
 * @param {string} method
 * @param {string} path
 * @param {{ query?: Record<string, string | number>, body?: unknown, signal?: AbortSignal }} [options]
 * @returns {Promise<{ data: unknown, error: unknown, response: Response }>}
 */
export async function anthropicApiRequest(config, method, path, options = {}) {
  const base = config.baseUrl.replace(/\/$/, '');
  const url = new URL(path.replace(/^\//, ''), `${base}/`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  }
  const headers = { ...anthropicApiAuthHeaders(config) };
  let body;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: options.signal,
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const data = response.ok ? parsed : null;
  const error = response.ok
    ? null
    : (parsed ?? { message: text.slice(0, 200) || response.statusText });
  return { data, error, response };
}
