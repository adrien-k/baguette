import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerAgentConfigsService } from '../feathers/agent-configs.service.js';
import { registerMockAgentService } from '../../agent-sdks/mock/agent-service.ts';
import { registerSdkPlugin } from '../../agent-sdks/registry.js';
import { claudeAgentSdkPlugin } from '../../agent-sdks/claude/index.js';
import { cursorAgentSdkPlugin } from '../../agent-sdks/cursor/index.js';

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
    expect((await configs.getSdkMetas()).map((m) => m.key).sort()).toEqual([
      'claude',
      'cursor',
      'mock',
    ]);
    expect(configs.servicePathForSdk('claude')).toBe('claude-agent');
    expect(configs.servicePathForSdk('cursor')).toBe('cursor-agent');
    expect(configs.servicePathForSdk('mock')).toBe('mock-agent');
    expect(configs.getSdkMeta('mock')?.label).toBe('Mock');
  });

  it('getSdkMetas defaults capability fields when the plugin omits them', () => {
    const app = makeApp();
    app.service('agent-configs').registerSdk({
      key: 'future',
      label: 'Future',
      service_path: 'future-agent',
    });
    const meta = app.service('agent-configs').getSdkMeta('future');
    expect(meta).toMatchObject({
      key: 'future',
      label: 'Future',
      servicePath: 'future-agent',
      service_path: 'future-agent',
      supportsModelParams: false,
      requiresModelParamsOnTurn: false,
      usesAgentPricingTable: false,
      appliesUserModelPrefs: false,
      storedSessionIdColumn: null,
      requiresApiKey: true,
      credentialSchema: null,
    });
    expect(meta.adaptTools).toBeUndefined();
    expect(meta.hasStoredSession).toBeUndefined();
  });

  it('getSdkMetas exposes built-in capability flags from the plugin', async () => {
    registerSdkPlugin(claudeAgentSdkPlugin);
    registerSdkPlugin(cursorAgentSdkPlugin);
    const app = makeApp();
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
    const metas = Object.fromEntries(
      (await app.service('agent-configs').getSdkMetas()).map((m) => [m.key, m])
    );
    expect(metas.claude.supportsModelParams).toBe(true);
    expect(metas.claude.requiresModelParamsOnTurn).toBe(false);
    expect(metas.claude.storedSessionIdColumn).toBe('claude_session_id');
    expect(metas.claude.credentialSchema.hasApiUrl).toBe(true);
    expect(metas.claude.adaptTools).toBeUndefined();
    expect(metas.cursor.requiresModelParamsOnTurn).toBe(true);
    expect(metas.cursor.usesAgentPricingTable).toBe(true);
    expect(metas.cursor.appliesUserModelPrefs).toBe(true);
    expect(metas.cursor.storedSessionIdColumn).toBe('cursor_agent_id');
    expect(metas.claude.appliesUserModelPrefs).toBe(false);
    expect(JSON.parse(JSON.stringify(metas.claude))).toEqual(metas.claude);
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
