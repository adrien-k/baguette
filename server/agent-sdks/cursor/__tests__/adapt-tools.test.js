import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { toolListToCursorCustomTools } from '../adapt-tools.js';

describe('toolListToCursorCustomTools', () => {
  it('maps a generic tool list to a Cursor customTools record', async () => {
    const handler = vi.fn(async (args) => ({ ok: true, n: args.n }));
    const tools = toolListToCursorCustomTools([
      { name: 'Echo', description: 'echo', schema: { n: z.number() }, handler },
    ]);
    expect(tools.Echo.description).toBe('echo');
    expect(tools.Echo.inputSchema).toEqual(expect.objectContaining({ type: 'object' }));
    await expect(tools.Echo.execute({ n: 1 })).resolves.toEqual({ ok: true, n: 1 });
    expect(handler).toHaveBeenCalledWith({ n: 1 });
  });

  it('omits inputSchema when the schema is empty', () => {
    const tools = toolListToCursorCustomTools([
      { name: 'NoArgs', description: 'none', schema: {}, handler: async () => ({}) },
    ]);
    expect(tools.NoArgs.inputSchema).toBeUndefined();
  });
});
