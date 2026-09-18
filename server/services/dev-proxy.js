import http from 'http';
import { parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import logger from '../logger.js';
import { verifyProxyToken } from './preview.js';
import { ENCRYPTION_KEY, PUBLIC_HOST } from '../config.js';

const PROXY_COOKIE = 'baguette_proxy';
const PROXY_COOKIE_TTL = 60 * 60 * 1000; // 1 hour
const POLL_INTERVAL_MS = 1000;

function writeSseLog(res, line)  { res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`); }
function writeSseReady(res)      { res.write(`event: ready\ndata: {}\n\n`); }
function writeSseError(res, err) { res.write(`event: error\ndata: ${JSON.stringify({ message: err?.message ?? 'Unknown error' })}\n\n`); }

class SseChannel {
  #clients = new Set();

  add(req, res) {
    this.#clients.add(res);
    req.on('close', () => this.#clients.delete(res));
  }

  log(line)  { for (const res of this.#clients) writeSseLog(res, line); }

  ready() {
    for (const res of this.#clients) { writeSseReady(res); res.end(); }
    this.#clients.clear();
  }

  error(err) {
    for (const res of this.#clients) { writeSseError(res, err); res.end(); }
    this.#clients.clear();
  }

  closeAll() {
    for (const res of this.#clients) { try { res.end(); } catch { /* already closed */ } }
    this.#clients.clear();
  }
}

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

    let state = this.states.get(key);
    if (!state) {
      state = await this._startService(handler)
    }

    if (state.status === 'crashed' || state.status === 'starting') {
      return res.render('devserver-loading');
    }

    this._resetIdleTimer(key, state, handler.idleTimeoutMs);
    return this._proxyRequest(req, res, state.port);
  }

  async wsDispatch(req, socket, head, handler) {
    const key = handler.key;

    let state = this.states.get(key);
    if (!state) {
      state = await this._startService(handler);
    }
    
    try {
      await state.task.waitForReady({ timeout: handler.startupTimeoutMs });
    } catch (err) {
      this._onCrashed(key, state, err);
      socket.destroy();
      return;
    }

    this._resetIdleTimer(key, state, handler.idleTimeoutMs);
    this._proxyUpgrade(req, socket, head, state.port);
  }

  _cleanup(key, state) {
    clearTimeout(state.idleTimer);
    state.unsubLog?.();
    state.unsubExit?.();
    if (state.task != null) this.app.service('tasks').deleteTask(state.task.id);
    state.sseClients.closeAll();
    if (this.states.get(key) === state) this.states.delete(key);
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  async _startService(handler) {
    const key = handler.key;
    const state = {
      task: null,
      port: null,
      status: 'starting',
      idleTimer: null,
      sseClients: new SseChannel(),
      unsubLog: null,
      unsubExit: null,
    };

    this.states.set(key, state);
    try {
      const { task, exposePort } = await handler.buildTask();

      state.task = task;
      state.unsubLog = task.onLog((_id, _stream, line) => state.sseClients.log(line));
      state.unsubExit = task.onExit((_id, code) => {
        if (this.states.get(key) !== state) return;
        if (code !== 0 && state.status === 'starting') this._onCrashed(key, state);
      });

      task.start();
      
      (async () => {
        try {
          await task.waitForReady({ timeout: handler.startupTimeoutMs });
          const port = task.ports[exposePort];
          if (!port) {
            throw new Error('Port not allocated');
          }

          this._onListening(key, state, port, handler.idleTimeoutMs);
        } catch (err) {
          this._onCrashed(key, state, err);
        }
      })();
      
      return state;
    } catch (err) {
      this._onCrashed(key, state, err);
      return state;
    }
  }

  _onListening(key, state, port, idleTimeoutMs) {
    state.port = port;
    state.status = 'listening';
    state.sseClients.ready();
    this._resetIdleTimer(key, state, idleTimeoutMs);
  }

  _onCrashed(key, state, error) {
    if (state.status === 'crashed') return;
    state.status = 'crashed';
    state.error = error;
    state.sseClients.error(error);
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
      if (buffered) writeSseLog(res, buffered);
    }

    if (state.status === 'listening') { writeSseReady(res); res.end(); return; }
    if (state.status === 'crashed') { writeSseError(res, state.error); res.end(); return; }

    state.sseClients.add(req, res);
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

}
