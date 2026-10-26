import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from 'feathers';
import { createTestDb } from '../../test-utils/db.js';
import { insertTestAgentConfig } from '../../test-utils/agent-configs.js';
import { registerAgentConfigsService } from '../feathers/agent-configs.service.js';

vi.mock('../../lib/cache.js', () => ({
  fetch: (_key, _ttl, fn) => fn(),
  clear: vi.fn(async () => {}),
}));

vi.mock('../anthropic-models.js', () => ({
  listModels: vi.fn(async () => ({
    models: [{ id: 'claude-sonnet-4-5', display_name: 'Sonnet' }],
    rejected_models: [],
  })),
  modelsCacheKey: vi.fn((url) => `anthropic-models:${url ?? 'default'}`),
}));

const { listModelsForUser, loadModelsForSdk } = await import('../baguette-models-for-user.js');
const { listModels } = await import('../anthropic-models.js');

const db = createTestDb();

function makeApp() {
  const app = feathers();
  app.set('db', db);
  registerAgentConfigsService(app);
  app.service('agent-configs').registerSdk({
    key: 'claude',
    label: 'Claude',
    service_path: 'claude-agent',
  });
  return app;
}

describe('listModelsForUser / loadModelsForSdk with agent_config_id', () => {
  let user;
  let configId;

  beforeEach(async () => {
    listModels.mockClear();
    await db('users').insert({ github_id: 1, username: 'u', approved: true });
    user = await db('users').where({ username: 'u' }).first();
    configId = await insertTestAgentConfig(db, user.id, { apiKey: 'sk-ant-api03-key' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the built-in SDK list when no base URL is configured', async () => {
    const app = makeApp();
    await app.setup();
    const result = await listModelsForUser(user, null, app, { agentConfigId: configId });
    expect(result.models.map((m) => m.id)).toEqual(['claude-sonnet-4-5']);
  });

  it('lists models from the gateway when a base URL is set on the config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'kimi-k3' }, { id: 'glm-5.3' }] }), {
            status: 200,
          })
      )
    );
    const gwId = await insertTestAgentConfig(db, user.id, {
      apiKey: 'sk-ant-api03-key',
      apiUrl: 'https://opencode.ai/zen/go',
      label: 'Claude GW',
    });
    const app = makeApp();
    await app.setup();
    const result = await listModelsForUser(user, null, app, { agentConfigId: gwId });
    expect(result.models.map((m) => m.id)).toEqual(['kimi-k3', 'glm-5.3']);
    const sdkModels = await loadModelsForSdk(user, 'claude', null, app, { agentConfigId: gwId });
    expect(sdkModels.map((m) => m.id)).toEqual(['kimi-k3', 'glm-5.3']);
  });

  it("does not list models using another user's agent_config_id", async () => {
    await db('users').insert({ github_id: 2, username: 'other', approved: true });
    const other = await db('users').where({ username: 'other' }).first();
    const otherConfigId = await insertTestAgentConfig(db, other.id, {
      apiKey: 'sk-ant-other',
      label: 'Other Claude',
    });
    const app = makeApp();
    await app.setup();
    await expect(
      listModelsForUser(user, null, app, { agentConfigId: otherConfigId })
    ).rejects.toThrow('Agent configuration not found');
    expect(listModels).not.toHaveBeenCalled();
  });

  it('does not fall back to the built-in list when the gateway fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 }))
    );
    const gwId = await insertTestAgentConfig(db, user.id, {
      apiKey: 'sk-ant-api03-key',
      apiUrl: 'https://opencode.ai/zen/go',
      label: 'Claude GW2',
    });
    const app = makeApp();
    await app.setup();
    await expect(listModelsForUser(user, null, app, { agentConfigId: gwId })).rejects.toThrow(
      'Gateway model list failed'
    );
  });
});
