/**
 * Regression test: the `agent-observers` service is internal-only and exposes no
 * generic read. Two guards protect it:
 *   1. the service declares only `watch` / `unwatch` (no `find`/`get`) — undeclared
 *      methods are rejected at Feathers routing with 405, and
 *   2. it is absent from PUBLIC_SERVICES, so the app-level `requirePublicService`
 *      hook rejects external transport calls with 403 before any service hook runs.
 *
 * Without this, an unscoped `find` would leak cross-user observation metadata
 * (which agent ids observe which agent ids across the whole instance).
 */
import { createServer, request as httpRequest } from 'http';
import { describe, it, expect, vi } from 'vitest';
import { createHandler, errorHandler, queryParser, bodyParser } from 'feathers/http';

vi.mock('../../db.js', () => ({ default: vi.fn() }));

import { createFeathersApp } from '../../feathers.js';
import { toAbortableNodeHandler } from '../../lib/feathers-node-handler.js';
import { createFeathersCookieAuth } from '../../lib/feathers-http-auth.js';
import { registerAgentObserversService } from '../feathers/agent-observers.service.js';
import { requirePublicService } from '../feathers/public-services.js';

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

function post(port, { method, body = {} }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/agent-observers',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-method': method,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

/** Registration needs a truthy Model; these tests never run queries against it. */
function appWithAgentObservers() {
  const app = createFeathersApp();
  app.set('db', { client: 'better-sqlite3' });
  registerAgentObserversService(app);
  return app;
}

describe('agent-observers exposure', () => {
  it('does not expose a generic find over the HTTP transport (405)', async () => {
    const app = appWithAgentObservers();
    const { server, port } = await startServer(app);
    try {
      const res = await post(port, { method: 'find' });
      expect(res.status).toBe(405);
    } finally {
      server.close();
    }
  });

  it('control: routing is live — undeclared methods are rejected with 405', async () => {
    const app = appWithAgentObservers();
    const { server, port } = await startServer(app);
    try {
      const res = await post(port, { method: 'notARealMethod' });
      expect(res.status).toBe(405);
    } finally {
      server.close();
    }
  });

  it('is not external-reachable: the public-service guard rejects it for transports', () => {
    const context = { params: { provider: 'rest' }, path: 'agent-observers' };
    expect(() => requirePublicService(context)).toThrow(/not accessible externally/);
  });
});
