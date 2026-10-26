/**
 * Feathers v6 SSE channels and realtime publishers (registerFeathersRealtime).
 */
import { createServer } from 'http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feathers } from 'feathers';
import { createHandler, errorHandler, queryParser, bodyParser } from 'feathers/http';
import { createTestDb, insertTestSession } from '../../test-utils/db.js';
import { toAbortableNodeHandler } from '../../lib/feathers-node-handler.js';

const dbMock = vi.hoisted(() => ({ current: null }));
vi.mock('../../db.js', () => ({ default: (table) => dbMock.current(table) }));

import { registerFeathersRealtime } from '../feathers/realtime.js';

const SESSION_USER_EVENTS = [
  'app:error',
  'turn:start',
  'turn:complete',
  'push:start',
  'push:complete',
];

function makeCrudService(customEvents = []) {
  return {
    events: customEvents,
    async create(data) {
      return data;
    },
    async patch(id, data) {
      return { id, ...data };
    },
    async update(id, data) {
      return { id, ...data };
    },
    async remove(id) {
      return { id };
    },
  };
}

function registerStubServices(app) {
  app.use('sessions', makeCrudService(SESSION_USER_EVENTS));
  app.use('messages', makeCrudService());
  app.use('agents', makeCrudService());
  app.use('tasks', makeCrudService(['log']));
  app.use('repos', makeCrudService());
  app.use('queued-messages', makeCrudService());
  app.use('loops', makeCrudService());
  app.use('session-issues', makeCrudService());
  app.use('session-todos', makeCrudService());
  app.use('session-plans', makeCrudService());
  app.use('users', makeCrudService(['github:bad-credentials']));
}

function makeRealtimeApp() {
  const app = feathers();
  registerStubServices(app);
  registerFeathersRealtime(app);
  return app;
}

function joinUserOnConnect(app, userId) {
  const connection = { user: { id: userId } };
  app.emit('connection', connection);
  return connection;
}

function waitForPublish(app) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('publish timeout')), 5000);
    app.once('publish', (event, channel, hook) => {
      clearTimeout(timer);
      resolve({ event, channel, hook });
    });
  });
}

function payloadForConnection(channel, connection, hook) {
  if (channel.dataFor) {
    const mapped = channel.dataFor(connection);
    if (mapped !== undefined) return mapped;
  }
  return hook.result;
}

const db = createTestDb();

describe('registerFeathersRealtime', () => {
  beforeEach(() => {
    dbMock.current = db;
  });

  it('joins authenticated and user/{id} when connection has a user', () => {
    const app = makeRealtimeApp();
    const connection = joinUserOnConnect(app, 42);

    expect(app.channel('authenticated').connections).toContain(connection);
    expect(app.channel('user/42').connections).toContain(connection);
  });

  it('does not join channels for anonymous connections', () => {
    const app = makeRealtimeApp();
    app.emit('connection', {});

    expect(app.channel('authenticated').connections).toHaveLength(0);
    expect(app.channel('user/1').connections).toHaveLength(0);
  });

  it('strips short_id from session CRUD publish payloads', async () => {
    const app = makeRealtimeApp();
    joinUserOnConnect(app, 1);

    const publishPromise = waitForPublish(app);
    await app.service('sessions').create({
      id: 10,
      user_id: 1,
      short_id: 'abc123',
      label: 'Test',
    });
    const { event, channel, hook } = await publishPromise;

    expect(event).toBe('created');
    const payload = payloadForConnection(channel, app.channel('user/1').connections[0], hook);
    expect(payload).toMatchObject({ id: 10, user_id: 1, label: 'Test' });
    expect(payload).not.toHaveProperty('short_id');
  });

  it('does not deliver another user’s session events to the wrong connection', async () => {
    await db('users').insert([
      { github_id: 1, username: 'alice', approved: true },
      { github_id: 2, username: 'bob', approved: true },
    ]);
    const alice = await db('users').where({ username: 'alice' }).first();
    const bob = await db('users').where({ username: 'bob' }).first();

    await db('repos').insert({ full_name: 'test/repo', repo_path: '/tmp/repo' });
    const repo = await db('repos').where({ full_name: 'test/repo' }).first();
    const sessionId = await insertTestSession(db, {
      user_id: alice.id,
      repo_id: repo.id,
      repo_full_name: repo.full_name,
      base_branch: 'main',
      initial_prompt: 'Task',
    });

    const app = makeRealtimeApp();
    const aliceConn = joinUserOnConnect(app, alice.id);
    const bobConn = joinUserOnConnect(app, bob.id);

    const publishPromise = waitForPublish(app);
    await app.service('messages').create({
      id: 1,
      session_id: sessionId,
      content: 'hello',
    });
    const { channel } = await publishPromise;

    expect(channel.connections).toContain(aliceConn);
    expect(channel.connections).not.toContain(bobConn);
  });

  it('leaves all channels on disconnect', () => {
    const app = makeRealtimeApp();
    const connection = joinUserOnConnect(app, 7);

    app.emit('disconnect', connection);

    expect(app.channel('authenticated').connections).not.toContain(connection);
    expect(app.channel('user/7').connections).not.toContain(connection);
  });

  it('broadcasts repos CRUD to all authenticated connections', async () => {
    const app = makeRealtimeApp();
    const conn1 = joinUserOnConnect(app, 1);
    const conn2 = joinUserOnConnect(app, 2);

    const publishPromise = waitForPublish(app);
    await app.service('repos').create({ id: 99, full_name: 'org/repo' });
    const { event, channel } = await publishPromise;

    expect(event).toBe('created');
    expect(channel.connections).toContain(conn1);
    expect(channel.connections).toContain(conn2);
  });
});

describe('AbortableSseService over HTTP', () => {
  let server;
  let app;

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
    if (app) {
      await app.teardown();
      app = null;
    }
  });

  it('drops channel membership and emits disconnect when the client aborts', async () => {
    app = makeRealtimeApp();
    await app.setup();

    const handler = createHandler(app, [errorHandler(), queryParser(), bodyParser()]);
    server = createServer(
      toAbortableNodeHandler(handler, () => ({ user: { id: 1, approved: true } }))
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const disconnected = new Promise((resolve) => {
      app.once('disconnect', resolve);
    });

    const abortController = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/sse`, {
      signal: abortController.signal,
    });
    expect(response.ok).toBe(true);
    const bodyReader = response.body.getReader();
    await bodyReader.read();
    expect(app.channel('user/1').connections.length).toBeGreaterThan(0);

    abortController.abort();
    await disconnected;

    expect(app.channel('authenticated').connections).toHaveLength(0);
    expect(app.channel('user/1').connections).toHaveLength(0);
  }, 10000);

  it('writes SSE heartbeat comments on an idle stream', async () => {
    app = makeRealtimeApp();
    await app.setup();

    const handler = createHandler(app, [errorHandler(), queryParser(), bodyParser()]);
    server = createServer(
      toAbortableNodeHandler(handler, () => ({ user: { id: 1, approved: true } }), {
        heartbeatMs: 40,
      })
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const abortController = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/sse`, {
      signal: abortController.signal,
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const bodyReader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 2000;
    while (!text.includes(': heartbeat') && Date.now() < deadline) {
      const { value, done } = await bodyReader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    abortController.abort();

    expect(text).toContain(': heartbeat');
  }, 10000);
});
