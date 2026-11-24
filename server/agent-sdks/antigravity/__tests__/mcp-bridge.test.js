import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startAntigravityMcpBridge } from '../mcp-bridge.ts';

describe('startAntigravityMcpBridge', () => {
  let bridge = null;
  let client = null;

  afterEach(async () => {
    if (client) {
      await client.close().catch(() => {});
      client = null;
    }
    if (bridge) {
      await bridge.close().catch(() => {});
      bridge = null;
    }
  });

  it('requires bearer authentication and returns 404 on unknown paths', async () => {
    bridge = await startAntigravityMcpBridge([]);

    const unauth = await fetch(bridge.url, { method: 'POST', body: '{}' });
    expect(unauth.status).toBe(401);

    const wrongToken = await fetch(bridge.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
      body: '{}',
    });
    expect(wrongToken.status).toBe(401);

    const badPath = await fetch(bridge.url.replace('/mcp', '/other'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${bridge.token}` },
    });
    expect(badPath.status).toBe(404);
  });

  it('serves registered Baguette tools over Streamable HTTP and captures FIFO results', async () => {
    bridge = await startAntigravityMcpBridge([
      {
        name: 'CreateTodo',
        description: 'Create a todo item',
        schema: { title: z.string() },
        handler: async ({ title }) => ({
          content: [{ type: 'text', text: JSON.stringify({ created: title }) }],
        }),
      },
      {
        name: 'FailingTool',
        description: 'Fails explicitly',
        schema: {},
        handler: async () => ({
          isError: true,
          content: [{ type: 'text', text: 'boom' }],
        }),
      },
    ]);

    expect(bridge.acpServerConfig).toEqual({
      type: 'http',
      name: 'baguette',
      url: bridge.url,
      headers: [{ name: 'Authorization', value: `Bearer ${bridge.token}` }],
    });

    client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(bridge.url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${bridge.token}`,
        },
      },
    });
    await client.connect(transport);

    const listRes = await client.listTools();
    expect(listRes.tools.map((t) => t.name)).toEqual(['CreateTodo', 'FailingTool']);

    await client.callTool({ name: 'CreateTodo', arguments: { title: 'first' } });
    await client.callTool({ name: 'CreateTodo', arguments: { title: 'second' } });
    await client.callTool({ name: 'FailingTool', arguments: {} });

    expect(bridge.consumeToolResult('CreateTodo')).toEqual({
      raw: [{ type: 'text', text: JSON.stringify({ created: 'first' }) }],
      isError: false,
    });
    expect(bridge.consumeToolResult('CreateTodo')).toEqual({
      raw: [{ type: 'text', text: JSON.stringify({ created: 'second' }) }],
      isError: false,
    });
    expect(bridge.consumeToolResult('CreateTodo')).toBeNull();

    expect(bridge.consumeToolResult('FailingTool')).toEqual({
      raw: [{ type: 'text', text: 'boom' }],
      isError: true,
    });
  });
});
