import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

/** Wrap a generic `{ name, description, schema, handler }` list as a Claude SDK MCP server. */
export function toolListToClaudeMcpServer(toolList, { name = 'baguette' } = {}) {
  return createSdkMcpServer({
    name,
    tools: toolList.map((t) => tool(t.name, t.description, t.schema, t.handler)),
  });
}
