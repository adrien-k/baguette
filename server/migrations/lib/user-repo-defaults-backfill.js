import { pickAgentConfigIdForSessionBackfill } from '../../../shared/agent-config-backfill.js';
import { parseAgentSessionDefaultsJson } from '../../../shared/agent-session-defaults.js';

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
 * @param {import('../../../shared/agent-config-backfill.js').ScopeConfigIds | undefined} repoScope
 * @param {import('../../../shared/agent-config-backfill.js').ScopeConfigIds | undefined} accountScope
 */
export async function buildUserRepoDefaultsPatch(knex, link, repoScope, accountScope) {
  const hadRepoCreds = userRepoLinkHadDistinctCredentials(link);
  const session = await lastSessionForRepo(knex, link.user_id, link.repo_id);
  const sdk = session?.agent_sdk || (await preferredSdkForUser(knex, link.user_id));
  const reviewSdk = session?.review_agent_sdk || session?.agent_sdk || sdk;

  let agentConfigId = null;
  if (hadRepoCreds) {
    agentConfigId = pickAgentConfigIdForSessionBackfill(repoScope, accountScope, sdk);
  } else if (session) {
    agentConfigId =
      session.agent_config_id ?? pickAgentConfigIdForSessionBackfill(repoScope, accountScope, sdk);
  }
  if (!agentConfigId) return null;

  const agentDefaultModel = session
    ? stringifyDefaultModel(session.model, session.model_params)
    : null;

  let reviewerConfigId = null;
  if (hadRepoCreds) {
    reviewerConfigId = pickAgentConfigIdForSessionBackfill(repoScope, accountScope, reviewSdk);
  } else if (session) {
    reviewerConfigId =
      session.review_agent_config_id ??
      session.agent_config_id ??
      pickAgentConfigIdForSessionBackfill(repoScope, accountScope, reviewSdk);
  }

  let reviewerDefaultModel = null;
  if (session && reviewerConfigId) {
    const reviewModelField = session.review_model ?? session.model;
    const reviewParamsField = session.review_model_params ?? session.model_params;
    reviewerDefaultModel = stringifyDefaultModel(reviewModelField, reviewParamsField);
  }

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
