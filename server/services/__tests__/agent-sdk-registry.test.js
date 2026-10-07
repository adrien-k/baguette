import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { registerAgentSdksService } from '../feathers/agent-sdks.service.js';
import { registerMockAgentService } from '../feathers/mock-agent.service.ts';

vi.hoisted(() => {
  process.env.ENABLE_MOCK_AGENT = 'true';
});

vi.mock('@cursor/sdk', () => ({
  Agent: { create: vi.fn() },
  AgentBusyError: class AgentBusyError extends Error {},
}));
vi.mock('@cursor/sdk/sqlite', () => ({
  SqliteLocalAgentStore: class SqliteLocalAgentStore {},
}));
vi.mock('../baguette-mcp-server.js', () => ({
  buildBaguetteMcpServer: vi.fn(() => ({})),
  buildCursorCustomTools: vi.fn(async () => []),
}));

function makeApp() {
  const app = feathers();
  app.use('messages', { on: vi.fn(), create: vi.fn() }, { methods: ['create'] });
  registerAgentSdksService(app);
  return app;
}

describe('agent-sdks registry', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets each SDK service register its key and Feathers path', async () => {
    const app = makeApp();
    const stub = {
      async isEnabled() {
        return true;
      },
      async listModels() {
        return [];
      },
    };
    app.use('claude-agent', stub, { methods: ['isEnabled', 'listModels'] });
    app.use('cursor-agent', stub, { methods: ['isEnabled', 'listModels'] });
    await app.service('agent-sdks').register({
      key: 'claude',
      label: 'Claude',
      service_path: 'claude-agent',
    });
    await app.service('agent-sdks').register({
      key: 'cursor',
      label: 'Cursor',
      service_path: 'cursor-agent',
    });
    registerMockAgentService(app);

    const registry = app.service('agent-sdks');
    expect(
      registry
        .getMetas()
        .map((m) => m.key)
        .sort()
    ).toEqual(['claude', 'cursor', 'mock']);
    expect(registry.servicePathFor('claude')).toBe('claude-agent');
    expect(registry.servicePathFor('cursor')).toBe('cursor-agent');
    expect(registry.servicePathFor('mock')).toBe('mock-agent');
    expect(registry.getMeta('mock')?.label).toBe('Mock');
  });

  it('lists models via the registered SDK service', async () => {
    const app = makeApp();
    app.use(
      'claude-agent',
      {
        async isEnabled({ user }) {
          return Boolean(user?.anthropic_api_key);
        },
        async listModels() {
          return [{ id: 'sonnet', display_name: 'Sonnet' }];
        },
      },
      { methods: ['isEnabled', 'listModels'] }
    );
    await app.service('agent-sdks').register({
      key: 'claude',
      label: 'Claude',
      service_path: 'claude-agent',
    });

    const models = await app.service('agent-sdks').listModelsForSdk('claude', {
      user: { id: 1, anthropic_api_key: 'sk-test' },
      repo: { id: 1 },
    });
    expect(models).toEqual([{ id: 'sonnet', display_name: 'Sonnet' }]);
  });

  it('lists only registered SDKs whose service is enabled', async () => {
    const app = makeApp();
    app.use(
      'claude-agent',
      {
        async isEnabled({ user }) {
          return Boolean(user?.anthropic_api_key);
        },
        async listModels() {
          return [];
        },
      },
      { methods: ['isEnabled', 'listModels'] }
    );
    app.use(
      'cursor-agent',
      {
        async isEnabled({ user }) {
          return Boolean(user?.cursor_api_key);
        },
        async listModels() {
          return [];
        },
      },
      { methods: ['isEnabled', 'listModels'] }
    );
    app.service('agent-sdks').register({
      key: 'claude',
      label: 'Claude',
      service_path: 'claude-agent',
    });
    app.service('agent-sdks').register({
      key: 'cursor',
      label: 'Cursor',
      service_path: 'cursor-agent',
    });

    const ctx = { user: { id: 1, anthropic_api_key: 'sk-test' }, repo: { id: 1 } };
    const registry = app.service('agent-sdks');
    expect(await registry.isEnabled('claude', ctx)).toBe(true);
    expect(await registry.isEnabled('cursor', ctx)).toBe(false);
    await expect(registry.isEnabled('unknown', ctx)).rejects.toThrow(/Unknown agent SDK/);
    const enabled = await registry.listEnabled(ctx);
    expect(enabled).toEqual([{ key: 'claude', label: 'Claude' }]);
  });

  it('rejects duplicate register calls', () => {
    const app = makeApp();
    app.service('agent-sdks').register({
      key: 'claude',
      label: 'Claude',
      service_path: 'claude-agent',
    });
    expect(() =>
      app.service('agent-sdks').register({
        key: 'claude',
        label: 'Claude',
        service_path: 'claude-agent',
      })
    ).toThrow(/Duplicate agent SDK key/);
  });
});
