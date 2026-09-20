import { extractSessionIdFromHost, getServicePreviewHost } from './preview.js';
import {
  loadBaguetteConfig,
  resolveWebserverConfig,
  resolveServicesConfig,
} from './baguette-config.js';
import { PUBLIC_HOST } from '../config.js';

export class DevserverHandler {
  startupTimeoutMs = 1 * 60 * 1000;

  constructor(app, req) {
    this.app = app;
    this.req = req;
    this.host = (req.headers.host || '').split(':')[0];
    const parsed = extractSessionIdFromHost(this.host);
    this.shortId = parsed?.shortId ?? null;
    this.serviceName = parsed?.serviceName ?? null; // null = portal / single-service root
    this._sessionPromise = null;
    this._configPromise = null;
  }

  isValidHost() {
    return !!this.shortId;
  }

  async getSession() {
    this._sessionPromise ??= this.app
      .get('db')('sessions')
      .where({ short_id: this.shortId })
      .first()
      .then((s) => s ?? null);
    return this._sessionPromise;
  }

  async _getConfig() {
    this._configPromise ??= this.getSession().then((s) =>
      s ? loadBaguetteConfig(s.worktree_path) : null
    );
    return this._configPromise;
  }

  async _hasPreviewConfig() {
    const config = await this._getConfig();
    const hasWebserver = !!config?.webserver;
    const hasServices = !hasWebserver && !!(config && resolveServicesConfig(config));
    return hasWebserver || hasServices;
  }

  async allowUser(userId, res) {
    const session = await this.getSession();

    if (!session) {
      this._renderDenied(res, 404, 'Session not found', 'This preview session no longer exists.');
      return false;
    }

    if (session.is_preview_public) return true;

    if (String(session.user_id) !== String(userId)) {
      this._renderDenied(
        res,
        403,
        'Access denied',
        "You don't have permission to view this preview."
      );
      return false;
    }

    if (!(await this._hasPreviewConfig())) {
      this._renderDenied(
        res,
        404,
        'No preview available',
        'No webserver or services are configured for this session.'
      );
      return false;
    }

    return true;
  }

  _renderDenied(res, status, title, message) {
    if (!res) return; // WS upgrade path has no response to render into
    res.status(status).render('devserver-denied', { title, message, backUrl: PUBLIC_HOST });
  }

  /** Unauthenticated access for the IP that started the dev server (when enabled on session). */
  async allowIpPublicAccess(clientIp, proxyState) {
    const session = await this.getSession();
    if (!session?.is_preview_ip_public) return false;
    if (!proxyState?.starterIp || proxyState.starterIp !== clientIp) return false;
    if (proxyState.status === 'crashed') return false;
    return this._hasPreviewConfig();
  }

  get key() {
    return this.host;
  }

  get subdomain() {
    return this.host.split('.')[0];
  }

  async render(res) {
    const config = await this._getConfig();
    const servicesConfig = resolveServicesConfig(config);
    if (!servicesConfig || this.serviceName !== null) return false;
    const services = servicesConfig.map((svc) => ({
      name: svc.name,
      url: getServicePreviewHost(this.shortId, svc.name),
    }));
    res.render('portal', { services });
    return true;
  }

  async buildTask() {
    const session = await this.getSession();
    const config = await this._getConfig();
    const effectiveServiceName = this.serviceName ?? 'default';
    const webserverConfig = this._resolveServiceConfig(config, effectiveServiceName);
    if (!webserverConfig)
      throw new Error(`No webserver config for service "${effectiveServiceName}"`);
    const publicTask = await this.app.service('tasks').create(
      {
        session_id: session.id,
        command: webserverConfig.command,
        label: `baguette:webserver:${effectiveServiceName}`,
        ports: Array.isArray(webserverConfig.ports) ? webserverConfig.ports : [],
        ...(webserverConfig.taskKey ? { task_key: webserverConfig.taskKey } : {}),
        autoStart: false,
      },
      { user: { id: session.user_id } }
    );
    const task = this.app.service('tasks').getTask(publicTask.id);
    return { task, exposePort: webserverConfig.expose };
  }

  _resolveServiceConfig(baguetteConfig, serviceName) {
    if (serviceName === 'default') return resolveWebserverConfig(baguetteConfig);
    const services = resolveServicesConfig(baguetteConfig);
    return services?.find((s) => s.name === serviceName) ?? null;
  }
}
