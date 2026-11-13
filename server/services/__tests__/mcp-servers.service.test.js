import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerMcpServersService } from '../feathers/mcp-servers.service.js';
import { requirePublicService } from '../feathers/public-services.js';
import { decryptMcpServerRow } from '../mcp-server-config.js';
import { encrypt } from '../../lib/encrypt.js';

vi.mock('../mcp-connectivity.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    probeMcpServer: vi.fn(async () => ({ ok: true, needs_auth: false, tools: ['echo'] })),
  };
});

const { authMock, discoveryMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  discoveryMock: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/auth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    auth: authMock,
    discoverOAuthServerInfo: discoveryMock,
  };
});

const db = createTestDb();
const params = (user) => ({ provider: 'rest', user });

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerMcpServersService(app);
  return app;
}

let app;
let alice;
let bob;

beforeEach(async () => {
  authMock.mockReset();
  await db('users').insert([
    { github_id: 1, username: 'alice', status: 'approved' },
    { github_id: 2, username: 'bob', status: 'approved' },
  ]);
  alice = await db('users').where({ username: 'alice' }).first();
  bob = await db('users').where({ username: 'bob' }).first();
  app = makeApp();
  await app.setup();
});

function serverPayload(overrides = {}) {
  return {
    name: 'docs',
    transport: 'http',
    url: 'https://mcp.example/mcp',
    bearer_token: 'secret-token',
    headers: { 'X-Team': 'platform' },
    ...overrides,
  };
}

describe('mcp-servers', () => {
  it('is reachable from the browser client', () => {
    const context = { path: 'mcp-servers', params: { provider: 'rest' }, method: 'find' };
    expect(requirePublicService(context)).toBe(context);
  });

  it('stores secrets encrypted and masks them for the owner', async () => {
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    expect(created.bearer_token).not.toBe('secret-token');
    expect(created.bearer_token_configured).toBe(true);
    expect(created.headers['X-Team']).not.toBe('platform');
    expect(created.enabled).toBe(true);
    expect(created.oauth_connected).toBe(false);

    const row = await db('user_mcp_servers').where({ id: created.id }).first();
    expect(row.bearer_token_encrypted).not.toContain('secret-token');
    expect(decryptMcpServerRow(row).bearer_token).toBe('secret-token');
    expect(decryptMcpServerRow(row).headers).toEqual({ 'X-Team': 'platform' });

    const listed = await app.service('mcp-servers').find(params(alice));
    expect(listed.data.map((row) => row.id)).toEqual([created.id]);
    await expect(app.service('mcp-servers').get(created.id, params(bob))).rejects.toMatchObject({
      name: 'NotFound',
    });
  });

  it('rejects reserved names, bad URLs, and duplicate names', async () => {
    await expect(
      app.service('mcp-servers').create(serverPayload({ name: 'baguette' }), params(alice))
    ).rejects.toMatchObject({ name: 'BadRequest' });
    await expect(
      app.service('mcp-servers').create(serverPayload({ url: 'file:///tmp/mcp' }), params(alice))
    ).rejects.toMatchObject({ name: 'BadRequest' });
    await app.service('mcp-servers').create(serverPayload(), params(alice));
    await expect(
      app.service('mcp-servers').create(serverPayload({ name: 'Docs' }), params(alice))
    ).rejects.toMatchObject({ name: 'BadRequest' });
  });

  it('persists and validates the auth-method picker choice', async () => {
    const oauth = await app
      .service('mcp-servers')
      .create(serverPayload({ name: 'smart', auth_method: 'oauth' }), params(alice));
    expect(oauth.auth_method).toBe('oauth');

    const bearer = await app
      .service('mcp-servers')
      .create(serverPayload({ name: 'tok', auth_method: 'bearer' }), params(alice));
    expect(bearer.auth_method).toBe('bearer');
    expect(bearer.description).toBeNull();

    // Legacy rows (no auth_method stored) present as 'none' for the client.
    const legacy = await app.service('mcp-servers').create(serverPayload(), params(alice));
    expect(legacy.auth_method).toBe('none');

    await expect(
      app
        .service('mcp-servers')
        .create(serverPayload({ name: 'bad', auth_method: 'magic' }), params(alice))
    ).rejects.toMatchObject({ name: 'BadRequest' });

    const patched = await app
      .service('mcp-servers')
      .patch(oauth.id, { auth_method: 'none' }, params(alice));
    expect(patched.auth_method).toBe('none');
    const row = await db('user_mcp_servers').where({ id: oauth.id }).first();
    expect(row.auth_method).toBe('none');
  });

  it('stores, updates, and clears the agent-facing description', async () => {
    const created = await app.service('mcp-servers').create(
      serverPayload({
        description: '  Use fabricate for test data. ' + 'x'.repeat(1900),
      }),
      params(alice)
    );
    expect(created.description).toBe(`Use fabricate for test data. ${'x'.repeat(1900)}`);

    await expect(
      app.service('mcp-servers').create(serverPayload({ description: 42 }), params(alice))
    ).rejects.toMatchObject({ name: 'BadRequest' });
    await expect(
      app
        .service('mcp-servers')
        .create(serverPayload({ description: 'a'.repeat(2001) }), params(alice))
    ).rejects.toMatchObject({ name: 'BadRequest' });
    const whitespace = await app
      .service('mcp-servers')
      .create(serverPayload({ name: 'blank', description: '   ' }), params(alice));
    expect(whitespace.description).toBeNull();

    const patched = await app
      .service('mcp-servers')
      .patch(
        created.id,
        { description: 'Prefer fabricate fixtures over manual SQL.' },
        params(alice)
      );
    expect(patched.description).toBe('Prefer fabricate fixtures over manual SQL.');
    const cleared = await app
      .service('mcp-servers')
      .patch(created.id, { description: null }, params(alice));
    expect(cleared.description).toBeNull();
    const row = await db('user_mcp_servers').where({ id: created.id }).first();
    expect(row.description).toBeNull();
  });

  it('tests unsaved edits even when an expired OAuth token is refreshed', async () => {
    const { probeMcpServer } = await import('../mcp-connectivity.js');
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    await seedExpiredOAuth(created.id);
    authMock.mockImplementation(async (provider) => {
      await provider.saveTokens({
        access_token: 'fresh-access',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });
      return 'AUTHORIZED';
    });

    const result = await app.service('mcp-servers').testConnectivity(
      {
        id: created.id,
        url: 'https://edited.example/mcp',
        transport: 'sse',
        bearer_token: 'edited-bearer',
        headers: { 'X-Team': 'edited' },
      },
      params(alice)
    );

    expect(result.base_url).toBe('https://edited.example/mcp');
    expect(probeMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'sse',
        url: 'https://edited.example/mcp',
        headers: expect.objectContaining({
          Authorization: 'Bearer fresh-access',
          'X-Team': 'edited',
        }),
      })
    );
  });

  it('tests a saved server with the stored bearer token', async () => {
    const { probeMcpServer } = await import('../mcp-connectivity.js');
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    const result = await app
      .service('mcp-servers')
      .testConnectivity({ id: created.id }, params(alice));
    expect(result.ok).toBe(true);
    expect(result.tools).toEqual(['echo']);
    expect(probeMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: 'http',
        url: 'https://mcp.example/mcp',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'X-Team': 'platform',
        }),
      })
    );
  });

  it('starts OAuth, completes the callback, and disconnects', async () => {
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    authMock.mockImplementation(async (provider) => {
      await provider.saveCodeVerifier('verifier-1');
      await provider.redirectToAuthorization(
        new URL('https://auth.example/authorize?state=state-1')
      );
      return 'REDIRECT';
    });
    const started = await app.service('mcp-servers').startOAuth({ id: created.id }, params(alice));
    expect(started.authorization_url).toContain('state=state-1');
    const pending = await db('mcp_oauth_states').where({ state: 'state-1' }).first();
    expect(pending.code_verifier).toBe('verifier-1');
    expect(pending.user_id).toBe(alice.id);

    authMock.mockImplementation(async (provider, opts) => {
      expect(opts.authorizationCode).toBe('code-1');
      expect(await provider.codeVerifier()).toBe('verifier-1');
      await provider.saveTokens({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });
      return 'AUTHORIZED';
    });
    await expect(
      app.service('mcp-servers').completeOAuth({ code: 'code-1', state: 'state-1' }, { user: bob })
    ).rejects.toMatchObject({ name: 'Forbidden' });
    expect(await db('mcp_oauth_states').where({ state: 'state-1' }).first()).toBeTruthy();

    const completed = await app
      .service('mcp-servers')
      .completeOAuth({ code: 'code-1', state: 'state-1' }, { user: alice });
    expect(completed).toEqual({ ok: true, id: created.id });
    expect(await db('mcp_oauth_states').where({ state: 'state-1' }).first()).toBeUndefined();

    const external = await app.service('mcp-servers').get(created.id, params(alice));
    expect(external.oauth_connected).toBe(true);
    const stored = await db('user_mcp_servers').where({ id: created.id }).first();
    expect(stored.oauth_tokens_encrypted).not.toContain('access-token');
    expect(decryptMcpServerRow(stored).oauth_tokens.access_token).toBe('access-token');

    const disconnected = await app
      .service('mcp-servers')
      .disconnectOAuth({ id: created.id }, params(alice));
    expect(disconnected.oauth_connected).toBe(false);
  });

  function oauthMetadata(overrides = {}) {
    if (overrides === null) return undefined;
    return {
      authorization_endpoint: 'https://auth.example/authorize',
      registration_endpoint: 'https://auth.example/register',
      ...overrides,
    };
  }

  async function seedExpiredOAuth(id) {
    const tokens = {
      access_token: 'expired-access',
      refresh_token: 'refresh-token',
      expires_in: 60,
      obtained_at: Date.now() - 10 * 60 * 1000,
      token_type: 'Bearer',
    };
    await db('user_mcp_servers')
      .where({ id })
      .update({ oauth_tokens_encrypted: encrypt(JSON.stringify(tokens)) });
    return decryptMcpServerRow(await db('user_mcp_servers').where({ id }).first());
  }

  it('describeOAuth reports dynamic registration for saved servers and drafts', async () => {
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    discoveryMock.mockResolvedValue({
      authorizationServerUrl: 'https://auth.example/',
      authorizationServerMetadata: oauthMetadata(),
      resourceMetadata: undefined,
    });
    const saved = await app.service('mcp-servers').describeOAuth({ id: created.id }, params(alice));
    expect(saved.dcr_available).toBe(true);
    expect(saved.registration_endpoint).toBe('https://auth.example/register');
    expect(saved.authorization_server_url).toBe('https://auth.example/');

    const draft = await app
      .service('mcp-servers')
      .describeOAuth({ url: 'https://mcp.example/draft' }, params(alice));
    expect(draft.dcr_available).toBe(true);
    await expect(
      app.service('mcp-servers').describeOAuth({ id: created.id }, params(bob))
    ).rejects.toMatchObject({ name: 'NotFound' });
    await expect(
      app
        .service('mcp-servers')
        .describeOAuth({ id: created.id, url: 'file:///tmp' }, params(alice))
    ).rejects.toMatchObject({ name: 'BadRequest' });
  });

  it('describeOAuth reports no registration for servers without OAuth metadata', async () => {
    discoveryMock.mockResolvedValue({
      authorizationServerUrl: 'https://mcp.example/',
      authorizationServerMetadata: undefined,
      resourceMetadata: undefined,
    });
    const result = await app
      .service('mcp-servers')
      .describeOAuth({ url: 'https://mcp.example/bare' }, params(alice));
    expect(result.dcr_available).toBe(false);
    expect(result.registration_endpoint).toBeNull();
  });

  it('startOAuth explains missing dynamic registration before calling the SDK', async () => {
    discoveryMock.mockResolvedValue({
      authorizationServerUrl: 'https://auth.example/',
      authorizationServerMetadata: oauthMetadata({ registration_endpoint: undefined }),
      resourceMetadata: undefined,
    });
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    await expect(
      app.service('mcp-servers').startOAuth({ id: created.id }, params(alice))
    ).rejects.toThrow('does not advertise dynamic client registration');
    expect(authMock).not.toHaveBeenCalled();
  });

  it('startOAuth skips the registration check when a client id or tokens exist', async () => {
    discoveryMock.mockResolvedValue({
      authorizationServerUrl: 'https://auth.example/',
      authorizationServerMetadata: oauthMetadata({ registration_endpoint: undefined }),
      resourceMetadata: undefined,
    });
    authMock.mockImplementation(async (provider) => {
      await provider.saveCodeVerifier('verifier-1');
      await provider.redirectToAuthorization(
        new URL('https://auth.example/authorize?state=state-dcr-skip')
      );
      return 'REDIRECT';
    });
    const preregistered = await app
      .service('mcp-servers')
      .create(serverPayload({ name: 'prereg', oauth_client_id: 'cid' }), params(alice));
    const started = await app
      .service('mcp-servers')
      .startOAuth({ id: preregistered.id }, params(alice));
    expect(started.authorization_url).toContain('state=state-dcr-skip');

    const connected = await app
      .service('mcp-servers')
      .create(serverPayload({ name: 'connected' }), params(alice));
    await seedExpiredOAuth(connected.id);
    const resumed = await app
      .service('mcp-servers')
      .startOAuth({ id: connected.id }, params(alice));
    expect(resumed.authorization_url).toContain('state=state-dcr-skip');
  });

  it('keeps OAuth tokens when a refresh would start a new login', async () => {
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    const decrypted = await seedExpiredOAuth(created.id);
    authMock.mockImplementation(async (provider) => {
      await provider.saveCodeVerifier('verifier-refresh');
      await provider.redirectToAuthorization(
        new URL('https://auth.example/authorize?state=orphan-state')
      );
      return 'REDIRECT';
    });

    const refreshed = await app.service('mcp-servers').refreshOAuthIfNeeded(decrypted);
    expect(refreshed.oauth_tokens.access_token).toBe('expired-access');
    expect(refreshed.oauth_tokens.refresh_token).toBe('refresh-token');
    const stored = decryptMcpServerRow(
      await db('user_mcp_servers').where({ id: created.id }).first()
    );
    expect(stored.oauth_tokens.access_token).toBe('expired-access');
    expect(await db('mcp_oauth_states').where({ state: 'orphan-state' }).first()).toBeUndefined();
  });

  it('keeps OAuth tokens when refresh fails transiently', async () => {
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    const decrypted = await seedExpiredOAuth(created.id);
    authMock.mockRejectedValue(new Error('network down'));

    const refreshed = await app.service('mcp-servers').refreshOAuthIfNeeded(decrypted);
    expect(refreshed.oauth_tokens.refresh_token).toBe('refresh-token');
    const stored = decryptMcpServerRow(
      await db('user_mcp_servers').where({ id: created.id }).first()
    );
    expect(stored.oauth_tokens.access_token).toBe('expired-access');
  });

  it('clears OAuth tokens when the authorization server rejects the grant', async () => {
    const { InvalidGrantError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js');
    const created = await app.service('mcp-servers').create(serverPayload(), params(alice));
    const decrypted = await seedExpiredOAuth(created.id);
    authMock.mockRejectedValue(new InvalidGrantError('revoked'));

    const refreshed = await app.service('mcp-servers').refreshOAuthIfNeeded(decrypted);
    expect(refreshed.oauth_tokens).toBeNull();
    const stored = await db('user_mcp_servers').where({ id: created.id }).first();
    expect(stored.oauth_tokens_encrypted).toBeNull();
  });
});
