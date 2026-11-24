import { describe, it, expect, vi } from 'vitest';
import { toolListToAntigravityMcpTools } from '../adapt-tools.js';

describe('toolListToAntigravityMcpTools', () => {
  it('wraps tool descriptors with safe defaults and preserves handler/schema', async () => {
    const handler = vi.fn(async (args) => ({ ok: true, args }));
    const tools = toolListToAntigravityMcpTools([
      {
        name: 'CreateTodo',
        description: 'Add a todo',
        schema: { title: {} },
        handler,
      },
      {
        name: 'Ping',
        handler: async () => 'pong',
      },
    ]);

    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      name: 'CreateTodo',
      description: 'Add a todo',
      schema: { title: {} },
    });
    expect(tools[1]).toMatchObject({
      name: 'Ping',
      description: '',
      schema: {},
    });
    await expect(tools[0].handler({ title: 'Test' })).resolves.toEqual({
      ok: true,
      args: { title: 'Test' },
    });
    expect(toolListToAntigravityMcpTools(null)).toEqual([]);
  });
});
