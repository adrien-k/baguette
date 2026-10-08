export async function up(knex) {
  if (await knex.schema.hasColumn('agent_configs', 'default_model')) return;
  await knex.raw('ALTER TABLE agent_configs ADD COLUMN default_model TEXT');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('agent_configs', 'default_model'))) return;
  await knex.raw('ALTER TABLE agent_configs DROP COLUMN default_model');
}
