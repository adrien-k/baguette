import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  defineTool: (def) => def,
}));

import { toolListToPiCustomTools } from '../adapt-tools.js';

describe('toolListToPiCustomTools', () => {
  it('wraps a generic tool list as Pi defineTool entries', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'pong' }] }));
    const [tool] = toolListToPiCustomTools([
      { name: 'Ping', description: 'ping', schema: { session_id: z.number().int() }, handler },
    ]);
    expect(tool.name).toBe('Ping');
    expect(tool.label).toBe('Ping');
    expect(tool.parameters).toEqual(expect.objectContaining({ type: 'object' }));
    const result = await tool.execute('call-1', { session_id: '32' });
    expect(handler).toHaveBeenCalledWith({ session_id: 32 });
    expect(result).toEqual({ content: [{ type: 'text', text: 'pong' }], details: {} });
  });

  it('allows empty schemas', () => {
    const [tool] = toolListToPiCustomTools([
      { name: 'NoArgs', description: 'none', schema: {}, handler: async () => 'ok' },
    ]);
    expect(tool.parameters).toBeDefined();
  });
});
