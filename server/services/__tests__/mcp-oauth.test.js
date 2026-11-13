import http from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { McpOAuthProvider, MCP_OAUTH_FETCH_TIMEOUT_MS, publicMcpFetch } from '../mcp-oauth.js';

const SERVER_URL = 'https://mcp.example/mcp';
const REDIRECT_URL = 'https://app.example/auth/mcp/callback';

const authorizationServerMetadata = {
  issuer: 'https://mcp.example',
  authorization_endpoint: 'https://mcp.example/authorize',
  token_endpoint: 'https://mcp.example/token',
  registration_endpoint: 'https://mcp.example/register',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input?.url;
}

const stubFetch = vi.fn(async (input, init) => {
  const url = requestUrl(input);
  if (url === 'https://mcp.example/.well-known/oauth-authorization-server') {
    return jsonResponse(authorizationServerMetadata);
  }
  if (url === 'https://mcp.example/register' && init?.method === 'POST') {
    return jsonResponse(
      {
        client_id: 'client-1',
        client_id_issued_at: 1,
        redirect_uris: [REDIRECT_URL],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      201
    );
  }
  if (url?.includes('/.well-known/oauth-')) {
    return new Response(null, { status: 404 });
  }
  throw new Error(`Unexpected MCP OAuth fetch: ${url}`);
});

function makeProvider() {
  return new McpOAuthProvider({
    server: {
      id: 1,
      url: SERVER_URL,
      oauth_client_id: null,
      oauth_client_secret: null,
      oauth_client_information: null,
      oauth_tokens: null,
      oauth_scope: undefined,
    },
    redirectUrl: REDIRECT_URL,
    onSaveClient: vi.fn(),
    onSaveTokens: vi.fn(),
    onSavePending: vi.fn(),
  });
}

describe('publicMcpFetch deadline', () => {
  it('injects a deadline when the caller passes no signal', async () => {
    const server = http.createServer(() => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/mcp`;
      const started = Date.now();
      await expect(publicMcpFetch(url, { timeoutMs: 300 })).rejects.toThrow(
        'MCP OAuth request timed out'
      );
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('leaves a caller-provided signal untouched', async () => {
    const server = http.createServer(() => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/mcp`;
      const err = await publicMcpFetch(url, {
        signal: AbortSignal.timeout(150),
      }).catch((e) => e);
      expect(err?.name).toBe('TimeoutError');
      expect(err?.message).not.toBe('MCP OAuth request timed out');
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('uses the same ceiling as the MCP connectivity probe', () => {
    expect(MCP_OAUTH_FETCH_TIMEOUT_MS).toBe(15_000);
  });
});

describe('McpOAuthProvider with the real MCP SDK auth()', () => {
  it('puts a provider-generated state on the authorization URL and saves it with the PKCE verifier', async () => {
    const provider = makeProvider();

    const result = await auth(provider, { serverUrl: SERVER_URL, fetchFn: stubFetch });

    expect(result).toBe('REDIRECT');
    expect(provider.authorizationUrl).toBeTruthy();
    const state = new URL(provider.authorizationUrl).searchParams.get('state');
    expect(state).toBeTruthy();

    const codeVerifier = await provider.codeVerifier();
    expect(codeVerifier.length).toBeGreaterThan(0);
    expect(provider._onSavePending).toHaveBeenCalledWith({ state, codeVerifier });
    expect(provider._onSaveClient).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 'client-1' })
    );
  });

  it('returns a fresh UUID from state() on each call', async () => {
    const provider = makeProvider();
    const first = await provider.state();
    const second = await provider.state();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(first).not.toBe(second);
  });
});
