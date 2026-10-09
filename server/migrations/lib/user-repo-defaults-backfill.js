import { parseAgentSessionDefaultsJson } from '../../../shared/agent-session-defaults.js';

/** @typedef {{ primary: number | null, token: number | null, cursor: number | null, pi: number | null }} ScopeConfigIds */

export const USER_REPO_AGENT_DEFAULT_COLS = [
  'agent_default_config_id',
  'agent_default_model',
  'reviewer_default_config_id',
  'reviewer_default_model',
];

/** Columns dropped from user_repos in 053 after configs are migrated. */
export const USER_REPO_LEGACY_CRED_COLS = [
  'anthropic_api_key_encrypted',
  'anthropic_auth_token_encrypted',
  'anthropic_base_url',
  'cursor_api_key_encrypted',
  'pi_api_key_encrypted',
  'pi_api_key_env_var',
];

function parseSessionModelId(modelField) {
  if (!modelField) return null;
  try {
    const parsed = JSON.parse(modelField);
    if (parsed?.id) return parsed.id;
  } catch {
    /* plain id */
  }
  return modelField;
}

function modelParamsForDefault(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

export function stringifyDefaultModel(model, modelParams) {
  const id = parseSessionModelId(model);
  if (!id && (modelParams == null || modelParams === '')) return null;
  const params = modelParamsForDefault(modelParams);
  return JSON.stringify({
    model: id,
    model_params: Array.isArray(params) && params.length ? params : null,
  });
}

export function userRepoLinkHadDistinctCredentials(link) {
  return USER_REPO_LEGACY_CRED_COLS.some((col) => link[col] != null && link[col] !== '');
}

/**
 * First config id that exists in a migrated scope — the configs present ARE the overrides
 * that existed (claude key, claude token, cursor key, pi key).
 * @param {ScopeConfigIds | undefined} repoScope
 */
function repoScopeConfigId(repoScope) {
  if (!repoScope) return null;
  return repoScope.primary ?? repoScope.token ?? repoScope.cursor ?? repoScope.pi ?? null;
}

/** @returns {Promise<Map<number, string>>} config id → sdk */
async function configSdksById(knex, ids) {
  const clean = [...new Set(ids.filter((id) => id != null))];
  if (!clean.length) return new Map();
  const rows = await knex('agent_configs').whereIn('id', clean).select('id', 'sdk');
  return new Map(rows.map((r) => [r.id, r.sdk]));
}

async function preferredSdkForUser(knex, userId) {
  const user = await knex('users').where({ id: userId }).select('agent_defaults').first();
  if (user?.agent_defaults) {
    const parsed = parseAgentSessionDefaultsJson(user.agent_defaults);
    if (parsed.agent_sdk) return parsed.agent_sdk;
  }
  return 'claude';
}

async function lastSessionForRepo(knex, userId, repoId) {
  return knex('sessions')
    .where({ user_id: userId, repo_id: repoId })
    .whereNull('archived_at')
    .orderByRaw('COALESCE(last_activity_at, updated_at, created_at) DESC')
    .select(
      'agent_config_id',
      'model',
      'model_params',
      'agent_sdk',
      'review_agent_config_id',
      'review_model',
      'review_model_params',
      'review_agent_sdk'
    )
    .first();
}

/**
 * Build user_repos default columns from legacy per-repo credentials and/or last session on that repo.
 * @param {import('knex').Knex} knex
 * @param {object} link — user_repos row (may still include legacy credential columns)
 * @param {ScopeConfigIds | undefined} repoScope
 */
export async function buildUserRepoDefaultsPatch(knex, link, repoScope) {
  const hadRepoCreds = userRepoLinkHadDistinctCredentials(link);
  const session = await lastSessionForRepo(knex, link.user_id, link.repo_id);
  const sdk = session?.agent_sdk || (await preferredSdkForUser(knex, link.user_id));
  const reviewSdk = session?.review_agent_sdk || session?.agent_sdk || sdk;

  // A repo credential override maps to the repo-scoped config that exists for it, regardless of
  // which SDK the user last ran here — resolveAgentConfigIdForRepoSdk falls back per SDK when the
  // default config's SDK differs. A base-URL-only override creates no config, so those links fall
  // through to the last-session seeding below.
  const repoConfigId = hadRepoCreds ? repoScopeConfigId(repoScope) : null;

  let agentConfigId = repoConfigId;
  let reviewerConfigId = repoConfigId;
  // Sessions were already backfilled with pickAgentConfigIdForSessionBackfill earlier in 053,
  // so the session's own config ids are the pick result — no re-pick needed here.
  if (!agentConfigId && session) {
    agentConfigId = session.agent_config_id;
    reviewerConfigId = session.review_agent_config_id ?? session.agent_config_id;
  }
  if (!agentConfigId) return null;

  // Pin a session model only when it was used with the default config's SDK — otherwise the
  // model falls through to the user-level default, as pre-migration.
  const configSdks = await configSdksById(knex, [agentConfigId, reviewerConfigId]);
  const agentDefaultModel =
    session && configSdks.get(agentConfigId) === (session.agent_sdk || sdk)
      ? stringifyDefaultModel(session.model, session.model_params)
      : null;
  const reviewerDefaultModel =
    session && reviewerConfigId && configSdks.get(reviewerConfigId) === reviewSdk
      ? stringifyDefaultModel(
          session.review_model ?? session.model,
          session.review_model_params ?? session.model_params
        )
      : null;

  const patch = {
    agent_default_config_id: agentConfigId,
    agent_default_model: agentDefaultModel,
  };
  if (reviewerConfigId) {
    patch.reviewer_default_config_id = reviewerConfigId;
    patch.reviewer_default_model = reviewerDefaultModel;
  }
  return patch;
}
