import { describe, it, expect, beforeEach, vi } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb, insertTestSession } from '../../../../test-utils/db.js';
import { registerMcpServersService } from '../../../feathers/mcp-servers.service.js';
import { registerSessionsService } from '../../../feathers/sessions.service.js';
import { decryptMcpServerRow } from '../../../mcp-server-config.js';
import { createConfigureMcpServerTool } from '../configure-mcp-server.js';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: authMock,
}));

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

const db = createTestDb();

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

function makeApp() {
  const app = feathers();
  app.set('db', db);
  app.use('users', {
    async get(id) {
      return db('users').where({ id }).first();
    },
  });
  registerMcpServersService(app);
  registerSessionsService(app);
  return app;
}

let app;
let userId;
let sessionId;
let tool;

beforeEach(async () => {
  authMock.mockReset();
  await db('users').insert({ github_id: 1, username: 'alice', status: 'approved' });
  userId = (await db('users').where({ username: 'alice' }).first()).id;
  const [repoId] = await db('repos').insert({ full_name: 'acme/app', repo_path: '/tmp/app' });
  sessionId = await insertTestSession(db, {
    user_id: userId,
    repo_id: repoId,
    repo_full_name: 'acme/app',
    short_id: 'mcp1',
    initial_prompt: 'connect a server',
    base_branch: 'main',
  });
  app = makeApp();
  await app.setup();
  tool = createConfigureMcpServerTool({
    app,
    session: { id: sessionId, user_id: userId },
    userId,
  });
});

describe('ConfigureMcpServer', () => {
  it('stores a bearer token encrypted and enables it on this session', async () => {
    const result = parseResult(
      await tool.handler({
        name: 'docs',
        url: 'https://mcp.example/mcp',
        bearer_token: 'super-secret-token-value',
        headers: { 'X-Team': 'platform' },
      })
    );
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.session_enabled).toBe(true);
    expect(result.server.bearer_token_configured).toBe(true);
    expect(result.server.url).toBe('https://mcp.example/mcp');
    expect(JSON.stringify(result)).not.toContain('super-secret-token-value');
    expect(result.user_guidance).toContain('Settings → Integrations');
    expect(result.settings_url).toContain('/settings?tab=integrations');

    const stored = decryptMcpServerRow(
      await db('user_mcp_servers').where({ id: result.server.id }).first()
    );
    expect(stored.bearer_token).toBe('super-secret-token-value');
    expect(stored.headers).toEqual({ 'X-Team': 'platform' });

    const session = await db('sessions').where({ id: sessionId }).first();
    expect(JSON.parse(session.mcp_servers)[String(result.server.id)]).toBe(true);
  });

  it('persists the auth method through the tool', async () => {
    const result = parseResult(
      await tool.handler({
        name: 'smart',
        url: 'https://mcp.example/smart',
        auth_method: 'oauth',
      })
    );
    expect(result.ok).toBe(true);
    expect(result.server.auth_method).toBe('oauth');

    const updated = parseResult(await tool.handler({ name: 'smart', auth_method: 'bearer' }));
    expect(updated.server.auth_method).toBe('bearer');
  });

  it('sets and clears the agent-facing description through the tool', async () => {
    const result = parseResult(
      await tool.handler({
        name: 'docs',
        url: 'https://mcp.example/mcp',
        description: '  Look up API shapes before writing SQL. ',
      })
    );
    expect(result.ok).toBe(true);
    expect(result.server.description).toBe('Look up API shapes before writing SQL.');

    const updated = parseResult(
      await tool.handler({ name: 'docs', description: 'Prefer this over manual SQL.' })
    );
    expect(updated.server.description).toBe('Prefer this over manual SQL.');

    const cleared = parseResult(await tool.handler({ name: 'docs', description: null }));
    expect(cleared.server.description).toBeNull();
    const row = await db('user_mcp_servers').where({ id: cleared.server.id }).first();
    expect(row.description).toBeNull();
  });

  it('updates an existing server without clearing the bearer token', async () => {
    await tool.handler({
      name: 'docs',
      url: 'https://mcp.example/mcp',
      bearer_token: 'super-secret-token-value',
    });
    const result = parseResult(
      await tool.handler({
        name: 'docs',
        url: 'https://mcp.example/v2',
        enable_on_session: false,
      })
    );
    expect(result.created).toBe(false);
    expect(result.session_enabled).toBe(false);
    expect(result.server.url).toBe('https://mcp.example/v2');
    expect(result.server.bearer_token_configured).toBe(true);
    const stored = decryptMcpServerRow(
      await db('user_mcp_servers').where({ id: result.server.id }).first()
    );
    expect(stored.bearer_token).toBe('super-secret-token-value');
  });

  it('returns the OAuth URL and tells the agent where to send the user', async () => {
    authMock.mockImplementation(async (provider) => {
      await provider.saveCodeVerifier('verifier-1');
      await provider.redirectToAuthorization(
        new URL('https://auth.example/authorize?state=state-1')
      );
      return 'REDIRECT';
    });
    const result = parseResult(
      await tool.handler({
        name: 'docs',
        transport: 'sse',
        url: 'https://mcp.example/sse',
        start_oauth: true,
      })
    );
    expect(result.authorization_url).toContain('https://auth.example/authorize');
    expect(result.authorization_url).toContain('state=state-1');
    expect(result.user_guidance).toContain(result.authorization_url);
    expect(result.user_guidance).toContain('same browser');
    expect(result.user_guidance).toContain('Settings → Integrations');
    expect(result.user_guidance).toContain('Do not ask them to paste a code');
    expect(result.user_guidance).toContain('Pi sessions skip SSE');
    expect(result.settings_url).toContain('tab=integrations');
  });

  it('says no browser step is needed when OAuth is already connected', async () => {
    authMock.mockResolvedValue('AUTHORIZED');
    const created = parseResult(
      await tool.handler({ name: 'docs', url: 'https://mcp.example/mcp' })
    );
    const result = parseResult(
      await tool.handler({ name: 'docs', start_oauth: true, enable_on_session: false })
    );
    expect(created.server.id).toBe(result.server.id);
    expect(result.already_authorized).toBe(true);
    expect(result.authorization_url).toBeUndefined();
    expect(result.user_guidance).toContain('no browser step');
  });

  it('rejects the reserved baguette name', async () => {
    const result = parseResult(
      await tool.handler({ name: 'baguette', url: 'https://mcp.example/mcp' })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reserved/);
  });
});
