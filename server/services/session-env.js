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

export function stripServerEnv(env) {
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

/*
 * Claude-specific subprocess env helpers live in `claude/env.js`; this module
 * keeps only SDK-agnostic pieces (secrets, baguette config interpolation, task
 * env and command interpolation).
 */
