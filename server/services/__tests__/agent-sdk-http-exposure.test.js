/**
 * Regression test: the agent SDK services (claude-agent, cursor-agent, pi-agent,
 * mock-agent) drive the agent runtimes and are internal-only — they must never be
 * reachable over the HTTP transport. Two independent guards protect them:
 *   1. the app-level `requirePublicService` hook registered in `createFeathersApp`
 *      (deny-by-default against the PUBLIC_SERVICES declarative list), and
 *   2. a `disableExternal` hook on the service itself.
 *
 * This test drives the real Feathers HTTP handler against the real ClaudeAgentService
 * registration and asserts both guards, plus that internal calls still work.
 */
import { createServer, request as httpRequest } from 'http';
import { describe, it, expect, vi } from 'vitest';
import { createHandler, errorHandler, queryParser, bodyParser } from 'feathers/http';

vi.mock('../../db.js', () => ({ default: vi.fn() }));

import { createFeathersApp } from '../../feathers.js';
import { toAbortableNodeHandler } from '../../lib/feathers-node-handler.js';
import { createFeathersCookieAuth } from '../../lib/feathers-http-auth.js';
import { registerClaudeAgentService } from '../feathers/claude-agent.service.ts';
import { CLAUDE_AGENT_SERVICE_PATH } from '../agent-sdk-meta.js';

/** Same middleware stack as server/index.js (minus Express-specific layers). */
function handlerFor(app) {
  return createHandler(app, [
    errorHandler(),
    createFeathersCookieAuth(app),
    queryParser(),
    bodyParser(),
  ]);
}

async function startServer(app) {
  const server = createServer(toAbortableNodeHandler(handlerFor(app), () => ({})));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

function post(port, { path, method, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-method': method,
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : '');
  });
}

function appWithAgentService() {
  const app = createFeathersApp();
  registerClaudeAgentService(app);
  return app;
}

describe('agent SDK services are not reachable over HTTP', () => {
  it('rejects an unauthenticated external call with the transport guard (403)', async () => {
    const app = appWithAgentService();
    const { server, port } = await startServer(app);
    try {
      // stopTurn(activeKey) is an in-memory no-op — safe to attempt; the guard must
      // reject the call before the method body runs.
      const res = await post(port, {
        path: `/${CLAUDE_AGENT_SERVICE_PATH}`,
        method: 'stopTurn',
        body: { activeKey: 'nonexistent-active-key' },
      });
      expect(res.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it('rejects even an authenticated external call (internal-only service, 403)', async () => {
    const app = appWithAgentService();
    const { server, port } = await startServer(app);
    try {
      const res = await post(port, {
        path: `/${CLAUDE_AGENT_SERVICE_PATH}`,
        method: 'stopTurn',
        body: { activeKey: 'nonexistent-active-key' },
        headers: { cookie: 'userId=s:whatever' },
      });
      expect(res.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it('still serves listed services over HTTP (reachability is opt-in, not global denial)', async () => {
    const app = createFeathersApp();
    app.use(
      'sse',
      {
        async find() {
          return { ok: true };
        },
      },
      { methods: ['find'] }
    );
    const { server, port } = await startServer(app);
    try {
      const res = await post(port, {
        path: '/sse',
        method: 'find',
        body: {},
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    } finally {
      server.close();
    }
  });

  it('control: an undeclared method is rejected with 405 (routing is live)', async () => {
    const app = appWithAgentService();
    const { server, port } = await startServer(app);
    try {
      const res = await post(port, {
        path: `/${CLAUDE_AGENT_SERVICE_PATH}`,
        method: 'notARealMethod',
        body: {},
      });
      expect(res.status).toBe(405);
    } finally {
      server.close();
    }
  });

  it('internal calls (no transport provider) still reach the service', async () => {
    const app = appWithAgentService();
    // stopTurn is an in-memory no-op for unknown keys; resolving proves hooks let it pass.
    await expect(app.service(CLAUDE_AGENT_SERVICE_PATH).stopTurn('nonexistent-key')).resolves.toBe(
      undefined
    );
  });
});
