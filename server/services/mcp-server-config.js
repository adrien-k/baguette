import { BadRequest } from 'feathers/errors';
import { decrypt } from '../lib/encrypt.js';

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const RESERVED_NAMES = new Set(['baguette']);
const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;
const MAX_NAME = 64;
const MAX_URL = 2048;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE = 4096;
const MAX_MCP_DESCRIPTION = 2000;

export function mcpFlagEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function assertMcpServerName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || trimmed.length > MAX_NAME || !NAME_RE.test(trimmed)) {
    throw new BadRequest('Name must be 1–64 characters: letters, numbers, "_" or "-"');
  }
  if (RESERVED_NAMES.has(trimmed.toLowerCase())) {
    throw new BadRequest(`Name "${trimmed}" is reserved`);
  }
  return trimmed;
}

/** Persisted Authentication picker values for outbound MCP servers. */
const MCP_AUTH_METHODS = new Set(['none', 'bearer', 'oauth']);

/**
 * The user's chosen credential kind. Persisted so the edit dialog can show the
 * intent (e.g. "OAuth, not connected yet") even before any credential exists.
 * null / empty are legacy no-auth rows → 'none'.
 */
export function assertMcpAuthMethod(value) {
  if (value == null || value === '') return 'none';
  const method = String(value).trim().toLowerCase();
  if (!MCP_AUTH_METHODS.has(method)) {
    throw new BadRequest('Authentication method must be none, bearer, or oauth');
  }
  return method;
}

/**
 * Optional user-written guidance for the agent ("when and why to use this server").
 * Reaches the model through the session system prompt and Pi's per-session mcp.json.
 */
export function assertMcpDescription(value) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new BadRequest('Description must be text');
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_MCP_DESCRIPTION) {
    throw new BadRequest(`Description must be at most ${MAX_MCP_DESCRIPTION} characters`);
  }
  return trimmed || null;
}

export function assertMcpTransport(transport) {
  const value = String(transport ?? '')
    .trim()
    .toLowerCase();
  if (value !== 'http' && value !== 'sse') {
    throw new BadRequest('Transport must be http or sse');
  }
  return value;
}

export function assertMcpUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw || raw.length > MAX_URL) throw new BadRequest('A valid http(s) URL is required');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequest('A valid http(s) URL is required');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequest('URL must use http or https');
  }
  return parsed.toString();
}

export function normalizeHeaders(input) {
  if (input == null) return {};
  const pairs = Array.isArray(input)
    ? input
    : Object.entries(input).map(([name, value]) => ({ name, value }));
  const out = {};
  for (const pair of pairs) {
    const name = String(pair?.name ?? pair?.key ?? '').trim();
    if (!name) continue;
    if (!HEADER_NAME_RE.test(name)) throw new BadRequest(`Invalid header name "${name}"`);
    if (name.toLowerCase() === 'authorization') {
      throw new BadRequest('Set Authorization with the bearer token or OAuth');
    }
    const value = pair?.value == null ? '' : String(pair.value);
    if (value.length > MAX_HEADER_VALUE) throw new BadRequest(`Header ${name} is too long`);
    out[name] = value;
  }
  if (Object.keys(out).length > MAX_HEADERS) throw new BadRequest('At most 20 headers');
  return out;
}

export function parseMcpServersMap(value) {
  if (value == null || value === '') return {};
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed;
}

/**
 * Enable map for a new session or a locked loop snapshot.
 * Unknown ids are dropped. `locked` keeps only override keys (still-owned servers)
 * and does not fill in servers added after the snapshot.
 */
export function buildMcpEnableMap({ catalog, override, locked }) {
  const owned = new Map((catalog || []).map((server) => [String(server.id), server]));
  const source = parseMcpServersMap(override);
  if (locked) {
    const out = {};
    for (const [id, enabled] of Object.entries(source)) {
      if (!owned.has(String(id))) continue;
      out[String(id)] = mcpFlagEnabled(enabled);
    }
    return out;
  }
  const out = {};
  for (const server of owned.values()) {
    out[String(server.id)] = mcpFlagEnabled(server.enabled);
  }
  for (const [id, enabled] of Object.entries(source)) {
    if (!owned.has(String(id))) continue;
    out[String(id)] = mcpFlagEnabled(enabled);
  }
  return out;
}

function decryptOptional(value) {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

function parseJsonObject(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* stored value was not JSON */
  }
  return null;
}

/** Decrypt a `user_mcp_servers` row. Encrypted columns are removed. */
export function decryptMcpServerRow(row) {
  if (!row) return row;
  const headers = parseJsonObject(decryptOptional(row.headers_encrypted)) || {};
  const oauthTokens = parseJsonObject(decryptOptional(row.oauth_tokens_encrypted));
  const clientInformation = parseJsonObject(
    decryptOptional(row.oauth_client_information_encrypted)
  );
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    transport: row.transport,
    url: row.url,
    description: row.description ?? null,
    auth_method: row.auth_method || null,
    enabled: mcpFlagEnabled(row.enabled),
    oauth_scope: row.oauth_scope || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    bearer_token: decryptOptional(row.bearer_token_encrypted),
    headers,
    oauth_client_id: decryptOptional(row.oauth_client_id_encrypted),
    oauth_client_secret: decryptOptional(row.oauth_client_secret_encrypted),
    oauth_client_information: clientInformation,
    oauth_tokens: oauthTokens,
  };
}

export function buildMcpHeaders(row) {
  const headers = {};
  const extra = row?.headers;
  if (extra && typeof extra === 'object') {
    for (const [name, value] of Object.entries(extra)) {
      if (!name || value == null || value === '') continue;
      headers[name] = String(value);
    }
  }
  const oauthToken = row?.oauth_tokens?.access_token;
  const bearer = oauthToken || row?.bearer_token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

/** Claude / Cursor / Pi HTTP(S) MCP server entry. */
export function toSdkMcpServer(row) {
  const config = {
    type: row.transport === 'sse' ? 'sse' : 'http',
    url: row.url,
  };
  const headers = buildMcpHeaders(row);
  if (Object.keys(headers).length) config.headers = headers;
  return config;
}

export function accessTokenExpired(tokens) {
  if (!tokens?.access_token) return true;
  if (!tokens.expires_in || !tokens.obtained_at) return false;
  const expiresAt = Number(tokens.obtained_at) + Number(tokens.expires_in) * 1000;
  return Date.now() > expiresAt - 60_000;
}
