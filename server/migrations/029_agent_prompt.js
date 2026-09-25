export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN agent_prompt TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE users DROP COLUMN agent_prompt');
}
