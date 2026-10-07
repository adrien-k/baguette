export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN pi_api_key_encrypted TEXT');
  await knex.raw('ALTER TABLE users ADD COLUMN pi_api_key_env_var TEXT');
  await knex.raw('ALTER TABLE user_repos ADD COLUMN pi_api_key_encrypted TEXT');
  await knex.raw('ALTER TABLE user_repos ADD COLUMN pi_api_key_env_var TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE user_repos DROP COLUMN pi_api_key_env_var');
  await knex.raw('ALTER TABLE user_repos DROP COLUMN pi_api_key_encrypted');
  await knex.raw('ALTER TABLE users DROP COLUMN pi_api_key_env_var');
  await knex.raw('ALTER TABLE users DROP COLUMN pi_api_key_encrypted');
}
