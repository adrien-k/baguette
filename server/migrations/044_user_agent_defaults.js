export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'agent_defaults'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN agent_defaults TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'agent_defaults')) {
    await knex.raw('ALTER TABLE users DROP COLUMN agent_defaults');
  }
}
