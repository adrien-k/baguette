import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerAgentConfigsService } from '../feathers/agent-configs.service.js';
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

const db = createTestDb();

function makeApp() {
  const app = feathers();
  app.set('db', db);
  app.use('messages', { on: vi.fn(), create: vi.fn() }, { methods: ['create'] });
  registerAgentConfigsService(app);
  return app;
}

describe('agent-configs SDK registry', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_MOCK_AGENT', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets each SDK service register its key and Feathers path', async () => {
    const app = makeApp();
    app.use('claude-agent', { async get() {} }, { methods: ['get'] });
    app.use('cursor-agent', { async get() {} }, { methods: ['get'] });
    app.service('agent-configs').registerSdk({
      key: 'claude',
      label: 'Claude',
      service_path: 'claude-agent',
    });
    app.service('agent-configs').registerSdk({
      key: 'cursor',
      label: 'Cursor',
      service_path: 'cursor-agent',
    });
    registerMockAgentService(app);

    const configs = app.service('agent-configs');
    expect(
      configs
        .getSdkMetas()
        .map((m) => m.key)
        .sort()
    ).toEqual(['claude', 'cursor', 'mock']);
    expect(configs.servicePathForSdk('claude')).toBe('claude-agent');
    expect(configs.servicePathForSdk('cursor')).toBe('cursor-agent');
    expect(configs.servicePathForSdk('mock')).toBe('mock-agent');
    expect(configs.getSdkMeta('mock')?.label).toBe('Mock');
  });

  it('rejects duplicate register calls', () => {
    const app = makeApp();
    app.service('agent-configs').registerSdk({
      key: 'claude',
      label: 'Claude',
      service_path: 'claude-agent',
    });
    expect(() =>
      app.service('agent-configs').registerSdk({
        key: 'claude',
        label: 'Claude',
        service_path: 'claude-agent',
      })
    ).toThrow(/Duplicate agent SDK key/);
  });
});
