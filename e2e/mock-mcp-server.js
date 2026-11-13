import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const E2E_MCP_BEARER = 'e2e-mcp-token';
export const E2E_MCP_TOOL = 'echo';

/**
 * Streamable HTTP MCP server on 127.0.0.1. Requests without the e2e bearer get 401.
 */
export async function startE2eMockMcpServer() {
  const mcp = new McpServer({ name: 'e2e-mock', version: '0.0.1' });
  mcp.registerTool(E2E_MCP_TOOL, { description: 'Echo a short message back' }, async () => ({
    content: [{ type: 'text', text: 'pong' }],
  }));

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcp.connect(transport);

  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${E2E_MCP_BEARER}`) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Bearer',
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(err?.message || 'MCP mock failed');
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
