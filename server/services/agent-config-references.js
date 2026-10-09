import { BadRequest, Conflict } from '@feathersjs/errors';
import { stringifyAgentDefaultModel } from '../../shared/agent-default-model.js';
import { stringifyModelParamsForStorage } from '../../shared/agent-session-defaults.js';

/**
 * @param {import('knex').Knex} knex
 * @param {number} userId
 * @param {number} configId
 */
export async function summarizeAgentConfigReferences(knex, userId, configId) {
  const builderSessions = Number(
    (
      await knex('sessions')
        .where({ user_id: userId, agent_config_id: configId })
        .count('* as count')
        .first()
    )?.count ?? 0
  );
  const reviewerSessions = Number(
    (
      await knex('sessions')
        .where({ user_id: userId, review_agent_config_id: configId })
        .count('* as count')
        .first()
    )?.count ?? 0
  );
  const loops = Number(
    (
      await knex('loops')
        .where({ user_id: userId, agent_config_id: configId })
        .count('* as count')
        .first()
    )?.count ?? 0
  );
  const user = await knex('users').where({ id: userId }).first();
  const builderUserDefault = user?.agent_default_config_id === configId;
  const reviewerUserDefault = user?.reviewer_default_config_id === configId;
  const builderRepoDefaults = Number(
    (
      await knex('user_repos')
        .where({ user_id: userId, agent_default_config_id: configId })
        .count('* as count')
        .first()
    )?.count ?? 0
  );
  const reviewerRepoDefaults = Number(
    (
      await knex('user_repos')
        .where({ user_id: userId, reviewer_default_config_id: configId })
        .count('* as count')
        .first()
    )?.count ?? 0
  );

  const builder = {
    sessions: builderSessions,
    loops,
    user_default: builderUserDefault,
    repo_defaults: builderRepoDefaults,
  };
  const reviewer = {
    sessions: reviewerSessions,
    user_default: reviewerUserDefault,
    repo_defaults: reviewerRepoDefaults,
  };
  const in_use =
    builder.sessions > 0 ||
    builder.loops > 0 ||
    builder.user_default ||
    builder.repo_defaults > 0 ||
    reviewer.sessions > 0 ||
    reviewer.user_default ||
    reviewer.repo_defaults > 0;

  return { in_use, builder, reviewer };
}

export function assertAgentConfigNotInUse(summary) {
  if (!summary.in_use) return;
  throw new Conflict('Agent configuration is still in use', {
    code: 'agent_config_in_use',
    references: summary,
  });
}

/**
 * @param {unknown} raw
 * @param {string} label
 */
function parseAgentConfigReplacement(raw, label) {
  if (!raw || typeof raw !== 'object') {
    throw new BadRequest(`${label} is required`);
  }
  const agent_config_id = Number(raw.agent_config_id);
  if (!Number.isFinite(agent_config_id)) {
    throw new BadRequest(`${label}.agent_config_id is required`);
  }
  const model = raw.model;
  if (model == null || String(model).trim() === '') {
    throw new BadRequest(`${label}.model is required`);
  }
  let model_params = raw.model_params ?? null;
  if (model_params != null && !Array.isArray(model_params)) {
    throw new BadRequest(`${label}.model_params must be an array`);
  }
  if (Array.isArray(model_params) && !model_params.length) model_params = null;
  return { agent_config_id, model: String(model), model_params };
}

function needsBuilderReplacement(summary) {
  const b = summary.builder;
  return b.sessions > 0 || b.loops > 0 || b.user_default;
}

function needsReviewerReplacement(summary) {
  const r = summary.reviewer;
  return r.sessions > 0 || r.user_default;
}

/**
 * @param {import('knex').Knex} knex
 * @param {number} userId
 * @param {number} deletedConfigId
 * @param {{ builder?: object, reviewer?: object }} replacements
 * @param {object} summary from summarizeAgentConfigReferences
 */
export async function applyAgentConfigReplacements(
  knex,
  userId,
  deletedConfigId,
  replacements,
  summary
) {
  const needBuilder = needsBuilderReplacement(summary);
  const needReviewer = needsReviewerReplacement(summary);
  if (needBuilder && !replacements.builder) {
    throw new BadRequest('builder_replacement is required');
  }
  if (needReviewer && !replacements.reviewer) {
    throw new BadRequest('reviewer_replacement is required');
  }

  const builder = needBuilder
    ? parseAgentConfigReplacement(replacements.builder, 'builder_replacement')
    : null;
  const reviewer = needReviewer
    ? parseAgentConfigReplacement(replacements.reviewer, 'reviewer_replacement')
    : null;

  for (const rep of [builder, reviewer].filter(Boolean)) {
    if (rep.agent_config_id === deletedConfigId) {
      throw new BadRequest(
        'Replacement configuration must be different from the one being deleted'
      );
    }
    const row = await knex('agent_configs')
      .where({ id: rep.agent_config_id, user_id: userId })
      .first();
    if (!row) throw new BadRequest('Replacement agent configuration not found');
  }

  if (builder) {
    const config = await knex('agent_configs')
      .where({ id: builder.agent_config_id, user_id: userId })
      .first();
    const modelParamsStored = stringifyModelParamsForStorage(builder.model_params);
    await knex('sessions').where({ user_id: userId, agent_config_id: deletedConfigId }).update({
      agent_config_id: builder.agent_config_id,
      agent_sdk: config.sdk,
      model: builder.model,
      model_params: modelParamsStored,
    });
    await knex('loops').where({ user_id: userId, agent_config_id: deletedConfigId }).update({
      agent_config_id: builder.agent_config_id,
      agent_sdk: config.sdk,
      model: builder.model,
      model_params: modelParamsStored,
    });
    const user = await knex('users').where({ id: userId }).first();
    if (user?.agent_default_config_id === deletedConfigId) {
      await knex('users')
        .where({ id: userId })
        .update({
          agent_default_config_id: builder.agent_config_id,
          agent_default_model: stringifyAgentDefaultModel({
            model: builder.model,
            model_params: builder.model_params,
          }),
        });
    }
  }

  if (reviewer) {
    const config = await knex('agent_configs')
      .where({ id: reviewer.agent_config_id, user_id: userId })
      .first();
    const reviewParamsStored = stringifyModelParamsForStorage(reviewer.model_params);
    await knex('sessions')
      .where({ user_id: userId, review_agent_config_id: deletedConfigId })
      .update({
        review_agent_config_id: reviewer.agent_config_id,
        review_agent_sdk: config.sdk,
        review_model: reviewer.model,
        review_model_params: reviewParamsStored,
      });
    const user = await knex('users').where({ id: userId }).first();
    if (user?.reviewer_default_config_id === deletedConfigId) {
      await knex('users')
        .where({ id: userId })
        .update({
          reviewer_default_config_id: reviewer.agent_config_id,
          reviewer_default_model: stringifyAgentDefaultModel({
            model: reviewer.model,
            model_params: reviewer.model_params,
          }),
        });
    }
  }

  if (builder) {
    await knex('user_repos')
      .where({ user_id: userId, agent_default_config_id: deletedConfigId })
      .update({
        agent_default_config_id: builder.agent_config_id,
        agent_default_model: stringifyAgentDefaultModel({
          model: builder.model,
          model_params: builder.model_params,
        }),
      });
  }
  if (reviewer) {
    await knex('user_repos')
      .where({ user_id: userId, reviewer_default_config_id: deletedConfigId })
      .update({
        reviewer_default_config_id: reviewer.agent_config_id,
        reviewer_default_model: stringifyAgentDefaultModel({
          model: reviewer.model,
          model_params: reviewer.model_params,
        }),
      });
  }
}
