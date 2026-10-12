import {
  loadBaguetteConfig,
  interpolateEnv,
  interpolateBaguetteConfig,
  configValueIncludesPlaceholder,
  assertNoTaskPlaceholders,
  resolveServicesConfig,
  buildDockerTaskHostnames,
  buildDockerTaskImages,
} from './baguette-config.js';
import { getPreviewHost, getServicePreviewHost } from './preview.js';
import { gitAuthorEnvFromUser } from './git-identity.js';
import { loadOwnedAgentConfigDecrypted } from './agent-context.js';
import { claudeGatewayFields } from '../../shared/agent-config-api-key-env.js';

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
  if (session?.session_path) {
    baguetteConfig = await loadBaguetteConfig(session.session_path);
    if (baguetteConfig) {
      const servicesConfig = resolveServicesConfig(baguetteConfig);
      const servicesUriMap = servicesConfig
        ? Object.fromEntries(
            servicesConfig.map((s) => [s.name, getServicePreviewHost(session.short_id, s.name)])
          )
        : {};
      const interpolateBase = {
        shortId: session.short_id,
        secrets,
        publicUri: getPreviewHost(session.short_id),
        servicesUriMap,
        taskHostnames: buildDockerTaskHostnames(baguetteConfig, session.short_id),
      };
      interpolateOpts = {
        ...interpolateBase,
        taskImages: buildDockerTaskImages(baguetteConfig, session.short_id, interpolateBase),
      };
    }
  }
  return { baguetteConfig, interpolateOpts };
}

export async function getInterpolateOptsForSession(db, sessionId) {
  const { interpolateOpts } = await buildInterpolateContext(db, sessionId);
  return interpolateOpts;
}

/**
 * Build the environment for task subprocesses (init/cleanup scripts, dev servers).
 * Includes interpolated `session.env` only (secrets, session URIs). Per-task `env` is
 * merged when the task starts — see `resolveTaskEnv` in task.js.
 */
export async function buildTaskEnv(db, sessionId) {
  const { baguetteConfig, interpolateOpts } = await buildInterpolateContext(db, sessionId);

  let sessionEnv = {};
  if (
    interpolateOpts &&
    baguetteConfig.session?.env &&
    typeof baguetteConfig.session.env === 'object'
  ) {
    assertNoTaskPlaceholders(baguetteConfig.session.env, 'session.env');
    sessionEnv = interpolateEnv(baguetteConfig.session.env, {
      ...interpolateOpts,
      taskHostnames: {},
      taskImages: {},
    });
  }

  return {
    ...stripServerEnv(process.env),
    ...sessionEnv,
  };
}

/**
 * Interpolate `${{ baguette.secrets.* }}` (and other baguette placeholders) in a
 * task command string, using the same substitution rules as session.env / task.env.
 */
export async function interpolateTaskCommand(db, sessionId, commandStr) {
  if (!configValueIncludesPlaceholder(commandStr)) return commandStr;
  const { interpolateOpts } = await buildInterpolateContext(db, sessionId);
  if (!interpolateOpts) return commandStr;
  return interpolateBaguetteConfig(commandStr, interpolateOpts);
}

/** Interpolate baguette placeholders in any config subtree (e.g. docker `container`). */
export async function interpolateTaskConfigValue(db, sessionId, value) {
  if (!configValueIncludesPlaceholder(value)) return value;
  const { interpolateOpts } = await buildInterpolateContext(db, sessionId);
  if (!interpolateOpts) return value;
  return interpolateBaguetteConfig(value, interpolateOpts);
}

/**
 * Apply each credential field to its env var independently — an API key becomes
 * ANTHROPIC_API_KEY and an auth token becomes ANTHROPIC_AUTH_TOKEN. Neither strips the
 * other or the host environment: setting both is the user's responsibility to avoid.
 */
function applyClaudeCredentials(env, { apiKey, authToken }) {
  let result = env;
  if (apiKey) result = { ...result, ANTHROPIC_API_KEY: apiKey };
  if (authToken) result = { ...result, ANTHROPIC_AUTH_TOKEN: authToken };
  return result;
}

/** Trim and strip trailing slashes; empty input becomes null. */
export function normalizeAnthropicBaseUrl(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function applyAnthropicBaseUrl(env, configuredUrl) {
  const normalized = normalizeAnthropicBaseUrl(configuredUrl);
  if (!normalized) return env;
  return { ...env, ANTHROPIC_BASE_URL: normalized };
}

/** Claude Code built-in model aliases (not gateway/third-party ids). */
const CLAUDE_BUILTIN_MODEL_ALIASES = new Set(['opus', 'sonnet', 'haiku', 'default']);

/**
 * Whether `modelId` refers to an Anthropic Claude model (native id or CLI alias).
 * Gateway-routed third-party models return false.
 */
export function isAnthropicClaudeModelId(modelId) {
  if (modelId == null) return true;
  const id = String(modelId).trim();
  if (!id) return true;
  if (id.startsWith('claude-')) return true;
  if (CLAUDE_BUILTIN_MODEL_ALIASES.has(id.toLowerCase())) return true;
  const withoutOneM = id.replace(/\[1m\]$/i, '');
  if (withoutOneM !== id && CLAUDE_BUILTIN_MODEL_ALIASES.has(withoutOneM.toLowerCase())) {
    return true;
  }
  return false;
}

/**
 * When Claude Code runs on a non-Anthropic model, map opus/sonnet defaults to that model
 * so sub-agents and internal calls use the gateway route the user selected.
 */
export function applyClaudeAgentModelEnv(env, modelId) {
  if (!modelId || isAnthropicClaudeModelId(modelId)) return env;
  const resolved = String(modelId);
  return {
    ...env,
    ANTHROPIC_DEFAULT_OPUS_MODEL: resolved,
    ANTHROPIC_DEFAULT_SONNET_MODEL: resolved,
  };
}

/**
 * Build Claude subprocess env from a pre-decrypted user row.
 * All fields on `user` must already be plaintext (fetched via Feather service with no provider).
 * Credential fields map one-to-one to their env vars:
 * - `anthropicApiKey`      — Console API key, set as ANTHROPIC_API_KEY (repo overrides user)
 * - `anthropicAuthToken`   — setup-token or gateway bearer token, set as ANTHROPIC_AUTH_TOKEN
 *                            (repo overrides user)
 * - `anthropicBaseUrl`     — ANTHROPIC_BASE_URL override (repo overrides user)
 */
export function buildClaudeEnvFromPlainUser(
  user,
  anthropicApiKey,
  anthropicBaseUrl = null,
  { anthropicAuthToken = null } = {}
) {
  let env = applyClaudeCredentials(stripServerEnv(process.env), {
    apiKey: anthropicApiKey || null,
    authToken: anthropicAuthToken || null,
  });
  env = applyAnthropicBaseUrl(env, anthropicBaseUrl);
  return {
    ...env,
    ...gitAuthorEnvFromUser(user),
  };
}

/**
 * Build the Claude agent subprocess environment for a given user (account credentials).
 *
 * @param {object} app  - Feathers app instance
 * @param {number} userId
 * @param {string|null} _repoFullName - unused; kept for call-site compatibility
 */
export async function getClaudeEnv(app, userId, _repoFullName, agentConfigId = null) {
  const db = app.get('db');
  let config = null;
  if (agentConfigId != null) {
    config = await loadOwnedAgentConfigDecrypted(agentConfigId, userId, db);
  }
  const { apiKey, authToken, baseUrl } = claudeGatewayFields(config);
  const userRow = await app.service('users').get(userId, {});
  return buildClaudeEnvFromPlainUser(userRow, apiKey, baseUrl, {
    anthropicAuthToken: authToken,
  });
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
  return getClaudeEnv(app, session.user_id, null, session.agent_config_id ?? null);
}
