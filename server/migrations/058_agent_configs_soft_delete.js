export async function up(knex) {
  if (!(await knex.schema.hasColumn('agent_configs', 'deleted_at'))) {
    await knex.raw('ALTER TABLE agent_configs ADD COLUMN deleted_at TEXT');
  }
  await knex.raw('DROP INDEX IF EXISTS agent_configs_user_id_label_unique');
  await knex.raw(
    'CREATE UNIQUE INDEX agent_configs_user_id_label_unique ON agent_configs (user_id, label) WHERE deleted_at IS NULL'
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS agent_configs_user_id_label_unique');
  await knex.raw(
    'CREATE UNIQUE INDEX agent_configs_user_id_label_unique ON agent_configs (user_id, label)'
  );
  if (await knex.schema.hasColumn('agent_configs', 'deleted_at')) {
    await knex.raw('ALTER TABLE agent_configs DROP COLUMN deleted_at');
  }
}
