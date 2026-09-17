import { loadBaguetteConfig, interpolateEnv, resolveServicesConfig } from './baguette-config.js';
import { getPreviewHost, getServicePreviewHost } from './preview.js';

const SERVER_ONLY_ENV_KEYS = [
  'NODE_ENV',
  'ENCRYPTION_KEY',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'DATA_DIR',
  'PUBLIC_HOST',
  'PUBLIC_API_HOST',
];

function stripServerEnv(env) {
  const result = { ...env };
  for (const key of SERVER_ONLY_ENV_KEYS) delete result[key];
  return result;
}

/**
 * Build the environment for task subprocesses (init/cleanup scripts, dev servers).
 * Includes interpolated .baguette.yaml env vars and user secrets, but NOT
 * the Anthropic API key or git identity (those are for the Claude agent only).
 *
 * If taskKey is provided, per-task env (session.tasks[taskKey].env) is merged on
 * top of the session-level env, using the same substitution syntax.
 */
export async function buildTaskEnv(db, sessionId, taskKey = null) {
  const session = await db('sessions').where({ id: sessionId }).first();
  const secretRows = await db('secrets').select('key', 'value');
  const secrets = Object.fromEntries(secretRows.map((r) => [r.key, r.value]));

  let sessionEnv = {};
  let taskEnv = {};
  if (session?.worktree_path) {
    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    if (baguetteConfig) {
      const servicesConfig = resolveServicesConfig(baguetteConfig);
      const servicesUriMap = servicesConfig
        ? Object.fromEntries(servicesConfig.map((s) => [s.name, getServicePreviewHost(session.short_id, s.name)]))
        : {};
      const interpolateOpts = {
        shortId: session.short_id,
        secrets,
        publicUri: getPreviewHost(session.short_id),
        servicesUriMap,
      };

      if (baguetteConfig.session?.env && typeof baguetteConfig.session.env === 'object') {
        sessionEnv = interpolateEnv(baguetteConfig.session.env, interpolateOpts);
      }

      if (taskKey) {
        const taskDef = baguetteConfig.session?.tasks?.[taskKey];
        if (taskDef?.env && typeof taskDef.env === 'object') {
          taskEnv = interpolateEnv(taskDef.env, interpolateOpts);
        }
      }
    }
  }

  return {
    ...stripServerEnv(process.env),
    ...sessionEnv,
    ...taskEnv,
  };
}

/**
 * Build Claude subprocess env from a pre-decrypted user row.
 * All fields on `user` must already be plaintext (fetched via Feather service with no provider).
 */
function buildClaudeEnvFromPlainUser(user, anthropicApiKey) {
  const gitName = user?.username || 'baguette';
  const gitEmail =
    user?.email ||
    (user?.github_id && user?.username
      ? `${user.github_id}+${user.username}@users.noreply.github.com`
      : 'baguette@users.noreply.github.com');
  return {
    ...stripServerEnv(process.env),
    ...(anthropicApiKey ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
    GIT_AUTHOR_NAME: gitName,
    GIT_AUTHOR_EMAIL: gitEmail,
    GIT_COMMITTER_NAME: gitName,
    GIT_COMMITTER_EMAIL: gitEmail,
  };
}

/**
 * Build the Claude agent subprocess environment for a given user + repo.
 * Fetches the user and per-repo key via Feather services (hooks decrypt, no raw DB access).
 * Per-repo key takes priority over the user-level key.
 *
 * @param {object} app  - Feathers app instance
 * @param {number} userId
 * @param {string|null} repoFullName - e.g. "owner/repo", or null when no repo context
 */
export async function getClaudeEnv(app, userId, repoFullName) {
  const user = await app.service('users').get(userId, {}); // no provider → plaintext secrets

  let repoApiKey = null;
  if (repoFullName) {
    const db = app.get('db');
    const repo = await db('repos')
      .where({ full_name: repoFullName })
      .whereNull('deleted_at')
      .first();
    if (repo) {
      const userRepos = await app.service('user-repos').find({
        query: { repo_id: repo.id },
        user: { id: userId }, // internal call — no provider → plaintext
        paginate: false,
      });
      repoApiKey = userRepos?.[0]?.anthropic_api_key || null;
    }
  }

  const apiKey = repoApiKey || user.anthropic_api_key || null;
  return buildClaudeEnvFromPlainUser(user, apiKey);
}

/**
 * Convenience wrapper: resolve userId + repoFullName from a session row, then call getClaudeEnv.
 *
 * @param {object} app       - Feathers app instance
 * @param {number} sessionId
 */
export async function getClaudeEnvForSession(app, sessionId) {
  const db = app.get('db');
  const session = await db('sessions').where({ id: sessionId }).first();
  if (!session) return buildClaudeEnvFromPlainUser(null, null);
  const repo = session.repo_id
    ? await db('repos').where({ id: session.repo_id }).first()
    : null;
  return getClaudeEnv(app, session.user_id, repo?.full_name ?? null);
}
