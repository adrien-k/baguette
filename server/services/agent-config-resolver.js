import { BadRequest, NotFound } from '@feathersjs/errors';
import { decryptAgentConfigRow } from './agent-config-env.js';
import { parseAgentDefaultModelJson } from '../../shared/agent-default-model.js';
import { coerceModelParams } from '../../shared/agent-session-defaults.js';

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

/** Load and decrypt an agent_config owned by userId. */
export async function loadOwnedAgentConfig(knex, configId, userId) {
  const row = await knex('agent_configs').where({ id: configId, user_id: userId }).first();
  if (!row) throw new NotFound('Agent configuration not found');
  return decryptAgentConfigRow(row);
}

async function lastUsedSessionAgentRow(db, userId) {
  return db('sessions')
    .where({ user_id: userId })
    .whereNull('archived_at')
    .whereNotNull('agent_config_id')
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

function agentFieldsFromSessionRow(row) {
  if (!row?.agent_config_id) return null;
  return {
    agent_config_id: row.agent_config_id,
    agent_sdk: row.agent_sdk ?? null,
    model: parseSessionModelId(row.model),
    model_params: coerceModelParams(row.model_params),
    source: 'last_used',
  };
}

function reviewerFieldsFromSessionRow(row) {
  const configId = row?.review_agent_config_id ?? row?.agent_config_id;
  if (!configId) return null;
  const modelField = row.review_model ?? row.model;
  const paramsField = row.review_model_params ?? row.model_params;
  return {
    review_agent_config_id: configId,
    review_agent_sdk: row.review_agent_sdk ?? row.agent_sdk ?? null,
    review_model: parseSessionModelId(modelField),
    review_model_params: coerceModelParams(paramsField),
    source: 'last_used',
  };
}

async function userDefaultAgentFields(db, userId) {
  const user = await db('users')
    .where({ id: userId })
    .select('agent_default_config_id', 'agent_default_model')
    .first();
  if (!user?.agent_default_config_id) return null;
  const config = await db('agent_configs')
    .where({ id: user.agent_default_config_id, user_id: userId })
    .first();
  if (!config) return null;
  const { model, model_params } = parseAgentDefaultModelJson(user.agent_default_model);
  return {
    agent_config_id: user.agent_default_config_id,
    agent_sdk: config.sdk,
    model,
    model_params,
    source: 'user',
  };
}

async function userDefaultReviewerFields(db, userId) {
  const user = await db('users')
    .where({ id: userId })
    .select('reviewer_default_config_id', 'reviewer_default_model')
    .first();
  if (!user?.reviewer_default_config_id) return null;
  const config = await db('agent_configs')
    .where({ id: user.reviewer_default_config_id, user_id: userId })
    .first();
  if (!config) return null;
  const { model, model_params } = parseAgentDefaultModelJson(user.reviewer_default_model);
  return {
    review_agent_config_id: user.reviewer_default_config_id,
    review_agent_sdk: config.sdk,
    review_model: model,
    review_model_params: model_params,
    source: 'user',
  };
}

/** Builder prefill: stored user defaults, else most recent session (account-wide). */
export async function resolveEffectiveAgentDefaults(db, userId) {
  const fromUser = await userDefaultAgentFields(db, userId);
  if (fromUser) return fromUser;
  const row = await lastUsedSessionAgentRow(db, userId);
  return agentFieldsFromSessionRow(row);
}

/** Reviewer prefill: stored user defaults, else most recent session review fields. */
export async function resolveEffectiveReviewerDefaults(db, userId) {
  const fromUser = await userDefaultReviewerFields(db, userId);
  if (fromUser) return fromUser;
  const row = await lastUsedSessionAgentRow(db, userId);
  return reviewerFieldsFromSessionRow(row);
}

/** @deprecated Use resolveEffectiveAgentDefaults */
export async function resolveLastUsedAgentConfig(db, userId) {
  return resolveEffectiveAgentDefaults(db, userId);
}

/** Builder + reviewer defaults for API (agent-configs.lastUsed). */
export async function resolveSessionFormDefaults(db, userId) {
  const agent = await resolveEffectiveAgentDefaults(db, userId);
  const reviewer = await resolveEffectiveReviewerDefaults(db, userId);
  return {
    agent_config_id: agent?.agent_config_id ?? null,
    agent_sdk: agent?.agent_sdk ?? null,
    model: agent?.model ?? null,
    model_params: agent?.model_params ?? null,
    agent_source: agent?.source ?? null,
    review_agent_config_id: reviewer?.review_agent_config_id ?? null,
    review_agent_sdk: reviewer?.review_agent_sdk ?? null,
    review_model: reviewer?.review_model ?? null,
    review_model_params: reviewer?.review_model_params ?? null,
    reviewer_source: reviewer?.source ?? null,
  };
}

/**
 * Resolve config id for an SDK when callers omit agent_config_id (loops, session create).
 * Uses stored user defaults, then the most recent session — never repo label heuristics.
 *
 * @param {unknown} _repoId — ignored; kept for call-site compatibility
 * @param {{ role?: 'agent' | 'reviewer' }} [options]
 */
export async function resolveAgentConfigIdForRepoSdk(
  knex,
  userId,
  _repoId,
  sdk,
  { role = 'agent' } = {}
) {
  const configs = await knex('agent_configs').where({ user_id: userId, sdk }).orderBy('id', 'asc');
  if (!configs.length) return null;
  const configIds = new Set(configs.map((c) => c.id));

  const user = await knex('users')
    .where({ id: userId })
    .select('agent_default_config_id', 'reviewer_default_config_id')
    .first();
  const defaultConfigId =
    role === 'reviewer' ? user?.reviewer_default_config_id : user?.agent_default_config_id;
  if (defaultConfigId != null && configIds.has(defaultConfigId)) {
    return defaultConfigId;
  }

  const lastRow = await lastUsedSessionAgentRow(knex, userId);
  if (lastRow) {
    const sessionConfigId =
      role === 'reviewer'
        ? (lastRow.review_agent_config_id ?? lastRow.agent_config_id)
        : lastRow.agent_config_id;
    if (sessionConfigId != null && configIds.has(sessionConfigId)) {
      return sessionConfigId;
    }
  }

  return configs[0].id;
}

export async function assertAgentConfigOnCreate(context) {
  const userId = context.params.user?.id;
  if (!userId) return context;
  const db = context.app.get('db');
  const data = context.data;
  let agentConfigId = data.agent_config_id != null ? Number(data.agent_config_id) : null;
  if (!agentConfigId) {
    const repoId = data.repo_id ?? null;
    const sdk = data.agent_sdk;
    if (sdk) {
      agentConfigId = await resolveAgentConfigIdForRepoSdk(db, userId, repoId, sdk);
    }
  }
  if (!agentConfigId && process.env.VITEST) {
    const sdkHint = data.agent_sdk != null ? String(data.agent_sdk).trim() : 'claude';
    const { ensureTestClaudeConfig, ensureTestPiConfig, insertTestAgentConfig } =
      await import('../test-utils/agent-configs.js');
    if (sdkHint === 'mock') {
      const { ensureMockAgentConfig } = await import('./mock-agent-config.js');
      agentConfigId = await ensureMockAgentConfig(db, userId);
    } else if (sdkHint === 'pi') {
      agentConfigId = await ensureTestPiConfig(db, userId);
    } else if (sdkHint === 'cursor') {
      agentConfigId = await insertTestAgentConfig(db, userId, {
        sdk: 'cursor',
        apiKey: 'cursor-test-key',
        apiKeyEnvVar: null,
      });
    } else {
      agentConfigId = await ensureTestClaudeConfig(db, userId);
    }
  }
  if (!agentConfigId) {
    throw new BadRequest('agent_config_id is required');
  }
  const config = await loadOwnedAgentConfig(db, agentConfigId, userId);
  data.agent_config_id = agentConfigId;
  data.agent_sdk = config.sdk;

  if (data.review_agent_config_id != null) {
    const reviewId = Number(data.review_agent_config_id);
    const reviewConfig = await loadOwnedAgentConfig(db, reviewId, userId);
    data.review_agent_config_id = reviewId;
    data.review_agent_sdk = reviewConfig.sdk;
  } else if (data.review_agent_sdk === undefined) {
    data.review_agent_config_id = agentConfigId;
    data.review_agent_sdk = config.sdk;
  } else {
    const reviewSdk = data.review_agent_sdk;
    const reviewId = await resolveAgentConfigIdForRepoSdk(
      db,
      userId,
      data.repo_id ?? null,
      reviewSdk,
      { role: 'reviewer' }
    );
    if (reviewId) {
      data.review_agent_config_id = reviewId;
    }
  }

  return context;
}
