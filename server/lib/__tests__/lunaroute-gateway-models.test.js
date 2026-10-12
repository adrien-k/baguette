import { describe, it, expect, vi } from 'vitest';
import {
  listLunarouteGatewayModels,
  lunarouteEnvFromAgentConfig,
  resolveLunarouteRoutingUrl,
} from '../lunaroute-gateway-models.js';

describe('lunaroute-gateway-models', () => {
  it('resolveLunarouteRoutingUrl uses env override', () => {
    expect(
      resolveLunarouteRoutingUrl({ LUNAROUTE_ROUTING_URL: 'https://custom.example/v1/' })
    ).toBe('https://custom.example/v1');
    expect(resolveLunarouteRoutingUrl({})).toBe('https://gw.lunaroute.com/v1');
  });

  it('merges extra_env_json from agent config', () => {
    const env = lunarouteEnvFromAgentConfig({
      extra_env_json: JSON.stringify({ LUNAROUTE_ROUTING_URL: 'https://gw.test/v1' }),
    });
    expect(resolveLunarouteRoutingUrl(env)).toBe('https://gw.test/v1');
  });

  it('lists chat models and filters non-chat capabilities', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'glm-5.3-flash',
            display_name: 'GLM Flash',
            context_window: 128000,
            max_output_tokens: 8192,
          },
          {
            id: 'emb-model',
            display_name: 'Embeddings',
            context_window: 8192,
            max_output_tokens: 1,
            capabilities: { embeddings: true },
          },
          {
            id: 'reasoning-bad',
            display_name: 'Reasoning',
            context_window: 128000,
            max_output_tokens: 8192,
            capabilities: { reasoning: true },
          },
        ],
      }),
    }));

    const models = await listLunarouteGatewayModels('lr_test', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://gw.lunaroute.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer lr_test' },
      })
    );
    expect(models).toEqual([{ id: 'glm-5.3-flash', display_name: 'GLM Flash', description: null }]);
  });

  it('surfaces auth errors with status', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid key' } }),
    }));

    await expect(listLunarouteGatewayModels('bad', { fetchImpl })).rejects.toMatchObject({
      status: 401,
      message: /invalid key/,
    });
  });
});
