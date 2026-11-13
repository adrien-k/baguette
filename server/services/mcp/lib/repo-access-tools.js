import { getGithubToken } from '../../agent-settings.js';
import { githubApiAvailable, repoAccessMode } from '../../../../shared/repo-origin.js';
import { isGlobalSession } from '../../../../shared/session-scope.js';
import { currentSessionInfoDescription } from './current-session-info.js';
import { updateSessionDescription } from '../tools/update-session.js';

/** GitHub REST / PR MCP tools omitted when `github_api_available` is false. */
const GITHUB_API_MCP_TOOLS = [
  'PrRead',
  'PrComments',
  'PrMarkCommentViewed',
  'PrComment',
  'PrReview',
  'PrWorkflows',
  'PrWorkflowLogs',
  'ListGithubPrs',
  'GetGithubPr',
  'AddGithubLabel',
  'ListGithubTags',
];

/** Remote git MCP tools omitted for local repos (no origin). */
const REMOTE_GIT_MCP_TOOLS = ['GitPull', 'GitFetch', 'GitPush'];

/**
 * @param {object} session
 * @param {object} app
 * @param {object | null} [owner] already-loaded user (plaintext secrets)
 */
export async function resolveSessionRepoAccess(session, app, owner = null) {
  if (isGlobalSession(session) || !session?.repo_id) {
    return {
      accessMode: null,
      gitRemote: null,
      githubApiAvailable: false,
      repo: null,
    };
  }

  const db = app.get('db');
  let repo = null;
  try {
    repo = await db('repos').where({ id: session.repo_id }).first();
  } catch {
    repo = null;
  }

  let token = getGithubToken(owner);
  if (!token && session.user_id && app.service) {
    try {
      const user = owner || (await app.service('users').get(session.user_id, {}));
      token = getGithubToken(user);
    } catch {
      token = null;
    }
  }

  const origin = repo?.origin ?? null;
  return {
    accessMode: repo ? repoAccessMode(repo) : 'github',
    gitRemote: origin,
    githubApiAvailable: githubApiAvailable({ token, origin }),
    repo,
  };
}

/**
 * Filter PR / remote-git tools and rewrite descriptions for the session's access mode.
 * Skip for global sessions (caller should not invoke this).
 */
export function applyRepoAccessModeToTools(tools, access) {
  const exclude = new Set();
  if (!access.githubApiAvailable) {
    for (const name of GITHUB_API_MCP_TOOLS) exclude.add(name);
  }
  const localRepo = access.accessMode === 'local' || (access.repo && !access.gitRemote);
  if (localRepo) {
    for (const name of REMOTE_GIT_MCP_TOOLS) exclude.add(name);
  }

  const apiAvailable = Boolean(access.githubApiAvailable);
  return tools
    .filter((t) => !exclude.has(t.name))
    .map((t) => {
      if (t.name === 'CurrentSessionInfo') {
        return {
          ...t,
          description: currentSessionInfoDescription({ githubApiAvailable: apiAvailable }),
        };
      }
      if (t.name === 'UpdateSession') {
        return {
          ...t,
          description: updateSessionDescription({ githubApiAvailable: apiAvailable }),
        };
      }
      return t;
    });
}
