export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN anthropic_base_url TEXT');
  await knex.raw('ALTER TABLE user_repos ADD COLUMN anthropic_base_url TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE user_repos DROP COLUMN anthropic_base_url');
  await knex.raw('ALTER TABLE users DROP COLUMN anthropic_base_url');
}
