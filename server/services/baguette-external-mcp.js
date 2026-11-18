import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildExternalMcpToolList } from './baguette-account-mcp-tools.js';

/**
 * Stateless MCP server exposing account-level Baguette tools for an authenticated user.
 */
export function createBaguetteExternalMcpServer(user, app) {
  const server = new McpServer(
    {
      name: 'baguette',
      version: '1.0.0',
    },
    { capabilities: { tools: {} } }
  );

  const toolList = buildExternalMcpToolList(user, app);
  for (const { name, description, schema, handler } of toolList) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
      },
      async (args) => handler(args ?? {})
    );
  }

  return server;
}
