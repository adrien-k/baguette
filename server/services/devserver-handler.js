import { extractSessionIdFromHost, signProxyToken, getServicePreviewHost } from './preview.js';
import { loadBaguetteConfig, resolveWebserverConfig, resolveServicesConfig } from './baguette-config.js';

const POLL_INTERVAL_MS = 1000;

export class DevserverHandler {
  startupTimeoutMs = 1 * 60 * 1000;
  idleTimeoutMs = 5 * 60 * 1000;

  matchesHost(host) {
    return !!extractSessionIdFromHost(host);
  }

  async matchesUser(req, userId, app) {
    const host = (req.headers.host || '').split(':')[0];
    const parsed = extractSessionIdFromHost(host);
    if (!parsed) return null;
    const session = await app.get('db')('sessions').where({ short_id: parsed.shortId }).first();
    if (!session) return null;
    // Allow session owner or public previews
    if (!session.is_preview_public && String(session.user_id) !== String(userId)) return null;
    const config = await loadBaguetteConfig(session.worktree_path);
    const hasWebserver = !!config?.webserver;
    const hasServices = !hasWebserver && !!(config && resolveServicesConfig(config));
    if (!hasWebserver && !hasServices) return null;
    return session;
  }

  getErrorMessages(reason) {
    return reason === 'crashed'
      ? { title: 'Dev server exited', message: 'The dev server process exited with a non-zero code.' }
      : { title: 'Dev server timed out', message: 'The dev server did not become ready within the timeout period.' };
  }

  async handleAuthenticated(req, res, session, devProxy) {
    const parsed = extractSessionIdFromHost((req.headers.host || '').split(':')[0]);
    const { serviceName } = parsed ?? { serviceName: null };

    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    const servicesConfig = resolveServicesConfig(baguetteConfig);

    if (servicesConfig && !serviceName) {
      return this._handlePortal(req, res, session, devProxy, servicesConfig);
    }

    const effectiveServiceName = serviceName ?? 'default';
    return devProxy.dispatch(req, res, session, this, `${session.id}:${effectiveServiceName}`);
  }

  async handleUpgrade(req, socket, head, session, devProxy) {
    const host = (req.headers.host || '').split(':')[0];
    const parsed = extractSessionIdFromHost(host);
    if (!parsed) { socket.destroy(); return; }

    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    const serviceName = parsed.serviceName ?? 'default';
    if (!this._resolveServiceConfig(baguetteConfig, serviceName)) { socket.destroy(); return; }

    return devProxy.wsDispatch(req, socket, head, session, this, `${session.id}:${serviceName}`);
  }

  async buildTask(app, session, key) {
    const serviceName = key.slice(String(session.id).length + 1);
    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    const webserverConfig = this._resolveServiceConfig(baguetteConfig, serviceName);
    if (!webserverConfig) throw new Error(`No webserver config for service "${serviceName}"`);
    const publicTask = await app.service('tasks').create(
      {
        session_id: session.id,
        command: webserverConfig.command,
        label: `baguette:webserver:${serviceName}`,
        ports: Array.isArray(webserverConfig.ports) ? webserverConfig.ports : [],
        ...(webserverConfig.taskKey ? { task_key: webserverConfig.taskKey } : {}),
        autoStart: false,
      },
      { user: { id: session.user_id } }
    );
    const task = app.service('tasks').getTask(publicTask.id);
    return { task, exposePort: webserverConfig.expose };
  }

  _resolveServiceConfig(baguetteConfig, serviceName) {
    if (serviceName === 'default') return resolveWebserverConfig(baguetteConfig);
    const services = resolveServicesConfig(baguetteConfig);
    return services?.find((s) => s.name === serviceName) ?? null;
  }

  async _handlePortal(req, res, session, devProxy, servicesConfig) {
    const sessionId = session.id;

    if (req.url === '/_baguette/services') {
      return this._serveServicesSSE(req, res, sessionId, servicesConfig, devProxy);
    }

    if (req.url.startsWith('/_baguette/service-logs')) {
      const svcName = new URL(req.url, 'http://x').searchParams.get('service');
      if (!svcName || !servicesConfig.find((s) => s.name === svcName)) return res.status(404).end();
      return this._serveServiceLogsForPortal(req, res, sessionId, svcName, devProxy);
    }

    if (req.method === 'POST' && req.url.startsWith('/_baguette/service-retry')) {
      const svcName = new URL(req.url, 'http://x').searchParams.get('service');
      const key = svcName && `${sessionId}:${svcName}`;
      const state = key && devProxy.states.get(key);
      if (state) devProxy._cleanup(key, state);
      return res.status(204).end();
    }

    const serviceStatuses = servicesConfig.map((svc) => {
      const state = devProxy.states.get(`${sessionId}:${svc.name}`);
      return {
        name: svc.name,
        status: state?.status ?? 'stopped',
        url: getServicePreviewHost(session.short_id, svc.name),
        token: signProxyToken(session.user_id),
      };
    });

    return res.render('portal', { services: serviceStatuses });
  }

  _serveServicesSSE(req, res, sessionId, servicesConfig, devProxy) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const sendStatus = () => {
      for (const svc of servicesConfig) {
        const state = devProxy.states.get(`${sessionId}:${svc.name}`);
        res.write(`event: status\ndata: ${JSON.stringify({ service: svc.name, status: state?.status ?? 'stopped' })}\n\n`);
      }
    };

    sendStatus();
    const interval = setInterval(sendStatus, POLL_INTERVAL_MS);
    req.on('close', () => clearInterval(interval));
  }

  _serveServiceLogsForPortal(req, res, sessionId, serviceName, devProxy) {
    const state = devProxy.states.get(`${sessionId}:${serviceName}`);

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

    if (state.status === 'listening') res.write(`event: ready\ndata: {}\n\n`);
    else if (state.status === 'timedout') res.write(`event: timeout\ndata: {}\n\n`);
    else if (state.status === 'crashed') res.write(`event: error\ndata: {}\n\n`);

    state.portalSseClients.add(res);
    req.on('close', () => state.portalSseClients.delete(res));
  }
}
