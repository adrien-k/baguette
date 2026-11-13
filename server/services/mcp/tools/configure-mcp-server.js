import { z } from 'zod';
import { PUBLIC_HOST } from '../../../config.js';
import { ok, fail } from '../lib/result.js';

function mcpSettingsUrl() {
  const url = new URL('/settings', PUBLIC_HOST);
  url.searchParams.set('tab', 'integrations');
  return url.toString();
}

/**
 * Text the agent should relay when an outbound MCP server needs a browser login.
 * The user must open the authorization URL in the browser that is signed in to Baguette.
 */
function mcpOAuthUserGuidance({
  settingsUrl,
  authorizationUrl,
  alreadyAuthorized,
  transport,
  bearerConfigured,
  sessionEnabled,
}) {
  const piNote =
    transport === 'sse'
      ? ' Pi sessions skip SSE servers; Claude and Cursor still attach them.'
      : '';
  const nextTurn = sessionEnabled
    ? ' It is on for this session and attaches on the next agent turn, not this one.'
    : ' It is not turned on for this session. Enable it from the session Details tab, or call ConfigureMcpServer again.';
  if (alreadyAuthorized) {
    return `This MCP server is already connected with OAuth. Tell the user no browser step is needed.${nextTurn}${piNote}`;
  }
  if (authorizationUrl) {
    return (
      `Send the user this link and ask them to open it in the same browser where they are signed in to Baguette: ${authorizationUrl}. ` +
      'Do not ask them to paste a code. After they approve, Baguette stores the tokens and returns them to ' +
      `Settings → Integrations (${settingsUrl}).${nextTurn}${piNote}`
    );
  }
  if (bearerConfigured) {
    return `Saved with a bearer token.${nextTurn} To use OAuth instead, call ConfigureMcpServer with start_oauth true, or send the user to Settings → Integrations (${settingsUrl}) and press Connect.${piNote}`;
  }
  return `Saved. OAuth is not started. Call ConfigureMcpServer with start_oauth true, or send the user to Settings → Integrations (${settingsUrl}) and press Connect.${nextTurn}${piNote}`;
}

function publicServer(row) {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    url: row.url,
    description: row.description ?? null,
    auth_method: row.auth_method ?? 'none',
    enabled: row.enabled,
    oauth_connected: row.oauth_connected,
    oauth_scope: row.oauth_scope ?? null,
    bearer_token_configured: !!row.bearer_token_configured,
    oauth_client_id: row.oauth_client_id ?? null,
    oauth_client_secret_configured: !!row.oauth_client_secret_configured,
  };
}

function writePayload(args) {
  const data = {};
  if (args.transport != null) data.transport = args.transport;
  if (args.url != null) data.url = args.url;
  if (args.description !== undefined) data.description = args.description;
  if (args.auth_method !== undefined) data.auth_method = args.auth_method;
  if (args.enabled != null) data.enabled = args.enabled;
  if (args.bearer_token !== undefined) data.bearer_token = args.bearer_token;
  if (args.headers !== undefined) data.headers = args.headers;
  if (args.oauth_client_id !== undefined) data.oauth_client_id = args.oauth_client_id;
  if (args.oauth_client_secret !== undefined) data.oauth_client_secret = args.oauth_client_secret;
  if (args.oauth_scope !== undefined) data.oauth_scope = args.oauth_scope;
  return data;
}

export function createConfigureMcpServerTool(ctx) {
  const { app } = ctx;
  return {
    name: 'ConfigureMcpServer',
    description:
      'Add or update an outbound HTTP or SSE MCP server for the signed-in user. ' +
      'Bearer tokens, extra headers, and the OAuth client secret are stored encrypted. ' +
      'Set description to tell the agent when and why to use the server; it is shown in the session context. ' +
      'Pass description as null or an empty string to clear it. ' +
      'Omit secret fields on update to leave them unchanged. ' +
      'Pass start_oauth true to begin MCP OAuth. When the result includes authorization_url, ' +
      'send that URL to the user and tell them to open it in the same browser where they are signed in to Baguette. ' +
      'Do not ask them to paste a code. After they approve, Baguette finishes the flow and sends them to Settings → Integrations ' +
      '(also returned as settings_url). The server attaches on the next turn, not the current one. ' +
      'Pi skips SSE servers. The name baguette is reserved.',
    schema: {
      name: z
        .string()
        .describe(
          'Server name agents see as the tool namespace. Letters, numbers, underscores, and hyphens. Matches an existing server case-insensitively.'
        ),
      transport: z
        .enum(['http', 'sse'])
        .optional()
        .describe('http or sse. Required when creating. Defaults to http.'),
      url: z.string().optional().describe('http(s) MCP endpoint. Required when creating.'),
      description: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Optional guidance for agents: when and why this server should be used. Empty string or null clears it.'
        ),
      auth_method: z
        .enum(['none', 'bearer', 'oauth'])
        .optional()
        .describe(
          'How agents authenticate: none (public), bearer token, or oauth. Smart connect is used when the server supports dynamic client registration, otherwise paste oauth_client_id.'
        ),
      enabled: z
        .boolean()
        .optional()
        .describe('Settings default for new sessions. Defaults to true on create.'),
      bearer_token: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Optional bearer token. Pass an empty string to clear it. Omit to leave unchanged.'
        ),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Extra HTTP headers. Replaces the stored set. Do not include Authorization.'),
      oauth_client_id: z
        .string()
        .nullable()
        .optional()
        .describe('Optional pre-registered OAuth client id. Omit to use dynamic registration.'),
      oauth_client_secret: z
        .string()
        .nullable()
        .optional()
        .describe('Optional OAuth client secret. Omit to leave unchanged.'),
      oauth_scope: z.string().nullable().optional().describe('Optional OAuth scope string.'),
      start_oauth: z
        .boolean()
        .optional()
        .describe('When true, start MCP OAuth and return authorization_url for the user to open.'),
      enable_on_session: z
        .boolean()
        .optional()
        .describe(
          'When true (default), turn this server on for the current session. It attaches on the next turn.'
        ),
    },
    handler: async (args) => {
      const userId = ctx.userId ?? ctx.session?.user_id;
      if (!userId) return fail('Not authenticated');
      const name = String(args?.name ?? '').trim();
      if (!name) return fail('name is required');
      const params = { provider: 'mcp', user: { id: userId } };
      const service = app.service('mcp-servers');
      try {
        const existing = await app
          .get('db')('user_mcp_servers')
          .where({ user_id: userId })
          .whereRaw('LOWER(name) = ?', [name.toLowerCase()])
          .first();
        const payload = writePayload(args || {});
        let server;
        let created = false;
        if (!existing) {
          if (!payload.url) return fail('url is required to add an MCP server');
          server = await service.create(
            { name, transport: payload.transport || 'http', ...payload },
            params
          );
          created = true;
        } else {
          const patch = { ...payload };
          if (args?.name && args.name !== existing.name) patch.name = name;
          server =
            Object.keys(patch).length > 0
              ? await service.patch(existing.id, patch, params)
              : await service.get(existing.id, params);
        }

        const enableOnSession = args?.enable_on_session !== false;
        let sessionEnabled = false;
        if (enableOnSession && ctx.session?.id) {
          await app
            .service('sessions')
            .patch(
              ctx.session.id,
              { mcp_servers: { [server.id]: true } },
              { provider: undefined, user: { id: userId } }
            );
          sessionEnabled = true;
        }

        let authorizationUrl = null;
        let alreadyAuthorized = false;
        if (args?.start_oauth) {
          const oauth = await service.startOAuth({ id: server.id }, params);
          authorizationUrl = oauth.authorization_url || null;
          alreadyAuthorized = !!oauth.already_authorized;
          server = await service.get(server.id, params);
        }

        const settingsUrl = mcpSettingsUrl();
        return ok({
          server: publicServer(server),
          created,
          session_enabled: sessionEnabled,
          settings_url: settingsUrl,
          ...(authorizationUrl ? { authorization_url: authorizationUrl } : {}),
          ...(alreadyAuthorized ? { already_authorized: true } : {}),
          user_guidance: mcpOAuthUserGuidance({
            settingsUrl,
            authorizationUrl,
            alreadyAuthorized,
            transport: server.transport,
            bearerConfigured: !!server.bearer_token_configured,
            sessionEnabled,
          }),
        });
      } catch (err) {
        return fail(err?.message || 'Failed to configure MCP server');
      }
    },
  };
}
