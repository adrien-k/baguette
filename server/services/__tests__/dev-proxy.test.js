import http from 'http';
import { PassThrough } from 'stream';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { DevProxy } from '../dev-proxy.js';
import { signProxyToken } from '../preview.js';
import { Task, HEARTBEAT_INTERVAL_MS } from '../task.js';

describe('DevProxy._proxyRequest keep-alive', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('heartbeats immediately and on interval while waiting for upstream headers', () => {
    vi.useFakeTimers();
    const proxy = new DevProxy({}, []);
    const heartbeat = vi.fn();
    const state = { task: { heartbeat } };

    const mockProxyReq = new PassThrough();
    vi.spyOn(http, 'request').mockImplementation(() => mockProxyReq);

    const req = new PassThrough();
    const res = new PassThrough();
    res.socket = {};
    proxy._proxyRequest(req, res, 3000, '127.0.0.1', state);

    expect(heartbeat).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });
});

describe('DevProxy._forwardProxyResponse', () => {
  it('flushes response headers before piping the upstream body', () => {
    const proxy = new DevProxy({}, []);
    const events = [];
    const mockRes = new PassThrough();
    mockRes.setHeader = () => events.push('setHeader');
    mockRes.flushHeaders = () => events.push('flush');

    const proxyRes = new PassThrough();
    proxyRes.statusCode = 200;
    proxyRes.headers = { 'content-type': 'text/plain' };

    proxy._forwardProxyResponse(proxyRes, mockRes, { socket: {} }, () => {});

    expect(events).toContain('setHeader');
    expect(events.at(-1)).toBe('flush');
    proxyRes.end('hello');
  });

  it('sets X-Accel-Buffering for SSE upstream responses', () => {
    const proxy = new DevProxy({}, []);
    const headers = {};
    const mockRes = new PassThrough();
    mockRes.setHeader = (key, value) => {
      headers[key.toLowerCase()] = value;
    };
    mockRes.flushHeaders = () => {};

    const proxyRes = new PassThrough();
    proxyRes.statusCode = 200;
    proxyRes.headers = {
      'content-type': 'text/event-stream; charset=utf-8',
      'content-length': '99',
      connection: 'keep-alive',
    };

    proxy._forwardProxyResponse(proxyRes, mockRes, { socket: {} }, () => {});

    expect(headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(headers['content-length']).toBeUndefined();
    expect(headers['connection']).toBeUndefined();
    expect(headers['x-accel-buffering']).toBe('no');
  });
});

describe('DevProxy._releaseProxyState', () => {
  it('does not remove the task from the task store', () => {
    const deleteTask = vi.fn();
    const proxy = new DevProxy({ service: () => ({ deleteTask }) }, []);
    const task = new Task({ id: 7, sessionId: 1, command: 'echo', ports: ['PORT'] });
    task.exit(1);
    const unsubLog = vi.fn();
    const unsubExit = vi.fn();
    const state = { task, unsubLog, unsubExit, status: 'crashed' };
    const key = 'session-abc.example.com';

    proxy.states.set(key, state);
    proxy._releaseProxyState(key, state);

    expect(deleteTask).not.toHaveBeenCalled();
    expect(unsubLog).toHaveBeenCalled();
    expect(unsubExit).toHaveBeenCalled();
    expect(proxy.states.has(key)).toBe(false);
    expect(task.status).toBe('exited');
  });
});

/** Task stub: enough surface for attachWebserverTask / _wireTaskToProxy, exit driven by the test. */
function stubTask({ id = 1, logs = 'listening on 3000\n' } = {}) {
  const exitListeners = [];
  return {
    id,
    status: 'running',
    ports: { PORT: 3000 },
    kill_reason: null,
    getLogs: () => logs,
    onLog: () => () => {},
    onExit(fn) {
      exitListeners.push(fn);
      return () => {};
    },
    // Never resolves: the test drives the state through _onListening / exit instead.
    waitForReady: () => new Promise(() => {}),
    heartbeat: () => {},
    exit(code) {
      this.status = 'exited';
      for (const fn of exitListeners) fn(this.id, code);
    },
  };
}

/** Replayable SSE events buffered for a channel, decoded. */
function replayedEvents(proxy, key) {
  return (proxy.sse._eventLog.get(key) ?? []).map((msg) => JSON.parse(msg.slice('data: '.length)));
}

describe('DevProxy exit after the server came up', () => {
  const key = 'session-abc.example.com';

  it('keeps the state with logs and an error event when stopped from the Preview tab', () => {
    const proxy = new DevProxy({}, []);
    const task = stubTask();
    const state = proxy.attachWebserverTask(key, task, 'PORT');
    proxy._onListening(key, state, 3000);

    task.kill_reason = 'stopped';
    task.exit(1);

    expect(proxy.states.get(key)).toBe(state);
    expect(state.status).toBe('crashed'); // terminal → dispatch renders logs + Retry
    expect(state.port).toBe(null);
    const events = replayedEvents(proxy, key);
    // No `ready` left over, otherwise the loading page would reload in a loop.
    expect(events.some((e) => e.event === 'ready')).toBe(false);
    expect(events.filter((e) => e.event === 'log').map((e) => e.data)).toContain(
      'listening on 3000\n'
    );
    expect(events.at(-1)).toEqual({
      event: 'error',
      data: { message: 'Dev server was stopped.' },
    });
  });

  it('keeps the state and reports the exit code when the server crashes on its own', () => {
    const proxy = new DevProxy({}, []);
    const task = stubTask();
    const state = proxy.attachWebserverTask(key, task, 'PORT');
    proxy._onListening(key, state, 3000);

    task.exit(137);

    expect(proxy.states.get(key)).toBe(state);
    expect(replayedEvents(proxy, key).at(-1)).toEqual({
      event: 'error',
      data: { message: 'Dev server exited with code 137.' },
    });
  });

  it('drops the state on an idle-TTL stop so the next request starts a fresh server', () => {
    const proxy = new DevProxy({}, []);
    const task = stubTask();
    const state = proxy.attachWebserverTask(key, task, 'PORT');
    proxy._onListening(key, state, 3000);

    task.kill_reason = 'ttl';
    task.exit(1);

    expect(proxy.states.has(key)).toBe(false);
    expect(replayedEvents(proxy, key)).toEqual([]);
  });

  it('drops the state when TTL fires during startup (SIGTERM exit code)', () => {
    const proxy = new DevProxy({}, []);
    const task = stubTask();
    proxy.attachWebserverTask(key, task, 'PORT');

    task.kill_reason = 'ttl';
    task.exit(1);

    expect(proxy.states.has(key)).toBe(false);
  });

  it('drops the state when TTL fires after a startup-timeout crash', () => {
    const proxy = new DevProxy({}, []);
    const task = stubTask();
    const state = proxy.attachWebserverTask(key, task, 'PORT');
    proxy._onCrashed(key, state, new Error('ports not ready'));

    task.kill_reason = 'ttl';
    task.exit(1);

    expect(proxy.states.has(key)).toBe(false);
  });
});

describe('DevProxy approved-user gating', () => {
  const clientIp = '203.0.113.9';

  /** Minimal db/app stand-in: db('users').where({id}).first() resolves from usersById. */
  function appWithUsers(usersById) {
    const db = () => ({
      where: (clause) => ({
        first: () => Promise.resolve(usersById[clause.id] ?? null),
      }),
    });
    return { get: () => db };
  }

  /** Handler stub that matches every host and would dispatch (render returns true). */
  function stubHandlerClass({ allowIpPublicAccess } = {}) {
    return class {
      constructor(app, req) {
        this.app = app;
        this.req = req;
        if (allowIpPublicAccess) this.allowIpPublicAccess = allowIpPublicAccess;
      }
      isValidHost() {
        return true;
      }
      get key() {
        return 'k';
      }
      get subdomain() {
        return 'k';
      }
      async allowUser() {
        return true;
      }
      async render() {
        return true;
      }
      async buildTask() {
        return { task: null, exposePort: null };
      }
      startupTimeoutMs = 1000;
    };
  }

  it('treats a proxy cookie naming an approved user as authenticated', async () => {
    const proxy = new DevProxy(appWithUsers({ 7: { id: 7, approved: 1 } }), []);
    const Handler = stubHandlerClass();
    const access = await proxy._resolveProxyAccess(new Handler(), '7', clientIp);
    expect(access).toMatchObject({ userId: '7', needsAuth: false, ipBypass: false });
  });

  it('treats a proxy cookie naming a pending user as anonymous (needsAuth)', async () => {
    const proxy = new DevProxy(appWithUsers({ 7: { id: 7, approved: 0 } }), []);
    const Handler = stubHandlerClass();
    const access = await proxy._resolveProxyAccess(new Handler(), '7', clientIp);
    expect(access).toMatchObject({ userId: null, needsAuth: true, ipBypass: false });
  });

  it('treats a proxy cookie naming a deleted user as anonymous', async () => {
    const proxy = new DevProxy(appWithUsers({}), []);
    const Handler = stubHandlerClass();
    const access = await proxy._resolveProxyAccess(new Handler(), '7', clientIp);
    expect(access.needsAuth).toBe(true);
  });

  it('falls through to the handler IP bypass when the cookie user is not approved', async () => {
    const proxy = new DevProxy(appWithUsers({ 7: { id: 7, approved: 0 } }), []);
    const Handler = stubHandlerClass({ allowIpPublicAccess: async () => true });
    const access = await proxy._resolveProxyAccess(new Handler(), '7', clientIp);
    expect(access).toMatchObject({ userId: null, needsAuth: false, ipBypass: true });
  });

  function middlewareRes() {
    return {
      redirectedTo: null,
      redirect(destination) {
        this.redirectedTo = destination;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      render: vi.fn(),
      cookie: vi.fn(),
    };
  }

  it('/_baguette/auth sets the proxy cookie for an approved token holder', async () => {
    const proxy = new DevProxy(appWithUsers({ 7: { id: 7, approved: 1 } }), [stubHandlerClass()]);
    const req = {
      path: '/_baguette/auth',
      query: { sign: signProxyToken(7) },
      signedCookies: {},
      headers: {},
      url: '/',
    };
    const res = middlewareRes();

    await proxy.middleware(req, res, () => {});

    expect(res.cookie).toHaveBeenCalledWith('baguette_proxy', '7', expect.any(Object));
    expect(res.redirectedTo).toBe('/');
  });

  it('/_baguette/auth rejects a token for an unapproved user without setting a cookie', async () => {
    const proxy = new DevProxy(appWithUsers({ 8: { id: 8, approved: 0 } }), [stubHandlerClass()]);
    const req = {
      path: '/_baguette/auth',
      query: { sign: signProxyToken(8) },
      signedCookies: {},
      headers: {},
      url: '/',
    };
    const res = middlewareRes();

    await proxy.middleware(req, res, () => {});

    expect(res.statusCode).toBe(403);
    expect(res.render).toHaveBeenCalledWith(
      'devserver-denied',
      expect.objectContaining({ title: 'Account pending approval' })
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
