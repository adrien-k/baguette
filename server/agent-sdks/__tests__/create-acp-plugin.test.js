import { describe, it, expect, vi } from 'vitest';
import { createAcpPlugin } from '../acp/create-acp-plugin.ts';

describe('createAcpPlugin', () => {
  it('creates a config-only ACP plugin and registers GenericAgentService without custom service code', async () => {
    const plugin = createAcpPlugin({
      key: 'gemini-cli',
      label: 'Gemini CLI',
      binary: 'gemini',
      args: ['--experimental-acp'],
      modelSelection: 'setModel',
      requiresApiKey: false,
      listModels: async () => ({
        models: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
        rejected_models: [],
      }),
    });

    expect(plugin.key).toBe('gemini-cli');
    expect(plugin.servicePath).toBe('gemini-cli-agent');
    expect(plugin.toolCallBuilders().buildToolCallStart).toBeTypeOf('function');
    expect(await plugin.listModels({})).toEqual({
      models: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
      rejected_models: [],
    });

    const use = vi.fn();
    const service = vi.fn(() => ({ hooks: vi.fn() }));
    const app = { get: vi.fn(), service, use, emit: vi.fn(), services: {} };
    plugin.register(app);

    expect(use).toHaveBeenCalledWith(
      'gemini-cli-agent',
      expect.objectContaining({ handleMessageCreated: expect.any(Function) }),
      expect.objectContaining({ methods: expect.any(Array) })
    );
  });
});
