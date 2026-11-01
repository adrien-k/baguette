import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const tool = (name, description, inputSchema, handler) => ({
    name,
    description,
    inputSchema,
    handler,
  });
  const createSdkMcpServer = vi.fn((opts) => ({ name: opts.name, tools: opts.tools }));
  return { tool, createSdkMcpServer };
});

import { toolListToClaudeMcpServer } from '../adapt-tools.js';

describe('toolListToClaudeMcpServer', () => {
  it('wraps a generic tool list as an SDK MCP server named baguette', () => {
    const handler = vi.fn();
    const server = toolListToClaudeMcpServer([
      { name: 'Ping', description: 'ping', schema: {}, handler },
    ]);
    expect(server.name).toBe('baguette');
    expect(server.tools).toHaveLength(1);
    expect(server.tools[0].name).toBe('Ping');
    expect(server.tools[0].handler).toBe(handler);
  });
});
