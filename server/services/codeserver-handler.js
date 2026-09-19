import { PUBLIC_API_URL } from '../config.js';
import { buildSessionHostname } from './preview.js';

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

  async allowUser(_userId, _res) {
    return true;
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
      command: 'code-server --auth none --disable-telemetry',
      label: 'baguette:codeserver',
      ports: ['PORT'],
      env: {},
      cwd: undefined,
      dependsOn: [],
    });
    return { task, exposePort: 'PORT' };
  }
}

/** Returns the VS Code web URL for a session folder on the shared code-server. */
export function getCodeserverUrl(absoluteWorktreePath) {
  const url = new URL(PUBLIC_API_URL);
  url.hostname = codeHostname;
  url.searchParams.set('folder', absoluteWorktreePath);
  return url.toString();
}
