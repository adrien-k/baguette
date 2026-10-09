import { BadRequest, NotFound } from '@feathersjs/errors';
import { decryptAgentConfigRow } from './agent-config-env.js';
import { parseAgentDefaultModelJson } from '../../shared/agent-default-model.js';
import {
  coerceModelParams,
  stringifyModelParamsForStorage,
} from '../../shared/agent-session-defaults.js';

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

async function lastUsedSessionAgentRow(db, userId, repoId = null) {
  let query = db('sessions')
    .where({ user_id: userId })
    .whereNull('archived_at')
    .whereNotNull('agent_config_id');
  if (repoId != null) {
    query = query.where({ repo_id: repoId });
  }
  return query
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

async function repoDefaultAgentFields(db, userId, repoId) {
  if (repoId == null) return null;
  const link = await db('user_repos')
    .where({ user_id: userId, repo_id: repoId })
    .select('agent_default_config_id', 'agent_default_model')
    .first();
  if (!link?.agent_default_config_id) return null;
  const config = await db('agent_configs')
    .where({ id: link.agent_default_config_id, user_id: userId })
    .first();
  if (!config) return null;
  const { model, model_params } = parseAgentDefaultModelJson(link.agent_default_model);
  return {
    agent_config_id: link.agent_default_config_id,
    agent_sdk: config.sdk,
    model,
    model_params,
    source: 'repo',
  };
}

async function repoDefaultReviewerFields(db, userId, repoId) {
  if (repoId == null) return null;
  const link = await db('user_repos')
    .where({ user_id: userId, repo_id: repoId })
    .select('reviewer_default_config_id', 'reviewer_default_model')
    .first();
  if (!link?.reviewer_default_config_id) return null;
  const config = await db('agent_configs')
    .where({ id: link.reviewer_default_config_id, user_id: userId })
    .first();
  if (!config) return null;
  const { model, model_params } = parseAgentDefaultModelJson(link.reviewer_default_model);
  return {
    review_agent_config_id: link.reviewer_default_config_id,
    review_agent_sdk: config.sdk,
    review_model: model,
    review_model_params: model_params,
    source: 'repo',
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

/** Builder prefill: repo defaults, account defaults, then last session (repo-scoped when repoId set). */
export async function resolveEffectiveAgentDefaults(db, userId, repoId = null) {
  const fromRepo = await repoDefaultAgentFields(db, userId, repoId);
  if (fromRepo) return fromRepo;
  const fromUser = await userDefaultAgentFields(db, userId);
  if (fromUser) return fromUser;
  let row = await lastUsedSessionAgentRow(db, userId, repoId);
  let fields = agentFieldsFromSessionRow(row);
  if (fields) return fields;
  if (repoId != null) {
    row = await lastUsedSessionAgentRow(db, userId);
    fields = agentFieldsFromSessionRow(row);
  }
  return fields;
}

/** Reviewer prefill: repo defaults, account defaults, then last session (repo-scoped when repoId set). */
export async function resolveEffectiveReviewerDefaults(db, userId, repoId = null) {
  const fromRepo = await repoDefaultReviewerFields(db, userId, repoId);
  if (fromRepo) return fromRepo;
  const fromUser = await userDefaultReviewerFields(db, userId);
  if (fromUser) return fromUser;
  let row = await lastUsedSessionAgentRow(db, userId, repoId);
  let fields = reviewerFieldsFromSessionRow(row);
  if (fields) return fields;
  if (repoId != null) {
    row = await lastUsedSessionAgentRow(db, userId);
    fields = reviewerFieldsFromSessionRow(row);
  }
  return fields;
}

/** @deprecated Use resolveEffectiveAgentDefaults */
export async function resolveLastUsedAgentConfig(db, userId) {
  return resolveEffectiveAgentDefaults(db, userId);
}

/** Builder + reviewer defaults for API (agent-configs.lastUsed). */
export async function resolveSessionFormDefaults(db, userId, repoId = null) {
  const agent = await resolveEffectiveAgentDefaults(db, userId, repoId);
  const reviewer = await resolveEffectiveReviewerDefaults(db, userId, repoId);
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
 * @param {{ role?: 'agent' | 'reviewer' }} [options]
 */
export async function resolveAgentConfigIdForRepoSdk(
  knex,
  userId,
  repoId,
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
  let link = null;
  if (repoId != null) {
    link = await knex('user_repos')
      .where({ user_id: userId, repo_id: repoId })
      .select('agent_default_config_id', 'reviewer_default_config_id')
      .first();
  }
  const repoDefaultId =
    role === 'reviewer' ? link?.reviewer_default_config_id : link?.agent_default_config_id;
  const userDefaultId =
    role === 'reviewer' ? user?.reviewer_default_config_id : user?.agent_default_config_id;
  if (repoDefaultId != null && configIds.has(repoDefaultId)) {
    return repoDefaultId;
  }
  if (userDefaultId != null && configIds.has(userDefaultId)) {
    return userDefaultId;
  }

  const lastRows = [];
  if (repoId != null) {
    const repoRow = await lastUsedSessionAgentRow(knex, userId, repoId);
    if (repoRow) lastRows.push(repoRow);
  }
  const accountRow = await lastUsedSessionAgentRow(knex, userId);
  if (accountRow) lastRows.push(accountRow);

  for (const lastRow of lastRows) {
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
  } else if (data.review_agent_sdk !== undefined) {
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
  } else {
    const reviewer = await resolveEffectiveReviewerDefaults(db, userId, data.repo_id ?? null);
    if (reviewer && (reviewer.source === 'repo' || reviewer.source === 'user')) {
      data.review_agent_config_id = reviewer.review_agent_config_id;
      data.review_agent_sdk = reviewer.review_agent_sdk;
      if (reviewer.review_model != null && reviewer.review_model !== '') {
        data.review_model = reviewer.review_model;
      }
      const reviewParams = stringifyModelParamsForStorage(reviewer.review_model_params);
      if (reviewParams != null) data.review_model_params = reviewParams;
    }
  }

  return context;
}
