import { getGithubToken } from '../../agent-settings.js';
import { resolveDataDirRelativePath } from '../../../config.js';
import { fail } from './result.js';
import { formatAgentSdkDisplayName } from '../../../../shared/agent-sdk-display.js';

/**
 * Context shared by repo-session MCP tools (git, PR, tasks, config, etc.).
 */
export function createSessionAgentContext(session, app, { slackApps = [] } = {}) {
  const db = app.get('db');
  let sessionRef = session;

  const getSession = async () => {
    const row = await db('sessions').where({ id: sessionRef.id }).first();
    if (row) {
      sessionRef = row;
      return row;
    }
    return sessionRef;
  };

  const getToken = async () => {
    const user = await app.service('users').get(sessionRef.user_id, {});
    return getGithubToken(user);
  };

  /** e.g. "Pi glm-5.3-flash" — agent identity wherever Baguette posts on a user's behalf. */
  const describeAgent = (s) => {
    const agentName = formatAgentSdkDisplayName(s?.agent_sdk);
    const modelId = (() => {
      const m = s?.model;
      if (!m) return null;
      try {
        const parsed = JSON.parse(m);
        if (parsed?.id) return parsed.id;
      } catch {
        /* not JSON */
      }
      return m;
    })();
    return modelId ? `${agentName} ${modelId}` : agentName;
  };

  const withSessionHeader = (body, s) => {
    const sessionId = s?.short_id || s?.id;
    return `*Posted by baguette - ${describeAgent(s)}, session ${sessionId}:*\n\n${body}`;
  };

  const getRepo = async () => {
    const s = await getSession();
    if (!s.repo_id) return null;
    return db('repos').where({ id: s.repo_id }).first();
  };

  const requireGitHubRepo = async () => {
    const repo = await getRepo();
    const fn = repo?.full_name;
    if (fn && (fn.startsWith('/') || !fn.includes('/'))) {
      return fail(
        'This repository is not connected to GitHub. Push and PR features are unavailable.'
      );
    }
    return null;
  };

  const patchSession = async (data) => {
    const updated = await app
      .service('sessions')
      .patch(sessionRef.id, data, { provider: undefined, user: { id: sessionRef.user_id } });
    sessionRef = { ...sessionRef, ...updated };
  };

  const absoluteSessionPath = resolveDataDirRelativePath(sessionRef.session_path) || '';
  const baseBranch = sessionRef.base_branch;

  return {
    app,
    db,
    get session() {
      return sessionRef;
    },
    slackApps,
    getSession,
    getToken,
    describeAgent,
    withSessionHeader,
    getRepo,
    requireGitHubRepo,
    patchSession,
    absoluteSessionPath,
    baseBranch,
  };
}
