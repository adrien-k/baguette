import { getGithubToken } from '../../agent-settings.js';
import { resolveDataDirRelativePath } from '../../../config.js';
import { fail } from './result.js';
import { formatAgentSdkDisplayName } from '../../../../shared/agent-sdk-display.js';
import {
  gitAuthFromRepo,
  githubApiAvailable,
  isLocalRepo,
} from '../../../../shared/repo-origin.js';

/**
 * Context shared by repo-session MCP tools (git, PR, tasks, config, etc.).
 */
export function createSessionAgentContext(
  session,
  app,
  { slackApps = [], callerAgent = null } = {}
) {
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

  const getUser = async () => app.service('users').get(sessionRef.user_id, {});

  const getToken = async () => {
    const user = await getUser();
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
    const sessionId = s?.id;
    return `*Posted by baguette - ${describeAgent(s)}, session ${sessionId}:*\n\n${body}`;
  };

  const getRepo = async () => {
    const s = await getSession();
    if (!s.repo_id) return null;
    return db('repos').where({ id: s.repo_id }).first();
  };

  const getGitAuth = async () => {
    const [repo, user] = await Promise.all([getRepo(), getUser()]);
    return gitAuthFromRepo(repo, {
      token: getGithubToken(user),
      userId: user?.id ?? sessionRef.user_id,
    });
  };

  /** Origin present, or access_mode github — git push/pull/fetch. */
  const requireRemoteRepo = async () => {
    const repo = await getRepo();
    if (!isLocalRepo(repo)) return null;
    return fail('This repository has no remote. Push, pull, and fetch are unavailable.');
  };

  /** App token or PAT and a github.com origin — PR / GitHub API tools. */
  const requireGitHubApi = async () => {
    const [repo, token] = await Promise.all([getRepo(), getToken()]);
    if (githubApiAvailable({ token, origin: repo?.origin })) return null;
    return fail(
      'GitHub API is not available for this repository. PR features require a GitHub token and a github.com remote.'
    );
  };

  const requireGitHubRepo = requireGitHubApi;

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
    get userId() {
      return sessionRef.user_id;
    },
    callerAgent,
    slackApps,
    getSession,
    getToken,
    getGitAuth,
    describeAgent,
    withSessionHeader,
    getRepo,
    requireRemoteRepo,
    requireGitHubApi,
    requireGitHubRepo,
    patchSession,
    absoluteSessionPath,
    baseBranch,
  };
}
