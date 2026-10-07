import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { registerAgentSdksService } from '../feathers/agent-sdks.service.js';
import { isClaudeAgentSdkEnabled, listClaudeAgentModels } from '../agent-sdk/claude-agent-sdk.js';

const { dbProxy } = vi.hoisted(() => {
  const chain = () => {
    const rows = [];
    const promise = Promise.resolve(rows);
    const query = {
      where: () => query,
      whereNull: () => query,
      select: () => query,
    };
    return Object.assign(query, {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    });
  };
  return { dbProxy: Object.assign(() => chain(), {}) };
});

vi.mock('../../db.js', () => ({ default: dbProxy }));
vi.mock('../../lib/cache.js', () => ({
  fetch: (_key, _ttl, fn) => fn(),
  clear: vi.fn(async () => {}),
}));

vi.mock('../anthropic-models.js', () => ({
  listModels: vi.fn(async () => [{ id: 'claude-sonnet-4-5', display_name: 'Sonnet' }]),
  modelsCacheKey: vi.fn((url) => `anthropic-models:${url ?? 'default'}`),
}));
vi.mock('../cursor-models.js', () => ({
  listCursorModels: vi.fn(async () => []),
}));

const { listModelsForUser, loadModelsForSdk } = await import('../baguette-models-for-user.js');
const { listModels } = await import('../anthropic-models.js');

const USER = {
  id: 1,
  agent_preferences: null,
  anthropic_api_key: 'sk-ant-api03-key',
  anthropic_auth_token: null,
  anthropic_base_url: null,
};

const REPO = { id: 1 };

function makeApp() {
  const app = feathers();
  registerAgentSdksService(app);
  app.use(
    'claude-agent',
    {
      async isEnabled(ctx) {
        return isClaudeAgentSdkEnabled(ctx);
      },
      async listModels(ctx, opts) {
        return listClaudeAgentModels(ctx, opts);
      },
    },
    { methods: ['isEnabled', 'listModels'] }
  );
  app.service('agent-sdks').register({
    key: 'claude',
    label: 'Claude',
    service_path: 'claude-agent',
  });
  return app;
}

beforeEach(() => {
  listModels.mockClear();
});

describe('listModelsForUser / loadModelsForSdk with a configured gateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the built-in SDK list when no base URL is configured', async () => {
    const result = await listModelsForUser(USER, REPO, makeApp());
    expect(result.models.map((m) => m.id)).toEqual(['claude-sonnet-4-5']);
  });

  it('lists models from the gateway when a base URL is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'kimi-k3' }, { id: 'glm-5.3' }] }), {
            status: 200,
          })
      )
    );
    const user = { ...USER, anthropic_base_url: 'https://opencode.ai/zen/go' };
    const app = makeApp();
    const result = await listModelsForUser(user, REPO, app);
    expect(result.models.map((m) => m.id)).toEqual(['kimi-k3', 'glm-5.3']);
    const sdkModels = await loadModelsForSdk(user, 'claude', REPO, app);
    expect(sdkModels.map((m) => m.id)).toEqual(['kimi-k3', 'glm-5.3']);
  });

  it('does not fall back to the built-in list when the gateway fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 }))
    );
    const user = { ...USER, anthropic_base_url: 'https://opencode.ai/zen/go' };
    const app = makeApp();
    await expect(listModelsForUser(user, REPO, app)).rejects.toThrow('Gateway model list failed');
    await expect(loadModelsForSdk(user, 'claude', REPO, app)).rejects.toThrow(
      'Gateway model list failed'
    );
  });

  it('lets a repo base URL override the account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'repo-gw-model' }] }), { status: 200 })
      )
    );
    const repo = { id: 2, anthropic_base_url: 'https://repo-gw.example.com' };
    const result = await listModelsForUser(USER, repo, makeApp());
    expect(result.models.map((m) => m.id)).toEqual(['repo-gw-model']);
  });
});
