import { PUBLIC_HOST } from '../config.js';

export function mcpOAuthRedirectUrl() {
  return new URL('/auth/mcp/callback', PUBLIC_HOST).toString();
}

function toSdkTokens(stored) {
  if (!stored?.access_token && !stored?.refresh_token) return undefined;
  const tokens = {
    access_token: stored.access_token,
    token_type: stored.token_type || 'Bearer',
  };
  if (stored.refresh_token) tokens.refresh_token = stored.refresh_token;
  if (stored.expires_in != null) tokens.expires_in = stored.expires_in;
  if (stored.scope) tokens.scope = stored.scope;
  return tokens;
}

/**
 * OAuth client provider for `@modelcontextprotocol/sdk` `auth()`.
 * Persistence is delegated so the Feathers service owns the DB writes.
 */
export class McpOAuthProvider {
  constructor({
    server,
    redirectUrl,
    codeVerifier,
    onSaveClient,
    onSaveTokens,
    onSavePending,
    refuseRedirect = false,
  }) {
    this.server = server;
    this._redirectUrl = redirectUrl;
    this._verifier = codeVerifier || null;
    this._onSaveClient = onSaveClient;
    this._onSaveTokens = onSaveTokens;
    this._onSavePending = onSavePending;
    this._refuseRedirect = refuseRedirect;
    this.authorizationUrl = null;
  }

  get redirectUrl() {
    return this._redirectUrl;
  }

  /**
   * MCP SDK 1.32+ takes the OAuth `state` from an optional provider.state()
   * method (auth.js: `provider.state ? await provider.state() : undefined`).
   * Older SDK versions generated it internally, so our redirectToAuthorization
   * guard started failing once the SDK was upgraded past 1.31. Matches the old
   * behavior: a random UUID, persisted with the PKCE verifier by
   * redirectToAuthorization via onSavePending.
   */
  async state() {
    return crypto.randomUUID();
  }

  get clientMetadata() {
    const metadata = {
      client_name: 'Baguette',
      redirect_uris: [this._redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.server.oauth_client_secret ? 'client_secret_post' : 'none',
    };
    if (this.server.oauth_scope) metadata.scope = this.server.oauth_scope;
    return metadata;
  }

  async clientInformation() {
    if (this.server.oauth_client_id) {
      const info = { client_id: this.server.oauth_client_id };
      if (this.server.oauth_client_secret) info.client_secret = this.server.oauth_client_secret;
      return info;
    }
    return this.server.oauth_client_information || undefined;
  }

  async saveClientInformation(info) {
    await this._onSaveClient?.(info);
    this.server.oauth_client_information = info;
  }

  async tokens() {
    return toSdkTokens(this.server.oauth_tokens);
  }

  async saveTokens(tokens) {
    const stored = { ...tokens, obtained_at: Date.now() };
    await this._onSaveTokens?.(stored);
    this.server.oauth_tokens = stored;
  }

  async saveCodeVerifier(verifier) {
    this._verifier = verifier;
  }

  async codeVerifier() {
    if (!this._verifier) throw new Error('Missing PKCE code verifier');
    return this._verifier;
  }

  async redirectToAuthorization(authorizationUrl) {
    if (this._refuseRedirect) {
      throw new Error('MCP OAuth refresh cannot start a new login');
    }
    const url =
      authorizationUrl instanceof URL ? authorizationUrl : new URL(String(authorizationUrl));
    const state = url.searchParams.get('state');
    if (!state || !this._verifier) {
      throw new Error('MCP OAuth did not return a state and code verifier');
    }
    await this._onSavePending?.({ state, codeVerifier: this._verifier });
    this.authorizationUrl = url.toString();
  }
}

/** Same ceiling as the MCP connectivity probe; token exchanges finish well under it. */
export const MCP_OAUTH_FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch wrapper every outbound OAuth HTTP call rides (metadata discovery, DCR,
 * token exchange, refresh). Without a deadline an authorization server that
 * accepts TCP but never answers stalls the caller for undici's default
 * headersTimeout (~5 minutes) — including `refreshOAuthIfNeeded`, which runs
 * inside the turn-start server refresh, so the timeout also keeps one hung
 * identity provider from stalling the next token.
 */
export async function publicMcpFetch(input, init) {
  const { timeoutMs, signal: callerSignal, ...rest } = init ?? {};
  if (callerSignal) {
    // A caller-provided signal owns cancellation end to end.
    return fetch(input, init);
  }
  const signal = AbortSignal.timeout(timeoutMs ?? MCP_OAUTH_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...rest, signal });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error('MCP OAuth request timed out');
    }
    throw err;
  }
}

/**
 * Discovery-only pass that mirrors the SDK `auth()` flow (RFC 9728 protected-resource
 * metadata, then authorization-server metadata) without registering a client or
 * starting an authorization. Reports whether the authorization server supports
 * dynamic client registration (a `registration_endpoint` in its metadata).
 *
 * Missing authorization-server metadata is a normal "no OAuth server here" answer
 * (the SDK treats it the same before failing deeper), so it resolves to
 * `dcr_available: false`. Unreachable hosts and HTTP 5xx responses throw.
 */
export async function mcpOAuthAvailability(serverUrl) {
  const { discoverOAuthServerInfo } = await import('@modelcontextprotocol/sdk/client/auth.js');
  if (typeof discoverOAuthServerInfo !== 'function') {
    throw new Error('MCP SDK OAuth discovery is unavailable');
  }
  const { authorizationServerUrl, authorizationServerMetadata } = await discoverOAuthServerInfo(
    serverUrl,
    { fetchFn: publicMcpFetch }
  );
  return {
    authorization_server_url: authorizationServerUrl ?? null,
    authorization_endpoint: authorizationServerMetadata?.authorization_endpoint ?? null,
    registration_endpoint: authorizationServerMetadata?.registration_endpoint ?? null,
    dcr_available: Boolean(authorizationServerMetadata?.registration_endpoint),
  };
}

export async function mcpAuth(provider, options) {
  const { auth } = await import('@modelcontextprotocol/sdk/client/auth.js');
  if (typeof auth !== 'function') throw new Error('MCP SDK auth() is unavailable');
  return auth(provider, { ...options, fetchFn: publicMcpFetch });
}
