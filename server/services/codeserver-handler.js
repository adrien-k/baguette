import { PUBLIC_API_URL } from '../config.js';
import { buildSessionHostname } from './preview.js';
import { DEFAULT_TTL_MS } from './task.js';
import logger from '../logger.js';

const CODE_DOMAIN_PREFIX = 'code';

const codeHostname = buildSessionHostname(new URL(PUBLIC_API_URL).hostname, CODE_DOMAIN_PREFIX);

export class CodeServerHandler {
  startupTimeoutMs = 2 * 60 * 1000;

  constructor(app, req) {
    this.app = app;
    this.req = req;
    this.host = (req.headers.host || '').split(':')[0];
  }

  isValidHost() {
    return this.host === codeHostname;
  }

  /**
   * Only approved, signed-in users may reach the shared code-server. The proxy passes the
   * userId from the signed `baguette_proxy` cookie; verify it against the users table so a
   * stale cookie (or an account revoked after the cookie was issued) is re-checked per
   * request. Anonymous visitors never get here with a userId — `_resolveProxyAccess`
   * sends them to /auth/proxy first — but this double-check keeps the handler safe on
   * its own. code-server itself runs with `--auth none`, so this proxy gate is the only
   * authentication standing between the internet and a shell on the host.
   */
  async allowUser(userId, _res) {
    if (userId == null || userId === '') return false;
    try {
      const user = await this.app
        .get('db')('users')
        .where({ id: Number(userId) })
        .first();
      return !!user?.approved;
    } catch (err) {
      logger.error(err, 'Code-server user lookup failed — failing closed');
      return false;
    }
  }

  get key() {
    return this.host;
  }

  get subdomain() {
    return CODE_DOMAIN_PREFIX;
  }

  async render(_res) {
    return false;
  }

  async buildTask() {
    const task = this.app.service('tasks').createTask({
      sessionId: null,
      command: 'code-server --auth none --disable-telemetry --disable-workspace-trust',
      label: 'baguette:codeserver',
      ports: ['PORT'],
      env: {},
      cwd: undefined,
      dependsOn: [],
      ttl: DEFAULT_TTL_MS,
    });
    return { task, exposePort: 'PORT' };
  }
}

/** Returns the VS Code web URL for a session folder on the shared code-server. */
export function getCodeserverUrl(absoluteSessionPath) {
  const url = new URL(PUBLIC_API_URL);
  url.hostname = codeHostname;
  url.searchParams.set('folder', absoluteSessionPath);
  return url.toString();
}
