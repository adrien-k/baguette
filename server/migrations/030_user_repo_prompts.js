export async function up(knex) {
  await knex.raw('ALTER TABLE user_repos ADD COLUMN agent_prompt TEXT');
  await knex.raw('ALTER TABLE user_repos ADD COLUMN review_prompt TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE user_repos DROP COLUMN review_prompt');
  await knex.raw('ALTER TABLE user_repos DROP COLUMN agent_prompt');
}
