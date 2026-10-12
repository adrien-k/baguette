/**
 * Snapshot the agent configuration a turn runs with onto message rows and queued
 * rows. Turns read the row first (legacy null falls back to the session).
 *
 * Plain ADD COLUMN: SQLite does this natively (no table rebuild, FKs to
 * agent_configs stay untouched).
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('session_messages', 'agent_config_id'))) {
    await knex.raw(
      'ALTER TABLE session_messages ADD COLUMN agent_config_id INTEGER REFERENCES agent_configs(id)'
    );
  }
  if (!(await knex.schema.hasColumn('queued_messages', 'agent_config_id'))) {
    await knex.raw(
      'ALTER TABLE queued_messages ADD COLUMN agent_config_id INTEGER REFERENCES agent_configs(id)'
    );
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('session_messages', 'agent_config_id')) {
    await knex.raw('ALTER TABLE session_messages DROP COLUMN agent_config_id');
  }
  if (await knex.schema.hasColumn('queued_messages', 'agent_config_id')) {
    await knex.raw('ALTER TABLE queued_messages DROP COLUMN agent_config_id');
  }
}
