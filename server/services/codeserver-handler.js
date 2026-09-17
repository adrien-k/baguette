import { extractSessionIdFromHost, getServicePreviewHost } from './preview.js';
import { PUBLIC_HOST, resolveDataDirRelativePath } from '../config.js';

export const VSCODE_SERVICE_NAME = 'vscode';

export class CodeServerHandler {
  startupTimeoutMs = 2 * 60 * 1000;
  idleTimeoutMs = 30 * 60 * 1000;

  matches(req) {
    const parsed = extractSessionIdFromHost(req.headers.host);
    return !!parsed && parsed.serviceName === VSCODE_SERVICE_NAME;
  }

  async previewSession(req, app) {
    const parsed = extractSessionIdFromHost(req.headers.host);
    if (!parsed || parsed.serviceName !== VSCODE_SERVICE_NAME) return undefined;
    const session = await app.get('db')('sessions').where({ short_id: parsed.shortId }).first();
    return session ?? null;
  }

  getPreviewRoute(session) {
    return `${PUBLIC_HOST}/preview?session=${session.short_id}&service=${VSCODE_SERVICE_NAME}`;
  }

  getErrorMessages(reason) {
    return reason === 'crashed'
      ? { title: 'VS Code server exited', message: 'The VS Code server process exited. Is code-server installed?' }
      : { title: 'VS Code server timed out', message: 'The VS Code server did not start within the timeout period.' };
  }

  async handleAuthenticated(req, res, session, devProxy) {
    return devProxy.dispatch(req, res, session, this, `${session.id}:vscode`);
  }

  async handleUpgrade(req, socket, head, session, devProxy) {
    return devProxy.wsDispatch(req, socket, head, session, this, `${session.id}:vscode`);
  }

  async buildTask(_app, session, _key) {
    const worktreePath = resolveDataDirRelativePath(session.worktree_path) || '';
    return {
      command: `code-server --auth none --disable-telemetry "${worktreePath}"`,
      label: 'baguette:codeserver',
      ports: ['PORT'],
      exposePort: 'PORT',
    };
  }
}

/** Returns the VS Code web URL for a session. */
export function getCodeserverUrl(shortId) {
  return getServicePreviewHost(shortId, VSCODE_SERVICE_NAME);
}
