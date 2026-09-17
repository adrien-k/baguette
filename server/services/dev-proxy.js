import http from 'http';
import { parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import logger from '../logger.js';
import { verifyPreviewToken } from './preview.js';
import { ENCRYPTION_KEY } from '../config.js';
import { isPortListening } from './port-utils.js';

const PREVIEW_COOKIE_TTL = 60 * 60 * 1000; // 1 hour
const POLL_INTERVAL_MS = 1000;

/**
 * Single entry point for all session subdomain traffic.
 * Owns: auth cookie flow, state machine, dispatch loop, WS proxying.
 * Handlers own: subdomain matching, task creation params, error messages.
 */
export class DevProxy {
  constructor(app, handlers) {
    this.app = app;
    this.handlers = handlers; // ordered most-specific first
    this.states = new Map();  // "sessionId:serviceKey" → state
  }

  _findHandler(req) {
    return this.handlers.find((h) => h.matches(req)) ?? null;
  }

  // undefined = no handler matched; null = session not found; else session row
  async previewSession(req) {
    const handler = this._findHandler(req);
    if (!handler) return undefined;
    return handler.previewSession(req, this.app);
  }

  async handleRequest(req, res, session) {
    const handler = this._findHandler(req);
    const previewRoute = handler.getPreviewRoute(session);

    if (req.path === '/_baguette/auth') {
      const { sign } = req.query;
      if (sign) {
        try {
          const shortId = verifyPreviewToken(sign);
          if (shortId !== session.short_id) throw new Error('Session mismatch');
          this._setPreviewCookie(res, session.short_id);
          return res.redirect('/');
        } catch (e) {
          logger.error(e, 'Preview auth token error');
        }
      }
    }

    const previewCookie = req.signedCookies?.baguette_preview;
    if (previewCookie !== session.short_id) {
      if (req.method !== 'GET') {
        return res.status(401).json({ error: 'Unauthorized', authUrl: previewRoute });
      }
      return res.redirect(previewRoute);
    }

    this._setPreviewCookie(res, session.short_id); // renew TTL
    return handler.handleAuthenticated(req, res, session, this);
  }

  async handleUpgrade(req, socket, head, session) {
    const handler = this._findHandler(req);
    const shortId = this._getWsCookieShortId(req);
    if (!shortId || shortId !== session.short_id) {
      socket.destroy();
      return;
    }
    return handler.handleUpgrade(req, socket, head, session, this);
  }

  // Called by handlers to dispatch a single-service request
  async dispatch(req, res, session, handler, key) {
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
      state = await this._startService(session, handler, key);
    }

    if (state.status === 'timedout' || state.status === 'crashed') {
      const { title, message } = handler.getErrorMessages(state.status);
      return res
        .status(state.status === 'crashed' ? 500 : 504)
        .render('devserver-error', { title, message });
    }

    if (state.status === 'starting') {
      return res.render('devserver-loading');
    }

    state.lastTraffic = new Date();
    this._resetIdleTimer(key, state, handler.idleTimeoutMs);
    return this._proxyRequest(req, res, state.port);
  }

  // Called by handlers to dispatch a WS upgrade
  async wsDispatch(req, socket, head, session, handler, key) {
    let state = this._getOrFixState(key);
    if (!state) {
      state = await this._startService(session, handler, key);
    }

    const ok = await this._waitUntilListeningOrTerminal(state, handler.startupTimeoutMs);
    if (!ok || state.status !== 'listening') {
      socket.destroy();
      return;
    }

    this._resetIdleTimer(key, state, handler.idleTimeoutMs);
    this._proxyUpgrade(req, socket, head, state.port);
  }

  async _startService(session, handler, key) {
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

    const taskConfig = await handler.buildTask(this.app, session, key);

    const publicTask = await this.app.service('tasks').create(
      {
        session_id: session.id,
        command: taskConfig.command,
        label: taskConfig.label,
        ports: taskConfig.ports,
        ...(taskConfig.taskKey ? { task_key: taskConfig.taskKey } : {}),
        onLog: (_id, _stream, line) => {
          for (const res of state.sseClients) res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
          for (const res of state.portalSseClients) res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
        },
        onExit: (_id, code) => {
          if (this.states.get(key) !== state) return;
          if (code !== 0 && state.status === 'starting') this._onCrashed(key, state);
          else this._cleanup(key, state);
        },
      },
      { user: { id: session.user_id } }
    );

    const task = this.app.service('tasks').getTask(publicTask.id);
    const port = task.ports[taskConfig.exposePort];
    if (!port) {
      this._cleanup(key, state);
      throw new Error(`Port "${taskConfig.exposePort}" not allocated`);
    }

    state.task = task;
    state.port = port;

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

  _setPreviewCookie(res, shortId) {
    res.cookie('baguette_preview', shortId, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: PREVIEW_COOKIE_TTL,
    });
  }

  _getWsCookieShortId(req) {
    const cookies = parseCookie(req.headers.cookie || '');
    const signed = cookies['baguette_preview'] || '';
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
