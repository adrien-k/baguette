import http from 'http';
import { parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import logger from '../logger.js';
import { verifyProxyToken } from './preview.js';
import { ENCRYPTION_KEY, PUBLIC_HOST } from '../config.js';
import { getClientIp } from '../lib/client-ip.js';
import { SseManager } from '../lib/sse-manager.js';
import { toSafePath } from '../lib/safe-path.js';
import { getLoopbackHost } from './port-utils.js';

const PROXY_COOKIE = 'baguette_proxy';
const PROXY_COOKIE_TTL = 60 * 60 * 1000; // 1 hours
const WEBSERVER_STARTUP_TIMEOUT_MS = 60 * 1000;

/**
 * Handler classes must implement:
 *   constructor(app, req)
 *   isValidHost() → bool
 *   allowUser(userId) → Promise<bool>
 *   get key() → string  (state map key, typically the hostname)
 *   render(res) → Promise<bool>  (returns true if response was handled)
 *   buildTask() → Promise<{ task, exposePort }>
 *   startupTimeoutMs
 */
export class DevProxy {
  constructor(app, handlerClasses) {
    this.app = app;
    this.handlerClasses = handlerClasses;
    this.states = new Map();
    this.sse = new SseManager({ replay: true });
    this.middleware = this.middleware.bind(this);
  }

  // ── Express middleware ────────────────────────────────────────────────────────

  async middleware(req, res, next) {
    const handler = this.handlerClasses
      .map((H) => new H(this.app, req))
      .find((h) => h.isValidHost());
    if (!handler) return next();

    // Handle /_baguette/auth before checking the proxy cookie (this is what sets it)
    if (req.path === '/_baguette/auth') {
      const { sign } = req.query;
      if (sign) {
        try {
          const userId = verifyProxyToken(sign);
          this._setProxyCookie(res, String(userId));
          const dest = toSafePath(req.query.redirectTo) ?? '/';
          return res.redirect(dest);
        } catch (e) {
          logger.error(e, 'Proxy auth token error');
        }
      }
      return next();
    }

    const clientIp = getClientIp(req);
    const access = await this._resolveProxyAccess(
      handler,
      req.signedCookies?.[PROXY_COOKIE],
      clientIp
    );
    if (access.needsAuth) {
      if (req.method !== 'GET') {
        return res.status(401).json({
          error: 'Unauthorized',
          authUrl: `${PUBLIC_HOST}/auth/proxy?service=${encodeURIComponent(handler.subdomain)}`,
        });
      }
      const redirectToParam = req.url ? `&redirectTo=${encodeURIComponent(req.url)}` : '';
      return res.redirect(
        `${PUBLIC_HOST}/auth/proxy?service=${encodeURIComponent(handler.subdomain)}${redirectToParam}`
      );
    }

    if (!(await this._authorizeHandler(handler, access, res))) return;

    if (access.userId) this._setProxyCookie(res, access.userId); // renew TTL

    if (await handler.render(res)) return;

    return this.dispatch(req, res, handler);
  }

  // ── WebSocket upgrade ─────────────────────────────────────────────────────────

  async handleUpgrade(req, socket, head) {
    const handler = this.handlerClasses
      .map((H) => new H(this.app, req))
      .find((h) => h.isValidHost());
    if (!handler) {
      socket.destroy();
      return;
    }

    const clientIp = getClientIp(req);
    const access = await this._resolveProxyAccess(handler, this._getWsCookieUserId(req), clientIp);
    if (access.needsAuth) {
      socket.destroy();
      return;
    }

    try {
      if (!(await this._authorizeHandler(handler, access))) {
        socket.destroy();
        return;
      }
    } catch (err) {
      logger.error(err, 'WS proxy authorize error');
      socket.destroy();
      return;
    }

    try {
      await this.wsDispatch(req, socket, head, handler);
    } catch (err) {
      logger.error(err, 'WebSocket upgrade failed');
      socket.destroy();
    }
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────────

  async dispatch(req, res, handler) {
    const key = handler.key;

    if (req.url === '/_baguette/logs') {
      return this._serveSseLogs(req, res, key);
    }
    if (req.method === 'POST' && req.url === '/_baguette/retry') {
      const state = this.states.get(key);
      if (state) this._releaseProxyState(key, state, { stopRunningTask: true });
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    let state = this.states.get(key);
    if (!state) {
      state = await this._startService(handler, getClientIp(req));
    }

    if (state.status === 'crashed' || state.status === 'starting') {
      return res.render('devserver-loading');
    }

    state.task?.heartbeat();
    return this._proxyRequest(req, res, state.port, state.loopbackHost);
  }

  async wsDispatch(req, socket, head, handler) {
    const key = handler.key;

    let state = this.states.get(key);
    if (!state) {
      state = await this._startService(handler, getClientIp(req));
    }

    try {
      await state.task.waitForReady({ timeoutMs: handler.startupTimeoutMs });
    } catch (err) {
      this._onCrashed(key, state, err);
      socket.destroy();
      return;
    }

    state.task?.heartbeat();
    this._proxyUpgrade(req, socket, head, state.port, state.loopbackHost);
  }

  /**
   * Detach proxy state from a task without removing it from the task store (logs/history stay in the UI).
   * @param {{ stopRunningTask?: boolean }} opts - kill a still-running child on retry, but keep the task row
   */
  _releaseProxyState(key, state, { stopRunningTask = false } = {}) {
    state.unsubLog?.();
    state.unsubExit?.();
    const task = state.task;
    if (stopRunningTask && task?.status === 'running') {
      void task.kill().catch((err) => logger.error(err, 'Error stopping preview task on retry'));
    }
    this.sse.purgeChannel(key);
    if (this.states.get(key) === state) this.states.delete(key);
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  async _resolveProxyAccess(handler, userId, clientIp) {
    if (userId) return { userId, clientIp, needsAuth: false, ipBypass: false };
    const state = this.states.get(handler.key);
    if (handler.allowIpPublicAccess) {
      try {
        if (await handler.allowIpPublicAccess(clientIp, state)) {
          return { userId: null, clientIp, needsAuth: false, ipBypass: true };
        }
      } catch (err) {
        logger.error(err, 'allowIpPublicAccess error');
      }
    }
    return { userId: null, clientIp, needsAuth: true, ipBypass: false };
  }

  async _authorizeHandler(handler, access, res) {
    if (access.ipBypass) return true;
    return handler.allowUser(access.userId, res);
  }

  /**
   * Register an already-created webserver task with the proxy (e.g. started from the Preview tab).
   */
  attachWebserverTask(key, task, exposePort, { starterIp = null, startupTimeoutMs } = {}) {
    const timeoutMs = startupTimeoutMs ?? WEBSERVER_STARTUP_TIMEOUT_MS;
    const existing = this.states.get(key);
    if (existing?.task?.id === task.id) return existing;
    if (existing) this._releaseProxyState(key, existing);

    const state = {
      task,
      port: null,
      status: 'starting',
      starterIp: starterIp ?? null,
      unsubLog: null,
      unsubExit: null,
    };
    this.states.set(key, state);
    this._wireTaskToProxy(key, state, exposePort, timeoutMs);
    return state;
  }

  async _startService(handler, starterIp) {
    const key = handler.key;
    const state = {
      task: null,
      port: null,
      status: 'starting',
      starterIp: starterIp ?? null,
      unsubLog: null,
      unsubExit: null,
    };

    this.states.set(key, state);
    try {
      const { task, exposePort } = await handler.buildTask();
      state.task = task;
      task.start();
      this._wireTaskToProxy(key, state, exposePort, handler.startupTimeoutMs);
      return state;
    } catch (err) {
      this._onCrashed(key, state, err);
      return state;
    }
  }

  _wireTaskToProxy(key, state, exposePort, startupTimeoutMs) {
    const task = state.task;
    // The loading page shows the whole startup story, so it streams the dependency tree too
    // (the task's own log only records that a pre-requisite ran).
    const buffered = task.getLogs?.({ includeNestedTasks: true });
    if (buffered) this.sse.send(key, { event: 'log', data: buffered });
    state.unsubLog = task.onLog(
      (_id, _stream, line) => this.sse.send(key, { event: 'log', data: line }),
      { includeNestedTasks: true }
    );
    state.unsubExit = task.onExit((_id, code) => {
      if (this.states.get(key) !== state) return;
      if (state.status === 'starting') {
        if (code !== 0) this._onCrashed(key, state);
      } else if (state.status === 'listening') {
        // An idle-TTL stop is transparent: drop the state so the next request boots a fresh
        // server. Any other exit (Stop from the Preview tab, or a crash) keeps the state so
        // opening the preview link shows the task logs and the Retry button.
        if (task.kill_reason === 'ttl') this._releaseProxyState(key, state);
        else this._onExited(key, state, code);
      }
    });

    (async () => {
      try {
        const portEnv = exposePort;
        if (task.status === 'running' && portEnv && task.ports[portEnv]) {
          const port = task.ports[portEnv];
          const loopbackHost = await getLoopbackHost(port);
          if (loopbackHost) {
            this._onListening(key, state, port, loopbackHost);
            return;
          }
        }
        await task.waitForReady({ timeoutMs: startupTimeoutMs });
        const port = task.ports[exposePort];
        if (!port) {
          throw new Error('Port not allocated');
        }
        const loopbackHost = await getLoopbackHost(port);
        if (!loopbackHost) {
          throw new Error('Port not listening on loopback');
        }
        this._onListening(key, state, port, loopbackHost);
      } catch (err) {
        this._onCrashed(key, state, err);
      }
    })();
  }

  _onListening(key, state, port, loopbackHost = '127.0.0.1') {
    state.port = port;
    state.loopbackHost = loopbackHost;
    state.status = 'listening';
    this.sse.send(key, { event: 'ready' });
    this.sse.closeChannel(key);
  }

  /**
   * The server exited after it had come up (stopped from the Preview tab, or crashed).
   * Keep the proxy state — status `crashed` means "terminal, not serving" — so the preview page
   * renders the task logs plus the Retry button instead of silently starting a new server.
   */
  _onExited(key, state, code) {
    state.unsubLog?.();
    state.port = null;
    state.status = 'crashed';
    const message = state.task?.kill_reason
      ? 'Dev server was stopped.'
      : `Dev server exited${code != null ? ` with code ${code}` : ''}.`;
    // The replay log still holds the `ready` event from when the server came up, which would make
    // the loading page reload in a loop. Rebuild it from the task logs plus this exit.
    this.sse.purgeChannel(key);
    const buffered = state.task?.getLogs?.({ includeNestedTasks: true });
    if (buffered) this.sse.send(key, { event: 'log', data: buffered });
    this.sse.send(key, { event: 'error', data: { message } });
    this.sse.closeChannel(key);
  }

  _onCrashed(key, state, error) {
    if (state.status === 'crashed') return;
    state.status = 'crashed';
    state.error = error;
    this.sse.send(key, { event: 'error', data: { message: error?.message ?? 'Unknown error' } });
    this.sse.closeChannel(key);
  }

  _serveSseLogs(req, res, key) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    if (!this.states.get(key)) {
      res.end();
      return;
    }

    this.sse.subscribe(req, res, key);
  }

  _setProxyCookie(res, userId) {
    res.cookie(PROXY_COOKIE, userId, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: PROXY_COOKIE_TTL,
    });
  }

  _getWsCookieUserId(req) {
    const cookies = parseCookie(req.headers.cookie || '');
    const signed = cookies[PROXY_COOKIE] || '';
    return signed.startsWith('s:') ? unsign(signed.slice(2), ENCRYPTION_KEY) : false;
  }

  _proxyRequest(req, res, port, hostname = '127.0.0.1') {
    const proxyReq = http.request(
      { hostname, port, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Bad Gateway');
    });
    req.pipe(proxyReq);
  }

  _proxyUpgrade(req, socket, head, port, hostname = '127.0.0.1') {
    const proxyReq = http.request(
      {
        agent: false,
        hostname,
        port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        if (proxyRes.statusCode !== 101) socket.destroy();
      }
    );

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}`];
      for (const [k, value] of Object.entries(proxyRes.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) lines.push(`${k}: ${v}`);
        } else lines.push(`${k}: ${value}`);
      }
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (proxyHead?.length) socket.write(proxyHead);
      if (head?.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
    });

    proxyReq.on('error', (err) => {
      logger.error({ err: err.message }, 'Proxy upgrade error');
      socket.destroy();
    });
    proxyReq.end();
  }
}
