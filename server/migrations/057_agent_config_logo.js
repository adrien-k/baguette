export async function up(knex) {
  if (await knex.schema.hasColumn('agent_configs', 'logo')) return;
  await knex.raw('ALTER TABLE agent_configs ADD COLUMN logo TEXT');
}

export async function down(knex) {
  if (!(await knex.schema.hasColumn('agent_configs', 'logo'))) return;
  await knex.raw('ALTER TABLE agent_configs DROP COLUMN logo');
}
