import {
  loadBaguetteConfig,
  interpolateEnv,
  interpolateString,
  resolveServicesConfig,
} from './baguette-config.js';
import { getPreviewHost, getServicePreviewHost } from './preview.js';
import { gitAuthorEnvFromUser } from './git-identity.js';

const SERVER_ONLY_ENV_KEYS = [
  'NODE_ENV',
  'ENCRYPTION_KEY',
  'AUTH_GITHUB_CLIENT_ID',
  'AUTH_GITHUB_CLIENT_SECRET',
  'AUTH_GITHUB_APP_SLUG',
  'DATA_DIR',
  'PUBLIC_HOST',
  'PUBLIC_API_HOST',
];

function stripServerEnv(env) {
  const result = { ...env };
  for (const key of SERVER_ONLY_ENV_KEYS) delete result[key];
  return result;
}

export async function loadSecretsForUser(db, userId) {
  const globalRows = await db('secrets').whereNull('user_id').select('key', 'value');
  const secrets = Object.fromEntries(globalRows.map((r) => [r.key, r.value]));
  if (userId) {
    const personalRows = await db('secrets').where({ user_id: userId }).select('key', 'value');
    for (const row of personalRows) {
      secrets[row.key] = row.value;
    }
  }
  return secrets;
}

async function buildInterpolateContext(db, sessionId) {
  const session = await db('sessions').where({ id: sessionId }).first();
  const secrets = await loadSecretsForUser(db, session?.user_id ?? null);

  let baguetteConfig = null;
  let interpolateOpts = null;
  if (session?.worktree_path) {
    baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    if (baguetteConfig) {
      const servicesConfig = resolveServicesConfig(baguetteConfig);
      const servicesUriMap = servicesConfig
        ? Object.fromEntries(
            servicesConfig.map((s) => [s.name, getServicePreviewHost(session.short_id, s.name)])
          )
        : {};
      interpolateOpts = {
        shortId: session.short_id,
        secrets,
        publicUri: getPreviewHost(session.short_id),
        servicesUriMap,
      };
    }
  }
  return { baguetteConfig, interpolateOpts };
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
  const { baguetteConfig, interpolateOpts } = await buildInterpolateContext(db, sessionId);

  let sessionEnv = {};
  let taskEnv = {};
  if (interpolateOpts) {
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

  return {
    ...stripServerEnv(process.env),
    ...sessionEnv,
    ...taskEnv,
  };
}

/**
 * Interpolate `${{ baguette.secrets.* }}` (and other baguette placeholders) in a
 * task command string, using the same substitution rules as session.env / task.env.
 */
export async function interpolateTaskCommand(db, sessionId, commandStr) {
  if (!commandStr?.includes('${{')) return commandStr;
  const { interpolateOpts } = await buildInterpolateContext(db, sessionId);
  if (!interpolateOpts) return commandStr;
  return interpolateString(commandStr, interpolateOpts);
}

/**
 * Build Claude subprocess env from a pre-decrypted user row.
 * All fields on `user` must already be plaintext (fetched via Feather service with no provider).
 */
function buildClaudeEnvFromPlainUser(user, anthropicApiKey) {
  return {
    ...stripServerEnv(process.env),
    ...(anthropicApiKey ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
    ...gitAuthorEnvFromUser(user),
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
  const repo = session.repo_id ? await db('repos').where({ id: session.repo_id }).first() : null;
  return getClaudeEnv(app, session.user_id, repo?.full_name ?? null);
}
