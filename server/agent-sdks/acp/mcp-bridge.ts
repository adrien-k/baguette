import crypto from 'node:crypto';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type AcpMcpToolDescriptor = {
  name: string;
  description?: string;
  schema?: ZodRawShapeCompat;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type CapturedMcpToolResult = {
  raw: unknown;
  isError: boolean;
};

export type AcpMcpBridge = {
  url: string;
  token: string;
  acpServerConfig: {
    type: 'http';
    name: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
  };
  consumeToolResult: (toolName: string) => CapturedMcpToolResult | null;
  close: () => Promise<void>;
};

function isCallToolResult(value: unknown): value is CallToolResult {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function normalizeToCallToolResult(value: unknown): CallToolResult {
  if (isCallToolResult(value)) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return {
    content: [{ type: 'text', text }],
  };
}

function constantTimeBearerMatch(
  headerValue: string | string[] | undefined,
  token: string
): boolean {
  if (typeof headerValue !== 'string') return false;
  const prefix = 'Bearer ';
  if (!headerValue.startsWith(prefix)) return false;
  const supplied = Buffer.from(headerValue.slice(prefix.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(supplied, expected);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

/**
 * Start a loopback-only authenticated Streamable HTTP MCP server exposing
 * Baguette's per-turn tools to an ACP subprocess. Captures tool outputs in a
 * per-tool FIFO queue so drivers can backfill `tool_call_update` `rawOutput`
 * when the subprocess omits it for external MCP tool calls.
 */
export async function startAcpMcpBridge(
  tools: AcpMcpToolDescriptor[],
  { serverName = 'baguette' }: { serverName?: string } = {}
): Promise<AcpMcpBridge> {
  const token = crypto.randomBytes(32).toString('hex');
  const recentResultsByTool = new Map<string, CapturedMcpToolResult[]>();

  const recordResult = (name: string, raw: unknown, isError: boolean) => {
    let queue = recentResultsByTool.get(name);
    if (!queue) {
      queue = [];
      recentResultsByTool.set(name, queue);
    }
    queue.push({ raw, isError });
  };

  const server = http.createServer(async (req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (!constantTimeBearerMatch(req.headers.authorization, token)) {
      res
        .writeHead(401, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res
        .writeHead(400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const mcp = new McpServer({ name: serverName, version: '1.0.0' });
    for (const tool of tools) {
      const schema: ZodRawShapeCompat =
        tool.schema && Object.keys(tool.schema).length > 0 ? tool.schema : {};
      mcp.registerTool(
        tool.name,
        {
          description: tool.description ?? '',
          inputSchema: schema,
        },
        async (args) => {
          const parsedArgs =
            args && typeof args === 'object' && !Array.isArray(args)
              ? (args as Record<string, unknown>)
              : {};
          try {
            const raw = await tool.handler(parsedArgs);
            const normalized = normalizeToCallToolResult(raw);
            recordResult(tool.name, normalized.content, Boolean(normalized.isError));
            return normalized;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const errResult: CallToolResult = {
              content: [{ type: 'text', text: msg }],
              isError: true,
            };
            recordResult(tool.name, errResult.content, true);
            return errResult;
          }
        }
      );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });

    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        const msg = err instanceof Error ? err.message : String(err);
        res
          .writeHead(500, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: msg }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/mcp`;

  let closed = false;
  return {
    url,
    token,
    acpServerConfig: {
      type: 'http',
      name: serverName,
      url,
      headers: [{ name: 'Authorization', value: `Bearer ${token}` }],
    },
    consumeToolResult(toolName: string): CapturedMcpToolResult | null {
      const queue = recentResultsByTool.get(toolName);
      if (!queue || queue.length === 0) return null;
      const item = queue.shift() ?? null;
      if (queue.length === 0) recentResultsByTool.delete(toolName);
      return item;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
      });
    },
  };
}
