import http from 'http';
import { parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import logger from '../logger.js';
import { verifyProxyToken } from './preview.js';
import { ENCRYPTION_KEY, PUBLIC_HOST } from '../config.js';
import { isPortListening } from './port-utils.js';

const PROXY_COOKIE = 'baguette_proxy';
const PROXY_COOKIE_TTL = 60 * 60 * 1000; // 1 hour
const POLL_INTERVAL_MS = 1000;

/**
 * Handler classes must implement:
 *   constructor(app, req)
 *   isValidHost() → bool
 *   allowUser(userId) → Promise<bool>
 *   get key() → string  (state map key, typically the hostname)
 *   render(res) → Promise<bool>  (returns true if response was handled)
 *   buildTask() → Promise<{ task, exposePort }>
 *   startupTimeoutMs, idleTimeoutMs
 */
export class DevProxy {
  constructor(app, handlerClasses) {
    this.app = app;
    this.handlerClasses = handlerClasses;
    this.states = new Map();
    this.middleware = this.middleware.bind(this);
  }

  // ── Express middleware ────────────────────────────────────────────────────────

  async middleware(req, res, next) {
    const handler = this.handlerClasses.map((H) => new H(this.app, req)).find((h) => h.isValidHost());
    if (!handler) return next();

    // Handle /_baguette/auth before checking the proxy cookie (this is what sets it)
    if (req.path === '/_baguette/auth') {
      const { sign } = req.query;
      if (sign) {
        try {
          const userId = verifyProxyToken(sign);
          this._setProxyCookie(res, String(userId));
          return res.redirect('/');
        } catch (e) {
          logger.error(e, 'Proxy auth token error');
        }
      }
      return next();
    }

    // Check proxy session
    const userId = req.signedCookies?.[PROXY_COOKIE];
    if (!userId) {
      if (req.method !== 'GET') {
        return res.status(401).json({ error: 'Unauthorized', authUrl: `${PUBLIC_HOST}/auth/proxy?service=${encodeURIComponent(handler.subdomain)}` });
      }
      return res.redirect(`${PUBLIC_HOST}/auth/proxy?service=${encodeURIComponent(handler.subdomain)}`);
    }

    if (!await handler.allowUser(userId)) return res.status(403).send('Forbidden');

    this._setProxyCookie(res, userId); // renew TTL

    if (await handler.render(res)) return;

    return this.dispatch(req, res, handler);
  }

  // ── WebSocket upgrade ─────────────────────────────────────────────────────────

  async handleUpgrade(req, socket, head) {
    const handler = this.handlerClasses.map((H) => new H(this.app, req)).find((h) => h.isValidHost());
    if (!handler) { socket.destroy(); return; }

    const userId = this._getWsCookieUserId(req);
    if (!userId) { socket.destroy(); return; }

    try {
      if (!await handler.allowUser(userId)) { socket.destroy(); return; }
    } catch (err) {
      logger.error(err, 'WS allowUser error');
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
      if (state) this._cleanup(key, state);
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    let state = this._getOrFixState(key);
    if (!state) {
      state = await this._startService(handler);
    }

    if (state.status === 'timedout' || state.status === 'crashed' || state.status === 'starting') {
      return res.render('devserver-loading');
    }

    state.lastTraffic = new Date();
    this._resetIdleTimer(key, state, handler.idleTimeoutMs);
    return this._proxyRequest(req, res, state.port);
  }

  async wsDispatch(req, socket, head, handler) {
    const key = handler.key;

    let state = this._getOrFixState(key);
    if (!state) {
      state = await this._startService(handler);
    }

    const ok = await this._waitUntilListeningOrTerminal(state, handler.startupTimeoutMs);
    if (!ok || state.status !== 'listening') {
      socket.destroy();
      return;
    }

    this._resetIdleTimer(key, state, handler.idleTimeoutMs);
    this._proxyUpgrade(req, socket, head, state.port);
  }

  _cleanup(key, state) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    clearTimeout(state.idleTimer);
    if (state.task != null) this.app.service('tasks').deleteTask(state.task.id);
    for (const res of state.sseClients) { try { res.end(); } catch { /* already closed */ } }
    state.sseClients.clear();
    for (const res of state.portalSseClients) { try { res.end(); } catch { /* already closed */ } }
    state.portalSseClients.clear();
    if (this.states.get(key) === state) this.states.delete(key);
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  async _startService(handler) {
    const key = handler.key;

    const state = {
      task: null,
      port: null,
      status: 'starting',
      lastTraffic: null,
      startupTimer: null,
      idleTimer: null,
      pollerInterval: null,
      sseClients: new Set(),
      portalSseClients: new Set(),
    };

    this.states.set(key, state);

    const { task, exposePort } = await handler.buildTask();

    task.onLog((_id, _stream, line) => {
      for (const res of state.sseClients) res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
      for (const res of state.portalSseClients) res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
    });
    task.onExit((_id, code) => {
      if (this.states.get(key) !== state) return;
      if (code !== 0 && state.status === 'starting') this._onCrashed(key, state);
      else this._cleanup(key, state);
    });

    const port = task.ports[exposePort];
    if (!port) {
      this._cleanup(key, state);
      throw new Error('Port not allocated');
    }

    state.task = task;
    state.port = port;

    void task.start().catch((err) => logger.error(err, 'Task startup error'));

    const allPorts = Object.values(task.ports);
    state.pollerInterval = setInterval(async () => {
      const results = await Promise.all(allPorts.map(isPortListening));
      if (results.every(Boolean)) this._onListening(key, state, handler.idleTimeoutMs);
    }, POLL_INTERVAL_MS);

    state.startupTimer = setTimeout(() => {
      if (state.status !== 'starting') return;
      state.status = 'timedout';
      clearInterval(state.pollerInterval);
      this.app.service('tasks').deleteTask(state.task.id);
      for (const res of state.sseClients) { res.write(`event: timeout\ndata: {}\n\n`); res.end(); }
      state.sseClients.clear();
    }, handler.startupTimeoutMs);

    return state;
  }

  _getOrFixState(key) {
    const state = this.states.get(key);
    if (!state) return null;
    // Keep terminal states until the user explicitly retries
    if (state.status === 'crashed' || state.status === 'timedout') return state;
    if (state.task != null) {
      const liveTask = this.app.service('tasks').getTask(state.task.id);
      if (!liveTask || liveTask.status === 'exited') {
        this._cleanup(key, state);
        return null;
      }
    }
    return state;
  }

  _onListening(key, state, idleTimeoutMs) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    state.status = 'listening';
    for (const res of state.sseClients) { res.write(`event: ready\ndata: {}\n\n`); res.end(); }
    state.sseClients.clear();
    for (const res of state.portalSseClients) res.write(`event: ready\ndata: {}\n\n`);
    this._resetIdleTimer(key, state, idleTimeoutMs);
  }

  _onCrashed(key, state) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    state.status = 'crashed';
    for (const res of state.sseClients) { res.write(`event: error\ndata: {}\n\n`); res.end(); }
    state.sseClients.clear();
    for (const res of state.portalSseClients) res.write(`event: error\ndata: {}\n\n`);
  }

  _resetIdleTimer(key, state, idleTimeoutMs) {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      if (this.states.get(key) === state) this._cleanup(key, state);
    }, idleTimeoutMs);
  }

  _serveSseLogs(req, res, key) {
    const state = this.states.get(key);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    if (!state) { res.end(); return; }

    if (state.task != null) {
      const buffered = state.task.getLogs?.();
      if (buffered) res.write(`event: log\ndata: ${JSON.stringify(buffered)}\n\n`);
    }

    if (state.status === 'listening') { res.write(`event: ready\ndata: {}\n\n`); res.end(); return; }
    if (state.status === 'timedout') { res.write(`event: timeout\ndata: {}\n\n`); res.end(); return; }
    if (state.status === 'crashed') { res.write(`event: error\ndata: {}\n\n`); res.end(); return; }

    state.sseClients.add(res);
    req.on('close', () => state.sseClients.delete(res));
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

  _proxyRequest(req, res, port) {
    const proxyReq = http.request(
      { hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => { res.writeHead(proxyRes.statusCode, proxyRes.headers); proxyRes.pipe(res); }
    );
    proxyReq.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Bad Gateway'); });
    req.pipe(proxyReq);
  }

  _proxyUpgrade(req, socket, head, port) {
    const proxyReq = http.request(
      { agent: false, hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => { if (proxyRes.statusCode !== 101) socket.destroy(); }
    );

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}`];
      for (const [k, value] of Object.entries(proxyRes.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) { for (const v of value) lines.push(`${k}: ${v}`); }
        else lines.push(`${k}: ${value}`);
      }
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (proxyHead?.length) socket.write(proxyHead);
      if (head?.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
    });

    proxyReq.on('error', (err) => { logger.error({ err: err.message }, 'Proxy upgrade error'); socket.destroy(); });
    proxyReq.end();
  }

  _waitUntilListeningOrTerminal(state, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (state.status === 'listening') { resolve(true); return; }
        if (state.status === 'timedout' || state.status === 'crashed') { resolve(false); return; }
        if (Date.now() - start > timeoutMs) { resolve(false); return; }
        setTimeout(tick, POLL_INTERVAL_MS);
      };
      tick();
    });
  }
}
