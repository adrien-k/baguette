export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN anthropic_auth_token_encrypted TEXT');
  await knex.raw('ALTER TABLE user_repos ADD COLUMN anthropic_auth_token_encrypted TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE user_repos DROP COLUMN anthropic_auth_token_encrypted');
  await knex.raw('ALTER TABLE users DROP COLUMN anthropic_auth_token_encrypted');
}
