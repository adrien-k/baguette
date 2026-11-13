import { KnexService } from '@feathersjs/knex';
import { BadRequest, Forbidden, NotFound } from 'feathers/errors';
import { encrypt } from '../../lib/encrypt.js';
import { DEFAULT_PAGINATE } from '../../config.js';
import { requireUser, maskValue, disableExternal } from './hooks.js';
import {
  assertMcpAuthMethod,
  assertMcpDescription,
  assertMcpServerName,
  assertMcpTransport,
  assertMcpUrl,
  buildMcpHeaders,
  decryptMcpServerRow,
  mcpFlagEnabled,
  normalizeHeaders,
  accessTokenExpired,
} from '../mcp-server-config.js';
import { connectivityChecks, probeMcpServer } from '../mcp-connectivity.js';
import {
  McpOAuthProvider,
  mcpAuth,
  mcpOAuthAvailability,
  mcpOAuthRedirectUrl,
} from '../mcp-oauth.js';
import logger from '../../logger.js';
import {
  InvalidClientError,
  InvalidGrantError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

const WRITE_FIELDS = [
  'name',
  'transport',
  'url',
  'description',
  'auth_method',
  'enabled',
  'bearer_token',
  'headers',
  'oauth_client_id',
  'oauth_client_secret',
  'oauth_scope',
];

function encryptOptional(value) {
  if (value == null || value === '') return null;
  return encrypt(String(value));
}

function presentExternal(row) {
  const decrypted = decryptMcpServerRow(row);
  const headers = {};
  for (const [name, value] of Object.entries(decrypted.headers || {})) {
    headers[name] = maskValue(String(value));
  }
  return {
    id: decrypted.id,
    user_id: decrypted.user_id,
    name: decrypted.name,
    transport: decrypted.transport,
    url: decrypted.url,
    description: decrypted.description ?? null,
    auth_method: decrypted.auth_method || 'none',
    enabled: !!decrypted.enabled,
    oauth_scope: decrypted.oauth_scope,
    bearer_token_configured: Boolean(decrypted.bearer_token),
    bearer_token: decrypted.bearer_token ? maskValue(decrypted.bearer_token) : null,
    headers,
    oauth_client_id: decrypted.oauth_client_id,
    oauth_client_secret_configured: Boolean(decrypted.oauth_client_secret),
    oauth_connected: Boolean(
      decrypted.oauth_tokens?.access_token || decrypted.oauth_tokens?.refresh_token
    ),
    created_at: decrypted.created_at,
    updated_at: decrypted.updated_at,
  };
}

function presentResult(context) {
  if (!context.params.provider) return context;
  const present = (row) => (row ? presentExternal(row) : row);
  const result = context.result;
  if (result?.data) context.result = { ...result, data: result.data.map(present) };
  else if (Array.isArray(result)) context.result = result.map(present);
  else if (result) context.result = present(result);
  return context;
}

async function validateMcpServerWrite(context) {
  const data = context.data || {};
  for (const key of Object.keys(data)) {
    if (!WRITE_FIELDS.includes(key)) delete data[key];
  }
  if (context.method === 'create') {
    data.name = assertMcpServerName(data.name);
    data.transport = assertMcpTransport(data.transport);
    data.url = assertMcpUrl(data.url);
    if (data.enabled === undefined) data.enabled = 1;
  } else {
    if (data.name !== undefined) data.name = assertMcpServerName(data.name);
    if (data.transport !== undefined) data.transport = assertMcpTransport(data.transport);
    if (data.url !== undefined) data.url = assertMcpUrl(data.url);
  }
  if (data.description !== undefined) data.description = assertMcpDescription(data.description);
  if (data.auth_method !== undefined) data.auth_method = assertMcpAuthMethod(data.auth_method);
  if (data.enabled !== undefined) data.enabled = mcpFlagEnabled(data.enabled) ? 1 : 0;
  if (data.headers !== undefined) {
    const headers = normalizeHeaders(data.headers);
    data.headers_json = Object.keys(headers).length ? JSON.stringify(headers) : null;
    delete data.headers;
  }
  if (data.oauth_scope !== undefined) {
    const scope = String(data.oauth_scope ?? '').trim();
    data.oauth_scope = scope || null;
  }
  if (data.oauth_client_id !== undefined) {
    const clientId = String(data.oauth_client_id ?? '').trim();
    data.oauth_client_id = clientId || null;
  }
  data.updated_at = new Date().toISOString();
  if (context.method === 'create') data.created_at = data.updated_at;
  return context;
}

async function ensureUniqueName(context) {
  if (context.data.name === undefined) return context;
  const userId = context.params.user?.id;
  const db = context.service.options.Model;
  let query = db('user_mcp_servers')
    .where({ user_id: userId })
    .whereRaw('LOWER(name) = ?', [context.data.name.toLowerCase()]);
  if (context.method === 'patch') query = query.whereNot('id', context.id);
  const existing = await query.first();
  if (existing) throw new BadRequest(`Name "${context.data.name}" is already in use`);
  return context;
}

function encryptSecrets(context) {
  const data = context.data;
  if (data.bearer_token !== undefined) {
    data.bearer_token_encrypted = encryptOptional(data.bearer_token);
    delete data.bearer_token;
  }
  if (data.headers_json !== undefined) {
    data.headers_encrypted = data.headers_json ? encrypt(data.headers_json) : null;
    delete data.headers_json;
  }
  if (data.oauth_client_id !== undefined) {
    data.oauth_client_id_encrypted = encryptOptional(data.oauth_client_id);
    delete data.oauth_client_id;
  }
  if (data.oauth_client_secret !== undefined) {
    data.oauth_client_secret_encrypted = encryptOptional(data.oauth_client_secret);
    delete data.oauth_client_secret;
  }
  return context;
}

class McpServersService extends KnexService {
  setup(app) {
    this.app = app;
  }

  async _ownedRow(id, userId) {
    if (!userId) throw new Forbidden('Not authenticated');
    const row = await this.options
      .Model('user_mcp_servers')
      .where({ id: Number(id), user_id: userId })
      .first();
    if (!row) throw new NotFound('MCP server not found');
    return row;
  }

  async find(params) {
    const userId = params.user?.id;
    if (!userId) throw new Forbidden('Not authenticated');
    const rows = await this.options
      .Model('user_mcp_servers')
      .where({ user_id: userId })
      .orderBy('name', 'asc');
    return { data: rows, total: rows.length, limit: rows.length, skip: 0 };
  }

  async get(id, params) {
    return this._ownedRow(id, params.user?.id);
  }

  async create(data, params) {
    const userId = params.user?.id;
    if (!userId) throw new Forbidden('Not authenticated');
    return super.create({ ...data, user_id: userId }, { ...params, provider: undefined });
  }

  async patch(id, data, params) {
    await this._ownedRow(id, params.user?.id);
    return super.patch(id, data, params);
  }

  async remove(id, params) {
    const row = await this._ownedRow(id, params.user?.id);
    await this.options.Model('user_mcp_servers').where({ id: row.id }).delete();
    return row;
  }

  async testConnectivity(data, params) {
    const payload = data || {};
    let row;
    if (payload.id != null) {
      row = decryptMcpServerRow(await this._ownedRow(payload.id, params.user?.id));
      if (payload.url != null) row.url = assertMcpUrl(payload.url);
      if (payload.transport != null) row.transport = assertMcpTransport(payload.transport);
      if (payload.bearer_token !== undefined) row.bearer_token = payload.bearer_token || null;
      if (payload.headers !== undefined) row.headers = normalizeHeaders(payload.headers);
    } else {
      row = {
        transport: assertMcpTransport(payload.transport),
        url: assertMcpUrl(payload.url),
        bearer_token: payload.bearer_token || null,
        headers: payload.headers != null ? normalizeHeaders(payload.headers) : {},
        oauth_tokens: null,
      };
    }
    if (
      row.oauth_tokens &&
      accessTokenExpired(row.oauth_tokens) &&
      row.oauth_tokens.refresh_token
    ) {
      const edited = {
        url: row.url,
        transport: row.transport,
        bearer_token: row.bearer_token,
        headers: row.headers,
      };
      const refreshed = await this.refreshOAuthIfNeeded(row);
      row = { ...refreshed, ...edited };
    }
    const probe = await probeMcpServer({
      transport: row.transport,
      url: row.url,
      headers: buildMcpHeaders(row),
    });
    return connectivityChecks(probe, row.url);
  }

  _oauthCallbacks(serverId) {
    const db = this.options.Model;
    return {
      onSaveClient: async (info) => {
        await db('user_mcp_servers')
          .where({ id: serverId })
          .update({
            oauth_client_information_encrypted: encrypt(JSON.stringify(info)),
            updated_at: new Date().toISOString(),
          });
      },
      onSaveTokens: async (tokens) => {
        await db('user_mcp_servers')
          .where({ id: serverId })
          .update({
            oauth_tokens_encrypted: encrypt(JSON.stringify(tokens)),
            updated_at: new Date().toISOString(),
          });
      },
      onSavePending: async ({ state, codeVerifier }) => {
        const now = new Date().toISOString();
        await db('mcp_oauth_states').where('expires_at', '<', now).delete();
        await db('mcp_oauth_states')
          .insert({
            state,
            user_id: (await db('user_mcp_servers').where({ id: serverId }).first()).user_id,
            mcp_server_id: serverId,
            code_verifier: codeVerifier,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          })
          .onConflict('state')
          .merge();
      },
    };
  }

  /**
   * Dynamic client registration is only needed when nothing was registered or
   * connected before: a saved OAuth client id, a previously stored registration
   * result, or tokens (the SDK's refresh path) each start fine without it.
   */
  async _assertDynamicRegistrationAvailable(decrypted) {
    if (decrypted.oauth_client_id || decrypted.oauth_client_information) return;
    if (decrypted.oauth_tokens?.access_token) return;
    const availability = await mcpOAuthAvailability(decrypted.url).catch(() => null);
    if (!availability) return;
    if (availability.dcr_available) return;
    throw new BadRequest(
      'The authorization server does not advertise dynamic client registration. ' +
        'Pre-register a client id with the provider and paste it under OAuth client ID ' +
        'in Settings → Integrations (plus the client secret when one was issued).'
    );
  }

  async startOAuth(data, params) {
    const row = await this._ownedRow(data?.id, params.user?.id);
    const server = decryptMcpServerRow(row);
    await this._assertDynamicRegistrationAvailable(server);
    const provider = new McpOAuthProvider({
      server,
      redirectUrl: mcpOAuthRedirectUrl(),
      ...this._oauthCallbacks(row.id),
    });
    const result = await mcpAuth(provider, {
      serverUrl: server.url,
      scope: server.oauth_scope || undefined,
    });
    if (result === 'AUTHORIZED') return { ok: true, already_authorized: true, id: row.id };
    if (!provider.authorizationUrl)
      throw new BadRequest('Authorization server did not return a URL');
    return { authorization_url: provider.authorizationUrl, id: row.id };
  }

  /**
   * Availability of dynamic client registration for a saved server's or a
   * draft URL's authorization server, without registering or redirecting.
   * The Settings dialog probes it next to the OAuth fields; Connect keeps a
   * single flow but surfaces the same check as a friendly error first.
   */
  async describeOAuth(data, params) {
    let url;
    if (data?.id != null) {
      url = decryptMcpServerRow(await this._ownedRow(data.id, params.user?.id)).url;
      if (data.url != null) url = assertMcpUrl(data.url);
    } else {
      url = assertMcpUrl(data?.url);
    }
    try {
      const availability = await mcpOAuthAvailability(url);
      return { url, ...availability };
    } catch (err) {
      throw new BadRequest(`OAuth availability check failed: ${err?.message || 'unreachable'}`);
    }
  }

  async completeOAuth(data, params) {
    const state = String(data?.state || '');
    const code = String(data?.code || '');
    if (!state || !code) throw new BadRequest('code and state are required');
    const db = this.options.Model;
    const pending = await db('mcp_oauth_states').where({ state }).first();
    if (!pending) throw new BadRequest('OAuth state is invalid or expired');
    if (new Date(pending.expires_at).getTime() < Date.now()) {
      await db('mcp_oauth_states').where({ state }).delete();
      throw new BadRequest('OAuth state expired');
    }
    const userId = params?.user?.id;
    if (!userId || Number(userId) !== Number(pending.user_id)) {
      throw new Forbidden('MCP OAuth state does not belong to this user');
    }
    const row = await db('user_mcp_servers')
      .where({ id: pending.mcp_server_id, user_id: pending.user_id })
      .first();
    if (!row) throw new NotFound('MCP server not found');
    const server = decryptMcpServerRow(row);
    const provider = new McpOAuthProvider({
      server,
      redirectUrl: mcpOAuthRedirectUrl(),
      codeVerifier: pending.code_verifier,
      ...this._oauthCallbacks(row.id),
    });
    const result = await mcpAuth(provider, {
      serverUrl: server.url,
      authorizationCode: code,
      scope: server.oauth_scope || undefined,
    });
    await db('mcp_oauth_states').where({ state }).delete();
    if (result !== 'AUTHORIZED') throw new BadRequest('MCP OAuth did not complete');
    return { ok: true, id: row.id };
  }

  async disconnectOAuth(data, params) {
    const row = await this._ownedRow(data?.id, params.user?.id);
    await this.options
      .Model('user_mcp_servers')
      .where({ id: row.id })
      .update({ oauth_tokens_encrypted: null, updated_at: new Date().toISOString() });
    await this.options.Model('mcp_oauth_states').where({ mcp_server_id: row.id }).delete();
    return this.options.Model('user_mcp_servers').where({ id: row.id }).first();
  }

  /**
   * Refresh an expired OAuth access token. Returns the decrypted row.
   * Tokens are cleared only when the authorization server rejects the grant
   * or client. A redirect or a transient failure keeps the stored tokens.
   */
  async refreshOAuthIfNeeded(decrypted) {
    const tokens = decrypted?.oauth_tokens;
    if (!tokens?.refresh_token) return decrypted;
    if (tokens.access_token && !accessTokenExpired(tokens)) return decrypted;
    const row = await this.options.Model('user_mcp_servers').where({ id: decrypted.id }).first();
    if (!row) return decrypted;
    const server = decryptMcpServerRow(row);
    const provider = new McpOAuthProvider({
      server,
      redirectUrl: mcpOAuthRedirectUrl(),
      ...this._oauthCallbacks(row.id),
      refuseRedirect: true,
    });
    try {
      const result = await mcpAuth(provider, {
        serverUrl: server.url,
        scope: server.oauth_scope || undefined,
      });
      if (result !== 'AUTHORIZED') {
        logger.warn(
          { serverId: row.id, result },
          'MCP OAuth refresh did not authorize; keeping stored tokens'
        );
        return server;
      }
      const fresh = await this.options.Model('user_mcp_servers').where({ id: row.id }).first();
      return decryptMcpServerRow(fresh);
    } catch (err) {
      if (err instanceof InvalidGrantError || err instanceof InvalidClientError) {
        logger.warn(
          { err: err?.message, serverId: row.id },
          'MCP OAuth refresh rejected stored tokens'
        );
        await this._clearOAuthTokens(row.id);
        return { ...server, oauth_tokens: null };
      }
      logger.warn({ err: err?.message, serverId: row.id }, 'MCP OAuth refresh failed');
      return server;
    }
  }

  async _clearOAuthTokens(id) {
    await this.options
      .Model('user_mcp_servers')
      .where({ id })
      .update({ oauth_tokens_encrypted: null, updated_at: new Date().toISOString() });
  }
}

const mcpServerHooks = {
  before: {
    all: [requireUser],
    create: [validateMcpServerWrite, ensureUniqueName, encryptSecrets],
    patch: [validateMcpServerWrite, ensureUniqueName, encryptSecrets],
    completeOAuth: [disableExternal],
    refreshOAuthIfNeeded: [disableExternal],
  },
  after: {
    find: [presentResult],
    get: [presentResult],
    create: [presentResult],
    patch: [presentResult],
    remove: [presentResult],
    disconnectOAuth: [presentResult],
  },
};

export function registerMcpServersService(app, path = 'mcp-servers') {
  const options = {
    Model: app.get('db'),
    name: 'user_mcp_servers',
    id: 'id',
    paginate: DEFAULT_PAGINATE,
  };
  const service = new McpServersService(options);
  service.setup(app);
  app.use(path, service, {
    methods: [
      'find',
      'get',
      'create',
      'patch',
      'remove',
      'testConnectivity',
      'describeOAuth',
      'startOAuth',
      'completeOAuth',
      'disconnectOAuth',
      'refreshOAuthIfNeeded',
    ],
  });
  app.service(path).hooks(mcpServerHooks);
}
