import { extractSessionIdFromHost } from './preview.js';
import { getPreviewServiceDefinitions, resolvePreviewServiceConfig } from './preview-services.js';
import { loadBaguetteConfig } from './baguette-config.js';
import { PUBLIC_HOST } from '../config.js';
import { DEFAULT_TTL_MS } from './task.js';

const SESSION_UNAVAILABLE_TITLE = 'Session not found';
const SESSION_UNAVAILABLE_MESSAGE = 'This session does not exist or was archived.';

function isSessionUnavailable(session) {
  return !session || session.archived_at;
}

export class DevserverHandler {
  startupTimeoutMs = 1 * 60 * 1000;

  constructor(app, req) {
    this.app = app;
    this.req = req;
    this.host = (req.headers.host || '').split(':')[0];
    const parsed = extractSessionIdFromHost(this.host);
    this.shortId = parsed?.shortId ?? null;
    this.serviceName = parsed?.serviceName ?? null; // null = portal host
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
    return !!getPreviewServiceDefinitions(config, this.shortId)?.length;
  }

  async allowUser(userId, res) {
    const session = await this.getSession();

    if (isSessionUnavailable(session)) {
      this._renderDenied(res, 404, SESSION_UNAVAILABLE_TITLE, SESSION_UNAVAILABLE_MESSAGE);
      return false;
    }

    if (session.is_preview_public) return true;

    if (userId && (session.is_preview_users_public ?? true)) return true;

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
        'No preview services are configured for this session.'
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
    if (isSessionUnavailable(session) || !session.is_preview_ip_public) return false;
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
    const definitions = getPreviewServiceDefinitions(config, this.shortId);
    if (!definitions?.length || this.serviceName !== null) return false;

    if (definitions.length === 1) {
      res.redirect(302, definitions[0].url);
      return true;
    }

    const services = definitions.map((svc) => ({
      name: svc.display_name,
      slug: svc.name,
      description: svc.description ?? '',
      url: svc.url,
      deep_link_url: svc.deep_link_url,
    }));
    const session = await this.getSession();
    res.render('portal', {
      services,
      sessionLabel: session?.label ?? null,
    });
    return true;
  }

  async buildTask() {
    const session = await this.getSession();
    const config = await this._getConfig();
    const serviceConfig = resolvePreviewServiceConfig(config, this.serviceName);
    if (!serviceConfig) {
      const label = this.serviceName ?? 'portal';
      throw new Error(`No preview service config for "${label}"`);
    }
    const publicTask = await this.app.service('tasks').create(
      {
        session_id: session.id,
        task_key: serviceConfig.taskKey,
        autoStart: false,
        ttl_ms: DEFAULT_TTL_MS,
      },
      { user: { id: session.user_id } }
    );
    const task = this.app.service('tasks').getTask(publicTask.id);
    return { task, exposePort: serviceConfig.expose };
  }
}
