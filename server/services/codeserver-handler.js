import { PUBLIC_API_URL } from '../config.js';
import { buildSessionHostname } from './preview.js';

const CODE_DOMAIN_PREFIX = 'code';
const CODE_SERVER_KEY = 'global:vscode';

const codeHostname = buildSessionHostname(new URL(PUBLIC_API_URL).hostname, CODE_DOMAIN_PREFIX);

export class CodeServerHandler {
  startupTimeoutMs = 2 * 60 * 1000;
  idleTimeoutMs = 30 * 60 * 1000;

  matchesHost(host) {
    return host === codeHostname;
  }

  async matchesUser(_req, userId) {
    return { user_id: userId };
  }

  getErrorMessages(reason) {
    return reason === 'crashed'
      ? { title: 'VS Code server exited', message: 'The VS Code server process exited. Is code-server installed?' }
      : { title: 'VS Code server timed out', message: 'The VS Code server did not start within the timeout period.' };
  }

  async handleAuthenticated(req, res, session, devProxy) {
    return devProxy.dispatch(req, res, session, this, CODE_SERVER_KEY);
  }

  async handleUpgrade(req, socket, head, session, devProxy) {
    return devProxy.wsDispatch(req, socket, head, session, this, CODE_SERVER_KEY);
  }

  async buildTask(app, _session, _key) {
    const task = app.service('tasks').createTask({
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
