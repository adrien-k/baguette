export async function up(knex) {
  if (!(await knex.schema.hasColumn('repos', 'agent_fixed_push_branches'))) {
    await knex.raw('ALTER TABLE repos ADD COLUMN agent_fixed_push_branches TEXT');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('repos', 'agent_fixed_push_branches')) {
    await knex.raw('ALTER TABLE repos DROP COLUMN agent_fixed_push_branches');
  }
}
