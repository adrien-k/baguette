import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { findUserByMcpToken, parseBearerToken } from '../services/mcp-auth.js';
import { createBaguetteExternalMcpServer } from '../services/baguette-external-mcp.js';

function jsonRpcError(res, status, message) {
  if (res.headersSent) return;
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  });
}

/**
 * Token-authenticated Streamable HTTP MCP endpoint for external agents (Cursor, Claude Desktop, etc.).
 */
export default function createMcpRoutes(app) {
  const router = Router();
  const db = app.get('db');

  const authenticate = async (req, res) => {
    const token = parseBearerToken(req);
    if (!token) {
      jsonRpcError(res, 401, 'Missing or invalid Authorization header (Bearer token required)');
      return null;
    }
    const row = await findUserByMcpToken(db, token);
    if (!row) {
      jsonRpcError(res, 401, 'Invalid MCP token');
      return null;
    }
    if (!row.approved) {
      jsonRpcError(res, 403, 'Account pending approval');
      return null;
    }
    try {
      return await app.service('users').get(row.id, {});
    } catch {
      jsonRpcError(res, 401, 'Invalid MCP token');
      return null;
    }
  };

  router.post('/api/mcp', async (req, res) => {
    const user = await authenticate(req, res);
    if (!user) return;

    const server = createBaguetteExternalMcpServer(user, app);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (err) {
      if (!res.headersSent) {
        jsonRpcError(res, 500, err.message || 'Internal server error');
      }
    }
  });

  router.get('/api/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed — use POST for MCP requests' },
      id: null,
    });
  });

  return router;
}
