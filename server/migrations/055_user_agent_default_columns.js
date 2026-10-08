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

function stringifyDefaultModel(model, modelParams) {
  const id = parseSessionModelId(model);
  if (!id && (modelParams == null || modelParams === '')) return null;
  const params = modelParamsForDefault(modelParams);
  return JSON.stringify({
    model: id,
    model_params: Array.isArray(params) && params.length ? params : null,
  });
}

export async function up(knex) {
  const hasAgentDefaultConfig = await knex.schema.hasColumn('users', 'agent_default_config_id');
  if (!hasAgentDefaultConfig) {
    await knex.raw(
      'ALTER TABLE users ADD COLUMN agent_default_config_id INTEGER REFERENCES agent_configs(id)'
    );
    await knex.raw('ALTER TABLE users ADD COLUMN agent_default_model TEXT');
    await knex.raw(
      'ALTER TABLE users ADD COLUMN reviewer_default_config_id INTEGER REFERENCES agent_configs(id)'
    );
    await knex.raw('ALTER TABLE users ADD COLUMN reviewer_default_model TEXT');
  }

  const users = await knex('users').select('id');
  for (const { id: userId } of users) {
    const session = await knex('sessions')
      .where({ user_id: userId })
      .whereNull('archived_at')
      .whereNotNull('agent_config_id')
      .orderByRaw('COALESCE(last_activity_at, updated_at, created_at) DESC')
      .select(
        'agent_config_id',
        'model',
        'model_params',
        'review_agent_config_id',
        'review_model',
        'review_model_params',
        'agent_sdk',
        'review_agent_sdk'
      )
      .first();
    if (!session) continue;

    const agentDefaultModel = stringifyDefaultModel(session.model, session.model_params);
    const reviewConfigId = session.review_agent_config_id ?? session.agent_config_id;
    const reviewModelField = session.review_model ?? session.model;
    const reviewParamsField = session.review_model_params ?? session.model_params;
    const reviewerDefaultModel = stringifyDefaultModel(reviewModelField, reviewParamsField);

    await knex('users').where({ id: userId }).update({
      agent_default_config_id: session.agent_config_id,
      agent_default_model: agentDefaultModel,
      reviewer_default_config_id: reviewConfigId,
      reviewer_default_model: reviewerDefaultModel,
    });
  }
}

export async function down(knex) {
  for (const col of [
    'reviewer_default_model',
    'reviewer_default_config_id',
    'agent_default_model',
    'agent_default_config_id',
  ]) {
    if (await knex.schema.hasColumn('users', col)) {
      await knex.raw(`ALTER TABLE users DROP COLUMN ${col}`);
    }
  }
}
