import { pickAgentConfigIdForSessionBackfill } from './053_agent_configs.js';
import { stringifyDefaultModel } from './lib/user-repo-defaults-backfill.js';
import { parseAgentSessionDefaultsJson } from '../../shared/agent-session-defaults.js';
import { accountAgentConfigLabel, CLAUDE_TOKEN_LABEL } from '../../shared/agent-config-labels.js';

/**
 * Account-level config ids for a user, resolved by the labels 053 created. 053 backfills the
 * account scope before any repo scope, so account configs own the bare labels ("Claude",
 * "Claude token", "Cursor", "Pi") while repo-scoped configs — auth-token rows included —
 * always carry the repo-short suffix.
 */
function accountScopeFromConfigs(configs) {
  const byLabel = (label) => configs.find((c) => c.label === label)?.id ?? null;
  return {
    primary: byLabel(accountAgentConfigLabel('claude')),
    token: byLabel(CLAUDE_TOKEN_LABEL),
    cursor: byLabel(accountAgentConfigLabel('cursor')),
    pi: byLabel(accountAgentConfigLabel('pi')),
  };
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

  const hasAgentDefaults = await knex.schema.hasColumn('users', 'agent_defaults');
  const users = await knex('users').select('id', ...(hasAgentDefaults ? ['agent_defaults'] : []));
  for (const { id: userId, agent_defaults: rawDefaults } of users) {
    // Pre-053 account defaults (Settings → Agent): a fixed SDK seeds the default config and
    // model/params directly; "last used" (agent_sdk null) keeps the session-based seeding below.
    const defaults = parseAgentSessionDefaultsJson(rawDefaults);
    if (defaults.agent_sdk) {
      const configs = await knex('agent_configs')
        .where({ user_id: userId })
        .orderBy('id', 'asc')
        .select('id', 'label', 'sdk', 'api_key_env_var');
      const configId = pickAgentConfigIdForSessionBackfill(
        undefined,
        accountScopeFromConfigs(configs),
        defaults.agent_sdk
      );
      if (configId != null) {
        const modelJson = stringifyDefaultModel(
          defaults.model,
          defaults.agent_sdk === 'cursor' ? defaults.model_params : null
        );
        await knex('users').where({ id: userId }).update({
          agent_default_config_id: configId,
          agent_default_model: modelJson,
          reviewer_default_config_id: configId,
          reviewer_default_model: modelJson,
        });
        continue;
      }
    }

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

  if (hasAgentDefaults) {
    await knex.raw('ALTER TABLE users DROP COLUMN agent_defaults');
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
  if (!(await knex.schema.hasColumn('users', 'agent_defaults'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN agent_defaults TEXT');
  }
}
