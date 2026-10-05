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
  resolveClaudeGatewayConfig,
} from '../claude-gateway-models.js';

const ACCOUNT = {
  anthropic_api_key: 'sk-ant-api03-account',
  anthropic_auth_token: null,
  anthropic_base_url: 'https://account-gw.example.com',
};

describe('resolveClaudeGatewayConfig', () => {
  it('falls back to the account config when the repo has none', () => {
    const config = resolveClaudeGatewayConfig(ACCOUNT, {});
    expect(config.apiKey).toBe('sk-ant-api03-account');
    expect(config.baseUrl).toBe('https://account-gw.example.com');
  });

  it('lets repo values override the account', () => {
    const repo = {
      anthropic_api_key: 'sk-ant-api03-repo',
      anthropic_base_url: 'https://repo-gw.example.com',
    };
    const config = resolveClaudeGatewayConfig(ACCOUNT, repo);
    expect(config.apiKey).toBe('sk-ant-api03-repo');
    expect(config.baseUrl).toBe('https://repo-gw.example.com');
  });
});

describe('gatewayDiscoveryActive', () => {
  it('is true whenever a base URL is set (discovery is always on)', () => {
    expect(gatewayDiscoveryActive({ baseUrl: 'https://gw.example.com' })).toBe(true);
    expect(gatewayDiscoveryActive({ baseUrl: null })).toBe(false);
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
      apiKey: 'key',
      baseUrl: 'https://opencode.ai/zen/go',
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
      listGatewayModels({ apiKey: 'key', baseUrl: 'https://opencode.ai/zen/go' })
    ).rejects.toThrow('Gateway model list failed (HTTP 401)');
  });

  it('requires a base URL', async () => {
    await expect(listGatewayModels({ apiKey: 'key', baseUrl: null })).rejects.toThrow(
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
