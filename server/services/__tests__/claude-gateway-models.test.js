import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../lib/cache.js', () => ({
  fetch: vi.fn((_key, _ttl, fn) => fn()),
  clear: vi.fn(async () => {}),
}));

import { modelsCacheKey } from '../anthropic-models.js';
import {
  gatewayAuthHeaders,
  gatewayDiscoveryActive,
  listGatewayModels,
} from '../claude-gateway-models.js';

describe('gatewayDiscoveryActive', () => {
  it('is true whenever a base URL is set (discovery is always on)', () => {
    expect(gatewayDiscoveryActive({ api_url: 'https://gw.example.com' })).toBe(true);
    expect(gatewayDiscoveryActive({ api_url: null })).toBe(false);
  });
});

describe('gatewayAuthHeaders', () => {
  it('sends Bearer for auth tokens and x-api-key for API keys', () => {
    expect(gatewayAuthHeaders({ authToken: 'tok' })).toEqual({
      'anthropic-version': '2023-06-01',
      Authorization: 'Bearer tok',
    });
    expect(gatewayAuthHeaders({ apiKey: 'key' })).toEqual({
      'anthropic-version': '2023-06-01',
      'x-api-key': 'key',
    });
    expect(gatewayAuthHeaders({})).toEqual({ 'anthropic-version': '2023-06-01' });
  });
});

describe('listGatewayModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the gateway model list (ids + names)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: [{ id: 'kimi-k3' }, { name: 'glm-5.3' }, { id: null }] }),
            { status: 200 }
          )
      )
    );
    const models = await listGatewayModels({
      api_key: 'key',
      api_url: 'https://opencode.ai/zen/go',
      api_key_env_var: 'ANTHROPIC_API_KEY',
    });
    expect(models).toEqual([
      { id: 'kimi-k3', display_name: 'kimi-k3', description: null },
      { id: 'glm-5.3', display_name: 'glm-5.3', description: null },
    ]);
  });

  it('throws with the gateway error body on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 }))
    );
    await expect(
      listGatewayModels({
        api_key: 'key',
        api_url: 'https://opencode.ai/zen/go',
        api_key_env_var: 'ANTHROPIC_API_KEY',
      })
    ).rejects.toThrow('Gateway model list failed (HTTP 401)');
  });

  it('requires a base URL', async () => {
    await expect(listGatewayModels({ api_key: 'key', api_url: null })).rejects.toThrow(
      'requires a Claude API base URL'
    );
  });
});

describe('modelsCacheKey', () => {
  it('derives the cache key from the normalized Claude API URL', () => {
    expect(modelsCacheKey('https://opencode.ai/zen/go/')).toBe(
      'anthropic-models:https://opencode.ai/zen/go'
    );
    expect(modelsCacheKey(null)).toBe('anthropic-models:https://api.anthropic.com');
  });
});
